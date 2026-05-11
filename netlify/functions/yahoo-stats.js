// netlify/functions/yahoo-stats.js
// Main stats endpoint - fetches player stats from Yahoo Fantasy API
// Handles token refresh automatically when access token expires
//
// Supported query params:
//   ?type=players           → top players with stats (default)
//   ?type=standings         → league standings
//   ?type=matchups          → current week matchups
//   ?type=roster&team=3     → specific team roster (team number required)
//
// Example: /api/yahoo-stats?type=players

const { getStore } = require("@netlify/blobs");

const LEAGUE_ID = process.env.YAHOO_LEAGUE_ID || "10371";
const GAME_KEY = "nhl"; // Yahoo game key for NHL
const BASE_URL = "https://fantasysports.yahooapis.com/fantasy/v2";

// ── Token Management ──────────────────────────────────────────────────────────

async function getValidToken() {
  const store = getStore({
    name: "yahoo-tokens",
    siteID: "967be1b0-3761-4b81-93f4-631ba1be9ca3",
    token: process.env.NETLIFY_AUTH_TOKEN,
  });
  const tokenData = await store.getJSON("tokens");

  if (!tokenData) {
    throw new Error("NOT_AUTHORIZED: No tokens found. Visit /api/yahoo-auth to authorize.");
  }

  // Refresh if expired (with 60s buffer)
  if (Date.now() >= tokenData.expires_at - 60000) {
    return await refreshToken(tokenData.refresh_token, store);
  }

  return tokenData.access_token;
}

async function refreshToken(refreshToken, store) {
  const clientId = process.env.YAHOO_CLIENT_ID;
  const clientSecret = process.env.YAHOO_CLIENT_SECRET;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      redirect_uri: "https://dungeon-league-functions.netlify.app/api/yahoo-callback",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new Error("Token refresh failed. Visit /api/yahoo-auth to re-authorize.");
  }

  const tokens = await res.json();
  const newTokenData = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || refreshToken,
    expires_at: Date.now() + tokens.expires_in * 1000,
    token_type: tokens.token_type,
  };

  await store.setJSON("tokens", newTokenData);
  return newTokenData.access_token;
}

// ── Yahoo API Fetch Helper ────────────────────────────────────────────────────

