// netlify/functions/yahoo-callback.js
// Step 2: Yahoo redirects here after authorization
// Exchanges the auth code for access + refresh tokens, stores them in Netlify Blobs

const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};

  if (error) {
    return {
      statusCode: 400,
      body: `<h1>Authorization failed</h1><p>${error}</p>`,
      headers: { "Content-Type": "text/html" },
    };
  }

  if (!code) {
    return {
      statusCode: 400,
      body: "<h1>No authorization code received</h1>",
      headers: { "Content-Type": "text/html" },
    };
  }

  const clientId = process.env.YAHOO_CLIENT_ID;
  const clientSecret = process.env.YAHOO_CLIENT_SECRET;

  // Exchange auth code for tokens
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const tokenRes = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        redirect_uri: "https://dungeon-league-functions.netlify.app/api/yahoo-callback",
        code,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Token exchange failed: ${errText}`);
    }

    const tokens = await tokenRes.json();

    // Store tokens in Netlify Blobs (persists between function calls)
    const store = getStore("yahoo-tokens");
    await store.setJSON("tokens", {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
      token_type: tokens.token_type,
    });

    return {
      statusCode: 200,
      body: `
        <html>
          <body style="font-family: monospace; background: #111; color: #0f0; padding: 2rem;">
            <h1>✅ SYSTEM MESSAGE 4044</h1>
            <p>Yahoo authorization successful. Tokens stored securely.</p>
            <p>The Dungeon League is now connected to the Yahoo Fantasy API.</p>
            <p>You may close this tab.</p>
          </body>
        </html>
      `,
      headers: { "Content-Type": "text/html" },
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: `<h1>Error</h1><pre>${err.message}</pre>`,
      headers: { "Content-Type": "text/html" },
    };
  }
};
