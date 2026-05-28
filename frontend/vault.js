var API = 'https://dungeon-league-functions.netlify.app/api';
var MM = {"Steven":"Steven","Kelsey":"Kelsey","Blake":"Blake","Matt":"Matt","J":"Jake","Kayla":"Kayla","Vicky":"Vicky","DotsonX":"Mike","Dan":"Dani","Kyle":"Kyle"};
var FLOORS = [
  {weeks:[1,2],   name:"Floor 1",  title:"The Lobby of False Promises"},
  {weeks:[3,4],   name:"Floor 2",  title:"The Mucus Swamps of Mild Inconvenience"},
  {weeks:[5,6],   name:"Floor 3",  title:"The Hall of Mirrored Failures"},
  {weeks:[7,8],   name:"Floor 4",  title:"The Bureaucratic Processing Center"},
  {weeks:[9,10],  name:"Floor 5",  title:"The Inverted Spire of Upside-Down Stats"},
  {weeks:[11,12], name:"Floor 6",  title:"The Canteen of Suspicious Generosity"},
  {weeks:[13,14], name:"Floor 7",  title:"The Gauntlet of Petty Rivalries"},
  {weeks:[15,16], name:"Floor 8",  title:"The Archive of Inconvenient Truths"},
  {weeks:[17,18], name:"Floor 9",  title:"The Chamber of Pure Chaos"},
  {weeks:[19,20,21], name:"Floor 10", title:"The Boss Floor: The Grinding Dark"}
];

var allPlayers = [];

function af(r, e) {
  return fetch(API + '/fetch-supabase?resource=' + r + (e || '')).then(function(x) { return x.json(); });
}

function switchTab(name, btn) {
  document.querySelectorAll('.vault-tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.vault-tab-panel').forEach(function(p) { p.classList.remove('active'); });
  document.getElementById('vault-tab-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'players' && allPlayers.length === 0) loadYahooPlayers();
}

// ── STANDINGS ──
function loadStandings() {
  af('standings').then(function(data) {
    // Status bar
    var currentWeek = 0;
    af('weekly_state', '&order=week.desc&limit=1').then(function(ws) {
      if (ws && ws.length) currentWeek = ws[0].week;
      document.getElementById('vault-week').textContent = currentWeek || 'PRE-SEASON';
      var floor = FLOORS.find(function(f) { return f.weeks.includes(currentWeek); }) || FLOORS[0];
      document.getElementById('vault-floor').textContent = floor.name + ' — ' + floor.title;
    }).catch(function() {
      document.getElementById('vault-week').textContent = 'PRE-SEASON';
    });

    // Pit status
    var inPit = data.filter(function(c) { return c.pit_status; });
    document.getElementById('vault-pit').textContent = inPit.length
      ? inPit.map(function(c) { return c.display_name; }).join(', ')
      : 'CLEAR';
    document.getElementById('vault-pit').style.color = inPit.length ? 'var(--red-bright)' : 'var(--green-bright)';

    // Summary cards
    if (data.length) {
      var leader = data[0];
      document.getElementById('vault-leader').textContent = leader.display_name;
      document.getElementById('vault-leader-sub').textContent = leader.wins + 'W — ' + parseFloat(leader.points_for).toFixed(1) + ' adj pts';

      var allWeekly = [];
      // We'll compute best week from weekly_state separately
      document.getElementById('vault-streak').textContent = '—';
    }

    // Standings table
    var tbody = document.getElementById('vault-standings-tbody');
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);font-style:italic;padding:2rem;">Season has not yet begun. The System is watching.</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(function(c, i) {
      var rank = i + 1;
      var tot = (c.wins || 0) + (c.losses || 0);
      var wp = tot > 0 ? (c.wins / tot * 100).toFixed(1) + '%' : '—';
      var pts = parseFloat(c.points_for || 0).toFixed(1);
      var avg = tot > 0 ? (parseFloat(c.points_for || 0) / tot).toFixed(1) : '—';
      var rankColor = rank === 1 ? 'var(--gold-light)' : rank === data.length ? 'var(--red-bright)' : 'var(--text-body)';
      return '<tr>' +
        '<td style="text-align:center;font-family:var(--display);color:' + rankColor + ';font-weight:700;">' + rank + '</td>' +
        '<td style="font-family:var(--display);color:var(--gold-light);letter-spacing:0.05em;">' + c.display_name + '</td>' +
        '<td style="text-align:center;color:var(--green-bright);">' + (c.wins || 0) + '</td>' +
        '<td style="text-align:center;color:var(--red-bright);">' + (c.losses || 0) + '</td>' +
        '<td style="text-align:right;color:var(--gold);">' + wp + '</td>' +
        '<td style="text-align:right;color:var(--gold-light);font-weight:700;">' + pts + '</td>' +
        '<td style="text-align:right;color:var(--text-dim);">' + avg + '</td>' +
      '</tr>';
    }).join('');

    // Best week card — load from weekly_state
    af('weekly_state').then(function(ws) {
      if (!ws || !ws.length) return;
      // Need crawler names — match by crawler_id from standings data
      var best = ws.reduce(function(a, b) { return parseFloat(b.points_for) > parseFloat(a.points_for) ? b : a; });
      var crawler = data.find(function(c) { return c.id === best.crawler_id; });
      document.getElementById('vault-high').textContent = parseFloat(best.points_for).toFixed(1);
      document.getElementById('vault-high-sub').textContent = (crawler ? crawler.display_name : '?') + ' — Wk ' + best.week;
    }).catch(function() {});

  }).catch(function(e) { console.error('Vault standings err:', e); });
}

