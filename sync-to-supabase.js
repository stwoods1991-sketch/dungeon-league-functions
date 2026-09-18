const { getStore } = require("@netlify/blobs");

const LEAGUE_ID = process.env.YAHOO_LEAGUE_ID;
const GAME_KEY  = process.env.YAHOO_GAME_KEY || "nhl";
const BASE_URL  = "https://fantasysports.yahooapis.com/fantasy/v2";

const SUPABASE_URL              = process.env.SUPABASE_URL || process.env.SUPABASE_DATABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// --- Token helpers (same as yahoo-stats.js) ---
function getTokenStore() {
  return getStore({
    name: "yahoo-tokens",
    siteID: "967be1b0-3761-4b81-93f4-631ba1be9ca3",
    token: process.env.BLOBS_TOKEN,
  });
}

async function getValidToken() {
  const store     = getTokenStore();
  const tokenData = await store.get("tokens", { type: "json" });
  if (!tokenData) throw new Error("NOT_AUTHORIZED: No tokens found. Visit /api/yahoo-auth to authorize.");
  if (Date.now() >= tokenData.expires_at - 60000) return refreshAccessToken(tokenData.refresh_token, store);
  return tokenData.access_token;
}

async function refreshAccessToken(refreshToken, store) {
  const credentials = Buffer.from(`${process.env.YAHOO_CLIENT_ID}:${process.env.YAHOO_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      redirect_uri:  "https://dungeon-league-functions.netlify.app/api/yahoo-callback",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error("Token refresh failed. Visit /api/yahoo-auth to re-authorize.");
  const tokens     = await res.json();
  const newTokenData = {
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token || refreshToken,
    expires_at:    Date.now() + tokens.expires_in * 1000,
    token_type:    tokens.token_type,
  };
  await store.set("tokens", JSON.stringify(newTokenData));
  return newTokenData.access_token;
}

// --- Yahoo fetch helper ---
async function yahooFetch(path, accessToken) {
  const res = await fetch(`${BASE_URL}${path}?format=json`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Yahoo API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// --- Supabase helpers (service role key bypasses RLS) ---
function sbHeaders(extra = {}) {
  return {
    "apikey":        SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
    ...extra,
  };
}

async function sb(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: sbHeaders(prefer ? { Prefer: prefer } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : [];
}

// Map Yahoo manager nickname -> crawler id, straight from the crawlers table.
// Add/fix a mapping by editing crawlers.yahoo_name in Supabase — no redeploy needed.
async function getCrawlerMap() {
  const crawlers = await sb("crawlers?select=id,display_name,yahoo_name");
  const byYahoo = {};
  for (const c of crawlers) {
    if (c.yahoo_name)    byYahoo[c.yahoo_name.trim()]    = c.id;
    if (c.display_name)  byYahoo[c.display_name.trim()] ??= c.id;
  }
  return byYahoo;
}

// --- Parse Yahoo scoreboard ---
function teamInfo(team) {
  const info = team[0];
  return {
    team_key: info.find(x => x.team_key)?.team_key || "",
    name:     info.find(x => x.name)?.name || "",
    manager:  (info.find(x => x.managers)?.managers?.[0]?.manager?.nickname || "").trim(),
    points:   parseFloat(team[1]?.team_points?.total || 0),
  };
}

function parseMatchups(data) {
  const matchups = data.fantasy_content.league[1].scoreboard["0"]?.matchups
                || data.fantasy_content.league[1].scoreboard.matchups;
  const result = [];
  for (let i = 0; i < matchups.count; i++) {
    const m     = matchups[i].matchup;
    const teams = m["0"].teams;
    result.push({
      week:            parseInt(m.week),
      status:          m.status || "",               // preevent | midevent | postevent
      is_tied:         String(m.is_tied) === "1",
      winner_team_key: m.winner_team_key || "",
      a: teamInfo(teams["0"].team),
      b: teamInfo(teams["1"].team),
    });
  }
  return result;
}

// --- Main handler ---
// GET /api/sync-to-supabase[?secret=...][&week=N]
//   default: syncs the current Yahoo scoreboard week
//   week=N : syncs a specific week (handy for backfilling a finished week)
exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  const secret = event.queryStringParameters?.secret;
  if (process.env.SYNC_SECRET && secret !== process.env.SYNC_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }
  if (!LEAGUE_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "YAHOO_LEAGUE_ID not configured" }) };
  }

  try {
    const accessToken = await getValidToken();
    const leagueKey   = `${GAME_KEY}.l.${LEAGUE_ID}`;
    const weekParam   = parseInt(event.queryStringParameters?.week);
    const scoreboard  = Number.isFinite(weekParam) ? `/league/${leagueKey}/scoreboard;week=${weekParam}` : `/league/${leagueKey}/scoreboard`;

    const [crawlerMap, matchupsData] = await Promise.all([
      getCrawlerMap(),
      yahooFetch(scoreboard, accessToken),
    ]);

    const matchups = parseMatchups(matchupsData);
    if (!matchups.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, week: null, synced_matchups: 0, note: "No matchups returned by Yahoo (between weeks / preseason)." }) };
    }
    const week = matchups[0].week;

    const unmapped = [];
    const matchupRows = [];
    const weeklyRows  = [];

    for (const m of matchups) {
      const c1 = crawlerMap[m.a.manager] ?? crawlerMap[m.a.name];
      const c2 = crawlerMap[m.b.manager] ?? crawlerMap[m.b.name];
      if (!c1) unmapped.push(m.a.manager || m.a.name);
      if (!c2) unmapped.push(m.b.manager || m.b.name);
      if (!c1 || !c2) continue;

      // Only lock in a winner once Yahoo says the week is over (postevent).
      // Mid-week, winner_id stays null so the crawler pages show "-" instead of a fake result.
      let winnerId = null;
      if (m.status === "postevent" && !m.is_tied) {
        if (m.winner_team_key)        winnerId = m.winner_team_key === m.a.team_key ? c1 : c2;
        else if (m.a.points !== m.b.points) winnerId = m.a.points > m.b.points ? c1 : c2;
      }

      matchupRows.push({ week, crawler_1_id: c1, crawler_2_id: c2, score_1: m.a.points, score_2: m.b.points, winner_id: winnerId, status: m.status || null });

      // Per-week rows (fetch-supabase sums these across weeks for standings — never write season totals here)
      weeklyRows.push({ week, crawler_id: c1, points_for: m.a.points, wins: winnerId === c1 ? 1 : 0, losses: winnerId === c2 ? 1 : 0 });
      weeklyRows.push({ week, crawler_id: c2, points_for: m.b.points, wins: winnerId === c2 ? 1 : 0, losses: winnerId === c1 ? 1 : 0 });
    }

    // matchups has no unique key on (week, c1, c2), so replace the week's rows (same pattern as commish.js saveWeek)
    await sb(`matchups?week=eq.${week}`, { method: "DELETE" });
    if (matchupRows.length) await sb("matchups", { method: "POST", body: matchupRows, prefer: "return=minimal" });

    // weekly_state: merge on (week, crawler_id) so pit_status / loot_tokens / floor_modifier set from the console survive.
    // Skipped while the week is still "preevent" — writing 0-point rows before puck drop would make the Vault and
    // crawler pages think Week N has started. Matchups above are still written so the pairing is visible.
    const weekStarted = matchups[0].status !== "preevent";
    if (weeklyRows.length && weekStarted)
      await sb("weekly_state?on_conflict=week,crawler_id", { method: "POST", body: weeklyRows, prefer: "resolution=merge-duplicates,return=minimal" });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success:         true,
        week,
        status:          matchups[0].status,
        synced_matchups: matchupRows.length,
        synced_crawlers: weekStarted ? weeklyRows.length : 0,
        ...(!weekStarted && { note: "Week is preevent — matchup pairings synced, weekly_state untouched until puck drop." }),
        ...(unmapped.length && { unmapped_yahoo_managers: [...new Set(unmapped)], hint: "Set crawlers.yahoo_name in Supabase to match these nicknames." }),
      }),
    };

  } catch (err) {
    const isAuthError = err.message.startsWith("NOT_AUTHORIZED");
    return {
      statusCode: isAuthError ? 401 : 500,
      headers,
      body: JSON.stringify({
        error: err.message,
        ...(isAuthError && { auth_url: "https://dungeon-league-functions.netlify.app/api/yahoo-auth" }),
      }),
    };
  }
};
