exports.handler = async () => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      has_client_id: !!process.env.YAHOO_CLIENT_ID,
      has_client_secret: !!process.env.YAHOO_CLIENT_SECRET,
      client_id_length: process.env.YAHOO_CLIENT_ID?.length || 0,
      all_env_keys: Object.keys(process.env).filter(k => k.startsWith('YAHOO')),
    }),
  };
};
