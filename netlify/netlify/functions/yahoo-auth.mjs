export default async (req) => {
  const YAHOO_CLIENT_ID     = Netlify.env.get('YAHOO_CLIENT_ID');
  const YAHOO_CLIENT_SECRET = Netlify.env.get('YAHOO_CLIENT_SECRET');
  const REDIRECT_URI        = Netlify.env.get('YAHOO_REDIRECT_URI') || 'https://dungeon-league-functions.netlify.app/api/yahoo-callback';

  if (!YAHOO_CLIENT_ID || !YAHOO_CLIENT_SECRET) {
    return new Response(JSON.stringify({
      error: 'Yahoo API credentials not configured. Set YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET in Netlify environment variables.'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  if (action === 'login') {
    const authUrl = new URL('https://api.login.yahoo.com/oauth2/request_auth');
    authUrl.searchParams.set('client_id', YAHOO_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('language', 'en-us');
    return Response.redirect(authUrl.toString(), 302);
  }

  if (action === 'token') {
    const code = url.searchParams.get('code');
    if (!code) {
      return new Response(JSON.stringify({ error: 'No code provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const credentials = btoa(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`);
    const tokenRes = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code,
      })
    });

    const tokenData = await tokenRes.json();
    return new Response(JSON.stringify(tokenData), {
      status: tokenRes.ok ? 200 : 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action. Use ?action=login or ?action=token' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
};

export const config = {
  path: '/api/yahoo-auth'
};
