const { getStore } = require("@netlify/blobs");

const LEAGUE_ID = process.env.YAHOO_LEAGUE_ID || "10371";
const GAME_KEY  = "nhl";
const BASE_URL  = "https://fantasysports.yahooapis.com/fantasy/v2";

const SUPABASE_URL              = process.env.SUPABASE_DATABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Manager name map: Yahoo nickname -> crawler display name
const MANAGER_NAME_MAP = {
  "Steven":  "Steven",
  "Kelsey":  "Kelsey",
  "Blake":   "Blake",
  "Matt":    "Matt",
  "J":       "Jake",
  "Kayla":   "Kayla",
  "Vicky":   "Vicky",
  "DotsonX": "Mike",
  "Dan":     "Dani",
  "Kyle":    "Kyle",
};

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
  if (!res.ok) throw new Error(`Yahoo API error ${res.status}`);
  return res.json();
}

// --- Supabase upsert helper (uses service role key for writes) ---
async function sbUpsert(table, rows, onConflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method:  "POST",
    headers: {
      "apikey":        SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type":  "application/json",
      "Prefer":        "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upsert failed on ${table}: ${err}`);
  }
  return res.status;
}

// --- Get crawler ID map from Supabase ---
async function getCrawlerIdMap() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/crawlers?select=id,display_name`, {
    headers: {
      "apikey":        SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const crawlers = await res.json();
  return Object.fromEntries(crawlers.map(c => [c.display_name, c.id]));
}

// --- Parse Yahoo standings ---
function parseStandings(data) {
  const teams = data.fantasy_content.league[1].standings[0].teams;
  const result = [];
  for (let i = 0; i < teams.count; i++) {
    const t          = teams[i].team;
    const info       = t[0];
    const standings  = t[2]?.team_standings;
    const manager    = info.find(x => x.managers)?.managers[0]?.manager?.nickname || "";
    const yahooName  = manager.trim();
    const displayName = MANAGER_NAME_MAP[yahooName] || yahooName;
    result.push({
      display_name:    displayName,
      wins:            parseInt(standings?.outcome_totals?.wins || 0),
      losses:          parseInt(standings?.outcome_totals?.losses || 0),
      points_for:      parseFloat(standings?.points_for || 0),
    });
  }
  return result;
}

// --- Parse Yahoo matchups ---
function parseMatchups(data) {
  const matchups = data.fantasy_content.league[1].scoreboard.matchups;
  const result   = [];
  for (let i = 0; i < matchups.count; i++) {
    const m     = matchups[i].matchup;
    const week  = parseInt(m.week);
    const teams = m["0"].teams;
    const teamA = teams["0"].team;
    const teamB = teams["1"].team;

    const managerA  = teamA[0].find(x => x.managers)?.managers[0]?.manager?.nickname?.trim() || "";
    const managerB  = teamB[0].find(x => x.managers)?.managers[0]?.manager?.nickname?.trim() || "";
    const scoreA    = parseFloat(teamA[1]?.team_points?.total || 0);
    const scoreB    = parseFloat(teamB[1]?.team_points?.total || 0);

    result.push({
      week,
      name_a:  MANAGER_NAME_MAP[managerA] || managerA,
      name_b:  MANAGER_NAME_MAP[managerB] || managerB,
      score_a: scoreA,
      score_b: scoreB,
    });
  }
  return result;
}

// --- Main handler ---
exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  // Optional: protect this endpoint with a secret so only you can trigger it
  const secret = event.queryStringParameters?.secret;
  if (process.env.SYNC_SECRET && secret !== process.env.SYNC_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  try {
    const accessToken  = await getValidToken();
    const leagueKey    = `${GAME_KEY}.l.${LEAGUE_ID}`;
    const crawlerIdMap = await getCrawlerIdMap();

    // Fetch from Yahoo
    const [standingsData, matchupsData] = await Promise.all([
      yahooFetch(`/league/${leagueKey}/standings`, accessToken),
      yahooFetch(`/league/${leagueKey}/scoreboard`, accessToken),
    ]);

    const standings = parseStandings(standingsData);
    const matchups  = parseMatchups(matchupsData);

    // Determine current week from matchups
    const currentWeek = matchups[0]?.week || 1;

    // Build weekly_state rows (wins/losses/points for current week only — cumulative is calculated at read time)
    const weeklyStateRows = standings.map(s => {
      const crawlerId = crawlerIdMap[s.display_name];
      if (!crawlerId) return null;
      return {
        week:       currentWeek,
        crawler_id: crawlerId,
        wins:       s.wins,
        losses:     s.losses,
        points_for: s.points_for,
      };
    }).filter(Boolean);

    // Build matchup rows
    const matchupRows = matchups.map(m => {
      const c1 = crawlerIdMap[m.name_a];
      const c2 = crawlerIdMap[m.name_b];
      if (!c1 || !c2) return null;
      const winnerId = m.score_a > m.score_b ? c1 : m.score_b > m.score_a ? c2 : null;
      return {
        week:          m.week,
        crawler_1_id:  c1,
        crawler_2_id:  c2,
        score_1:       m.score_a,
        score_2:       m.score_b,
        winner_id:     winnerId,
      };
    }).filter(Boolean);

    // Upsert into Supabase
    await Promise.all([
      sbUpsert("weekly_state", weeklyStateRows, "week,crawler_id"),
      sbUpsert("matchups",     matchupRows,     "week,crawler_1_id,crawler_2_id"),
    ]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success:      true,
        week:         currentWeek,
        synced_teams: weeklyStateRows.length,
        synced_matchups: matchupRows.length,
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
