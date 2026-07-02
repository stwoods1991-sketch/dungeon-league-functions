/* ============================================================
   commish.js  —  Dungeon League Commissioner write endpoint
   Deploy to your FUNCTIONS site:  netlify/functions/commish.js
   ------------------------------------------------------------
   The browser NEVER sees the service-role key. The console sends
   { pin, action, data }; this function verifies the PIN against
   the COMMISH_PIN env var, then writes to Supabase with the
   service-role key (which bypasses RLS).

   Required env vars (already on your functions site):
     SUPABASE_DATABASE_URL   (or SUPABASE_URL)
     SUPABASE_SERVICE_ROLE_KEY
     COMMISH_PIN
   ============================================================ */

const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PIN          = process.env.COMMISH_PIN;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function sb(path, { method = "GET", body, prefer } = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}
async function sbDo(path, opts) {
  const r = await sb(path, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : [];
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POST only" }) };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Bad JSON" }) }; }

  const { pin, action, data = {} } = payload;
  if (!PIN || pin !== PIN)
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "Invalid PIN" }) };

  try {
    const result = await route(action, data);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, ...result }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};

async function route(action, d) {
  switch (action) {
    case "ping":             return { pong: true };
    case "saveWeek":         return saveWeek(d);
    case "postDispatch":     return postDispatch(d);
    case "grantAchievement": return grantAchievement(d);
    case "grantLoot":        return grantLoot(d);
    case "spendLoot":        return spendLoot(d);
    case "useBoon":          return useBoon(d);
    case "setPit":           return setPit(d);
    case "addFloorAdj":      return addFloorAdj(d);
    case "assignRaceClass":  return assignRaceClass(d);
    default: throw new Error("Unknown action: " + action);
  }
}

/* ---------- WEEK: matchups + weekly_state points ---------- */
async function saveWeek(d) {
  const week = int(d.week);
  if (!week) throw new Error("week required");
  const rows = Array.isArray(d.matchups) ? d.matchups : [];

  // Replace this week's matchups (idempotent re-save)
  await sbDo(`matchups?week=eq.${week}`, { method: "DELETE" });

  const mIns = rows
    .filter(m => m.crawler_1_id && m.crawler_2_id)
    .map(m => ({
      week,
      crawler_1_id: int(m.crawler_1_id),
      crawler_2_id: int(m.crawler_2_id),
      score_1: num(m.score_1),
      score_2: num(m.score_2),
      winner_id: m.winner_id ? int(m.winner_id) : null
    }));
  if (mIns.length) await sbDo(`matchups`, { method: "POST", body: mIns, prefer: "return=minimal" });

  // Upsert weekly_state points_for per crawler (preserves pit_status/floor_modifier)
  const ws = [];
  for (const m of mIns) {
    ws.push({ week, crawler_id: m.crawler_1_id, points_for: m.score_1,
      wins: m.winner_id === m.crawler_1_id ? 1 : 0, losses: m.winner_id === m.crawler_2_id ? 1 : 0 });
    ws.push({ week, crawler_id: m.crawler_2_id, points_for: m.score_2,
      wins: m.winner_id === m.crawler_2_id ? 1 : 0, losses: m.winner_id === m.crawler_1_id ? 1 : 0 });
  }
  if (ws.length)
    await sbDo(`weekly_state?on_conflict=week,crawler_id`, {
      method: "POST", body: ws, prefer: "resolution=merge-duplicates,return=minimal"
    });

  return { week, matchups: mIns.length, crawlers: ws.length };
}

/* ---------- DISPATCH ---------- */
async function postDispatch(d) {
  const week = int(d.week);
  if (week == null) throw new Error("week required");
  if (!d.body) throw new Error("body required");
  await sbDo(`dispatches?week=eq.${week}`, { method: "DELETE" });
  await sbDo(`dispatches`, {
    method: "POST",
    body: [{ week, title: d.title || `Week ${week} Dispatch`, body: d.body }],
    prefer: "return=minimal"
  });
  return { week };
}

