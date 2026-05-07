export default async (req) => {
  const YAHOO_CLIENT_ID     = Netlify.env.get('YAHOO_CLIENT_ID');
  const YAHOO_CLIENT_SECRET = Netlify.env.get('YAHOO_CLIENT_SECRET');
  const LEAGUE_ID           = Netlify.env.get('YAHOO_LEAGUE_ID');

  if (!YAHOO_CLIENT_ID || !YAHOO_CLIENT_SECRET) {
    return new Response(JSON.stringify({ error: 'Yahoo credentials not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const url = new URL(req.url);
  const resource = url.searchParams.get('resource') || 'standings';
  const accessToken = url.searchParams.get('token');

  if (!accessToken) {
    return new Response(JSON.stringify({ error: 'No access token provided. Authenticate first via /api/yahoo-auth?action=login' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const YAHOO_BASE = 'https://fantasysports.yahooapis.com/fantasy/v2';
  const endpoints = {
    standings: `${YAHOO_BASE}/league/nhl.l.${LEAGUE_ID}/standings?format=json`,
    scoreboard: `${YAHOO_BASE}/league/nhl.l.${LEAGUE_ID}/scoreboard?format=json`,
    roster: `${YAHOO_BASE}/league/nhl.l.${LEAGUE_ID}/teams;out=roster,stats?format=json`,
    stats: `${YAHOO_BASE}/league/nhl.l.${LEAGUE_ID}/players;out=stats?format=json`,
  };

  const endpoint = endpoints[resource];
  if (!endpoint) {
    return new Response(JSON.stringify({ error: `Unknown resource. Use: ${Object.keys(endpoints).join(', ')}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const yahooRes = await fetch(endpoint, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const data = await yahooRes.json();
    return new Response(JSON.stringify(data), {
      status: yahooRes.ok ? 200 : yahooRes.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};

export const config = {
  path: '/api/yahoo-fantasy'
};
