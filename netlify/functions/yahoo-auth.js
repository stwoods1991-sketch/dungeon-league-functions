exports.handler = async () => {
  const clientId = process.env.YAHOO_CLIENT_ID;

  if (!clientId) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "YAHOO_CLIENT_ID not configured" }),
    };
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "https://dungeon-league-functions.netlify.app/api/yahoo-callback",
    response_type: "code",
    language: "en-us",
  });

  return {
    statusCode: 302,
    headers: {
      Location: `https://api.login.yahoo.com/oauth2/request_auth?${params.toString()}`,
    },
    body: "",
  };
};
