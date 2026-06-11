// netlify/functions/save-profile.js
//
// Reads and saves crawler race/class against the EXISTING `crawlers` table.
// Makes NO schema changes. Only ever touches the race and class columns.
//
//   GET  /api/save-profile  -> { data: [ {id, display_name, race, class} ] }
//                              PUBLIC columns only — never passive_* fields.
//   POST /api/save-profile  -> body { id, race, class }
//                              UPDATEs race/class for that ONE crawler id.
//
// Same Supabase service-role REST pattern as sync-to-supabase.js; the key
// stays in a Netlify env var and never reaches the browser. v1 style.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_DATABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EDIT_TOKEN = process.env.PROFILE_EDIT_TOKEN || ""; // optional write guard

const TABLE = "crawlers";
// Public columns ONLY. The passive_name / passive_description / passive_trigger
// columns are deliberately excluded and never read or written here.
const PUBLIC_COLS = "id,display_name,race,class";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-edit-token",
};
const reply = (statusCode, obj) => ({
  statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj),
});
const sbHeaders = (extra) => ({
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  ...extra,
});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return reply(500, { error: "Supabase env vars not configured" });
  }

  try {
    // ---- READ (public columns only) ----
    if (event.httpMethod === "GET") {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=${PUBLIC_COLS}&order=id`, {
        headers: sbHeaders(),
      });
      if (!res.ok) return reply(502, { error: "read failed", detail: await res.text() });
      return reply(200, { data: await res.json() });
    }

    // ---- SAVE (race/class for ONE crawler) ----
    if (event.httpMethod === "POST") {
      if (EDIT_TOKEN) {
        const sent = event.headers["x-edit-token"] || event.headers["X-Edit-Token"];
        if (sent !== EDIT_TOKEN) return reply(401, { error: "Not authorized to edit" });
      }

      const body = JSON.parse(event.body || "{}");
      const id = parseInt(body.id, 10);
      const race = String(body.race ?? "").trim().slice(0, 60);
      const klass = String(body.class ?? "").trim().slice(0, 60);

      // Hard guard: a valid positive integer id is REQUIRED. Without it we
      // never issue the PATCH, so a write can never hit more than one row.
      if (!Number.isInteger(id) || id <= 0) {
        return reply(400, { error: "invalid id" });
      }

      const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${id}`, {
        method: "PATCH",
        headers: sbHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify({ race, class: klass }),  // only these two columns
      });
      if (!res.ok) return reply(502, { error: "save failed", detail: await res.text() });

      const saved = await res.json();
      if (!saved.length) return reply(404, { error: "no crawler with that id" });
      return reply(200, { ok: true, saved: { id: saved[0].id, race: saved[0].race, class: saved[0].class } });
    }

    return reply(405, { error: "Method not allowed" });
  } catch (err) {
    return reply(500, { error: String(err) });
  }
};
