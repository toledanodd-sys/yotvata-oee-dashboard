/* Period picker shared by all screens: a calendar that matches the period type.
 *   day   → a month calendar (Sunday first); only days with an uploaded report can be picked
 *   week  → the weeks of a year by the dairy's week number (week 1 = the Saturday-to-Friday week that contains 1 January)
 *   month → the 12 months of a year
 * Usage: OEE_PICKER.open({ type: 'day'|'week'|'month', value: 'YYYY-MM-DD', keys: [available keys], onPick: function (key) {} })
 * Keys: day = the production day, week = the Saturday that starts it, month = the 1st of the month. */
(function () {
  'use strict';
  var MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  var WD = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parse(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function iso(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function add(s, n) { var d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function weekStart(s) { return add(s, -((parse(s).getUTCDay() + 1) % 7)); }
  function weekYear(k) { return +add(k, 6).slice(0, 4); }
  function weekNo(k) { return Math.round((parse(k) - parse(weekStart(weekYear(k) + '-01-01'))) / 604800000) + 1; }
  function dm(s) { return s.slice(8) + '/' + s.slice(5, 7); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var O = null, cur = null, sheet = null, scrim = null, lastFocus = null;
  function ensure() {
    if (sheet) return;
    css();
    scrim = document.createElement('div'); scrim.className = 'pp-scrim'; document.body.appendChild(scrim);
    sheet = document.createElement('div'); sheet.className = 'pp-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('dir', 'rtl');
    document.body.appendChild(sheet);
    scrim.addEventListener('click', close);
    sheet.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.hasAttribute('data-close')) { close(); return; }
      if (b.dataset.move) { cur = move(cur, +b.dataset.move); draw(); return; }
      if (b.dataset.pick) { var k = b.dataset.pick, fn = O.onPick; close(); if (fn) fn(k); return; }
      if (b.dataset.jump) { cur = O.type === 'day' ? b.dataset.jump.slice(0, 8) + '01' : b.dataset.jump; draw(); }
    });
    document.addEventListener('keydown', function (e) { if (O && e.key === 'Escape') close(); });
  }
  function move(c, n) {
    if (O.type === 'day') { var d = parse(c); d.setUTCMonth(d.getUTCMonth() + n); return iso(d).slice(0, 8) + '01'; }
    return String(+c + n); // week / month: c is the year
  }
  function avail(k) { return O.set[k] === 1; }
  function draw() {
    var h = '', keys = O.keys, first = keys[0], last = keys[keys.length - 1];
    var title = { day: 'בחירת יום', week: 'בחירת שבוע', month: 'בחירת חודש' }[O.type];
    h += '<div class="pp-head"><h3>' + title + '</h3><button type="button" class="pp-x" data-close aria-label="סגירה">✕</button></div>';
    var label, prevOk, nextOk;
    if (O.type === 'day') {
      label = MONTHS[+cur.slice(5, 7) - 1] + ' ' + cur.slice(0, 4);
      prevOk = first && first.slice(0, 7) < cur.slice(0, 7); nextOk = last && last.slice(0, 7) > cur.slice(0, 7);
    } else {
      label = cur;
      var yrs = keys.map(function (k) { return O.type === 'week' ? weekYear(k) : +k.slice(0, 4); });
      prevOk = yrs.length && Math.min.apply(null, yrs) < +cur; nextOk = yrs.length && Math.max.apply(null, yrs) > +cur;
    }
    h += '<div class="pp-nav"><button type="button" data-move="-1" aria-label="קודם"' + (prevOk ? '' : ' disabled') + '>›</button><b>' + esc(label) + '</b><button type="button" data-move="1" aria-label="הבא"' + (nextOk ? '' : ' disabled') + '>‹</button></div>';
    if (O.type === 'day') {
      var start = parse(cur), dow = start.getUTCDay(), dim = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
      h += '<div class="pp-grid pp-days">' + WD.map(function (w) { return '<span class="pp-wd">' + w + '</span>'; }).join('');
      for (var i = 0; i < dow; i++) h += '<span></span>';
      for (var d = 1; d <= dim; d++) {
        var k = cur.slice(0, 8) + pad(d), ok = avail(k);
        h += '<button type="button" data-pick="' + k + '"' + (ok ? '' : ' disabled') + ' aria-pressed="' + (k === O.value) + '" aria-label="' + d + ' ' + MONTHS[+cur.slice(5, 7) - 1] + (ok ? '' : ' — אין דוח') + '">' + d + '</button>';
      }
      h += '</div>';
    } else if (O.type === 'week') {
      var y = +cur, w = weekStart(y + '-01-01'), list = [];
      while (weekYear(w) === y) { list.push(w); w = add(w, 7); }
      h += '<div class="pp-grid pp-weeks">' + list.map(function (k) {
        var ok = avail(k);
        return '<button type="button" data-pick="' + k + '"' + (ok ? '' : ' disabled') + ' aria-pressed="' + (k === O.value) + '" title="' + dm(k) + '–' + dm(add(k, 6)) + '"><b>' + weekNo(k) + '</b><span dir="ltr">' + dm(k) + '</span></button>';
      }).join('') + '</div>';
    } else {
      h += '<div class="pp-grid pp-months">' + MONTHS.map(function (m, i) {
        var k = cur + '-' + pad(i + 1) + '-01', ok = avail(k);
        return '<button type="button" data-pick="' + k + '"' + (ok ? '' : ' disabled') + ' aria-pressed="' + (k === O.value) + '"><b>' + (i + 1) + '</b><span>' + m + '</span></button>';
      }).join('') + '</div>';
    }
    h += '<div class="pp-foot">' + (last ? '<button type="button" class="pp-link" data-jump="' + (O.type === 'day' ? last : String(O.type === 'week' ? weekYear(last) : last.slice(0, 4))) + '">לתקופה האחרונה עם נתונים</button>' : '') + '<span class="pp-note">אפורים = אין דוחות לתקופה</span></div>';
    sheet.innerHTML = h;
    var f = sheet.querySelector('[aria-pressed="true"]:not(:disabled)') || sheet.querySelector('[data-pick]:not(:disabled)') || sheet.querySelector('.pp-x');
    if (f) f.focus();
  }
  function open(o) {
    ensure();
    O = { type: o.type, value: o.value || '', keys: (o.keys || []).slice().sort(), onPick: o.onPick, set: {} };
    O.keys.forEach(function (k) { O.set[k] = 1; });
    var v = O.value || O.keys[O.keys.length - 1] || iso(new Date());
    cur = O.type === 'day' ? v.slice(0, 8) + '01' : String(O.type === 'week' ? weekYear(v) : v.slice(0, 4));
    lastFocus = document.activeElement;
    draw(); scrim.classList.add('open'); sheet.classList.add('open');
  }
  function close() {
    if (!sheet) return;
    scrim.classList.remove('open'); sheet.classList.remove('open'); O = null;
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) { /* element gone */ }
  }
  function css() {
    if (document.getElementById('pp-css')) return;
    var s = document.createElement('style'); s.id = 'pp-css';
    s.textContent = [
      '.pp-scrim{position:fixed;inset:0;background:rgba(22,32,42,.45);display:none;z-index:1200}.pp-scrim.open{display:block}',
      '.pp-sheet{position:fixed;left:0;right:0;bottom:0;background:#fff;color:#16202A;border-radius:16px 16px 0 0;padding:14px 16px 18px;z-index:1201;transform:translateY(110%);visibility:hidden;transition:transform .2s,visibility .2s;font-size:14px;max-height:90vh;overflow:auto;box-sizing:border-box}',
      '.pp-sheet.open{transform:none;visibility:visible}@media (min-width:760px){.pp-sheet{max-width:420px;margin:0 auto}}',
      '.pp-sheet *{box-sizing:border-box}.pp-sheet button{font:inherit;cursor:pointer}',
      '.pp-sheet button:focus-visible{outline:2px solid #2a78d6;outline-offset:2px}',
      '.pp-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}.pp-head h3{margin:0;font-size:17px}',
      '.pp-x{border:0;background:#EEF2F6;border-radius:50%;width:32px;height:32px}',
      '.pp-nav{display:grid;grid-template-columns:40px 1fr 40px;align-items:center;text-align:center;margin:6px 0 10px}',
      '.pp-nav button{height:36px;border:1px solid #D8E0E8;background:#fff;border-radius:8px;font-size:18px}.pp-nav button:disabled{opacity:.3;cursor:default}',
      '.pp-grid{display:grid;gap:5px}.pp-days{grid-template-columns:repeat(7,1fr)}.pp-weeks{grid-template-columns:repeat(6,1fr)}.pp-months{grid-template-columns:repeat(3,1fr)}',
      '.pp-wd{text-align:center;font-size:12px;color:#8393A3;padding-bottom:2px}',
      '.pp-grid button{border:1px solid #D8E0E8;background:#fff;border-radius:8px;min-height:40px;padding:4px 2px;color:#16202A;font-weight:600}',
      '.pp-weeks button,.pp-months button{display:flex;flex-direction:column;align-items:center;gap:1px;min-height:48px}',
      '.pp-grid button span{font-size:10.5px;font-weight:400;color:#4A5A6B}',
      '.pp-grid button:disabled{background:#F5F6F8;color:#C3CBD4;border-color:#EEF2F6;cursor:default;font-weight:400}.pp-grid button:disabled span{color:#C3CBD4}',
      '.pp-grid button[aria-pressed="true"]{background:#1c2b45;color:#fff;border-color:#1c2b45}.pp-grid button[aria-pressed="true"] span{color:#DDE4EC}',
      '.pp-grid button:not(:disabled):not([aria-pressed="true"]):hover{border-color:#2a78d6;background:#F2F7FD}',
      '.pp-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}',
      '.pp-link{border:0;background:none;color:#2a78d6;text-decoration:underline;padding:4px 0}.pp-note{font-size:12px;color:#8393A3}',
      /* the period bar used by the screens: arrows and label never move */
      '.pp-bar{display:grid;grid-template-columns:36px minmax(0,1fr) 36px;gap:6px;align-items:center;width:100%;max-width:420px}',
      '.pp-bar>button{height:36px;border:1px solid #D8E0E8;background:#fff;border-radius:9px;font-size:18px;cursor:pointer;color:#16202A}.pp-bar>button:disabled{opacity:.35;cursor:default}',
      '.pp-bar .pp-label{height:36px;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid #D8E0E8;background:#fff;border-radius:9px;font:inherit;font-weight:600;color:#16202A;padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.pp-bar .pp-label:after{content:"";width:14px;height:14px;flex:none;background:no-repeat center/14px url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%234A5A6B%27 stroke-width=%272%27%3E%3Crect x=%273%27 y=%275%27 width=%2718%27 height=%2716%27 rx=%272%27/%3E%3Cpath d=%27M3 10h18M8 3v4M16 3v4%27/%3E%3C/svg%3E")}',
      '.pp-bar button:focus-visible{outline:2px solid #2a78d6;outline-offset:2px}'
    ].join('\n');
    document.head.appendChild(s);
  }
  /* helper: html of the fixed period bar — prev / label (opens the calendar) / next */
  function barHtml(label, canPrev, canNext, attrs) {
    attrs = attrs || {};
    return '<div class="pp-bar"><button type="button" ' + (attrs.prev || '') + ' aria-label="תקופה קודמת"' + (canPrev ? '' : ' disabled') + '>›</button>' +
      '<button type="button" class="pp-label" ' + (attrs.open || '') + ' aria-label="בחירה מלוח שנה: ' + esc(label.replace(/<[^>]+>/g, '')) + '">' + label + '</button>' +
      '<button type="button" ' + (attrs.next || '') + ' aria-label="תקופה הבאה"' + (canNext ? '' : ' disabled') + '>‹</button></div>';
  }
  window.OEE_PICKER = { open: open, close: close, barHtml: barHtml, weekNo: weekNo, weekStart: weekStart, injectCss: css };
})();
