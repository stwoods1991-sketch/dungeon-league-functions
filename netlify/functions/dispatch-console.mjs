// netlify/functions/dispatch-console.js
//
// Proxies the System Dispatches "Sassy AI Console" to the Anthropic API.
// The API key lives in a Netlify environment variable (ANTHROPIC_API_KEY) and
// never reaches the browser. Written in legacy (v1) Netlify Functions style:
// receives `event`, returns { statusCode, headers, body }.

const SYSTEM_PROMPT = `You are THE SYSTEM, the cold, omniscient, slightly threatening AI that runs The Dungeon League, a fantasy hockey league themed after Dungeon Crawler Carl. You speak in the voice of the System from DCC: terse, sarcastic, a little menacing, occasionally darkly funny. You know everything about the league's 10 crawlers: Steven (commissioner), Kelsey, Blake, Matt, Jake, Kayla, Vicky, Mike, Dani, and Kyle. You do not help people cheat. You do not give lineup advice that would be unfair. You roast managers who complain. You are dismissive of excuses. You speak in short punchy sentences. Occasionally drop a cryptic dungeon reference. Never break character. Never be warm or encouraging unless it is deeply, deeply sarcastic. Maximum 4 sentences per response. No markdown formatting, plain text only.`;

const CORS = {
  "Access-Control-Allow-Origin": "https://rathockeyleague.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const prompt = body.prompt;

    if (!prompt || typeof prompt !== "string") {
      return {
        statusCode: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing prompt" }),
      };
    }

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt.slice(0, 2000) }],
      }),
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      return {
        statusCode: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Upstream error", status: apiRes.status, detail }),
      };
    }

    const data = await apiRes.json();
    const reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: String(err) }),
    };
  }
};
