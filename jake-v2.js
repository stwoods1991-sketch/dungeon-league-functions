var API = 'https://dungeon-league-functions.netlify.app/api';
var CN = 'Jake';
var MM = {"Steven":"Steven","Kelsey":"Kelsey","Blake":"Blake","Matt":"Matt","J":"Jake","Kayla":"Kayla","Vicky":"Vicky","DotsonX":"Mike","Danica Miller":"Dani","Kyle":"Kyle"};

function af(r, e) {
  return fetch(API + '/fetch-supabase?resource=' + r + (e || '')).then(function(x) { return x.json(); });
}

function tierClass(t) {
  var s = (t || '').toLowerCase();
  if (s === 'celestial') return 'celestial';
  if (s === 'legendary') return 'legendary';
  if (s === 'rare') return 'rare';
  if (s === 'uncommon') return 'uncommon';
  return 'common';
}

function loadStandings() {
  af('standings').then(function(standings) {
    var me = standings.find(function(s) { return s.display_name === CN; });
    if (!me) return;
    var rk = standings.indexOf(me) + 1;
    var w = me.wins || 0;
    var l = me.losses || 0;
    var tot = w + l;
    var wp = tot > 0 ? (w / tot * 100).toFixed(1) + '%' : '-';
    var pts = parseFloat(me.points_for || 0).toFixed(1);
    document.getElementById('header-record').textContent = w + 'W - ' + l + 'L';
    document.getElementById('header-pts').textContent = 'PTS: ' + pts;
    document.getElementById('header-rank').textContent = 'RANK: #' + rk + ' OF 10';
    document.getElementById('stat-rank').textContent = '#' + rk;
    document.getElementById('stat-pts').textContent = pts;
    document.getElementById('stat-winpct').textContent = wp;
    document.getElementById('stat-wl').textContent = w + 'W / ' + l + 'L';
  }).catch(function(e) { console.error('Standings err:', e); });
}

function loadSupa() {
  af('crawlers').then(function(cs) {
    var c = cs.find(function(x) { return x.display_name === CN; });
    if (!c) return;
    var id = c.id;

    af('weekly_state', '&crawler_id=' + id).then(function(wks) {
      var last = wks[wks.length - 1];
      document.getElementById('pit-status-block').innerHTML = (last && last.pit_status)
        ? '<div class="pit-active">[ IN THE PIT - CRAWLER IS SUFFERING ]</div>'
        : '<div class="no-pit">[ NOT IN THE PIT - STANDING CLEAR ]</div>';

      af('matchups').then(function(ms) {
        var tb = document.getElementById('weekly-record-body');
        if (!wks.length) {
          tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);font-style:italic;padding:1.5rem;">Season has not yet begun. The System is watching.</td></tr>';
        } else {
          tb.innerHTML = wks.map(function(w) {
            var m = ms.find(function(x) {
              return x.week === w.week && (x.crawler_1 && x.crawler_1.display_name === CN || x.crawler_2 && x.crawler_2.display_name === CN);
            });
            var i1 = m && m.crawler_1 && m.crawler_1.display_name === CN;
            var on = m ? (i1 ? m.crawler_2.display_name : m.crawler_1.display_name) : '-';
            var os = m ? (i1 ? m.score_2 : m.score_1) : null;
            var sc = parseFloat(w.points_for || 0).toFixed(1);
            var adj = w.adjusted_points_for != null ? parseFloat(w.adjusted_points_for).toFixed(1) : '-';
            var res = m && m.winner_id ? (i1 ? (m.winner_id === m.crawler_1_id ? 'W' : 'L') : (m.winner_id === m.crawler_2_id ? 'W' : 'L')) : '-';
            var rc = res === 'W' ? 'score-win' : res === 'L' ? 'score-loss' : '';
            return '<tr><td>WK ' + w.week + '</td><td>' + on + '</td><td>' + sc + '</td><td class="score-adj">' + adj + '</td><td>' + (os !== null ? parseFloat(os).toFixed(1) : '-') + '</td><td class="' + rc + '">' + res + '</td></tr>';
          }).join('');
        }
      });
    });

    var pH = '';
    if (c.passive_name) {
      pH += '<div class="passive-block"><div class="passive-name">' + c.passive_name + '</div><div class="passive-desc">' + c.passive_description + '</div>' + (c.passive_trigger ? '<div class="passive-trigger">TRIGGER: ' + c.passive_trigger + '</div>' : '') + '</div>';
    }

    af('inventory', '&crawler_id=' + id).then(function(loot) {
      var bn = loot.find(function(l) { return l.item_tier === 'CELESTIAL'; });
      if (bn) {
        pH += '<div class="passive-block celestial"><div class="passive-name">' + bn.item_name + '</div><div class="passive-desc">' + (bn.description || '') + '</div><div class="passive-trigger">TRIGGER: Declare to Commissioner before Wednesday noon of target week - One use only</div></div>';
      }
      document.getElementById('passive-block').innerHTML = pH || '<div class="empty-loot">[ NO PASSIVE ASSIGNED ]</div>';

      var li = loot.filter(function(l) { return l.item_tier !== 'CELESTIAL'; });
      document.getElementById('loot-grid').innerHTML = !li.length
        ? '<div class="empty-loot">[ INVENTORY EMPTY ]</div>'
        : li.map(function(it) {
            var cl = tierClass(it.item_tier);
            var sc = it.is_active ? 'status-active' : 'status-used';
            return '<div class="loot-card ' + cl + '"><span class="loot-rarity">' + (it.item_tier || 'COMMON').toUpperCase() + '</span><div class="loot-name">' + it.item_name + '</div><div class="loot-desc">' + (it.description || '') + '</div><span class="loot-status ' + sc + '">' + (it.is_active ? 'ACTIVE' : 'USED') + '</span></div>';
          }).join('');
    });

    af('achievements', '&crawler_id=' + id).then(function(ach) {
      var tls = ach.filter(function(a) { return a.title_awarded; }).map(function(a) { return a.title_awarded; });
      var tcs = ['title-purple', 'title-gold', 'title-red', 'title-green'];
      document.getElementById('titles-strip').innerHTML = tls.length
        ? tls.map(function(t, i) { return '<span class="title-badge ' + tcs[i % tcs.length] + '">' + t + '</span>'; }).join('')
        : '';
      document.getElementById('achievement-list').innerHTML = !ach.length
        ? '<div class="empty-loot">[ NO ACHIEVEMENTS ]</div>'
        : ach.map(function(a) {
            return '<div class="achievement"><div><div class="achievement-name">' + a.achievement_name + '</div><div class="achievement-desc">' + (a.flavor_text || '') + '</div></div><div class="achievement-week">' + (a.week_earned === 0 ? 'PRE-SEASON' : 'WEEK ' + a.week_earned) + '</div></div>';
          }).join('');
    });

  }).catch(function(e) { console.error('Supa err:', e); });
}

