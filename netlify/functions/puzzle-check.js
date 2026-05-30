// puzzle-check.js  —  Netlify function for The Tenth Floor finale.
// Reachable at: https://dungeon-league-functions.netlify.app/api/puzzle-check
//
// The answer NEVER lives in the browser. It is read from a Netlify
// environment variable, so inspecting the terminal page reveals nothing.
//
// Set these in Netlify > Site settings > Environment variables:
//   PUZZLE_ANSWER = THE FLOOR IS YOURS    (spaces/case don't matter)
//   PUZZLE_CODE   = FLOOR-BOSS-SLAIN       (optional; the champion code returned on success)

// "*" matches the pattern used by the other functions (e.g. fetch-sheet).
const ORIGIN = "*";

const CORS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

// Normalize to bare uppercase letters so "the floor is yours",
// "THEFLOORISYOURS", and "The Floor Is Yours!" all match.
const norm = (s) => (s || "").toString().toUpperCase().replace(/[^A-Z]/g, "");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ ok: false, message: "METHOD NOT ALLOWED" }) };
  }

  let guess = "";
  try { guess = JSON.parse(event.body || "{}").guess; } catch (e) {}

  const answer = norm(process.env.PUZZLE_ANSWER);
  const code = process.env.PUZZLE_CODE || "FLOOR-BOSS-SLAIN";

  // Constant ~400ms delay to make blind brute-forcing impractical.
  await new Promise((r) => setTimeout(r, 400));

  if (answer && norm(guess) === answer) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        message: "THE DECREE IS BROKEN. THE FLOOR IS YOURS, CRAWLER.",
        code
      })
    };
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ok: false,
      message: "INCORRECT. THE DOOR DOES NOT MOVE. THE SYSTEM IS NOT ENTERTAINED."
    })
  };
};