async function yahooFetch(path, accessToken) {
  const url = `${BASE_URL}${path}?format=json`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Yahoo API error ${res.status}: ${errText}`);
  }

  return res.json();
}

// ── Data Parsers ──────────────────────────────────────────────────────────────

function parseStatCategories(data) {
  try {
    const categories =
      data.fantasy_content.game[1].stat_categories.stats.stat;
    return categories.reduce((acc, s) => {
      acc[s.stat_id] = s.display_name;
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function parsePlayers(data, statMap) {
  try {
    const playersRaw = data.fantasy_content.league[1].players;
    const players = [];

    for (let i = 0; i < playersRaw.count; i++) {
      const p = playersRaw[i].player;
      const info = p[0];
      const stats = p[1]?.player_stats?.stats?.stat || [];

      const name =
        info.find((x) => x.name)?.name?.full ||
        info.find((x) => x.name)?.name ||
        "Unknown";
      const team =
        info.find((x) => x.editorial_team_abbr)?.editorial_team_abbr || "—";
      const position =
        info.find((x) => x.display_position)?.display_position || "—";
      const ownership =
        info.find((x) => x.ownership)?.ownership?.ownership_type || "—";

      const statObj = {};
      stats.forEach((s) => {
        const label = statMap[s.stat_id] || `stat_${s.stat_id}`;
        statObj[label] = s.value;
      });

      players.push({ name, team, position, ownership, stats: statObj });
    }

    return players;
  } catch (err) {
    throw new Error(`Failed to parse players: ${err.message}`);
  }
}

function parseStandings(data) {
  try {
    const teams = data.fantasy_content.league[1].standings[0].teams;
    const result = [];

    for (let i = 0; i < teams.count; i++) {
      const t = teams[i].team;
      const info = t[0];
      const standings = t[2]?.team_standings;

      result.push({
        rank: standings?.rank,
        name: info.find((x) => x.name)?.name || "Unknown",
        manager: info.find((x) => x.managers)?.managers[0]?.manager?.nickname || "—",
        wins: standings?.outcome_totals?.wins,
        losses: standings?.outcome_totals?.losses,
        ties: standings?.outcome_totals?.ties,
        points_for: standings?.points_for,
        points_against: standings?.points_against,
      });
    }

    return result.sort((a, b) => a.rank - b.rank);
  } catch (err) {
    throw new Error(`Failed to parse standings: ${err.message}`);
  }
}

function parseMatchups(data) {
  try {
    const matchups =
      data.fantasy_content.league[1].scoreboard.matchups;
    const result = [];

    for (let i = 0; i < matchups.count; i++) {
      const m = matchups[i].matchup;
      const week = m.week;
      const teams = m["0"].teams;

      const teamA = teams["0"].team;
      const teamB = teams["1"].team;

      result.push({
        week,
        team_a: {
          name: teamA[0].find((x) => x.name)?.name || "—",
          points: teamA[1]?.team_points?.total || 0,
          projected: teamA[1]?.team_projected_points?.total || 0,
        },
        team_b: {
          name: teamB[0].find((x) => x.name)?.name || "—",
          points: teamB[1]?.team_points?.total || 0,
          projected: teamB[1]?.team_projected_points?.total || 0,
        },
      });
    }

    return result;
  } catch (err) {
    throw new Error(`Failed to parse matchups: ${err.message}`);
  }
}

function parseRoster(data) {
  try {
    const roster =
      data.fantasy_content.team[1].roster["0"].players;
    const players = [];

    for (let i = 0; i < roster.count; i++) {
      const p = roster[i].player;
      const info = p[0];
      players.push({
        name: info.find((x) => x.name)?.name?.full || "Unknown",
        position: info.find((x) => x.display_position)?.display_position || "—",
        team: info.find((x) => x.editorial_team_abbr)?.editorial_team_abbr || "—",
        selected_position:
          p[1]?.selected_position?.position || "—",
      });
    }

    return players;
  } catch (err) {
    throw new Error(`Failed to parse roster: ${err.message}`);
  }
}

// ── Main Handler ──────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const accessToken = await getValidToken();
    const type = event.queryStringParameters?.type || "players";
    const teamNum = event.queryStringParameters?.team;
    const leagueKey = `${GAME_KEY}.l.${LEAGUE_ID}`;

    let responseData;

    switch (type) {
      case "standings": {
        const data = await yahooFetch(
          `/league/${leagueKey}/standings`,
          accessToken
        );
        responseData = { type: "standings", data: parseStandings(data) };
        break;
      }

      case "matchups": {
        const data = await yahooFetch(
          `/league/${leagueKey}/scoreboard`,
          accessToken
        );
        responseData = { type: "matchups", data: parseMatchups(data) };
        break;
      }

      case "roster": {
        if (!teamNum) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "?team=N required for roster type" }),
          };
        }
        const teamKey = `${leagueKey}.t.${teamNum}`;
        const data = await yahooFetch(
          `/team/${teamKey}/roster`,
          accessToken
        );
        responseData = { type: "roster", team: teamNum, data: parseRoster(data) };
        break;
      }

      case "players":
      default: {
        // Fetch stat category labels first
        const gameData = await yahooFetch(
          `/game/${GAME_KEY}/stat_categories`,
          accessToken
        );
        const statMap = parseStatCategories(gameData);

        // Fetch top 25 players with season stats
        const data = await yahooFetch(
          `/league/${leagueKey}/players;count=25;sort=AR/stats`,
          accessToken
        );
        responseData = {
          type: "players",
          data: parsePlayers(data, statMap),
        };
        break;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(responseData),
    };
  } catch (err) {
    const isAuthError = err.message.startsWith("NOT_AUTHORIZED");
    return {
      statusCode: isAuthError ? 401 : 500,
      headers,
      body: JSON.stringify({
        error: err.message,
        ...(isAuthError && {
          auth_url: "https://dungeon-league-functions.netlify.app/api/yahoo-auth",
        }),
      }),
    };
  }
};