function loadYahoo() {
  // Build nickname -> crawler map from Supabase (crawlers.yahoo_name) so renames don't require a redeploy
  af('crawlers').then(function(cs) {
    cs.forEach(function(c) {
      if (c.yahoo_name) MM[c.yahoo_name.trim()] = c.display_name;
      MM[c.display_name] = c.display_name;
    });
    return fetch(API + '/yahoo-stats?type=matchups').then(function(r) { return r.json(); });
  }).then(function(res) {
    var ms = res.data || [];
    function who(t) { return MM[t.manager] || MM[t.name] || t.manager || t.name; }
    var mm = ms.find(function(m) { return who(m.team_a) === CN || who(m.team_b) === CN; });
    if (mm) {
      var ia = who(mm.team_a) === CN;
      var me = ia ? mm.team_a : mm.team_b;
      var op = ia ? mm.team_b : mm.team_a;
      var mp = parseFloat(me.points) || 0;
      var opp = parseFloat(op.points) || 0;
      var mpj = (parseFloat(me.projected) || 0).toFixed(1);
      var opj = (parseFloat(op.projected) || 0).toFixed(1);
      var iw = mp >= opp;
      var done = mm.status === 'postevent';
      var pre = mm.status === 'preevent';
      var note = done ? (mm.is_tied ? 'FINAL - TIED' : (iw ? 'FINAL - VICTORY' : 'FINAL - DEFEAT'))
               : pre ? 'MATCHUP SET - AWAITING FIRST PUCK DROP'
               : (iw ? 'CURRENTLY WINNING' : 'CURRENTLY LOSING') + ' - SCORES UPDATE FROM YAHOO';
      document.getElementById('matchup-week').textContent = 'WEEK ' + mm.week;
      document.getElementById('matchup-body').innerHTML =
        '<div class="matchup-side"><div class="matchup-crawler ' + (iw ? 'winning' : 'losing') + '">' + CN + '</div><div class="matchup-pts ' + (iw ? 'winning' : 'losing') + '">' + mp.toFixed(1) + '</div><div class="matchup-proj">PROJ: ' + mpj + '</div></div>' +
        '<div class="matchup-center"><span class="matchup-vs-text">VS</span><div class="matchup-status-dot"></div></div>' +
        '<div class="matchup-side right"><div class="matchup-crawler ' + (!iw ? 'winning' : 'losing') + '">' + who(op) + '</div><div class="matchup-pts ' + (!iw ? 'winning' : 'losing') + '">' + opp.toFixed(1) + '</div><div class="matchup-proj">PROJ: ' + opj + '</div></div>';
      document.getElementById('matchup-note').textContent = '[ ' + note + ' ]';
    } else {
      document.getElementById('matchup-body').innerHTML = '<div style="grid-column:1/-1;text-align:center;font-family:var(--mono);font-size:11px;color:var(--text-dim);padding:1rem;">[ NO ACTIVE MATCHUP - BETWEEN WEEKS ]</div>';
      document.getElementById('matchup-note').textContent = '';
    }
  }).catch(function(e) { console.error('Yahoo err:', e); });
}

document.addEventListener('DOMContentLoaded', function() {
  loadStandings();
  loadSupa();
  loadYahoo();
});
