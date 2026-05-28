export default async (req) => {
  const SUPABASE_URL      = Netlify.env.get('SUPABASE_DATABASE_URL');
  const SUPABASE_ANON_KEY = Netlify.env.get('SUPABASE_ANON_KEY');

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const url      = new URL(req.url);
  const resource = url.searchParams.get('resource') || 'standings';

  const headers = {
    'Content-Type':              'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control':             'public, max-age=60',
    'apikey':                    SUPABASE_ANON_KEY,
    'Authorization':             `Bearer ${SUPABASE_ANON_KEY}`,
  };

  // Helper to fetch from Supabase REST API
  async function sbFetch(table, params = '') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type':  'application/json',
      }
    });
    if (!res.ok) throw new Error(`Supabase error on ${table}: ${res.status}`);
    return res.json();
  }

  try {
    let data;

    switch (resource) {

      // All crawlers with their static info (used by all crawler pages)
      case 'crawlers': {
        data = await sbFetch('crawlers', '?select=*&order=display_name.asc');
        break;
      }

      // Full standings — crawlers + their latest weekly state
      case 'standings': {
        const [crawlers, weeklyState] = await Promise.all([
          sbFetch('crawlers', '?select=*'),
          sbFetch('weekly_state', '?select=*&order=week.desc'),
        ]);
        // Aggregate wins/losses/points across all weeks
        const totals = {};
        for (const row of weeklyState) {
          if (!totals[row.crawler_id]) {
            totals[row.crawler_id] = { wins: 0, losses: 0, points_for: 0, current_week: 0, loot_tokens: 0, pit_status: false };
          }
          totals[row.crawler_id].wins        += row.wins;
          totals[row.crawler_id].losses      += row.losses;
          totals[row.crawler_id].points_for  += parseFloat(row.points_for || 0);
          // Most recent week state
          if (row.week > totals[row.crawler_id].current_week) {
            totals[row.crawler_id].current_week   = row.week;
            totals[row.crawler_id].loot_tokens    = row.loot_tokens;
            totals[row.crawler_id].pit_status     = row.pit_status;
            totals[row.crawler_id].floor_modifier = row.floor_modifier;
          }
        }
        data = crawlers.map(c => ({
          ...c,
          ...(totals[c.id] || { wins: 0, losses: 0, points_for: 0, loot_tokens: 0, pit_status: false }),
        })).sort((a, b) => b.wins - a.wins || b.points_for - a.points_for);
        break;
      }

      // Inventory for all crawlers (or single crawler via ?crawler_id=N)
      case 'inventory': {
        const crawlerId = url.searchParams.get('crawler_id');
        const filter    = crawlerId ? `&crawler_id=eq.${crawlerId}` : '';
        data = await sbFetch('loot_inventory', `?select=*,crawlers(display_name)&is_active=eq.true${filter}&order=acquired_week.asc`);
        break;
      }

      // Achievements (all or per crawler)
      case 'achievements': {
        const crawlerId = url.searchParams.get('crawler_id');
        const filter    = crawlerId ? `&crawler_id=eq.${crawlerId}` : '';
        data = await sbFetch('achievements', `?select=*,crawlers(display_name)${filter}&order=week_earned.asc`);
        break;
      }

      // Matchups (all or per week)
      case 'matchups': {
        const week   = url.searchParams.get('week');
        const filter = week ? `&week=eq.${week}` : '';
        data = await sbFetch('matchups', `?select=*,crawler_1:crawlers!crawler_1_id(display_name),crawler_2:crawlers!crawler_2_id(display_name),winner:crawlers!winner_id(display_name)${filter}&order=week.desc`);
        break;
      }

      // Loot log for The Vault
      case 'loot_log': {
        const week   = url.searchParams.get('week');
        const filter = week ? `&week=eq.${week}` : '';
        data = await sbFetch('loot_log', `?select=*,crawlers(display_name)${filter}&order=week.desc,created_at.desc`);
        break;
      }

      // Weekly state for a specific crawler
      case 'weekly_state': {
        const crawlerId = url.searchParams.get('crawler_id');
        if (!crawlerId) throw new Error('crawler_id required for weekly_state');
        data = await sbFetch('weekly_state', `?crawler_id=eq.${crawlerId}&order=week.asc`);
        break;
      }

      // Floor data (current or all)
      case 'floors': {
        const week = url.searchParams.get('week');
        const filter = week
          ? `?week_start=lte.${week}&week_end=gte.${week}`
          : '?select=*&order=floor_number.asc';
        data = await sbFetch('floors', filter);
        break;
      }

      // Celestial boon status
      case 'celestial_boons': {
        data = await sbFetch('celestial_boons', '?select=*,crawlers(display_name)');
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown resource. Use: crawlers, standings, inventory, achievements, matchups, loot_log, weekly_state, floors, celestial_boons` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type':              'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':             'public, max-age=60',
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
  path: '/api/fetch-supabase'
};
