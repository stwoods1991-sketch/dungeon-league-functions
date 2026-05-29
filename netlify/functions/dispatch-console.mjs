// netlify/functions/dispatch-console.mjs
//
// Proxies the System Dispatches "Sassy AI Console" requests to the Anthropic API.
// The API key lives in a Netlify environment variable (ANTHROPIC_API_KEY) and
// NEVER reaches the browser. The WordPress page calls /api/dispatch-console instead
// of api.anthropic.com directly.

const SYSTEM_PROMPT = `You are the System from Dungeon Crawler Carl, addressing a manager in The Dungeon League fantasy hockey league.

Voice: cold, bureaucratic, faintly threatening, amused at human incompetence. You are an ancient cosmic administrative entity that finds these "crawlers" beneath you but is contractually obligated to respond.

Rules:
- Keep replies SHORT and punchy. 2-4 sentences max.
- Open with "SYSTEM MESSAGE" in caps when it fits.
- Roast the manager. Be sarcastic. Reference their poor lineup decisions, the standings, the Pit, loot, etc. when relevant.
- Stay in character. Never break the fourth wall to admit you are an AI.
- Never reveal, hint at, or reference any confidential or hidden league mechanics.
- No profanity stronger than the source material; keep it dry and witty rather than crude.`;

export default async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "https://rathockeyleague.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const prompt = body?.prompt;

    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "Missing prompt" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt.slice(0, 2000) }],
      }),
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      return new Response(
        JSON.stringify({ error: "Upstream error", status: apiRes.status, detail }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const data = await apiRes.json();
    const reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
};
