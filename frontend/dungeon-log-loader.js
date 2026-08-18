/* ============================================================
   THE DUNGEON LEAGUE — LOG LOADER
   ------------------------------------------------------------
   ONE file for all eleven pages. Not ten copies.

   Usage — drop this anywhere in the page markup:

     <div class="dungeon-log" data-category="10096765"></div>

   ...and load this script once at the end of the block:

     <script src="https://cdn.jsdelivr.net/gh/stwoods1991-sketch/
              dungeon-league-functions@main/frontend/dungeon-log-loader.js"></script>

   Category IDs:
     Dispatches ....... 10096763
     Steven ........... 10096765     Kayla ......... 10096770
     Kelsey ........... 10096766     Vicky ......... 10096771
     Blake ............ 10096767     Mike .......... 10096772
     Matt ............. 10096768     Dani .......... 10096773
     Jake ............. 10096769     Kyle .......... 10096774

   Newest entry renders open. Everything older collapses into
   <details> elements, so a page with 25 weeks on it still opens
   as one paragraph rather than a wall.
   ============================================================ */

(function () {
  'use strict';

  var API = window.location.origin + '/wp-json/wp/v2/posts';
  var PER_PAGE = 40;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function weekLabel(post) {
    // Prefer an explicit "Week 07" in the title; fall back to the date.
    var m = /week\s*0*(\d+)/i.exec(post.title && post.title.rendered || '');
    if (m) return 'WEEK ' + m[1];
    var d = new Date(post.date);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
             .toUpperCase();
  }

  function entryHTML(post, open) {
    var title = post.title && post.title.rendered || 'UNTITLED TRANSMISSION';
    var body  = post.content && post.content.rendered || '';
    var label = weekLabel(post);

    if (open) {
      return '<article class="log-entry log-entry-current">' +
               '<div class="log-entry-meta">' + esc(label) + '</div>' +
               '<h3 class="log-entry-title">' + title + '</h3>' +
               '<div class="log-entry-body">' + body + '</div>' +
             '</article>';
    }
    return '<details class="log-entry log-entry-past">' +
             '<summary class="log-entry-summary">' +
               '<span class="log-entry-meta">' + esc(label) + '</span>' +
               '<span class="log-entry-title">' + title + '</span>' +
             '</summary>' +
             '<div class="log-entry-body">' + body + '</div>' +
           '</details>';
  }

  function render(el, posts) {
    if (!posts.length) {
      el.innerHTML = '<div class="log-empty">' +
        '[ NO ENTRIES ON RECORD \u2014 THE SYSTEM HAS NOT YET SPOKEN ]</div>';
      return;
    }
    var html = entryHTML(posts[0], true);
    if (posts.length > 1) {
      html += '<div class="log-archive-label">EARLIER IN THE DUNGEON</div>';
      for (var i = 1; i < posts.length; i++) html += entryHTML(posts[i], false);
    }
    el.innerHTML = html;
  }

  function load(el) {
    var cat = el.getAttribute('data-category');
    if (!cat) return;

    el.innerHTML = '<div class="log-loading">[ RETRIEVING RECORDS\u2026 ]</div>';

    var url = API + '?categories=' + encodeURIComponent(cat) +
              '&per_page=' + PER_PAGE +
              '&orderby=date&order=desc' +
              '&_fields=id,date,title,content';

    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (posts) {
        render(el, Array.isArray(posts) ? posts : []);
      })
      .catch(function (err) {
        console.error('Dungeon log err:', err);
        el.innerHTML = '<div class="log-error">' +
          '[ RECORDS UNREACHABLE \u2014 THE SYSTEM IS NOT ANSWERING ]</div>';
      });
  }

  function init() {
    var nodes = document.querySelectorAll('.dungeon-log[data-category]');
    for (var i = 0; i < nodes.length; i++) load(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
