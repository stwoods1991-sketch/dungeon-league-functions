// Scheduled wrapper around sync-to-supabase. Schedule lives in netlify.toml ([functions."sync-cron"]).
// Scheduled functions can't be hit over HTTP, so this just invokes the sync handler in-process
// and passes SYNC_SECRET so the auth check still passes.
const { handler: sync } = require("./sync-to-supabase.js");

exports.handler = async () => {
  const res = await sync({ queryStringParameters: { secret: process.env.SYNC_SECRET } });
  console.log(`[sync-cron] ${res.statusCode} ${res.body}`);
  return { statusCode: 200, body: res.body };
};