// ── LOOT LOG ──
function loadLoot() {
  af('inventory').then(function(items) {
    var container = document.getElementById('vault-loot-container');
    if (!items || !items.length) {
      container.innerHTML = '<div class="empty-loot" style="text-align:center;padding:2rem;">[ NO LOOT AWARDED YET ]</div>';
      return;
    }
    // Sort by acquired_week desc
    items.sort(function(a, b) { return (b.acquired_week || 0) - (a.acquired_week || 0); });
    container.innerHTML = items.map(function(it) {
      var crawler = it.crawlers ? it.crawlers.display_name : '?';
      var tier = (it.item_tier || 'COMMON').toUpperCase();
      var tierClass = tier === 'CELESTIAL' ? 'celestial' : tier === 'LEGENDARY' ? 'legendary' : tier === 'RARE' ? 'rare' : tier === 'UNCOMMON' ? 'uncommon' : 'common';
      var wk = it.acquired_week === 0 ? 'PRE' : 'WK ' + it.acquired_week;
      var status = it.is_active ? 'ACTIVE' : 'USED';
      var statusColor = it.is_active ? 'var(--green-bright)' : 'var(--text-dim)';
      return '<div class="vault-loot-entry loot-' + tierClass + '" data-crawler="' + crawler + '" data-tier="' + tier + '">' +
        '<span class="vault-loot-week">' + wk + '</span>' +
        '<span class="vault-loot-who">' + crawler + '</span>' +
        '<span class="vault-loot-item"><strong>' + it.item_name + '</strong>' + (it.description ? ' — ' + it.description : '') + '</span>' +
        '<span class="vault-loot-tier loot-rarity">' + tier + '</span>' +
        '<span style="font-family:var(--mono);font-size:9px;color:' + statusColor + ';white-space:nowrap;">' + status + '</span>' +
      '</div>';
    }).join('');
  }).catch(function(e) { console.error('Vault loot err:', e); });
}

function filterLoot() {
  var crawlerVal = document.getElementById('vault-loot-filter-crawler').value;
  var tierVal = document.getElementById('vault-loot-filter-tier').value;
  document.querySelectorAll('.vault-loot-entry').forEach(function(el) {
    var mc = !crawlerVal || el.dataset.crawler === crawlerVal;
    var mt = !tierVal || el.dataset.tier === tierVal.toUpperCase();
    el.style.display = (mc && mt) ? '' : 'none';
  });
}

// ── FLAVOR STATS ──
function loadFlavor() {
  Promise.all([
    af('standings'),
    af('weekly_state'),
    af('achievements')
  ]).then(function(results) {
    var standings = results[0];
    var weeklyState = results[1];
    var achievements = results[2];

    // Current floor
    var maxWeek = weeklyState.length ? Math.max.apply(null, weeklyState.map(function(w) { return w.week; })) : 0;
    var floor = FLOORS.find(function(f) { return f.weeks.includes(maxWeek); }) || FLOORS[0];
    document.getElementById('vault-flavor-floor').textContent = floor.name;
    document.getElementById('vault-flavor-floor-detail').textContent = floor.title + ' — Weeks ' + floor.weeks[0] + '–' + floor.weeks[floor.weeks.length - 1];

    // Best/worst week
    if (weeklyState.length) {
      var best = weeklyState.reduce(function(a, b) { return parseFloat(b.points_for) > parseFloat(a.points_for) ? b : a; });
      var worst = weeklyState.reduce(function(a, b) { return parseFloat(b.points_for) < parseFloat(a.points_for) ? b : a; });
      var bestCrawler = standings.find(function(c) { return c.id === best.crawler_id; });
      var worstCrawler = standings.find(function(c) { return c.id === worst.crawler_id; });
      document.getElementById('vault-best-week').textContent = parseFloat(best.points_for).toFixed(1) + ' pts';
      document.getElementById('vault-best-week-detail').textContent = (bestCrawler ? bestCrawler.display_name : '?') + ' — Week ' + best.week;
      document.getElementById('vault-worst-week').textContent = parseFloat(worst.points_for).toFixed(1) + ' pts';
      document.getElementById('vault-worst-week-detail').textContent = (worstCrawler ? worstCrawler.display_name : '?') + ' — Week ' + worst.week;
    }

    // Most pit time
    var pitCounts = {};
    weeklyState.forEach(function(w) {
      if (w.pit_status) {
        var c = standings.find(function(s) { return s.id === w.crawler_id; });
        var name = c ? c.display_name : '?';
        pitCounts[name] = (pitCounts[name] || 0) + 1;
      }
    });
    var pitEntries = Object.entries(pitCounts);
    if (pitEntries.length) {
      pitEntries.sort(function(a, b) { return b[1] - a[1]; });
      document.getElementById('vault-pit-king').textContent = pitEntries[0][0];
      document.getElementById('vault-pit-king-detail').textContent = pitEntries[0][1] + ' week(s) in the pit. The System has noted this.';
    }

    // Total achievements
    document.getElementById('vault-total-achievements').textContent = achievements.length;

    // Celestial boons
    af('inventory').then(function(items) {
      var boons = items.filter(function(i) { return i.item_tier === 'CELESTIAL'; });
      var active = boons.filter(function(i) { return i.is_active; });
      document.getElementById('vault-boons').textContent = active.length + ' / ' + boons.length;
      document.getElementById('vault-boons-detail').textContent = active.length
        ? active.map(function(b) { return b.crawlers ? b.crawlers.display_name : '?'; }).join(', ') + ' — Unused'
        : 'All boons have been used.';
    }).catch(function() {});

  }).catch(function(e) { console.error('Vault flavor err:', e); });
}

