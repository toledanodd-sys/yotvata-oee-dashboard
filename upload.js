/* Upload page (admin only, separate from the dashboard) — built from the approved canvas mockup
 * "העלאת דוחות". Reads the two MES exports (HTML tables saved as .xls, UTF-16), detects the layer
 * (day / Sat–Fri week / calendar month), runs the pre-save checks and the official-vs-computed
 * comparison, and saves RAW + OEE together through ingest_report (replace / delete supported). */
(function () {
  'use strict';

  var API = window.OEE_API;
  var ENG = window.OEE_ENGINE;
  var root;

  // ---------- helpers ----------
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function parseIso(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function toIso(d) { return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function addDays(s, n) { var d = parseIso(s); d.setUTCDate(d.getUTCDate() + n); return toIso(d); }
  function daysBetween(a, b) { return Math.round((parseIso(b) - parseIso(a)) / 86400000); }
  function fmt(s) { var p = s.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function fmtShort(s) { var p = s.split('-'); return p[2] + '/' + p[1]; }
  function fmtDateTime(ts) {
    var d = new Date(ts);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  var MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  // production calendar — same rules as Date_Dim in the master file (week = Saturday → Friday)
  function weekStart(s) { var d = parseIso(s); return addDays(s, -((d.getUTCDay() + 1) % 7)); }
  function weekInfo(s) {
    var ws = weekStart(s), we = addDays(ws, 6);
    var wy = parseIso(we).getUTCFullYear();
    var first = weekStart(iso(wy, 1, 1));
    var wn = Math.floor(daysBetween(first, ws) / 7) + 1;
    return { start: ws, end: we, id: wy + '-W' + pad(wn), label: wy + '-W' + pad(wn) + ' | ' + fmtShort(ws) + '–' + fmtShort(we) };
  }
  function monthLabel(s) { var p = s.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function lastDayOfMonth(s) { var p = s.split('-'); return toIso(new Date(Date.UTC(+p[0], +p[1], 0))); }
  function productionToday() {
    var now = new Date();
    var d = iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
    return now.getHours() < 7 ? addDays(d, -1) : d;
  }
  function periodLabel(type, from, to) {
    if (type === 'DAY') return fmt(from) + ' · ' + WEEKDAYS[parseIso(from).getUTCDay()];
    if (type === 'WEEK') return weekInfo(from).label;
    return monthLabel(from);
  }
  var TYPE_NAME = { DAY: 'יומי', WEEK: 'שבועי', MONTH: 'חודשי' };

  function hmsToMin(s) {
    if (s === null || s === undefined || s === '') return 0;
    var p = String(s).trim().split(':').map(Number);
    if (p.some(isNaN)) return 0;
    return (p[0] || 0) * 60 + (p[1] || 0) + (p[2] || 0) / 60;
  }
  function numVal(s) {
    if (s === null || s === undefined || s === '') return null;
    var n = parseFloat(String(s).replace(/,/g, '').replace('%', ''));
    return isNaN(n) ? null : n;
  }
  function pctVal(s) { var n = numVal(s); return n === null ? null : n / 100; }
  function pctStr(v) { return v === null || v === undefined ? '—' : (Math.round(v * 10000) / 100).toFixed(2) + '%'; }

  // ---------- reading the MES files ----------
  function decodeEntities(s) { var ta = document.createElement('textarea'); ta.innerHTML = s; return ta.value; }
  function stripTags(s) { return s.replace(/<[^>]*>/g, ''); }

  function readFile(file) {
    return file.arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf);
      if (b[0] === 0x50 && b[1] === 0x4b) {
        throw new Error('הקובץ "' + file.name + '" נשמר מחדש באקסל. העלה את הקובץ המקורי כפי שיצא מה-MES, בלי לפתוח ולשמור אותו.');
      }
      var text;
      if (b[0] === 0xfe && b[1] === 0xff) text = new TextDecoder('utf-16be').decode(buf);
      else if ((b[0] === 0xff && b[1] === 0xfe) || (b.length > 1 && b[1] === 0)) text = new TextDecoder('utf-16le').decode(buf);
      else text = new TextDecoder('utf-8').decode(buf);
      var tIdx = text.search(/<table/i);
      if (tIdx < 0) throw new Error('לא נמצאה טבלה בקובץ "' + file.name + '". ודא שזה ייצוא דוח מה-MES.');
      var preamble = decodeEntities(stripTags(text.slice(0, tIdx)).replace(/&nbsp;/gi, ' '));
      var rows = [];
      var trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi, tr;
      while ((tr = trRe.exec(text))) {
        var cRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi, c, cells = [];
        while ((c = cRe.exec(tr[1]))) cells.push(decodeEntities(stripTags(c[1]).replace(/&nbsp;/gi, ' ')).trim());
        if (cells.length) rows.push(cells);
      }
      if (rows.length < 2) throw new Error('הקובץ "' + file.name + '" ריק.');
      var dates = [], m, dRe = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g;
      while ((m = dRe.exec(preamble))) dates.push(iso(+m[3], +m[2], +m[1]));
      if (!dates.length) throw new Error('לא נמצא טווח תאריכים בקובץ "' + file.name + '".');
      var from = dates[0], to = dates.length > 1 ? addDays(dates[dates.length - 1], -1) : dates[0];
      var header = rows[0].map(function (h) { return h.replace(/[‎‏﻿]/g, '').trim(); });
      var ix = {};
      header.forEach(function (h, i) { ix[h] = i; });
      var kind = ('סטטוס' in ix && 'מכונה' in ix && 'משך' in ix) ? 'RAW' : (('Oee' in ix && 'זמינות' in ix) ? 'OEE' : null);
      if (!kind) throw new Error('לא זיהיתי את סוג הקובץ "' + file.name + '" — לא דוח אירועים (RAW) ולא דוח OEE.');
      return { file: file.name, kind: kind, from: from, to: to, header: header, ix: ix, rows: rows.slice(1) };
    });
  }

  function toRawEvents(f) {
    var ix = f.ix, out = [];
    function g(r, n) { var i = ix[n]; return i === undefined ? '' : (r[i] || ''); }
    function ts(date, time) {
      if (!date) return null;
      var d = date.split('/'), t = (time || '00:00:00').split(':');
      var dt = new Date(+d[2], +d[1] - 1, +d[0], +t[0] || 0, +t[1] || 0, +t[2] || 0);
      return isNaN(dt) ? null : dt.toISOString();
    }
    f.rows.forEach(function (r) {
      var machine = ENG.norm(g(r, 'מכונה'));
      if (!machine) return;
      var sd = g(r, 'תאריך התחלה'), st = g(r, 'זמן התחלה');
      var day = f.from;
      if (sd) {
        var p = sd.split('/');
        day = iso(+p[2], +p[1], +p[0]);
        if (st && hmsToMin(st) < 7 * 60) day = addDays(day, -1);
      }
      out.push({
        machine: machine, production_date: day,
        status: ENG.norm(g(r, 'סטטוס')), stop_group: ENG.norm(g(r, 'קבוצת עצירה')), station: ENG.norm(g(r, 'תחנה')),
        description: ENG.norm(g(r, 'תיאור')), work_order: ENG.norm(g(r, 'פק"ע')), sku: ENG.norm(g(r, 'מק"ט')),
        start_at: ts(sd, st), end_at: ts(g(r, 'תאריך סיום'), g(r, 'זמן סיום')),
        duration_min: Math.round(hmsToMin(g(r, 'משך')) * 10000) / 10000,
        shift: ENG.norm(g(r, 'משמרת')), output_qty: numVal(g(r, 'תפוקה')), output_uom: ENG.norm(g(r, 'יחדת מידה לתפוקה')),
        raw: { plant: g(r, 'מפעל'), department: g(r, 'אגף'), operators: g(r, 'מפעיל/ים'), source_container: g(r, 'מיכל מקור') }
      });
    });
    return out;
  }

  function toOeeRows(f) {
    var ix = f.ix, col = ('יישות מפעלית' in ix) ? 'יישות מפעלית' : 'מכונה';
    return f.rows.filter(function (r) { return r[ix[col]]; }).map(function (r) {
      function g(n) { var i = ix[n]; return i === undefined ? '' : r[i]; }
      var raw = {};
      f.header.forEach(function (h, i) { raw[h] = r[i]; });
      return {
        entity: ENG.norm(g(col)), oee: pctVal(g('Oee')), availability: pctVal(g('זמינות')), performance: pctVal(g('יעילות')),
        quality: pctVal(g('איכות')), tdt_pct: pctVal(g('TDT%')), sap_good_units: numVal(g('SAP טובים')),
        net_minutes: hmsToMin(g('זמן ייצור נטו')), raw: raw
      };
    });
  }

  function detectType(from, to) {
    var n = daysBetween(from, to) + 1;
    if (n === 1) return { type: 'DAY' };
    if (n === 7 && weekStart(from) === from) return { type: 'WEEK' };
    if (from.slice(8) === '01' && to === lastDayOfMonth(from)) return { type: 'MONTH' };
    var why = n === 7 ? 'השבוע לא מתחיל בשבת (שבוע ייצור הוא שבת–שישי)' : n + ' ימים — לא יום, לא שבוע שבת–שישי ולא חודש מלא';
    return { type: null, why: why };
  }

  // ---------- state ----------
  var S = { mode: 'loading', data: null, stage: 'empty', preview: null, confirmBatch: null, busy: false, error: null };

  function toast(msg, isErr) {
    var t = document.createElement('div');
    t.className = 's-toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, isErr ? 7000 : 3000);
  }

  function loadData() {
    return Promise.all([
      API.select('machines?select=*&order=sort_order'),
      API.select('departments?select=*&order=sort_order'),
      API.select('machine_aliases?select=*'),
      API.select('classification_rules?select=*'),
      API.select('product_target_rates?select=*'),
      API.select('uploads?select=*&order=uploaded_at.desc&limit=400')
    ]).then(function (r) {
      S.data = { machines: r[0], depts: r[1], aliases: r[2], rules: ENG.prepareRules(r[3]), rates: r[4], uploads: r[5] };
    });
  }

  function start() {
    if (!API.session()) { S.mode = 'nologin'; render(); return; }
    S.mode = 'loading'; render();
    API.rpc('am_i_admin').then(function (ok) {
      if (!ok) { S.mode = 'nologin'; render(); return; }
      return loadData().then(function () { S.mode = 'ready'; render(); });
    }).catch(function (e) { S.mode = 'error'; S.error = e.message; render(); });
  }

  // ---------- analysis before saving ----------
  function analyse(files) {
    var d = S.data;
    var raw = files.filter(function (f) { return f.kind === 'RAW'; });
    var oee = files.filter(function (f) { return f.kind === 'OEE'; });
    if (raw.length !== 1 || oee.length !== 1) {
      throw new Error('צריך לגרור בדיוק שני קבצים: דוח אירועים (RAW) אחד ודוח OEE אחד. התקבלו ' + raw.length + ' RAW ו-' + oee.length + ' OEE.');
    }
    raw = raw[0]; oee = oee[0];
    var checks = [];
    var sameRange = raw.from === oee.from && raw.to === oee.to;
    if (!sameRange) throw new Error('הטווחים לא תואמים: RAW ' + fmt(raw.from) + '–' + fmt(raw.to) + ', OEE ' + fmt(oee.from) + '–' + fmt(oee.to) + '. יש להעלות שני דוחות של אותו טווח.');
    var det = detectType(raw.from, raw.to);
    if (!det.type) throw new Error('טווח לא סטנדרטי: ' + det.why + '.');
    checks.push({ kind: 'ok', title: 'שני הקבצים מכסים את אותו טווח' });

    var events = toRawEvents(raw);
    var oeeRows = toOeeRows(oee);
    var byName = {}, deptNames = {}, aliasBy = {};
    d.machines.forEach(function (m) { byName[m.name] = m; });
    d.depts.forEach(function (x) { deptNames[x.name] = true; });
    d.aliases.forEach(function (a) { aliasBy[a.alias] = a; });

    // OEE entities
    var unknownEnt = oeeRows.filter(function (o) { return !byName[o.entity] && !deptNames[o.entity] && o.entity !== 'יטבתה'; })
      .map(function (o) { return o.entity; });
    if (unknownEnt.length) checks.push({ kind: 'warn', title: unknownEnt.length + ' ישויות בדוח ה-OEE לא מוכרות במערכת', body: unknownEnt.join(', ') + ' — יישמרו כפי שהן, אבל לא יוצגו עד שיוגדרו' });
    else checks.push({ kind: 'ok', title: 'כל ' + oeeRows.length + ' הישויות בדוח ה-OEE מוכרות במערכת' });

    // machine names in RAW
    var counts = {};
    events.forEach(function (e) { counts[e.machine] = (counts[e.machine] || 0) + 1; });
    var unknown = Object.keys(counts).filter(function (n) { return !byName[n]; }).map(function (n) {
      var a = aliasBy[n];
      return { name: n, events: counts[n], saved: a ? (a.machine_id === null ? '' : String(a.machine_id)) : null };
    });

    // classification & rates per known machine
    var perMachine = {};
    events.forEach(function (e) {
      var m = byName[e.machine] || (aliasBy[e.machine] && aliasBy[e.machine].machine_id ? d.machines.filter(function (x) { return x.id === aliasBy[e.machine].machine_id; })[0] : null);
      if (!m) return;
      (perMachine[m.id] = perMachine[m.id] || []).push(e);
    });
    var unc = {}, miss = {};
    Object.keys(perMachine).forEach(function (mid) {
      mid = Number(mid);
      perMachine[mid].forEach(function (e) {
        if (!ENG.classify(e, d.rules, mid, e.production_date)) unc[mid + '|' + e.status + '|' + (e.stop_group || '') + '|' + (e.description || '')] = true;
        if (e.status === 'ייצור' && e.sku && (e.output_qty || 0) > 0) {
          var has = d.rates.some(function (r) { return r.machine_id === mid && r.sku === e.sku && ENG.validOn(r, e.production_date); });
          if (!has) miss[mid + '|' + e.sku] = true;
        }
      });
    });
    var uncKeys = Object.keys(unc), missKeys = Object.keys(miss);
    var mName = {};
    d.machines.forEach(function (m) { mName[m.id] = m.name; });
    if (uncKeys.length) {
      var ex = uncKeys.slice(0, 2).map(function (k) { var p = k.split('|'); return mName[p[0]] + ' › ' + (p[2] ? p[2] + ' › ' : '') + '"' + (p[3] || p[1]) + '"'; });
      checks.push({ kind: 'warn', title: uncKeys.length + ' צירופים שאין להם כלל סיווג', body: '(למשל ' + ex.join(', ') + '). האירועים יישמרו ויסומנו כלא מסווגים — אפשר לסווג אחר כך ב"כללי סיווג", והחישוב יתעדכן' });
    } else checks.push({ kind: 'ok', title: 'לכל האירועים יש כלל סיווג' });
    if (missKeys.length) {
      var ms = {};
      missKeys.forEach(function (k) { ms[mName[k.split('|')[0]]] = true; });
      checks.push({ kind: 'warn', title: missKeys.length + ' מק"טים בלי קצב מטרה', body: '(ב' + Object.keys(ms).join(', ') + ') — לכן אי אפשר לחשב יעילות למכונות האלה. אפשר להגדיר ב"מוצרים וקצב מטרה"' });
    } else checks.push({ kind: 'ok', title: 'לכל המק"טים שיוצרו יש קצב מטרה' });

    var existing = d.uploads.filter(function (u) { return u.status === 'OK' && u.period_type === det.type && u.period_from === raw.from && u.period_to === raw.to; });
    if (existing.length) checks.push({ kind: 'info', title: 'כבר קיים דוח ' + TYPE_NAME[det.type] + ' לטווח הזה', body: '(הועלה ב-' + fmtDateTime(existing[0].uploaded_at) + ') — השמירה תחליף אותו, והקודם יישאר ביומן כ"הוחלף"' });

    // official vs computed
    var oeeBy = {};
    oeeRows.forEach(function (o) { oeeBy[o.entity] = o; });
    var compare = d.machines.filter(function (m) { return m.is_active; }).map(function (m) {
      var off = oeeBy[m.name] || null;
      var c = ENG.computeMachine(perMachine[m.id] || [], d.rules, d.rates, m.id, off ? off.sap_good_units : null);
      return { name: m.name, off: off, calc: c };
    });

    return {
      raw: raw, oee: oee, type: det.type, from: raw.from, to: raw.to,
      events: events, oeeRows: oeeRows, checks: checks, unknown: unknown, compare: compare,
      machineCount: Object.keys(counts).length
    };
  }

  // ---------- rendering ----------
  function coverage() {
    var ups = S.data.uploads.filter(function (u) { return u.status === 'OK' && u.report_type === 'RAW'; });
    var today = productionToday(), yesterday = addDays(today, -1);
    var days = {}, weeks = {}, months = {};
    ups.forEach(function (u) {
      if (u.period_type === 'DAY') days[u.period_from] = true;
      if (u.period_type === 'WEEK') weeks[u.period_from] = true;
      if (u.period_type === 'MONTH') months[u.period_from] = true;
    });
    var cards = [];
    var dk = Object.keys(days).sort();
    if (!dk.length) cards.push({ title: 'דוחות יומיים', pill: 'עדיין אין', ok: false, line: 'עוד לא הועלה אף דוח יומי' });
    else {
      var missing = [];
      for (var x = dk[0]; x <= yesterday; x = addDays(x, 1)) if (!days[x]) missing.push(x);
      cards.push({
        title: 'דוחות יומיים', ok: !missing.length,
        pill: missing.length ? (missing.length === 1 ? 'חסר יום אחד' : 'חסרים ' + missing.length + ' ימים') : 'מעודכן ✓',
        line: 'עלה עד ' + fmt(dk[dk.length - 1]) + (missing.length ? ' · <b>חסר: ' + missing.slice(-5).map(fmtShort).join(', ') + (missing.length > 5 ? '…' : '') + '</b>' : '')
      });
    }
    var lastWeek = weekInfo(addDays(weekStart(today), -1));
    var cur = weekInfo(today);
    cards.push({
      title: 'דוחות שבועיים', ok: !!weeks[lastWeek.start],
      pill: weeks[lastWeek.start] ? 'מעודכן ✓' : 'חסר',
      line: (weeks[lastWeek.start] ? 'אחרון: ' + lastWeek.label : '<b>חסר: ' + lastWeek.label + '</b>') + ' · השבוע הנוכחי (' + cur.id.slice(5) + ') מוצג כ"מחושב" עד שיעלה הדוח הרשמי'
    });
    var t = parseIso(today);
    var prevMonth = toIso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1)));
    var dom = t.getUTCDate();
    cards.push({
      title: 'דוחות חודשיים', ok: !!months[prevMonth] || dom <= 10,
      pill: months[prevMonth] ? 'מעודכן ✓' : (dom <= 10 ? 'צפוי עד ה-10' : 'חסר'),
      line: months[prevMonth] ? 'אחרון: ' + monthLabel(prevMonth) : (dom <= 10 ? monthLabel(prevMonth) + ' עוד לא הועלה' : '<b>חסר: ' + monthLabel(prevMonth) + '</b>')
    });
    return cards;
  }

  function render() {
    if (!root) return;
    var h = '<div class="page"><a class="s-back" href="#/">→ חזרה לדשבורד</a>';
    if (S.mode === 'loading') h += '<div class="s-loading">טוען…</div>';
    else if (S.mode === 'nologin') {
      h += '<div class="s-login"><div class="s-panel"><h1 class="s-h2">נדרשת כניסת מנהל</h1><div class="s-muted" style="margin-bottom: 14px;">העלאת דוחות זמינה רק למנהל המערכת.</div>' +
        '<a class="s-btn" href="#/settings" style="display: inline-block; text-decoration: none;">כניסה</a></div></div>';
    } else if (S.mode === 'error') h += '<div class="s-empty s-bad">' + esc(S.error) + '</div>';
    else h += renderReady();
    h += '</div>';
    root.innerHTML = h;
  }

  function renderReady() {
    var h = '<div style="max-width: 1160px;"><div class="s-top"><div><h1 class="s-title">העלאת דוחות</h1>' +
      '<div class="s-sub">גוררים את שני הקבצים מה-MES — RAW ו-OEE — של אותו טווח. המערכת מזהה לבד אם זה דוח יומי, שבועי או חודשי, ומציגה בדיקות לפני שמירה</div></div></div>';
    h += '<div class="u-cover">';
    coverage().forEach(function (c) {
      h += '<div class="u-cover-card"><div class="u-cover-top"><span class="u-cover-title">' + c.title + '</span><span class="u-pill ' + (c.ok ? 'u-ok' : 'u-warn') + '">' + esc(c.pill) + '</span></div><div class="u-cover-line">' + c.line + '</div></div>';
    });
    h += '</div><div class="s-panel" id="u-drop-panel">';
    if (S.stage === 'preview' && S.preview) h += renderPreview(S.preview);
    else {
      h += '<label class="u-drop" id="u-drop" for="u-file"><div class="u-drop-title">' + (S.busy ? 'קורא את הקבצים…' : 'גרור לכאן את שני הקבצים, או לחץ לבחירה') + '</div>' +
        '<div class="u-drop-sub">gvPlantModelStateReport (RAW) + gvOeeReport (OEE) · אותו טווח תאריכים · קבצי ‎.xls כפי שיוצאים מה-MES, בלי לפתוח ולשמור מחדש</div></label>' +
        '<input id="u-file" type="file" accept=".xls,.xlsx,.html,.htm" multiple style="position: absolute; width: 1px; height: 1px; opacity: 0;">';
      if (S.error) h += '<div class="s-empty s-bad" style="margin: 12px 0 0;">' + esc(S.error) + '</div>';
    }
    h += '</div>';
    h += renderLog();
    return h + '</div>';
  }

  function renderPreview(p) {
    var d = S.data;
    var h = '<div class="u-detect"><span class="u-detect-type">דוח ' + TYPE_NAME[p.type] + '</span><div><div class="u-detect-range">' +
      (p.type === 'DAY' ? fmt(p.from) + ' 07:00 ← ' + fmt(addDays(p.from, 1)) + ' 07:00' : esc(periodLabel(p.type, p.from, p.to))) +
      '</div><div class="u-detect-sub">זוהה לפי טווח התאריכים שבתוך הקבצים · ' +
      (p.type === 'DAY' ? 'יום ייצור אחד (07:00–07:00)' : p.type === 'WEEK' ? 'שבוע ייצור שבת–שישי' : 'חודש קלנדרי מלא') + '</div></div></div>';
    h += '<div class="u-files"><div class="u-file"><div class="u-file-kind">דוח אירועים (RAW)</div><div class="u-file-name">' + esc(p.raw.file) + '</div><div class="u-file-stats">' +
      p.events.length.toLocaleString('he-IL') + ' אירועים · ' + p.machineCount + ' שמות מכונה</div></div>' +
      '<div class="u-file"><div class="u-file-kind">דוח OEE</div><div class="u-file-name">' + esc(p.oee.file) + '</div><div class="u-file-stats">' + p.oeeRows.length + ' ישויות</div></div></div>';
    h += '<h2 class="s-h3" style="margin-top: 4px;">בדיקות לפני שמירה</h2>';
    function check(c) {
      var ico = c.kind === 'ok' ? '<span class="u-check-ico i-ok">✓</span>' : c.kind === 'warn' ? '<span class="u-check-ico i-warn">!</span>' : '<span class="u-check-ico i-info">i</span>';
      return '<div class="u-check">' + ico + '<div class="u-check-body"><span class="u-check-title">' + esc(c.title) + '</span>' + (c.body ? ' ' + esc(c.body) : '') + '</div></div>';
    }
    p.checks.slice(0, 2).forEach(function (c) { h += check(c); });
    if (p.unknown.length) {
      h += '<div class="u-check"><span class="u-check-ico i-warn">!</span><div class="u-check-body"><span class="u-check-title">' + p.unknown.length +
        ' שמות מכונה בדוח ה-RAW לא מוכרים במערכת</span> — מה לעשות איתם?';
      p.unknown.forEach(function (u, i) {
        h += '<div class="u-map-row"><span class="u-map-name">' + esc(u.name) + '</span><span class="s-muted">' + (u.events === 1 ? 'אירוע אחד' : u.events + ' אירועים') + '</span>' +
          '<label for="map' + i + '" style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0);">שיוך עבור ' + esc(u.name) + '</label>' +
          '<select id="map' + i + '" class="u-select" data-alias="' + esc(u.name) + '"><option value="">להתעלם</option>';
        d.machines.forEach(function (m) { h += '<option value="' + m.id + '"' + (u.saved === String(m.id) ? ' selected' : '') + '>לשייך ל' + esc(m.name) + '</option>'; });
        h += '</select>' + (u.saved !== null ? '<span class="s-muted">(בחירה שנשמרה מפעם קודמת)</span>' : '') + '</div>';
      });
      h += '<div class="s-muted" style="margin-top: 6px;">מכונה חדשה מוסיפים ב"הגדרות › מכונות ואגפים". הבחירה כאן נשמרת לפעמים הבאות</div></div></div>';
    }
    p.checks.slice(2).forEach(function (c) { h += check(c); });

    h += '<h2 class="s-h3" style="margin-top: 18px;">רשמי מול מחושב — בדיקת אמינות לפני שמירה</h2>' +
      '<div class="s-muted" style="margin-bottom: 8px;">OEE מחושב לפי הנוסחה מקובץ המאסטר: זמינות מכללי הסיווג × יעילות מקצב המטרה × איכות (SAP טובים ÷ תפוקה). TDT מחושב באותו עיקרון: דקות העצירות שמסומנות "נכנס ל-TDT" ÷ זמן הבסיס. מוצג רק איפה שכל הנתונים קיימים — פער גדול מצביע על סיווג או דיווח ב-MES שכדאי לבדוק</div>';
    h += '<div class="s-table-wrap"><table class="s-table"><thead><tr><th>מכונה</th><th>OEE רשמי</th><th>OEE מחושב</th><th>פער</th><th>TDT רשמי</th><th>TDT מחושב</th></tr></thead><tbody>';
    p.compare.forEach(function (r) {
      var off = r.off, c = r.calc;
      var gap = (off && off.oee !== null && c.oee !== null) ? (c.oee - off.oee) * 100 : null;
      h += '<tr><td style="font-weight: 700;">' + esc(r.name) + '</td><td class="s-num">' + (off ? pctStr(off.oee) : '—') + '</td>' +
        (c.oee !== null ? '<td class="s-num">' + pctStr(c.oee) + '</td>' : '<td class="u-na">' + esc(c.reason || '—') + '</td>') +
        (gap !== null ? '<td class="' + (gap >= 0 ? 'u-gap-pos' : 'u-gap-neg') + '">' + (gap > 0 ? '+' : '') + gap.toFixed(2) + ' נק\'</td>' : '<td class="s-no">—</td>') +
        '<td class="s-num">' + (off ? pctStr(off.tdt_pct) : '—') + '</td>' +
        (c.tdt !== null ? '<td class="s-num">' + pctStr(c.tdt) + '</td>' : '<td class="u-na">' + (c.tdtKnown ? esc(c.reason || '—') : 'ממתין להגדרת TDT') + '</td>') + '</tr>';
    });
    h += '</tbody></table></div>';
    h += '<div style="display: flex; gap: 8px; margin-top: 16px;"><button class="s-btn" type="button" data-act="save"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'שומר…' : 'שמירה במערכת') + '</button>' +
      '<button class="s-btn s-btn-ghost" type="button" data-act="cancel"' + (S.busy ? ' disabled' : '') + '>ביטול</button></div>';
    return h;
  }

  function renderLog() {
    var d = S.data, batches = {}, order = [];
    d.uploads.forEach(function (u) {
      var k = u.batch_id || ('u' + u.id);
      if (!batches[k]) { batches[k] = { key: k, batch: u.batch_id, files: [] }; order.push(k); }
      batches[k].files.push(u);
    });
    var h = '<div class="s-panel"><div class="s-panel-head"><div><h2 class="s-h2">יומן העלאות</h2>' +
      '<div class="s-muted">כל העלאה נשמרת בשכבה שלה (יומי / שבועי / חודשי). "החלפה" — מעלים קבצים מתוקנים לאותו טווח, אחרי תיקון דיווחים ב-MES. "מחיקה" — מסירה את הנתונים של הטווח מהדשבורד (למשל אם עלה קובץ לא נכון). בשני המקרים השורה נשארת ביומן לתיעוד</div></div></div>';
    var conf = S.confirmBatch ? batches[S.confirmBatch] : null;
    if (conf) {
      var u0 = conf.files[0], rawF = conf.files.filter(function (f) { return f.report_type === 'RAW'; })[0] || u0;
      var layer = { DAY: 'היומית', WEEK: 'השבועית', MONTH: 'החודשית' }[u0.period_type] || '';
      h += '<div class="u-del"><div class="u-del-title">למחוק את הדוח ה' + TYPE_NAME[u0.period_type] + ' של ' + esc(periodLabel(u0.period_type, u0.period_from, u0.period_to)) + '?</div><ul class="u-del-list">' +
        '<li>יימחקו ' + (rawF.row_count || 0).toLocaleString('he-IL') + ' אירועים מהשכבה ' + layer + ', וגם שורות ה-OEE של אותו טווח</li>' +
        '<li>בתצוגה ' + layer + ' בדשבורד הטווח יופיע כ"חסר" עד שתעלה דוח חדש</li>' +
        '<li>שכבות אחרות לא מושפעות — דוחות יומיים לא נמחקים בגלל מחיקת דוח שבועי, ולהפך</li>' +
        '<li>השורה נשארת ביומן בסטטוס "נמחק"</li></ul>' +
        '<div style="display: flex; gap: 8px;"><button class="s-btn u-btn-danger" type="button" data-act="do-delete"' + (S.busy ? ' disabled' : '') + '>מחיקה סופית</button>' +
        '<button class="s-btn s-btn-ghost" type="button" data-act="cancel-delete">ביטול</button></div></div>';
    }
    if (!order.length) return h + '<div class="s-empty">עוד לא הועלו דוחות.</div></div>';
    h += '<div class="s-table-wrap"><table class="s-table"><thead><tr><th>הועלה</th><th>סוג</th><th>טווח</th><th>אירועים</th><th>סטטוס</th><th></th></tr></thead><tbody>';
    order.slice(0, 60).forEach(function (k) {
      var b = batches[k], u0 = b.files[0];
      var rawF = b.files.filter(function (f) { return f.report_type === 'RAW'; })[0] || u0;
      var st = u0.status;
      var stLabel = st === 'OK' ? 'פעיל' : st === 'REPLACED' ? 'הוחלף' : st === 'DELETED' ? 'נמחק' : st;
      var stCls = st === 'OK' ? 'u-status-active' : st === 'DELETED' ? 'u-status-deleted' : 'u-status-replaced';
      h += '<tr><td class="s-code">' + fmtDateTime(u0.uploaded_at) + '</td><td>' + (TYPE_NAME[u0.period_type] || '—') + '</td>' +
        '<td class="s-code">' + esc(u0.period_type ? periodLabel(u0.period_type, u0.period_from, u0.period_to) : '') + '</td>' +
        '<td class="s-num">' + (rawF.row_count || 0).toLocaleString('he-IL') + '</td><td class="' + stCls + '">' + stLabel + '</td>' +
        '<td style="text-align: left; white-space: nowrap;">' + (st === 'OK' && b.batch
          ? '<button class="s-btn s-btn-ghost s-btn-sm" type="button" data-act="replace">החלפה</button> <button class="s-btn s-btn-danger-ghost s-btn-sm" type="button" data-act="ask-delete" data-batch="' + esc(b.batch) + '">מחיקה</button>'
          : '') + '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  // ---------- actions ----------
  function handleFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    S.error = null; S.busy = true; render();
    Promise.all(files.map(readFile)).then(function (parsed) {
      S.preview = analyse(parsed);
      S.stage = 'preview';
    }).catch(function (e) {
      S.error = e.message; S.stage = 'empty'; S.preview = null;
    }).then(function () { S.busy = false; render(); });
  }

  function save() {
    var p = S.preview;
    var aliases = [];
    root.querySelectorAll('select[data-alias]').forEach(function (s) { aliases.push({ alias: s.getAttribute('data-alias'), machine_id: s.value }); });
    S.busy = true; render();
    API.rpc('ingest_report', {
      p_period_type: p.type, p_from: p.from, p_to: p.to, p_raw_file: p.raw.file, p_oee_file: p.oee.file,
      p_raw: p.events, p_oee: p.oeeRows, p_aliases: aliases
    }).then(function (res) {
      S.busy = false; S.stage = 'empty'; S.preview = null;
      if (window.__reloadDashboard) window.__reloadDashboard();
      return loadData().then(function () {
        render();
        toast('הדוח ה' + TYPE_NAME[p.type] + ' נשמר ✓ — ' + (res.raw_rows || 0).toLocaleString('he-IL') + ' אירועים' + (res.replaced ? ' (החליף העלאה קודמת)' : ''));
      });
    }).catch(function (e) { S.busy = false; render(); toast(e.message || 'השמירה נכשלה', true); });
  }

  function onClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn || btn.disabled) return;
    var act = btn.getAttribute('data-act');
    if (act === 'cancel') { S.stage = 'empty'; S.preview = null; render(); return; }
    if (act === 'save') { save(); return; }
    if (act === 'replace') {
      S.stage = 'empty'; S.preview = null; S.error = null; render();
      document.getElementById('u-drop-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('גרור את הקבצים המתוקנים — אותו טווח יוחלף');
      return;
    }
    if (act === 'ask-delete') { S.confirmBatch = btn.getAttribute('data-batch'); render(); return; }
    if (act === 'cancel-delete') { S.confirmBatch = null; render(); return; }
    if (act === 'do-delete') {
      S.busy = true; render();
      API.rpc('delete_upload', { p_batch: S.confirmBatch }).then(function () {
        S.busy = false; S.confirmBatch = null;
        if (window.__reloadDashboard) window.__reloadDashboard();
        return loadData().then(function () { render(); toast('הדוח נמחק ✓'); });
      }).catch(function (err) { S.busy = false; render(); toast(err.message || 'המחיקה נכשלה', true); });
    }
  }

  function init() {
    root = document.getElementById('upload-root');
    root.addEventListener('click', onClick);
    root.addEventListener('change', function (e) { if (e.target.id === 'u-file') handleFiles(e.target.files); });
    root.addEventListener('dragover', function (e) {
      var z = document.getElementById('u-drop');
      if (z) { e.preventDefault(); z.classList.add('u-drag'); }
    });
    root.addEventListener('dragleave', function () { var z = document.getElementById('u-drop'); if (z) z.classList.remove('u-drag'); });
    root.addEventListener('drop', function (e) {
      if (!document.getElementById('u-drop')) return;
      e.preventDefault();
      handleFiles(e.dataTransfer.files);
    });
    window.OEE_ROUTER.register('#/upload', root, 'העלאת דוחות — מנהל בלבד', start);
    window.OEE_ROUTER.start();   // upload.js is the last script: every page is registered by now
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
