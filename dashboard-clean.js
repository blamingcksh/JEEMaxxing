/* ============================================================================
   dashboard-clean.js v2 — Dashboard declutter + Time Bank card + layout FAB
   + momentum legend + persistent top-bar collapse. Append-only.
   - body.dc-active        → CSS hides cat banner + header badge row
   - body.dc-dash-active   → CSS hides "Grind Dashboard / Welcome back"
                             header ONLY while the dashboard tab is live
   - Reparents the Cloud Link cluster into the ☁ Cloud Storage settings card
   - Injects a live "Time Bank" card (total + per-subject study time) that
     mirrors the hidden header badge + pomodoro hour-stats (always in sync)
   - Adopts the bento .bento-toolbar as a floating panel behind a pencil FAB
   - Injects a legend into the Momentum Tracker
   - Persists sidebar collapsed/expanded state across refreshes
   No changes to app.js / pomodoro.js / bento.js / storage.js.
   ============================================================================ */
(function () {
  'use strict';
  if (window.__dashCleanInit) return;
  window.__dashCleanInit = true;

  var LS_SIDEBAR = 'jeemax_sidebar_collapsed';
  var fab = null, panel = null, dash = null, tries = 0;
  var timeCard = null, timeTotal = null, timeEls = {};
  var timeSrcTotal = null, timeSrcSubs = {};

  /* ── Top-bar collapse persistence ───────────────────────────────────── */
  function persistSidebar() {
    var sb = document.getElementById('sidebar') || document.querySelector('.sidebar');
    if (!sb || sb.__dcCollapseWatched) return;
    sb.__dcCollapseWatched = true;
    var saved = null;
    try { saved = localStorage.getItem(LS_SIDEBAR); } catch (e) {}
    if (saved === '1') {
      sb.classList.add('collapsed');
      var cb = sb.querySelector('.collapse-btn');
      if (cb) cb.textContent = '\u2192';           // keep app.js's label in sync
    }
    // toggleSidebar() flips this class → we persist every change.
    new MutationObserver(function () {
      try { localStorage.setItem(LS_SIDEBAR, sb.classList.contains('collapsed') ? '1' : '0'); } catch (e) {}
    }).observe(sb, { attributes: true, attributeFilter: ['class'] });
  }

  /* ── Dashboard-only header hiding ───────────────────────────────────── */
  function syncDashFlag() {
    if (!dash || !document.body) return;
    document.body.classList.toggle('dc-dash-active', dash.classList.contains('active'));
  }

  /* ── Cloud Link → Settings → Cloud Storage card ─────────────────────── */
  function moveCloudCluster() {
    var cluster = document.querySelector('.header-badges .sync-cluster') ||
                  document.querySelector('.sync-cluster');
    if (!cluster || cluster.classList.contains('dc-cloud-row')) return;
    var card = null;
    var cards = document.querySelectorAll('.settings-card');
    for (var i = 0; i < cards.length; i++) {
      var h = cards[i].querySelector('h3');
      if (h && /cloud/i.test(h.textContent)) { card = cards[i]; break; }
    }
    if (!card) card = document.querySelector('#view-settings .settings-card') ||
                      document.querySelector('.settings-card');
    if (!card) return;
    cluster.classList.add('dc-cloud-row');
    card.appendChild(cluster);
  }

  /* ── Time Bank card ─────────────────────────────────────────────────── */
  function chip(key, name) {
    return '<div class="dc-time-chip dc-' + key + '"><i></i><span>' + name +
           '</span><b id="dc-time-' + key + '">0m</b></div>';
  }
  function buildTimeCard() {
    if (timeCard || !dash) return;
    var grid = dash.querySelector('.dash-grid');
    if (!grid) return;
    timeCard = document.createElement('div');
    timeCard.className = 'dc-time-card';
    timeCard.innerHTML =
      '<div class="dc-time-main">' +
        '<div class="dc-time-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
          'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' +
        '</div>' +
        '<div class="dc-time-txt">' +
          '<span class="dc-time-kicker">TIME BANK · TODAY</span>' +
          '<span class="dc-time-total" id="dc-time-total">0m</span>' +
        '</div>' +
      '</div>' +
      '<div class="dc-time-subs">' +
        chip('phys', 'Physics') + chip('chem', 'Chemistry') + chip('math', 'Maths') +
      '</div>';
    dash.insertBefore(timeCard, grid);           // sits above the bento grid
    timeTotal = timeCard.querySelector('#dc-time-total');
    timeEls.phys = timeCard.querySelector('#dc-time-phys');
    timeEls.chem = timeCard.querySelector('#dc-time-chem');
    timeEls.math = timeCard.querySelector('#dc-time-math');
  }

  /* Live sources: the (hidden) ⏱ header badge + the pomodoro hour-stats.
     Both are kept fresh by pomodoro.js, so mirroring them is always right. */
  function watchNode(node) {
    if (!node || node.__dcWatched) return;
    node.__dcWatched = true;
    new MutationObserver(refreshTimes).observe(node,
      { childList: true, subtree: true, characterData: true });
  }
  function findTimeSources() {
    if (!timeSrcTotal) {
      var el = null;
      var ids = ['top-time', 'study-time', 'top-study', 'total-study-time'];
      for (var i = 0; i < ids.length && !el; i++) el = document.getElementById(ids[i]);
      if (!el) {
        var badges = document.querySelectorAll('.header-badges .badge');
        for (var j = 0; j < badges.length; j++) {
          if (badges[j].textContent.indexOf('\u23f1') !== -1) {   // ⏱
            el = badges[j].querySelector('.val') || badges[j];
            break;
          }
        }
      }
      if (el) { timeSrcTotal = el; watchNode(el); }
    }
    var names = { phys: 'physics', chem: 'chemistry', math: 'maths' };
    ['phys', 'chem', 'math'].forEach(function (k) {
      if (timeSrcSubs[k]) return;
      var stats = document.querySelectorAll('.hours-box .hour-stat');
      for (var i = 0; i < stats.length; i++) {
        var h = stats[i].querySelector('h4');
        if (h && h.textContent.toLowerCase().indexOf(names[k]) !== -1) {
          var v = stats[i].querySelector('.val');
          if (v) { timeSrcSubs[k] = v; watchNode(v); }
          break;
        }
      }
    });
  }
  function setText(el, txt) { if (el && el.textContent !== txt) el.textContent = txt; }
  function refreshTimes() {
    if (timeSrcTotal && timeTotal) {
      var t = (timeSrcTotal.textContent || '').trim();
      if (t) setText(timeTotal, t);
    }
    ['phys', 'chem', 'math'].forEach(function (k) {
      var src = timeSrcSubs[k], dst = timeEls[k];
      if (src && dst) { var v = (src.textContent || '').trim(); if (v) setText(dst, v); }
    });
  }

  /* ── Momentum legend ────────────────────────────────────────────────── */
  function buildMomentumLegend() {
    var mom = dash.querySelector('.dash-card-momentum');
    if (!mom || mom.querySelector('.dc-mom-legend')) return;
    var gd = mom.querySelector('.graph-display');
    if (!gd) return;
    var lg = document.createElement('div');
    lg.className = 'dc-mom-legend';
    lg.innerHTML =
      '<span class="dc-lg"><i class="lg-bull"></i>Bull</span>' +
      '<span class="dc-lg"><i class="lg-bear"></i>Bear</span>' +
      '<span class="dc-lg"><i class="lg-target"></i>Target lock</span>' +
      '<span class="dc-lg"><i class="lg-proj"></i>Projection</span>';
    gd.insertAdjacentElement('afterend', lg);
  }

  /* ── Pencil FAB + floating layout panel (unchanged from v1) ─────────── */
  function buildFab() {
    fab = document.createElement('button');
    fab.id = 'dc-layout-fab';
    fab.type = 'button';
    fab.title = 'Layout settings';
    fab.setAttribute('aria-label', 'Open layout settings');
    fab.setAttribute('aria-expanded', 'false');
    fab.innerHTML =
      '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    dash.appendChild(fab);
    fab.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panel && panel.classList.contains('open')) closePanel(); else openPanel();
    });
    document.addEventListener('pointerdown', function (e) {
      if (!panel || !panel.classList.contains('open')) return;
      if (panel.contains(e.target) || (fab && fab.contains(e.target))) return;
      closePanel();
    }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });
  }
  function openPanel() {
    if (!panel) return;
    panel.classList.add('open');
    if (fab) { fab.classList.add('active'); fab.setAttribute('aria-expanded', 'true'); }
  }
  function closePanel() {
    if (!panel) return;
    panel.classList.remove('open');
    if (fab) { fab.classList.remove('active'); fab.setAttribute('aria-expanded', 'false'); }
  }

  /* ── Boot + poll ─────────────────────────────────────────────────────── */
  function tick() {
    tries++;
    if (!document.body) { requestAnimationFrame(tick); return; }
    document.body.classList.add('dc-active');
    persistSidebar();
    moveCloudCluster();
    if (!dash) dash = document.getElementById('view-dashboard');
    if (dash && !dash.__dcViewWatched) {
      dash.__dcViewWatched = true;
      new MutationObserver(function () {
        syncDashFlag();
        if (!dash.classList.contains('active')) closePanel();
      }).observe(dash, { attributes: true, attributeFilter: ['class'] });
    }
    syncDashFlag();
    if (dash && !fab) buildFab();
    buildTimeCard();
    buildMomentumLegend();
    findTimeSources();
    refreshTimes();
    if (!panel) {
      var tb = (dash && dash.querySelector('.bento-toolbar')) ||
               document.querySelector('.bento-toolbar');
      if (tb) { panel = tb; panel.classList.add('dc-fab-panel'); }
    }
    if (!panel) {
      if (tries < 60) setTimeout(tick, 400);
      else if (fab && fab.parentNode) { fab.parentNode.removeChild(fab); fab = null; }
    }
  }

  setInterval(function () { findTimeSources(); refreshTimes(); }, 2000);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
  else tick();

  window.__dashClean = { open: openPanel, close: closePanel };
})();