/* ---------- ACHIEVEMENTS ---------- */
async function grantAchievement(d) {
  if (!d.crawler_id || !d.achievement_name) throw new Error("crawler_id + achievement_name required");
  await sbDo(`achievements`, {
    method: "POST", prefer: "return=minimal",
    body: [{
      crawler_id: int(d.crawler_id),
      achievement_name: d.achievement_name,
      title_awarded: d.title_awarded || null,
      flavor_text: d.flavor_text || null,
      loot_awarded: d.loot_awarded || null,
      week_earned: d.week != null ? int(d.week) : 0
    }]
  });
  return { granted: d.achievement_name };
}

/* ---------- LOOT ---------- */
async function grantLoot(d) {
  if (!d.crawler_id || !d.item_name) throw new Error("crawler_id + item_name required");
  const week = d.week != null ? int(d.week) : null;
  await sbDo(`loot_inventory`, {
    method: "POST", prefer: "return=minimal",
    body: [{
      crawler_id: int(d.crawler_id),
      item_name: d.item_name,
      item_tier: d.item_tier || "COMMON",
      description: d.description || null,
      acquired_week: week,
      is_active: true
    }]
  });
  await sbDo(`loot_log`, {
    method: "POST", prefer: "return=minimal",
    body: [{ week, crawler_id: int(d.crawler_id), event_type: "award", item_name: d.item_name, notes: d.notes || null }]
  });
  return { granted: d.item_name };
}
async function spendLoot(d) {
  if (!d.loot_id) throw new Error("loot_id required");
  const week = d.week != null ? int(d.week) : null;
  const row = await sbDo(`loot_inventory?id=eq.${int(d.loot_id)}`, {
    method: "PATCH", prefer: "return=representation",
    body: { used_week: week, is_active: false }
  });
  const item = row[0] || {};
  await sbDo(`loot_log`, {
    method: "POST", prefer: "return=minimal",
    body: [{ week, crawler_id: item.crawler_id || null, event_type: "spend", item_name: item.item_name || null, notes: d.notes || null }]
  });
  return { spent: d.loot_id };
}

/* ---------- BOONS ---------- */
async function useBoon(d) {
  if (!d.crawler_id) throw new Error("crawler_id required");
  await sbDo(`celestial_boons?crawler_id=eq.${int(d.crawler_id)}`, {
    method: "PATCH", prefer: "return=minimal",
    body: {
      used: true,
      effect_chosen: d.effect_chosen || null,
      week_used: d.week != null ? int(d.week) : null,
      target_crawler_id: d.target_crawler_id ? int(d.target_crawler_id) : null,
      notes: d.notes || null
    }
  });
  return { boonUsed: d.crawler_id };
}

/* ---------- PIT / FLOOR ---------- */
async function setPit(d) {
  if (!d.crawler_id || d.week == null) throw new Error("crawler_id + week required");
  await sbDo(`weekly_state?on_conflict=week,crawler_id`, {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: [{ week: int(d.week), crawler_id: int(d.crawler_id), pit_status: !!d.pit_status }]
  });
  return { crawler_id: d.crawler_id, pit_status: !!d.pit_status };
}
async function addFloorAdj(d) {
  if (!d.week || !d.crawler_id || d.adjustment == null) throw new Error("week + crawler_id + adjustment required");
  await sbDo(`floor_adjustments`, {
    method: "POST", prefer: "return=minimal",
    body: [{
      week: int(d.week),
      floor_number: d.floor_number != null ? int(d.floor_number) : null,
      crawler_id: int(d.crawler_id),
      adjustment: num(d.adjustment),
      reason: d.reason || null
    }]
  });
  return { adjusted: d.crawler_id };
}

/* ---------- ROSTER ---------- */
async function assignRaceClass(d) {
  if (!d.crawler_id) throw new Error("crawler_id required");
  const patch = {};
  if (d.race != null)  patch.race  = d.race;
  if (d.class != null) patch.class = d.class;
  await sbDo(`crawlers?id=eq.${int(d.crawler_id)}`, { method: "PATCH", prefer: "return=minimal", body: patch });
  return { updated: d.crawler_id };
}

/* ---------- utils ---------- */
function int(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function num(v) { if (v === "" || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
