export default async (req) => {
  const url = new URL(req.url);
  const sheet = url.searchParams.get('sheet') || 'standings';

  const SHEETS = {
    standings: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR5DwocI3ntiCLNrqmLPsgX1vc2IJStThmLy5UayT7Uks0VcRTTSOULRJ6qvMHjUK3p_YI9WshZT_An/pub?gid=137625083&single=true&output=csv',
    inventory: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR5DwocI3ntiCLNrqmLPsgX1vc2IJStThmLy5UayT7Uks0VcRTTSOULRJ6qvMHjUK3p_YI9WshZT_An/pub?gid=2072239518&single=true&output=csv',
  };

  const sheetUrl = SHEETS[sheet];
  if (!sheetUrl) {
    return new Response(JSON.stringify({ error: 'Unknown sheet' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const res = await fetch(sheetUrl);
    if (!res.ok) throw new Error(`Google returned ${res.status}`);
    const csv = await res.text();
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};

export const config = {
  path: '/api/fetch-sheet'
};