// ── PLAYER STATS (Yahoo) ──
function loadYahooPlayers() {
  var tbody = document.getElementById('vault-players-tbody');
  tbody.innerHTML = '<tr><td colspan="13"><div class="shimmer" style="margin:10px 0;"></div></td></tr>';
  fetch(API + '/yahoo-stats?type=standings').then(function(r) { return r.json(); }).then(function(standJson) {
    var teams = standJson.data || [];
    var promises = teams.map(function(team) {
      return fetch(API + '/yahoo-stats?type=roster&team=' + team.team_id)
        .then(function(r) { return r.json(); })
        .then(function(j) { return { manager: team.manager, data: j.data || [] }; })
        .catch(function() { return { manager: team.manager, data: [] }; });
    });
    return Promise.all(promises);
  }).then(function(rosters) {
    allPlayers = [];
    rosters.forEach(function(roster) {
      var cn = MM[roster.manager] || roster.manager;
      roster.data.forEach(function(p) { allPlayers.push(Object.assign({}, p, { crawler: cn })); });
    });
    document.getElementById('vault-players-tag').textContent = '// LIVE ROSTER DATA — ' + allPlayers.length + ' PLAYERS TRACKED';
    filterPlayers();
  }).catch(function(e) {
    tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;color:var(--text-dim);padding:2rem;">[ YAHOO API UNAVAILABLE — AUTHENTICATE FIRST ]</td></tr>';
  });
}

function filterPlayers() {
  var crawlerVal = document.getElementById('vault-player-crawler').value;
  var posVal = document.getElementById('vault-player-pos').value;
  var sortVal = document.getElementById('vault-player-sort').value;
  var filtered = allPlayers.filter(function(p) {
    return (!crawlerVal || p.crawler === crawlerVal) && (!posVal || (p.position && p.position.includes(posVal)));
  });
  filtered.sort(function(a, b) {
    var as = a.stats || {}, bs = b.stats || {};
    return (parseFloat(bs[sortVal]) || 0) - (parseFloat(as[sortVal]) || 0);
  });
  var tbody = document.getElementById('vault-players-tbody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;color:var(--text-dim);padding:2rem;">[ NO PLAYERS MATCH FILTER ]</td></tr>';
    return;
  }
  var st = function(p) { return p.stats || {}; };
  tbody.innerHTML = filtered.map(function(p) {
    var pos = (p.selected_position && p.selected_position !== '—') ? p.selected_position : p.position;
    return '<tr>' +
      '<td style="font-family:var(--display);color:var(--text-bright);font-size:13px;">' + p.name + '</td>' +
      '<td style="text-align:center;color:var(--gold);">' + (pos || '—') + '</td>' +
      '<td style="color:var(--text-dim);">' + p.crawler + '</td>' +
      '<td style="text-align:right;">' + (st(p)['GP']  || '—') + '</td>' +
      '<td style="text-align:right;">' + (st(p)['G']   || '—') + '</td>' +
      '<td style="text-align:right;">' + (st(p)['A']   || '—') + '</td>' +
      '<td style="text-align:right;">' + (st(p)['+/-'] || '—') + '</td>' +
      '<td style="text-align:right;">' + (st(p)['PPP'] || '—') + '</td>' +
      '<td style="text-align:right;">' + (st(p)['SHP'] || '—') + '</td>' +
      '<td style="text-align:right;">' + (st(p)['SOG'] || '—') + '</td>' +
      '<td style="text-align:right;">' + (st(p)['HIT'] || '—') + '</td>' +
      '<td style="text-align:right;">' + (st(p)['BLK'] || '—') + '</td>' +
      '<td style="text-align:right;">' + (st(p)['PIM'] || '—') + '</td>' +
    '</tr>';
  }).join('');
}

document.addEventListener('DOMContentLoaded', function() {
  loadStandings();
  loadLoot();
  loadFlavor();
});
