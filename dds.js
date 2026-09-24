/* DDS module — daily and weekly DDS per department (אגף), split by line (machine) or the whole department.
 * Each DDS has 3 steps: 1) prep & floor walk (verify what happened with the shift), 2) data (read-only for the meeting),
 * 3) tasks (suggested from the MES pattern of each failure, linked to it automatically).
 * Data: raw_events / oee_report_rows / classification_rules (existing) + dds_* tables. Writes only through dds_* RPCs
 * (admins or DDS editors). Dependencies: window.OEE_API.select / .rpc, window.OEE_ENGINE.classify / .norm / .prepareRules. */
(function () {
  'use strict';
  var API, ENG;
  var CFG = { recDays: 5, shortAvg: 5, longMin: 30, prepMin: 10, prepRepeat: 3, pattern: 30, topN: 10 };
  var ROLES = ['LL', 'ML', 'PL', 'LS', 'LLC', 'MLC', 'PLC', 'MP'];
  var DMS = ['CL', 'CIL', 'DH', 'BDE', 'IPS', 'UPS', 'MP&S', 'CO', 'OPL', 'חומר גלם', 'הדרכה', 'אחר'];
  var SOURCES = ['Top Stop', 'IPS', 'UPS', 'WEEKLY', 'בטיחות', 'איכות', 'IDA', 'RCA', 'Audit', 'שיפור'];
  var ST_DAILY = ['בתהליך', 'בוצע', 'לא בוצע', 'בוטל'];
  var ST_FU = ['בתהליך', 'בוצע', 'הועבר לשבועי', 'בוטל'];
  var CLOSED = ['בוצע', 'בוטל'];
  var PROD = ['ייצור', 'ייצור ללא פק"ע'];
  var GENERIC = ['עצירה לא מוסברת', 'אחר', 'עצירה קצרה'];
  var WD = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  /* ---------- small helpers ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parseIso(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function toIso(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(s, n) { var d = parseIso(s); d.setUTCDate(d.getUTCDate() + n); return toIso(d); }
  function daysBetween(a, b) { return Math.round((parseIso(b) - parseIso(a)) / 86400000); }
  function weekStart(s) { return addDays(s, -((parseIso(s).getUTCDay() + 1) % 7)); }
  function weekNo(k) { var y = addDays(k, 6).slice(0, 4); return Math.floor(daysBetween(weekStart(y + '-01-01'), k) / 7) + 1; }
  function dm(s) { return s ? s.slice(8) + '/' + s.slice(5, 7) : '—'; }
  function dmy(s) { return s.slice(8) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4); }
  function wd(s) { return 'יום ' + WD[parseIso(s).getUTCDay()]; }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fm(m) { m = Math.round(m || 0); return m >= 60 ? Math.floor(m / 60) + ':' + pad(m % 60) + ' ש\'' : m + ' דק\''; }
  function sum(a, f) { return a.reduce(function (s, x) { return s + (f ? f(x) : x); }, 0); }
  function norm(v) { return ENG && ENG.norm ? ENG.norm(v) : (v == null ? null : (String(v).replace(/[\u200e\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim() || null)); }
  function inList(vals) { return '(' + vals.map(function (v) { return encodeURIComponent('"' + v + '"'); }).join(',') + ')'; }
  var TF = null;
  function hhmm(ts) {
    try { TF = TF || new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }); return TF.format(new Date(ts)); }
    catch (e) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  }
  function shiftOf(t) { var h = +t.slice(0, 2); return h >= 7 && h < 15 ? 'בוקר' : h >= 15 && h < 23 ? 'ערב' : 'לילה'; }
  function selectAll(q) {
    var out = [], size = 1000;
    function page(off) {
      return API.select(q + (q.indexOf('?') < 0 ? '?' : '&') + 'limit=' + size + '&offset=' + off).then(function (rows) {
        out = out.concat(rows || []); return rows && rows.length === size ? page(off + size) : out;
      });
    }
    return page(0);
  }
  function validOn(rows, day) { var b = null; (rows || []).forEach(function (r) { if (r.valid_from <= day && (!r.valid_to || r.valid_to >= day) && (!b || r.valid_from > b.valid_from)) b = r; }); return b; }
  function errText(e) { return e && (e.message || e.msg || e.error_description) ? (e.message || e.msg || e.error_description) : String(e); }

  /* ---------- static data ---------- */
  var ST = null, INIT = null;
  function init() {
    if (!INIT) {
      API = window.OEE_API; ENG = window.OEE_ENGINE;
      INIT = Promise.all([
        API.select('machines?select=id,name,department_id,sort_order,is_active&order=sort_order'),
        API.select('departments?select=id,name,sort_order&order=sort_order'),
        API.select('machine_oee_targets?select=machine_id,oee_target,valid_from,valid_to'),
        API.select('classification_rules?select=*'),
        selectAll('uploads?select=id,period_type,report_type,period_from,period_to&status=eq.OK'),
        API.rpc('dds_can_edit', {}).then(function (x) { return x === true; }, function () { return false; })
      ]).then(function (r) {
        var idx = { day: {}, week: {}, official: {} };
        r[4].forEach(function (u) {
          var k = u.period_type + '|' + u.period_from + '|' + u.period_to;
          (idx.official[k] = idx.official[k] || {})[u.report_type] = u.id;
          if (u.period_type === 'DAY') { idx.day[u.period_from] = 1; idx.week[weekStart(u.period_from)] = 1; }
          if (u.period_type === 'WEEK') idx.week[u.period_from] = 1;
        });
        ST = {
          machines: r[0].filter(function (m) { return m.is_active; }),
          depts: r[1], targets: r[2],
          rules: ENG && ENG.prepareRules ? ENG.prepareRules(r[3]) : r[3],
          days: Object.keys(idx.day).sort(), weeks: Object.keys(idx.week).sort(), official: idx.official, canEdit: r[5]
        };
        ST.depts = ST.depts.filter(function (d) { return ST.machines.some(function (m) { return m.department_id === d.id; }); });
        return ST;
      });
      INIT.catch(function () { INIT = null; });
    }
    return INIT;
  }
  function machinesOf(deptId) { return ST.machines.filter(function (m) { return m.department_id === deptId; }); }
  function mName(id) { var m = ST.machines.filter(function (x) { return x.id === id; })[0]; return m ? m.name : ''; }
  function targetOf(mid, day) { var t = validOn(ST.targets.filter(function (x) { return x.machine_id === mid; }), day); return t ? Number(t.oee_target) : null; }
  function classifyEv(mid, day, status, group, desc) {
    var st = norm(status), rule = ENG.classify({ status: st, stop_group: norm(group), description: norm(desc), production_date: day }, ST.rules, mid, day), b;
    if (PROD.indexOf(st) >= 0) b = 'prod';
    else if (!rule || rule.counts_in_oee === null || rule.counts_in_oee === undefined) b = 'unknown';
    else if (rule.loss_type === 'PRODUCTION') b = 'prod';
    else if (!rule.counts_in_oee) b = 'none';
    else if (rule.loss_type === 'UPDT' || rule.loss_type === 'PROCESS_FAILURE') b = 'updt';
    else if (rule.loss_type === 'PDT') b = 'pdt';
    else b = 'none';
    return { b: b, rule: rule };
  }
  function keyOf(desc, group, status, station) { return (norm(desc) || norm(group) || norm(status) || 'ללא תיאור') + '|' + (norm(station) || ''); }

  /* ---------- day model ---------- */
  var CACHE = {};
  function invalidate(prefix) { Object.keys(CACHE).forEach(function (k) { if (!prefix || k.indexOf(prefix) === 0) delete CACHE[k]; }); }
  function taskQueries(deptId, from) {
    return Promise.all([
      selectAll('dds_tasks?select=*&department_id=eq.' + deptId + '&status=in.' + inList(['בתהליך', 'הועבר לשבועי', 'לא בוצע'])),
      selectAll('dds_tasks?select=*&department_id=eq.' + deptId + '&task_date=gte.' + from),
      selectAll('dds_tasks?select=id,what,kind,source,stop_machine_id,stop_key,task_date&department_id=eq.' + deptId + '&stop_key=not.is.null&order=task_date.desc')
    ]).then(function (r) {
      var by = {}; r[0].concat(r[1]).forEach(function (t) { by[t.id] = t; });
      return { list: Object.keys(by).map(function (k) { return by[k]; }), hist: r[2] };
    });
  }
  function loadDay(deptId, day) {
    var ck = 'D|' + deptId + '|' + day;
    if (CACHE[ck]) return Promise.resolve(CACHE[ck]);
    var ms = machinesOf(deptId), ids = ms.map(function (m) { return m.id; }), idq = 'in.(' + ids.join(',') + ')';
    return Promise.all([
      selectAll('raw_events?select=machine_id,status,stop_group,description,station,start_at,duration_min,shift&period_type=eq.DAY&production_date=eq.' + day + '&machine_id=' + idq + '&order=start_at'),
      API.rpc('dds_day_combos', { p_machine_ids: ids, p_from: addDays(day, -(CFG.pattern - 1)), p_to: day }),
      selectAll('oee_report_rows?select=entity_level,entity_name,machine_id,period_from,oee&period_type=eq.DAY&period_from=gte.' + addDays(day, -6) + '&period_from=lte.' + day),
      selectAll('dds_items?select=*&dds_date=eq.' + day + '&machine_id=' + idq),
      selectAll('dds_manual?select=*&dds_date=eq.' + day + '&department_id=eq.' + deptId),
      selectAll('dds_department_settings?select=*&department_id=eq.' + deptId),
      selectAll('dds_ready?select=*&dds_type=eq.DAY&period_key=eq.' + day + '&department_id=eq.' + deptId),
      taskQueries(deptId, addDays(day, -45))
    ]).then(function (r) {
      var M = buildDay(deptId, day, ms, r[0], r[1] || [], r[2], r[3], r[4], r[5][0] || null, r[6][0] || null, r[7]);
      CACHE[ck] = M; return M;
    });
  }
  function buildDay(deptId, day, ms, events, combos, oee, items, manual, settings, ready, tasks) {
    var groups = {}, perM = {};
    ms.forEach(function (m) { perM[m.id] = { prod: 0, fails: 0 }; });
    events.forEach(function (e) {
      var d = Number(e.duration_min) || 0, c = classifyEv(e.machine_id, day, e.status, e.stop_group, e.description), pm = perM[e.machine_id];
      if (!pm) return;
      if (c.b === 'prod') { pm.prod += d; return; }
      var key = keyOf(e.description, e.stop_group, e.status, e.station), std = c.rule && c.rule.normal_duration_min ? Number(c.rule.normal_duration_min) : null;
      var t = e.start_at ? hhmm(e.start_at) : null, sh = norm(e.shift) || (t ? shiftOf(t) : '');
      function g(kind) {
        var gk = e.machine_id + '|' + key + '|' + kind;
        return groups[gk] = groups[gk] || { gk: gk, kind: kind, mid: e.machine_id, key: key, d: key.split('|')[0], st: key.split('|')[1], n: 0, min: 0, max: 0, ex: 0, std: std, times: [], fail: false, pf: false, generic: false };
      }
      if (c.b === 'updt') {
        var x = g('UPDT'); x.n++; x.min += d; x.max = Math.max(x.max, d); if (t) x.times.push({ t: t, sh: sh, d: d });
        if (c.rule.counts_as_failure) { x.fail = true; pm.fails++; }
        if (c.rule.loss_type === 'PROCESS_FAILURE') x.pf = true;
        if (!x.st || GENERIC.indexOf(x.d) >= 0) x.generic = true;
      } else if (c.b === 'pdt' && std && d > std) {
        var y = g('PDTX'); y.n++; y.min += d; y.ex += d - std; y.max = Math.max(y.max, d); if (t) y.times.push({ t: t, sh: sh, d: d });
      }
    });
    // 30-day pattern + 7-day MTBF from the daily combos
    var pat = {}, mt = {};
    combos.forEach(function (c) {
      var cl = classifyEv(c.machine_id, c.production_date, c.status, c.stop_group, c.description), n = Number(c.n) || 0, min = Number(c.minutes) || 0;
      if (c.production_date >= addDays(day, -6)) {
        var q = mt[c.machine_id] = mt[c.machine_id] || { prod: 0, fails: 0 };
        if (cl.b === 'prod') q.prod += min; if (cl.b === 'updt' && cl.rule.counts_as_failure) q.fails += n;
      }
      if (cl.b !== 'updt') return;
      var pk = c.machine_id + '|' + keyOf(c.description, c.stop_group, c.status, c.station), p = pat[pk] = pat[pk] || { days: {}, n: 0, min: 0 };
      p.days[c.production_date] = 1; p.n += n; p.min += min;
    });
    var list = Object.keys(groups).map(function (k) {
      var x = groups[k], p = pat[x.mid + '|' + x.key];
      x.days30 = p ? Object.keys(p.days).length : 0; x.n30 = p ? p.n : 0; x.min30 = p ? p.min : 0;
      x.role = x.kind === 'PDTX' || x.pf ? 'PL' : x.fail ? 'ML' : 'LL';
      x.why = x.kind === 'PDTX' ? 'חריגה של ' + Math.round(x.ex) + ' דק׳ מהתקן (' + x.std + ')' : x.pf ? 'כשל תהליך' : x.min >= CFG.longMin ? 'עצירה ארוכה' : x.n >= CFG.prepRepeat ? 'חזרה ' + x.n + ' פעמים' : x.generic ? 'קוד כללי — לברר מה קרה' : x.days30 >= CFG.recDays ? 'חוזרת: ' + x.days30 + ' ימים ב-' + CFG.pattern + ' יום' : '';
      x.prep = x.kind === 'PDTX' || x.pf || x.generic || x.min >= CFG.prepMin || x.n >= CFG.prepRepeat;
      x.item = items.filter(function (i) { return i.machine_id === x.mid && i.stop_key === x.key; })[0] || null;
      return x;
    }).sort(function (a, b) { return b.min - a.min; });
    var kpi = {};
    ms.forEach(function (m) {
      var rows = oee.filter(function (o) { return o.entity_level === 'MACHINE' && (o.machine_id === m.id || o.entity_name === m.name); }).sort(function (a, b) { return a.period_from < b.period_from ? -1 : 1; });
      var today = rows.filter(function (o) { return o.period_from === day; })[0];
      var q = mt[m.id] || { prod: 0, fails: 0 };
      kpi[m.id] = { oee: today ? Number(today.oee) * 100 : null, series: rows.map(function (o) { return [o.period_from, Number(o.oee) * 100]; }), target: targetOf(m.id, day),
        mtbf: perM[m.id].fails ? perM[m.id].prod / perM[m.id].fails : null, mtbf7: q.fails ? q.prod / q.fails : null, fails: perM[m.id].fails };
    });
    var dept = ST.depts.filter(function (d) { return d.id === deptId; })[0];
    var drows = oee.filter(function (o) { return o.entity_level === 'DEPARTMENT' && o.entity_name === dept.name; }).sort(function (a, b) { return a.period_from < b.period_from ? -1 : 1; });
    var dtoday = drows.filter(function (o) { return o.period_from === day; })[0];
    var tw = sum(ms, function (m) { return targetOf(m.id, day) !== null ? 1 : 0; });
    kpi.dept = { oee: dtoday ? Number(dtoday.oee) * 100 : null, series: drows.map(function (o) { return [o.period_from, Number(o.oee) * 100]; }),
      target: tw ? sum(ms, function (m) { return targetOf(m.id, day) || 0; }) / tw : null };
    return { deptId: deptId, day: day, dds: addDays(day, 1), ms: ms, groups: list, kpi: kpi, manual: manual, settings: settings, ready: !!(ready && ready.ready), tasks: tasks.list, hist: tasks.hist, hasEvents: events.length > 0 };
  }

  /* ---------- week model ---------- */
  function loadWeek(deptId, wk) {
    var ck = 'W|' + deptId + '|' + wk;
    if (CACHE[ck]) return Promise.resolve(CACHE[ck]);
    var ms = machinesOf(deptId), ids = ms.map(function (m) { return m.id; }), idq = 'in.(' + ids.join(',') + ')', end = addDays(wk, 6);
    return Promise.all([
      selectAll('oee_report_rows?select=entity_level,entity_name,machine_id,period_from,oee&period_type=eq.WEEK&period_from=gte.' + addDays(wk, -49) + '&period_from=lte.' + wk),
      selectAll('dds_items?select=machine_id,dms_failure,dds_date,verified&dds_date=gte.' + wk + '&dds_date=lte.' + end + '&machine_id=' + idq),
      selectAll('dds_ready?select=*&department_id=eq.' + deptId + '&period_key=gte.' + wk + '&period_key=lte.' + end),
      taskQueries(deptId, addDays(wk, -30))
    ]).then(function (r) {
      var dept = ST.depts.filter(function (d) { return d.id === deptId; })[0];
      function series(level, name, mid) {
        return r[0].filter(function (o) { return o.entity_level === level && (mid ? (o.machine_id === mid || o.entity_name === name) : o.entity_name === name); })
          .sort(function (a, b) { return a.period_from < b.period_from ? -1 : 1; }).map(function (o) { return [o.period_from, Number(o.oee) * 100]; });
      }
      var kpi = {}; ms.forEach(function (m) { kpi[m.id] = { series: series('MACHINE', m.name, m.id), target: targetOf(m.id, end) }; });
      kpi.dept = { series: series('DEPARTMENT', dept.name), target: null };
      var o = ST.official['WEEK|' + wk + '|' + end];
      var daysUp = ST.days.filter(function (d) { return d >= wk && d <= end; });
      var M = { deptId: deptId, wk: wk, end: end, ms: ms, kpi: kpi, items: r[1],
        dayReady: r[2].filter(function (x) { return x.dds_type === 'DAY' && x.ready; }).length, daysUp: daysUp.length,
        weekReady: r[2].some(function (x) { return x.dds_type === 'WEEK' && x.period_key === wk && x.ready; }),
        official: !!(o && o.RAW && o.OEE), tasks: r[3].list, hist: r[3].hist };
      CACHE[ck] = M; return M;
    });
  }

  /* ---------- suggestions ---------- */
  function openOn(M, g) { return M.tasks.filter(function (t) { return t.stop_machine_id === g.mid && t.stop_key === g.key && CLOSED.indexOf(t.status) < 0; }); }
  function suggest(M, g) {
    var out = [], where = g.d + (g.st ? ' — ' + g.st : '') + ', ' + mName(g.mid);
    if (g.kind === 'PDTX') out.push({ tool: 'תקן PDT', kind: 'FOLLOWUP', src: 'Top Stop', what: 'בירור חריגה מהתקן: ' + g.d + ' (תקן ' + g.std + ' דק׳), ' + mName(g.mid), why: 'חרג מהתקן ב-' + Math.round(g.ex) + ' דק׳' });
    else {
      var avg = g.n30 ? g.min30 / g.n30 : 0, rec = g.days30 >= CFG.recDays, long = g.max >= CFG.longMin;
      if (long) out.push({ tool: 'IPS', kind: 'DAILY', src: 'IPS', what: 'IPS על ' + where, why: fm(g.min) + ' ' + (g.n > 1 ? 'ב-' + g.n + ' עצירות' : 'בעצירה אחת') + ', הארוכה ' + fm(g.max) });
      if (rec && avg >= CFG.shortAvg) out.push({ tool: 'UPS', kind: 'FOLLOWUP', src: 'UPS', what: 'פתיחת UPS על ' + where, why: 'חזרה ב-' + g.days30 + ' ימים ב-' + CFG.pattern + ' הימים האחרונים · ' + g.n30 + ' עצירות · ממוצע ' + avg.toFixed(1) + ' דק׳' });
      if (rec && avg < CFG.shortAvg) out.push({ tool: 'CIL / CL', kind: 'DAILY', src: 'Top Stop', what: 'בדיקת CIL / CL בתחנת ' + (g.st || mName(g.mid)) + ' — ' + g.d, why: 'חזרה ב-' + g.days30 + ' ימים, אבל קצרה (ממוצע ' + avg.toFixed(1) + ' דק׳)' });
      if (g.generic && !out.length) out.push({ tool: 'בירור', kind: 'DAILY', src: 'Top Stop', what: 'בירור עם המשמרת: ' + where, why: 'דווח בקוד כללי' });
    }
    var seen = {};
    M.hist.filter(function (h) { return h.stop_machine_id === g.mid && h.stop_key === g.key; }).forEach(function (h) {
      if (seen[h.what]) return; seen[h.what] = 1;
      out.push({ tool: 'היסטוריה', kind: h.kind, src: h.source || 'Top Stop', what: h.what, why: 'נפתחה על אותה תקלה ב-' + dm(h.task_date), hist: true });
    });
    var open = openOn(M, g);
    return out.filter(function (x) { return !open.some(function (t) { return t.what === x.what || (x.src !== 'Top Stop' && t.source === x.src && !x.hist); }); }).slice(0, 4);
  }

  /* ---------- state ---------- */
  var LS = 'oee_dds_state_v1';
  var S = (function () { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } })();
  S.view = S.view || 'day'; S.step = S.step || { day: 1, week: 1 }; S.roleF = S.roleF || 'all';
  function persist() { try { localStorage.setItem(LS, JSON.stringify({ view: S.view, step: S.step, dept: S.dept, mid: S.mid, roleF: S.roleF })); } catch (e) { /* ignore */ } }
  var ROOT = null, M = null, F = null, BUSY = false;

  /* ---------- widgets ---------- */
  function pill(cls, t, title) { return '<span class="dds-pill dds-' + cls + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + t + '</span>'; }
  function stCls(s) { return { 'בוצע': 'grn', 'בתהליך': 'blu', 'לא בוצע': 'red', 'בוטל': 'gry', 'הועבר לשבועי': 'amb' }[s] || 'gry'; }
  function card(title, hint, body, extra) { return '<section class="dds-card' + (extra || '') + '"><h3>' + title + '</h3>' + (hint ? '<p class="dds-hint">' + hint + '</p>' : '') + body + '</section>'; }
  function spark(series, target, labelOf) {
    if (!series.length) return '<div class="dds-empty">אין דוחות רשמיים לטווח</div>';
    var max = Math.max.apply(null, series.map(function (d) { return d[1]; }).concat(target !== null ? [target] : [])) * 1.1 || 1;
    return '<div class="dds-spark">' + series.map(function (d, i) {
      var ok = target === null || d[1] >= target;
      return '<div class="sb' + (i === series.length - 1 ? ' last' : '') + '" title="' + esc(labelOf(d[0])) + ': ' + d[1].toFixed(1) + '%"><div style="height:' + (d[1] / max * 100).toFixed(1) + '%;background:' + (ok ? '#4E9A6B' : '#DC2626') + '"></div><span>' + esc(labelOf(d[0])) + '</span></div>';
    }).join('') + (target !== null ? '<div class="tl" style="bottom:calc(16px + ' + (target / max).toFixed(3) + ' * (100% - 16px))"><span>יעד ' + Math.round(target) + '%</span></div>' : '') + '</div>';
  }
  function ownHtml(t) {
    var h = (t.owner_roles || []).map(function (o) { return '<span>' + esc(o) + '</span>'; }).join('') + (t.owner_names || []).map(function (n) { return '<span class="nm">' + esc(n) + '</span>'; }).join('');
    return '<span class="dds-own">' + (h || pill('red', 'ללא אחראי')) + '</span>';
  }
  function dueOf(t) { return t.due_new || t.due_original; }
  function stopLabel(t) { return t.stop_key ? t.stop_key.split('|')[0] + (t.stop_machine_id ? ' · ' + mName(t.stop_machine_id) : '') : ''; }
  function taskRow(t, today) {
    var ed = ST.canEdit, opts = t.kind === 'DAILY' ? ST_DAILY : ST_FU, meta = ownHtml(t);
    if (t.kind === 'DAILY') { if (t.start_time) meta += '<span dir="ltr">' + esc(t.start_time.slice(0, 5)) + (t.end_time ? '–' + esc(t.end_time.slice(0, 5)) : '') + '</span>'; }
    else {
      var due = dueOf(t), late = due && due < today && CLOSED.indexOf(t.status) < 0, slip = t.due_new && t.due_original ? daysBetween(t.due_original, t.due_new) : 0;
      meta += '<span>' + (t.due_new ? 'יעד מקורי ' + dm(t.due_original) + ' · חדש ' + dm(t.due_new) + ' ' + pill('amb', 'נדחה ' + slip + ' ימים') : 'יעד ' + dm(t.due_original)) + '</span>' + (late ? pill('red', 'באיחור ' + daysBetween(due, today) + ' ימים') : '') + (t.source ? pill('gry', esc(t.source)) : '');
    }
    meta += '<span>' + (t.machine_id ? esc(mName(t.machine_id)) : 'כל האגף') + '</span>';
    if (t.stop_key) meta += pill('red', '⛓ ' + esc(stopLabel(t)));
    var ctl = ed ? '<select aria-label="סטטוס" class="dds-st dds-' + stCls(t.status) + '" data-tstatus="' + t.id + '">' + opts.map(function (o) { return '<option' + (o === t.status ? ' selected' : '') + '>' + o + '</option>'; }).join('') + (opts.indexOf(t.status) < 0 ? '<option selected>' + esc(t.status) + '</option>' : '') + '</select>' +
      (t.kind === 'FOLLOWUP' && CLOSED.indexOf(t.status) < 0 ? '<label class="dds-due">יעד חדש <input type="date" data-tdue="' + t.id + '" value="' + esc(t.due_new || '') + '"></label>' : '')
      : pill(stCls(t.status), esc(t.status));
    return '<div class="dds-task"><div><div class="what">' + esc(t.what) + '</div><div class="meta">' + meta + '</div></div><div class="ctl">' + ctl + '</div></div>';
  }

  /* ---------- render root ---------- */
  function render() {
    if (!ROOT) return;
    if (!ST) { ROOT.innerHTML = '<div class="dds-loading">טוען…</div>'; return; }
    if (!ST.depts.length) { ROOT.innerHTML = '<div class="dds-loading">אין אגפים עם מכונות פעילות</div>'; return; }
    if (!S.dept || !ST.depts.some(function (d) { return d.id === S.dept; })) S.dept = ST.depts[0].id;
    var ms = machinesOf(S.dept); if (S.mid && !ms.some(function (m) { return m.id === S.mid; })) S.mid = null;
    if (!S.day || ST.days.indexOf(S.day) < 0) S.day = ST.days[ST.days.length - 1];
    if (!S.wk || ST.weeks.indexOf(S.wk) < 0) S.wk = ST.weeks[ST.weeks.length - 1];
    var h = '';
    if (!ST.canEdit) h += '<div class="dds-ro">צפייה בלבד. כדי לעדכן את ה-DDS צריך להתחבר כמשתמש מורשה.</div>';
    h += '<div class="dds-bar"><div class="dds-seg" role="group" aria-label="סוג DDS"><button type="button" data-view="day" aria-pressed="' + (S.view === 'day') + '">DDS יומי</button><button type="button" data-view="week" aria-pressed="' + (S.view === 'week') + '">DDS שבועי</button></div>';
    var list = S.view === 'day' ? ST.days : ST.weeks, cur = S.view === 'day' ? S.day : S.wk, pos = list.indexOf(cur);
    var label = !cur ? 'אין דוחות' : S.view === 'day' ? dmy(cur) + ' · ' + wd(cur) : 'שבוע ' + weekNo(cur) + ' · <span dir="ltr">' + dm(cur) + '–' + dm(addDays(cur, 6)) + '</span>';
    var canP = pos > 0, canN = pos >= 0 && pos < list.length - 1;
    h += (window.OEE_PICKER ? window.OEE_PICKER.barHtml(label, canP, canN, { prev: 'data-nav="-1"', next: 'data-nav="1"', open: 'data-pick-open' })
      : '<div class="dds-nav"><button type="button" data-nav="-1" aria-label="קודם"' + (canP ? '' : ' disabled') + '>›</button><span>' + label + '</span><button type="button" data-nav="1" aria-label="הבא"' + (canN ? '' : ' disabled') + '>‹</button></div>');
    if (cur) h += '<div class="dds-sub">' + (S.view === 'day' ? 'ה-DDS של ' + dmy(addDays(cur, 1)) + ' סוקר את יום הייצור הזה' : 'ה-DDS השבועי סוקר את שבוע הייצור הזה') + '</div>';
    h += '</div>';
    h += '<div class="dds-chips" role="group" aria-label="אגף">' + ST.depts.map(function (d) { return '<button type="button" class="dds-chip" data-dept="' + d.id + '" aria-pressed="' + (d.id === S.dept) + '">אגף ' + esc(d.name) + '</button>'; }).join('') + '</div>';
    if (ms.length > 1) h += '<div class="dds-chips" role="group" aria-label="קו"><button type="button" class="dds-chip sm" data-mid="" aria-pressed="' + (!S.mid) + '">כל האגף</button>' + ms.map(function (m) { return '<button type="button" class="dds-chip sm" data-mid="' + m.id + '" aria-pressed="' + (S.mid === m.id) + '">' + esc(m.name) + '</button>'; }).join('') + '</div>';
    var names = S.view === 'day' ? ['הכנה וסיור', 'הצגת נתונים', 'משימות'] : ['איסוף והכנה', 'נתונים ומגמות', 'משימות'], step = S.step[S.view];
    h += '<ol class="dds-steps">' + names.map(function (n, i) { var k = i + 1; return '<li><button type="button" data-step="' + k + '" aria-current="' + (k === step ? 'step' : 'false') + '"' + (k < step ? ' class="done"' : '') + '><span class="num">' + k + '</span>' + n + '</button></li>'; }).join('') + '</ol>';
    h += '<div id="dds-body"><div class="dds-loading">טוען…</div></div>';
    h += '<div class="dds-stepnav">' + (step > 1 ? '<button type="button" class="dds-btn ghost" data-step="' + (step - 1) + '">→ ' + names[step - 2] + '</button>' : '<span></span>') + (step < 3 ? '<button type="button" class="dds-btn" data-step="' + (step + 1) + '">' + names[step] + ' ←</button>' : '<span></span>') + '</div>';
    ROOT.innerHTML = h;
    if (!cur) { document.getElementById('dds-body').innerHTML = '<div class="dds-empty">עדיין לא הועלו דוחות</div>'; return; }
    var want = S.view + '|' + S.dept + '|' + cur;
    (S.view === 'day' ? loadDay(S.dept, cur) : loadWeek(S.dept, cur)).then(function (model) {
      if (want !== S.view + '|' + S.dept + '|' + (S.view === 'day' ? S.day : S.wk)) return;
      M = model; var body = document.getElementById('dds-body'); if (!body) return;
      body.innerHTML = S.view === 'day' ? (step === 1 ? dayPrep() : step === 2 ? dayShow() : dayTasks()) : (step === 1 ? weekPrep() : step === 2 ? weekShow() : weekTasks());
    }).catch(function (e) { var body = document.getElementById('dds-body'); if (body) body.innerHTML = '<div class="dds-empty">שגיאה בטעינה: ' + esc(errText(e)) + '</div>'; });
  }
  function mOk(mid) { return !S.mid || mid === S.mid; }
  function tOk(t) { return !S.mid || t.machine_id === S.mid || t.machine_id === null; }

  /* ---------- DAY: 1 prep ---------- */
  function dayPrep() {
    var ed = ST.canEdit, dis = ed ? '' : ' disabled';
    var list = M.groups.filter(function (g) { return g.prep && mOk(g.mid); });
    function cnt(r) { var l = list.filter(function (g) { return r === 'all' || g.role === r; }); return [l.filter(function (g) { return g.item && g.item.verified; }).length, l.length]; }
    var all = cnt('all'), h = '';
    var body = '';
    if (!M.hasEvents) body = '<div class="dds-empty">אין אירועים מה-MES ליום הזה</div>';
    else {
      body += '<div class="dds-chips"><button type="button" class="dds-chip sm" data-rolef="all" aria-pressed="' + (S.roleF === 'all') + '">הכול ' + all[0] + '/' + all[1] + '</button>' + ['ML', 'PL', 'LL'].map(function (r) { var c = cnt(r); return '<button type="button" class="dds-chip sm" data-rolef="' + r + '" aria-pressed="' + (S.roleF === r) + '">' + r + ' ' + c[0] + '/' + c[1] + '</button>'; }).join('') + '</div>';
      var shown = list.filter(function (g) { return S.roleF === 'all' || g.role === S.roleF; });
      if (!shown.length) body += '<div class="dds-empty">אין אירועים לתפקיד הזה</div>';
      shown.forEach(function (g) {
        var it = g.item || { what_happened: '', root_cause: '', verified: false, verified_by: [] };
        body += '<div class="dds-stop' + (it.verified ? ' ok' : '') + '"><div class="dds-row"><div><div class="t">' + esc(g.d) + '</div><div class="m">' + esc(mName(g.mid)) + (g.st ? ' · ' + esc(g.st) : '') + ' · ' + fm(g.min) + (g.why ? ' · <b>' + esc(g.why) + '</b>' : '') + '</div>' +
          '<div class="m">' + g.times.map(function (x) { return pill('gry', '<span dir="ltr">' + x.t + '</span>') + ' ' + esc(x.sh); }).join(' · ') + '</div></div>' + pill('blu', g.role) + '</div>' +
          '<div class="dds-f2"><input type="text" placeholder="מה קרה בפועל — במילים של העובד" aria-label="מה קרה בפועל" data-iwhat="' + esc(g.gk) + '" value="' + esc(it.what_happened || '') + '"' + dis + '>' +
          '<input type="text" placeholder="סיבת שורש ראשונית" aria-label="סיבת שורש ראשונית" data-iroot="' + esc(g.gk) + '" value="' + esc(it.root_cause || '') + '"' + dis + '></div>' +
          '<div class="dds-row" style="margin-top:6px"><label class="dds-chk"><input type="checkbox" data-iok="' + esc(g.gk) + '"' + (it.verified ? ' checked' : '') + dis + '> אומת עם המשמרת</label>' +
          '<span class="dds-by">אומת ע״י: ' + ['LL', 'ML', 'PL'].map(function (r) { return '<button type="button" data-iby="' + esc(g.gk) + '|' + r + '" aria-pressed="' + ((it.verified_by || []).indexOf(r) >= 0) + '"' + dis + '>' + r + '</button>'; }).join('') + '</span></div></div>';
      });
    }
    h += card('לשאול בסיור — יום הייצור ' + dm(M.day) + ' <span class="dds-count ' + (all[0] === all[1] ? 'ok' : '') + '">אומתו ' + all[0] + ' / ' + all[1] + '</span>',
      'אירועים מה-MES ששווה לברר עם המשמרת: עצירות ארוכות, תקלות שחזרו, כשלי תהליך, חריגות מהתקן וקודים כלליים. כל אירוע משויך לתפקיד שבודק אותו, וכל אחד יכול לאמת כל אירוע.', body);
    // manual inputs
    var dm0 = M.manual.filter(function (x) { return x.machine_id === null; })[0] || {};
    var last = M.settings && M.settings.last_accident_date, days = last ? daysBetween(last, M.dds) : null;
    var man = '<div class="dds-grp">בטיחות</div><div class="dds-two"><label class="dds-fld">תאריך התאונה האחרונה<input type="date" data-acc value="' + esc(last || '') + '"' + dis + '></label><div class="dds-fld">ימים ללא תאונה<div class="dds-big">' + (days === null ? '—' : days) + '</div></div></div>' +
      '<label class="dds-fld">אירוע בטיחות ב-24 השעות<select data-man="safety_event"' + dis + '><option value="">—</option><option value="false"' + (dm0.safety_event === false ? ' selected' : '') + '>לא</option><option value="true"' + (dm0.safety_event === true ? ' selected' : '') + '>כן</option></select></label>' +
      '<label class="dds-fld">פירוט<input type="text" data-man="safety_text" value="' + esc(dm0.safety_text || '') + '"' + dis + '></label>' +
      '<div class="dds-grp">איכות</div><div class="dds-two"><label class="dds-fld">אירועי איכות<input type="number" min="0" inputmode="numeric" data-man="quality_incidents" value="' + esc(dm0.quality_incidents === null || dm0.quality_incidents === undefined ? '' : dm0.quality_incidents) + '"' + dis + '></label>' +
      '<label class="dds-fld">אירועי HACCP<input type="number" min="0" inputmode="numeric" data-man="haccp_events" value="' + esc(dm0.haccp_events === null || dm0.haccp_events === undefined ? '' : dm0.haccp_events) + '"' + dis + '></label></div>' +
      '<label class="dds-fld">פירוט<input type="text" data-man="quality_text" value="' + esc(dm0.quality_text || '') + '"' + dis + '></label>' +
      '<div class="dds-grp">כוח אדם — שובצו / הגיעו</div>' + M.ms.filter(function (m) { return mOk(m.id); }).map(function (m) {
        var r = M.manual.filter(function (x) { return x.machine_id === m.id; })[0] || {};
        return '<div class="dds-two dds-ppl"><span>' + esc(m.name) + '</span><span class="dds-two"><input type="number" min="0" inputmode="numeric" aria-label="שובצו ' + esc(m.name) + '" placeholder="שובצו" data-ppl="' + m.id + '|staff_planned" value="' + esc(r.staff_planned === null || r.staff_planned === undefined ? '' : r.staff_planned) + '"' + dis + '><input type="number" min="0" inputmode="numeric" aria-label="הגיעו ' + esc(m.name) + '" placeholder="הגיעו" data-ppl="' + m.id + '|staff_present" value="' + esc(r.staff_present === null || r.staff_present === undefined ? '' : r.staff_present) + '"' + dis + '></span></div>';
      }).join('');
    h += card('נתונים שאין להם מקור ב-MES', 'ממלאים בסיור. בטיחות ואיכות ברמת האגף, כוח אדם לפי קו.', man);
    var left = all[1] - all[0];
    h += card('מוכן לישיבה?', left ? left + ' אירועים עוד לא אומתו. אפשר להמשיך, והם יסומנו "לא אומת" בהצגה.' : 'כל האירועים אומתו.',
      ed ? '<button type="button" class="dds-btn" data-ready="DAY">' + (M.ready ? '✓ מוכן — לחץ לביטול' : 'מוכן לישיבה') + '</button>' : (M.ready ? pill('grn', 'מוכן') : pill('gry', 'עוד לא מוכן')));
    return h;
  }

  /* ---------- DAY: 2 show ---------- */
  function dayShow() {
    var h = '<div class="dds-grid2">';
    var cards = M.ms.filter(function (m) { return mOk(m.id); }).map(function (m) { return { name: m.name, k: M.kpi[m.id] }; });
    if (!S.mid && M.ms.length > 1) cards.unshift({ name: 'אגף ' + ST.depts.filter(function (d) { return d.id === M.deptId; })[0].name, k: M.kpi.dept, dept: true });
    cards.forEach(function (c) {
      var k = c.k, t = k.target;
      h += '<section class="dds-card"><h3>' + esc(c.name) + '</h3><div class="dds-kpis"><div class="dds-kpi ' + (k.oee === null || t === null ? '' : k.oee >= t ? 'good' : 'bad') + '"><div class="l">OEE</div><div class="v">' + (k.oee === null ? '—' : k.oee.toFixed(1) + '%') + '</div><div class="n">' + (t !== null ? 'יעד ' + Math.round(t) + '%' : '') + '</div></div>' +
        (c.dept ? '' : '<div class="dds-kpi ' + (k.mtbf === null || k.mtbf7 === null ? '' : k.mtbf >= k.mtbf7 ? 'good' : 'bad') + '"><div class="l">MTBF</div><div class="v">' + (k.mtbf === null ? '—' : fm(k.mtbf)) + '</div><div class="n">' + (k.mtbf7 !== null ? 'ממוצע 7 ימים ' + fm(k.mtbf7) : '') + ' · ' + k.fails + ' תקלות</div></div>') +
        '</div><div class="dds-hint">OEE רשמי ב-7 הימים האחרונים</div>' + spark(k.series, t, function (d) { return d.slice(8); }) + '</section>';
    });
    h += '</div>';
    var tops = M.groups.filter(function (g) { return mOk(g.mid); }).slice(0, CFG.topN);
    h += card('Top Stops — ' + dm(M.day), 'כפי שאומתו בסיור.', tops.length ? tops.map(function (g) {
      var it = g.item;
      return '<div class="dds-task"><div><div class="what">' + esc(g.d) + ' <span class="dds-sub">· ' + esc(mName(g.mid)) + (g.st ? ' · ' + esc(g.st) : '') + ' · ' + fm(g.kind === 'PDTX' ? g.ex : g.min) + (g.kind === 'PDTX' ? ' חריגה מתקן' : '') + '</span></div><div class="meta">' +
        (it && it.what_happened ? esc(it.what_happened) : '<span class="dds-sub">אין תיאור מהסיור</span>') + (it && it.root_cause ? ' · <b>שורש:</b> ' + esc(it.root_cause) : '') + (it && it.dms_failure ? ' · ' + pill('gry', 'כשל DMS: ' + esc(it.dms_failure)) : '') + '</div></div><div>' +
        (it && it.verified ? pill('grn', 'אומת') : pill('amb', 'לא אומת')) + '</div></div>';
    }).join('') : '<div class="dds-empty">אין עצירות</div>');
    var dm0 = M.manual.filter(function (x) { return x.machine_id === null; })[0] || {}, last = M.settings && M.settings.last_accident_date;
    h += '<div class="dds-grid3">' + card('בטיחות', '', '<div class="dds-big">' + (last ? daysBetween(last, M.dds) : '—') + '</div><div class="dds-sub">ימים ללא תאונה</div><div style="margin-top:6px">' + (dm0.safety_event === true ? pill('red', 'אירוע ב-24 שעות') + (dm0.safety_text ? '<div class="dds-sub">' + esc(dm0.safety_text) + '</div>' : '') : dm0.safety_event === false ? pill('grn', 'ללא אירוע ב-24 שעות') : pill('gry', 'לא מולא')) + '</div>') +
      card('איכות', '', '<div class="dds-big">' + (dm0.quality_incidents === null || dm0.quality_incidents === undefined ? '—' : dm0.quality_incidents) + '</div><div class="dds-sub">אירועי איכות · HACCP: ' + (dm0.haccp_events === null || dm0.haccp_events === undefined ? '—' : dm0.haccp_events) + '</div>' + (dm0.quality_text ? '<div class="dds-sub">' + esc(dm0.quality_text) + '</div>' : '')) +
      card('כוח אדם', '', M.ms.filter(function (m) { return mOk(m.id); }).map(function (m) { var r = M.manual.filter(function (x) { return x.machine_id === m.id; })[0] || {}; var ok = r.staff_planned == null || r.staff_present == null ? null : r.staff_present >= r.staff_planned;
        return '<div class="dds-row"><span>' + esc(m.name) + '</span>' + (ok === null ? pill('gry', 'לא מולא') : pill(ok ? 'grn' : 'red', r.staff_present + ' / ' + r.staff_planned)) + '</div>'; }).join('')) + '</div>';
    return h;
  }

  /* ---------- DAY: 3 tasks ---------- */
  var TOOLCLS = { 'IPS': 'amb', 'UPS': 'red', 'CIL / CL': 'blu', 'תקן PDT': 'amb', 'בירור': 'gry', 'היסטוריה': 'demo' };
  function sugHtml(g, inForm) {
    var h = '';
    openOn(M, g).forEach(function (t) { h += '<div class="dds-sug open">' + pill('grn', 'כבר פתוחה') + ' ' + esc(t.what) + ' <span class="dds-sub">· ' + esc(t.status) + '</span></div>'; });
    suggest(M, g).forEach(function (x, i) {
      h += '<button type="button" class="dds-sug" data-sug="' + esc(g.gk) + '|' + i + '"' + (inForm ? ' data-inform="1"' : '') + (ST.canEdit ? '' : ' disabled') + '>' + pill(TOOLCLS[x.tool] || 'gry', esc(x.tool)) + ' <b>' + esc(x.what) + '</b><span class="why">' + esc(x.why) + '</span></button>';
    });
    return h || '<div class="dds-sub">אין הצעה — התקלה לא חוזרת ולא ארוכה</div>';
  }
  function dayTasks() {
    var ed = ST.canEdit, dis = ed ? '' : ' disabled', h = '';
    var list = M.groups.filter(function (g) { return mOk(g.mid); }), shown = S.showAll ? list : list.slice(0, CFG.topN);
    var body = shown.length ? shown.map(function (g) {
      var it = g.item || {};
      var meta = g.kind === 'PDTX' ? esc(mName(g.mid)) + ' · PDT · ' + g.n + ' אירועים · ' + fm(g.min) + ' · ' + pill('amb', 'חריגה ' + Math.round(g.ex) + ' דק׳ מהתקן')
        : esc(mName(g.mid)) + (g.st ? ' · ' + esc(g.st) : '') + ' · ' + g.n + ' עצירות · ' + fm(g.min) + '<span class="dds-sub"> · ב-' + CFG.pattern + ' יום: ' + g.days30 + ' ימים, ' + g.n30 + ' עצירות</span>';
      return '<div class="dds-stop"><div class="t">' + esc(g.d) + '</div><div class="m">' + meta + '</div>' +
        (it.what_happened || it.root_cause ? '<div class="dds-fromprep"><b>מהסיור:</b> ' + esc(it.what_happened || '') + (it.root_cause ? ' · <b>שורש:</b> ' + esc(it.root_cause) : '') + '</div>' : '') +
        '<div class="dds-sugs"><div class="dds-sugh">מוצע לפי נתוני ה-MES:</div>' + sugHtml(g, false) + '</div>' +
        '<div class="dds-f3"><span class="dds-sub">' + (it.verified ? '✓ אומת עם המשמרת' : 'לא אומת בסיור') + '</span><select aria-label="כשל DMS" data-idms="' + esc(g.gk) + '"' + dis + '><option value="">כשל DMS…</option>' + DMS.map(function (d) { return '<option' + (it.dms_failure === d ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select>' +
        (ed ? '<button type="button" class="dds-btn ghost sm" data-newfrom="' + esc(g.gk) + '">משימה אחרת</button>' : '') + '</div></div>';
    }).join('') + (list.length > CFG.topN ? '<button type="button" class="dds-btn ghost sm" data-showall>' + (S.showAll ? 'הצג פחות' : 'הצג את כל ' + list.length + ' העצירות') + '</button>' : '') : '<div class="dds-empty">אין עצירות</div>';
    h += card('Top Stops — ' + dm(M.day), 'לכל תקלה המערכת מציעה משימות לפי הדפוס שלה ב-' + CFG.pattern + ' הימים האחרונים. לחיצה על הצעה פותחת משימה שכבר מקושרת לתקלה.', body);
    var da = M.tasks.filter(function (t) { return t.kind === 'DAILY' && t.task_date === M.dds && tOk(t); }).sort(function (a, b) { return (a.start_time || '') < (b.start_time || '') ? -1 : 1; });
    h += card('משימות ל-24 השעות הקרובות' + (ed ? ' <button type="button" class="dds-btn sm" data-new="DAILY">+ משימה יומית</button>' : ''), 'נכתבו ב-DDS של ' + dm(M.dds) + '.', da.length ? da.map(function (t) { return taskRow(t, M.dds); }).join('') : '<div class="dds-empty">אין משימות יומיות</div>');
    var fu = M.tasks.filter(function (t) { return t.kind === 'FOLLOWUP' && CLOSED.indexOf(t.status) < 0 && tOk(t); }).sort(function (a, b) { return (dueOf(a) || '9') < (dueOf(b) || '9') ? -1 : 1; });
    h += card('משימות ארוכות טווח פתוחות' + (ed ? ' <button type="button" class="dds-btn sm" data-new="FOLLOWUP">+ משימה ארוכת טווח</button>' : ''), 'אפשר להעביר משימה לשבועי דרך הסטטוס.', fu.length ? fu.map(function (t) { return taskRow(t, M.dds); }).join('') : '<div class="dds-empty">אין משימות פתוחות</div>');
    return h;
  }

  /* ---------- WEEK ---------- */
  function wkTasks() { return M.tasks.filter(function (t) { return tOk(t); }); }
  function weekPrep() {
    var today = addDays(M.end, 1), fu = wkTasks().filter(function (t) { return t.kind === 'FOLLOWUP'; });
    var moved = fu.filter(function (t) { return t.status === 'הועבר לשבועי'; });
    var late = fu.filter(function (t) { return CLOSED.indexOf(t.status) < 0 && t.status !== 'הועבר לשבועי' && dueOf(t) && dueOf(t) < today; });
    var slipped = fu.filter(function (t) { return t.due_new && CLOSED.indexOf(t.status) < 0; });
    var h = card('לפני הישיבה השבועית', '', '<div class="dds-check' + (M.official ? ' ok' : '') + '">' + (M.official ? '✓' : '○') + ' הדוח השבועי הרשמי הועלה (RAW + OEE)</div>' +
      '<div class="dds-check' + (M.daysUp && M.dayReady >= M.daysUp ? ' ok' : '') + '">' + (M.daysUp && M.dayReady >= M.daysUp ? '✓' : '○') + ' DDS יומיים שסומנו "מוכן": ' + M.dayReady + ' מתוך ' + M.daysUp + ' ימי ייצור</div>' +
      '<div class="dds-check' + (moved.length ? '' : ' ok') + '">' + (moved.length ? '○' : '✓') + ' משימות שהועברו לשבועי: ' + moved.length + '</div>');
    function grp(t, l) { return '<div class="dds-grp">' + t + ' (' + l.length + ')</div>' + (l.length ? l.map(function (x) { return taskRow(x, today); }).join('') : '<div class="dds-empty">אין</div>'); }
    h += card('לבדוק מול הבעלים לפני הישיבה', '', grp('הועברו מה-DDS היומי', moved) + grp('באיחור', late) + grp('נדחו (יעד חדש)', slipped));
    var rows = M.ms.filter(function (m) { return mOk(m.id); }).map(function (m) {
      var s = M.kpi[m.id].series, cur = s.filter(function (x) { return x[0] === M.wk; })[0], prev = s.filter(function (x) { return x[0] < M.wk; }).slice(-1)[0];
      if (!cur || !prev) return '';
      var d = cur[1] - prev[1];
      return '<div class="dds-task"><div><div class="what">OEE ' + esc(m.name) + ' ' + (d >= 0 ? 'עלה' : 'ירד') + ' ל-' + cur[1].toFixed(1) + '% (' + (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) + ' נק׳)</div></div>' + pill(d >= 0 ? 'grn' : 'red', d >= 0 ? 'שיפור' : 'ירידה') + '</div>';
    }).join('');
    h += card('שינוי מול השבוע הקודם', 'מהדוחות השבועיים הרשמיים.', rows || '<div class="dds-empty">אין דוח רשמי לשבוע הזה או לקודם</div>');
    h += card('מוכן לישיבה?', '', ST.canEdit ? '<button type="button" class="dds-btn" data-ready="WEEK">' + (M.weekReady ? '✓ מוכן — לחץ לביטול' : 'מוכן לישיבה') + '</button>' : (M.weekReady ? pill('grn', 'מוכן') : pill('gry', 'עוד לא מוכן')));
    return h;
  }
  function weekShow() {
    var today = addDays(M.end, 1), h = '<div class="dds-grid2">';
    M.ms.filter(function (m) { return mOk(m.id); }).forEach(function (m) {
      var k = M.kpi[m.id], cur = k.series.filter(function (x) { return x[0] === M.wk; })[0];
      h += '<section class="dds-card"><h3>' + esc(m.name) + ' — OEE שבועי</h3><div class="dds-kpis"><div class="dds-kpi ' + (!cur || k.target === null ? '' : cur[1] >= k.target ? 'good' : 'bad') + '"><div class="l">שבוע ' + weekNo(M.wk) + '</div><div class="v">' + (cur ? cur[1].toFixed(1) + '%' : '—') + '</div><div class="n">' + (k.target !== null ? 'יעד ' + Math.round(k.target) + '%' : '') + '</div></div></div>' +
        spark(k.series, k.target, function (d) { return 'W' + weekNo(d); }) + '</section>';
    });
    h += '</div>';
    var tk = wkTasks(), fu = tk.filter(function (t) { return t.kind === 'FOLLOWUP'; }), open = fu.filter(function (t) { return CLOSED.indexOf(t.status) < 0; });
    var late = open.filter(function (t) { return dueOf(t) && dueOf(t) < today; }), slipped = open.filter(function (t) { return t.due_new; });
    var daily = tk.filter(function (t) { return t.kind === 'DAILY' && t.task_date >= M.wk && t.task_date <= addDays(M.end, 1) && t.status !== 'בוטל'; });
    var done = daily.filter(function (t) { return t.status === 'בוצע'; }).length;
    h += card('ביצוע משימות', '', '<div class="dds-kpis"><div class="dds-kpi"><div class="l">ארוכות טווח פתוחות</div><div class="v">' + open.length + '</div></div><div class="dds-kpi' + (late.length ? ' bad' : '') + '"><div class="l">באיחור</div><div class="v">' + late.length + '</div></div><div class="dds-kpi"><div class="l">נדחו</div><div class="v">' + slipped.length + '</div></div><div class="dds-kpi"><div class="l">יומיות שבוצעו</div><div class="v">' + (daily.length ? Math.round(done / daily.length * 100) + '%' : '—') + '</div><div class="n">' + done + ' מתוך ' + daily.length + '</div></div></div>');
    var cnt = {}; M.items.filter(function (i) { return i.dms_failure && mOk(i.machine_id); }).forEach(function (i) { cnt[i.dms_failure] = (cnt[i.dms_failure] || 0) + 1; });
    var ks = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }), mx = ks.length ? cnt[ks[0]] : 1;
    h += card('Top Stops של השבוע לפי כשל DMS', 'מהסימון היומי של כשל ה-DMS בשלב המשימות.', ks.length ? '<div class="dds-hb">' + ks.map(function (k) { return '<div>' + esc(k) + '</div><div class="trk"><div class="fill" style="width:' + (cnt[k] / mx * 100) + '%"></div></div><div>' + cnt[k] + '</div>'; }).join('') + '</div>' : '<div class="dds-empty">עוד לא סומן כשל DMS השבוע</div>');
    return h;
  }
  function weekTasks() {
    var today = addDays(M.end, 1), fu = wkTasks().filter(function (t) { return t.kind === 'FOLLOWUP' && CLOSED.indexOf(t.status) < 0; });
    var moved = fu.filter(function (t) { return t.status === 'הועבר לשבועי'; }), rest = fu.filter(function (t) { return t.status !== 'הועבר לשבועי'; });
    var late = rest.filter(function (t) { return dueOf(t) && dueOf(t) < today; }), soon = rest.filter(function (t) { return dueOf(t) && dueOf(t) >= today && daysBetween(today, dueOf(t)) <= 7; });
    var later = rest.filter(function (t) { return !dueOf(t) || (dueOf(t) >= today && daysBetween(today, dueOf(t)) > 7); });
    function grp(t, l) { return '<div class="dds-grp">' + t + ' (' + l.length + ')</div>' + (l.length ? l.map(function (x) { return taskRow(x, today); }).join('') : '<div class="dds-empty">אין</div>'); }
    return card('משימות ארוכות טווח' + (ST.canEdit ? ' <button type="button" class="dds-btn sm" data-new="FOLLOWUP">+ משימה</button>' : ''), 'הרשימה שעוברים עליה בישיבה השבועית.', grp('הועברו מה-DDS היומי', moved) + grp('באיחור', late) + grp('יעד בשבוע הקרוב', soon) + grp('מאוחר יותר', later));
  }

  /* ---------- saving ---------- */
  function toast(msg, bad) {
    var t = document.createElement('div'); t.className = 'dds-toast' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 5000 : 1800);
  }
  function call(fn, args) {
    return API.rpc(fn, args).catch(function (e) { toast('לא נשמר: ' + errText(e), true); throw e; });
  }
  function noop() { /* the error was already shown in a toast */ }
  function groupByKey(gk) { return M && M.groups ? M.groups.filter(function (g) { return g.gk === gk; })[0] : null; }
  function saveItem(g, patch) {
    var it = g.item || { what_happened: '', root_cause: '', dms_failure: null, verified: false, verified_by: [] }, n = {};
    ['what_happened', 'root_cause', 'dms_failure', 'verified', 'verified_by'].forEach(function (k) { n[k] = patch.hasOwnProperty(k) ? patch[k] : it[k]; });
    return call('dds_save_item', { p_dds_date: M.day, p_machine_id: g.mid, p_stop_key: g.key, p_kind: g.kind, p_description: g.d, p_station: g.st || null,
      p_what: n.what_happened || null, p_root: n.root_cause || null, p_dms: n.dms_failure || null, p_verified: !!n.verified, p_verified_by: n.verified_by || [] })
      .then(function () { g.item = Object.assign({}, it, n, { machine_id: g.mid, stop_key: g.key }); invalidate('W|' + M.deptId); });
  }
  var MAN_FIELDS = ['safety_event', 'safety_text', 'quality_incidents', 'haccp_events', 'quality_text', 'staff_planned', 'staff_present', 'notes'];
  function saveManual(mid, field, value) {
    var row = M.manual.filter(function (x) { return x.machine_id === mid; })[0], p = {};
    MAN_FIELDS.forEach(function (k) { p[k] = row ? row[k] : null; });
    p[field] = value;
    return call('dds_save_manual', { p_dds_date: M.day, p_department_id: M.deptId, p_machine_id: mid, p: p }).then(function () {
      if (row) row[field] = value; else { row = { machine_id: mid }; MAN_FIELDS.forEach(function (k) { row[k] = p[k]; }); M.manual.push(row); }
      toast('נשמר');
    });
  }
  function saveTask(p) { return call('dds_save_task', { p: p }).then(function (id) { invalidate('D|' + S.dept); invalidate('W|' + S.dept); return id; }); }

  /* ---------- task form ---------- */
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function openForm(kind, gk, pre) {
    var g = gk ? groupByKey(gk) : null;
    F = { kind: kind, roles: [], names: [], gk: g ? g.gk : '', mid: g ? g.mid : (S.mid || null), src: 'Top Stop', what: '' };
    if (pre) { F.kind = pre.kind; F.src = pre.src; F.what = pre.what; }
    drawForm();
    document.querySelector('.dds-scrim').classList.add('open'); document.querySelector('.dds-sheet').classList.add('open');
    setTimeout(function () { var i = document.getElementById('dds-f-what'); if (i) i.focus(); }, 200);
  }
  function sheetEl() {
    var sh = document.querySelector('.dds-sheet');
    if (!sh) {
      var sc = document.createElement('div'); sc.className = 'dds-scrim'; document.body.appendChild(sc);
      sh = document.createElement('div'); sh.className = 'dds-sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('dir', 'rtl'); document.body.appendChild(sh);
      sc.addEventListener('click', closeForm); sh.addEventListener('click', onClick); sh.addEventListener('change', onChange);
    }
    return sh;
  }
  function drawForm() {
    var sh = sheetEl(), g = F.gk ? groupByKey(F.gk) : null, groups = M && M.groups ? M.groups : [];
    var names = {}; (M.tasks || []).forEach(function (t) { (t.owner_names || []).forEach(function (n) { names[n] = 1; }); });
    var h = '<h3>משימה חדשה</h3>';
    if (groups.length) h += '<label class="dds-fld">תקלה<select id="dds-f-stop"><option value="">ללא תקלה (בטיחות / איכות / אחר)</option>' + M.ms.map(function (m) {
      var l = groups.filter(function (x) { return x.mid === m.id; }); if (!l.length) return '';
      return '<optgroup label="' + esc(m.name) + '">' + l.map(function (x) { return '<option value="' + esc(x.gk) + '"' + (x.gk === F.gk ? ' selected' : '') + '>' + esc(x.d) + (x.st ? ' — ' + esc(x.st) : '') + (x.kind === 'PDTX' ? ' (חריגת PDT)' : '') + ' · ' + fm(x.min) + '</option>'; }).join('') + '</optgroup>';
    }).join('') + '</select></label>';
    if (g) h += '<div class="dds-link">⛓ המשימה תקושר ל: ' + esc(g.d) + ' · ' + esc(mName(g.mid)) + ' · ' + fm(g.min) + ' ב-' + dm(M.day) + '</div><div class="dds-sugs"><div class="dds-sugh">הצעות לתקלה הזו:</div>' + sugHtml(g, true) + '</div>';
    h += '<div class="dds-fld">סוג<div class="dds-seg"><button type="button" data-fkind="DAILY" aria-pressed="' + (F.kind === 'DAILY') + '">יומית (עד 24 שעות)</button><button type="button" data-fkind="FOLLOWUP" aria-pressed="' + (F.kind === 'FOLLOWUP') + '">ארוכת טווח</button></div></div>';
    h += '<label class="dds-fld">משימה<input id="dds-f-what" type="text" placeholder="מה צריך לעשות" value="' + esc(F.what) + '"></label>';
    h += '<div class="dds-fld">באחריות — אפשר לבחור כמה<div class="dds-by big">' + ROLES.map(function (r) { return '<button type="button" data-frole="' + r + '" aria-pressed="' + (F.roles.indexOf(r) >= 0) + '">' + r + '</button>'; }).join('') + '</div>' +
      '<div class="dds-namerow"><input id="dds-f-name" type="text" list="dds-names" placeholder="או שם עובד" aria-label="שם עובד"><datalist id="dds-names">' + Object.keys(names).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist><button type="button" class="dds-btn ghost sm" data-fname>הוסף</button></div>' +
      (F.names.length ? '<div class="dds-by big">' + F.names.map(function (n, i) { return '<button type="button" data-fdel="' + i + '" aria-pressed="true" title="הסר">' + esc(n) + ' ✕</button>'; }).join('') + '</div>' : '') + '</div>';
    if (F.kind === 'DAILY') h += '<div class="dds-two"><label class="dds-fld">שעת התחלה<input id="dds-f-from" type="time"></label><label class="dds-fld">שעת סיום<input id="dds-f-to" type="time"></label></div>';
    else h += '<div class="dds-two"><label class="dds-fld">תאריך יעד<input id="dds-f-due" type="date" value="' + addDays(formDate(), 7) + '"></label><label class="dds-fld">מקור<select id="dds-f-src">' + SOURCES.map(function (s) { return '<option' + (s === F.src ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label></div>';
    h += '<label class="dds-fld">קו<select id="dds-f-line"><option value="">כל האגף</option>' + machinesOf(S.dept).map(function (m) { return '<option value="' + m.id + '"' + (m.id === F.mid ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') + '</select></label>';
    h += '<div class="dds-row" style="margin-top:8px"><button type="button" class="dds-btn ghost" data-fclose>ביטול</button><button type="button" class="dds-btn" data-fsave>שמירה</button></div>';
    sh.innerHTML = h;
  }
  function formDate() { return S.view === 'day' && M && M.dds ? M.dds : todayIso(); }
  function keep() { var w = document.getElementById('dds-f-what'); if (w) F.what = w.value; var s = document.getElementById('dds-f-src'); if (s) F.src = s.value; var l = document.getElementById('dds-f-line'); if (l) F.mid = l.value ? Number(l.value) : null; }
  function closeForm() {
    var sc = document.querySelector('.dds-scrim'), sh = document.querySelector('.dds-sheet');
    if (sc) sc.classList.remove('open'); if (sh) { sh.classList.remove('open'); setTimeout(function () { if (!F) sh.innerHTML = ''; }, 250); }
    F = null;
  }
  function submitForm() {
    keep();
    var what = (F.what || '').trim(), inp = document.getElementById('dds-f-what');
    if (!what) { inp.focus(); inp.classList.add('err'); return; }
    var g = F.gk ? groupByKey(F.gk) : null, p = { department_id: S.dept, machine_id: F.mid, kind: F.kind, task_date: formDate(), what: what, owner_roles: F.roles, owner_names: F.names, status: 'בתהליך' };
    if (F.kind === 'DAILY') { p.start_time = document.getElementById('dds-f-from').value; p.end_time = document.getElementById('dds-f-to').value; p.source = g ? F.src : null; }
    else { p.due_original = document.getElementById('dds-f-due').value; p.source = document.getElementById('dds-f-src').value; }
    if (g) { p.stop_machine_id = g.mid; p.stop_key = g.key; p.stop_date = M.day; }
    if (BUSY) return; BUSY = true;
    saveTask(p).then(function () { BUSY = false; closeForm(); toast('המשימה נשמרה'); render(); }, function () { BUSY = false; });
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    var d = b.dataset;
    if (d.view) { S.view = d.view; persist(); render(); return; }
    if (d.step) { S.step[S.view] = +d.step; persist(); render(); if (ROOT.scrollIntoView) ROOT.scrollIntoView({ block: 'start' }); return; }
    if (b.hasAttribute('data-pick-open')) {
      if (window.OEE_PICKER) window.OEE_PICKER.open({ type: S.view === 'day' ? 'day' : 'week', value: S.view === 'day' ? S.day : S.wk, keys: S.view === 'day' ? ST.days : ST.weeks,
        onPick: function (k) { if (S.view === 'day') S.day = k; else S.wk = k; render(); } });
      return;
    }
    if (d.nav) { var list = S.view === 'day' ? ST.days : ST.weeks, k = S.view === 'day' ? 'day' : 'wk', i = list.indexOf(S[k]) + Number(d.nav); if (i >= 0 && i < list.length) { S[k] = list[i]; render(); } return; }
    if (d.dept) { S.dept = Number(d.dept); S.mid = null; persist(); render(); return; }
    if ('mid' in d) { S.mid = d.mid ? Number(d.mid) : null; persist(); render(); return; }
    if (d.rolef) { S.roleF = d.rolef; persist(); render(); return; }
    if (b.hasAttribute('data-showall')) { S.showAll = !S.showAll; render(); return; }
    if (d.iby) { var q = d.iby.split('|'), r = q.pop(), g = groupByKey(q.join('|')); if (!g) return; var by = ((g.item && g.item.verified_by) || []).slice(), ix = by.indexOf(r); if (ix >= 0) by.splice(ix, 1); else by.push(r); saveItem(g, { verified_by: by }).then(render, noop); return; }
    if (d.ready) { var on = d.ready === 'DAY' ? !M.ready : !M.weekReady; call('dds_set_ready', { p_type: d.ready, p_key: d.ready === 'DAY' ? M.day : M.wk, p_department_id: M.deptId, p_ready: on }).then(function () { if (d.ready === 'DAY') M.ready = on; else M.weekReady = on; invalidate('W|' + M.deptId); render(); }, noop); return; }
    if (d.new) { openForm(d.new, null, null); return; }
    if (d.newfrom) { openForm('DAILY', d.newfrom, null); return; }
    if (d.sug) {
      var p = d.sug.split('|'), idx = +p.pop(), gg = groupByKey(p.join('|')), x = gg ? suggest(M, gg)[idx] : null; if (!x) return;
      if (d.inform && F) { keep(); F.kind = x.kind; F.src = x.src; F.what = x.what; drawForm(); return; }
      openForm(x.kind, gg.gk, x); return;
    }
    if (!F) return;
    if (d.fkind) { keep(); F.kind = d.fkind; drawForm(); return; }
    if (d.frole) { keep(); var j = F.roles.indexOf(d.frole); if (j >= 0) F.roles.splice(j, 1); else F.roles.push(d.frole); drawForm(); return; }
    if (b.hasAttribute('data-fname')) { keep(); var n = document.getElementById('dds-f-name').value.trim(); if (n && F.names.indexOf(n) < 0) F.names.push(n); drawForm(); document.getElementById('dds-f-name').focus(); return; }
    if (d.fdel) { keep(); F.names.splice(+d.fdel, 1); drawForm(); return; }
    if (b.hasAttribute('data-fclose')) { closeForm(); return; }
    if (b.hasAttribute('data-fsave')) { submitForm(); return; }
  }
  function onChange(e) {
    var el = e.target, d = el.dataset, g;
    if (el.id === 'dds-f-stop' && F) { keep(); F.gk = el.value; var gg = groupByKey(el.value); if (gg) F.mid = gg.mid; drawForm(); return; }
    if (d.iwhat && (g = groupByKey(d.iwhat))) { saveItem(g, { what_happened: el.value.trim() }).catch(noop); return; }
    if (d.iroot && (g = groupByKey(d.iroot))) { saveItem(g, { root_cause: el.value.trim() }).catch(noop); return; }
    if (d.iok && (g = groupByKey(d.iok))) { saveItem(g, { verified: el.checked }).then(render, function () { el.checked = !el.checked; }); return; }
    if (d.idms && (g = groupByKey(d.idms))) { saveItem(g, { dms_failure: el.value || null }).then(function () { toast('נשמר'); }, noop); return; }
    if (d.man) { var v = el.value; if (d.man === 'safety_event') v = v === '' ? null : v === 'true'; else if (el.type === 'number') v = v === '' ? null : Number(v); else v = v.trim() || null; saveManual(null, d.man, v).catch(noop); return; }
    if (d.ppl) { var q = d.ppl.split('|'); saveManual(Number(q[0]), q[1], el.value === '' ? null : Number(el.value)).catch(noop); return; }
    if (el.hasAttribute('data-acc')) { call('dds_set_last_accident', { p_department_id: M.deptId, p_date: el.value || null }).then(function () { M.settings = Object.assign({}, M.settings, { last_accident_date: el.value || null }); render(); }, noop); return; }
    if (d.tstatus) { saveTask({ id: Number(d.tstatus), status: el.value }).then(function () { toast('עודכן'); render(); }, render); return; }
    if (d.tdue) { saveTask({ id: Number(d.tdue), due_new: el.value }).then(function () { toast('עודכן'); render(); }, render); return; }
  }
  document.addEventListener('keydown', function (e) {
    if (!F) return;
    if (e.key === 'Escape') closeForm();
    if (e.key === 'Enter' && e.target.id === 'dds-f-name') { e.preventDefault(); var b = document.querySelector('[data-fname]'); if (b) b.click(); }
  });

  /* ---------- mount ---------- */
  function attach(host) {
    if (!host) return;
    injectCss(); sheetEl();
    if (!ROOT || !host.contains(ROOT)) {
      ROOT = document.createElement('div'); ROOT.className = 'dds-root'; ROOT.setAttribute('dir', 'rtl');
      host.appendChild(ROOT);
      ROOT.addEventListener('click', onClick); ROOT.addEventListener('change', onChange);
    }
    render();
    init().then(render, function (e) { ROOT.innerHTML = '<div class="dds-empty">שגיאה בטעינת ה-DDS: ' + esc(errText(e)) + '</div>'; });
  }
  function refresh() { INIT = null; ST = null; CACHE = {}; if (ROOT && document.body.contains(ROOT)) { render(); init().then(render); } }

  /* ---------- styles (scoped to .dds-*) ---------- */
  function injectCss() {
    if (document.getElementById('dds-css')) return;
    var s = document.createElement('style'); s.id = 'dds-css';
    s.textContent = [
      '.dds-root{color:#16202A;font-size:14px;line-height:1.45;max-width:1000px;margin:0 auto;min-width:0;overflow-x:hidden}',
      '.dds-root *,.dds-sheet *{box-sizing:border-box}',
      '.dds-root button,.dds-root input,.dds-root select,.dds-sheet button,.dds-sheet input,.dds-sheet select{font:inherit}',
      '.dds-root button:focus-visible,.dds-root input:focus-visible,.dds-root select:focus-visible,.dds-sheet button:focus-visible,.dds-sheet input:focus-visible,.dds-sheet select:focus-visible{outline:2px solid #2a78d6;outline-offset:2px}',
      '.dds-ro{background:#FEF3C7;color:#92400E;border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:13px}',
      '.dds-bar{display:flex;flex-direction:column;align-items:stretch;gap:6px;margin-bottom:10px}.dds-bar>.dds-seg{align-self:flex-start}',
      '.dds-seg{display:inline-flex;background:#fff;border:1px solid #D8E0E8;border-radius:10px;padding:3px;gap:2px}',
      '.dds-seg button{border:0;background:none;color:#4A5A6B;padding:6px 14px;border-radius:8px;cursor:pointer}',
      '.dds-seg button[aria-pressed="true"]{background:#1c2b45;color:#fff;font-weight:600}',
      '.dds-nav{display:inline-flex;align-items:center;gap:6px;font-weight:600}',
      '.dds-nav button{width:30px;height:30px;border:1px solid #D8E0E8;background:#fff;border-radius:8px;cursor:pointer}.dds-nav button:disabled{opacity:.35;cursor:default}',
      '.dds-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}',
      '.dds-chip{border:1px solid #D8E0E8;background:#fff;border-radius:20px;padding:5px 13px;color:#4A5A6B;cursor:pointer}.dds-chip.sm{padding:4px 11px;font-size:13px}',
      '.dds-chip[aria-pressed="true"]{background:#1c2b45;color:#fff;border-color:#1c2b45}',
      '.dds-steps{list-style:none;display:flex;gap:6px;padding:0;margin:0 0 12px}.dds-steps li{flex:1}',
      '.dds-steps button{width:100%;display:flex;align-items:center;gap:6px;justify-content:center;border:1px solid #D8E0E8;background:#fff;border-radius:10px;padding:8px 6px;color:#4A5A6B;font-weight:600;font-size:13px;cursor:pointer}',
      '.dds-steps .num{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#EEF2F6;font-size:12px}',
      '.dds-steps button[aria-current="step"]{background:#1c2b45;color:#fff;border-color:#1c2b45}.dds-steps button[aria-current="step"] .num{background:#fff;color:#1c2b45}',
      '.dds-steps button.done .num{background:#DCFCE7;color:#166534}',
      '.dds-stepnav{display:flex;justify-content:space-between;margin:6px 0 20px}',
      '.dds-card{background:#fff;border:1px solid #D8E0E8;border-radius:14px;padding:14px;margin-bottom:12px;min-width:0}',
      '.dds-card h3{margin:0 0 2px;font-size:16px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;justify-content:space-between}',
      '.dds-hint{margin:0 0 10px;color:#8393A3;font-size:12px}',
      '.dds-count{font-size:12px;font-weight:500;border-radius:20px;padding:1px 9px;background:#FEF3C7;color:#92400E}.dds-count.ok{background:#DCFCE7;color:#166534}',
      '.dds-row{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dds-btn{border:1px solid #1c2b45;background:#1c2b45;color:#fff;border-radius:9px;padding:6px 12px;font-weight:600;cursor:pointer}.dds-btn.ghost{background:#fff;color:#1c2b45}.dds-btn.sm{padding:4px 10px;font-size:12.5px}',
      '.dds-pill{display:inline-block;font-size:11.5px;border-radius:20px;padding:1px 9px;white-space:nowrap}',
      '.dds-red{background:#FEE2E2;color:#991B1B}.dds-amb{background:#FEF3C7;color:#92400E}.dds-grn{background:#DCFCE7;color:#166534}.dds-gry{background:#EEF2F6;color:#4A5A6B}.dds-blu{background:#E0ECFA;color:#1E4E8C}.dds-demo{background:#ECE7FA;color:#4F3F8F}',
      '.dds-sub{font-size:11.5px;color:#8393A3}.dds-empty{color:#8393A3;text-align:center;padding:14px;font-size:13px}.dds-loading{color:#8393A3;text-align:center;padding:40px}',
      '.dds-stop{border:1px solid #D8E0E8;border-radius:12px;padding:10px 12px;margin-bottom:8px}.dds-stop.ok{border-color:#BFE3CB;background:#F7FCF8}',
      '.dds-stop .t{font-weight:600}.dds-stop .m{font-size:12px;color:#4A5A6B;margin-top:2px}',
      '.dds-f2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}',
      '.dds-f3{display:grid;grid-template-columns:1fr 160px auto;gap:8px;margin-top:8px;align-items:center}',
      '@media (max-width:620px){.dds-f2{grid-template-columns:1fr}.dds-f3{grid-template-columns:1fr 1fr}.dds-f3 .dds-btn{grid-column:1/-1}}',
      '.dds-root input[type=text],.dds-root input[type=date],.dds-root input[type=number],.dds-root select,.dds-sheet input,.dds-sheet select{border:1px solid #D8E0E8;border-radius:8px;padding:6px 8px;background:#fff;width:100%;min-width:0}',
      '.dds-root input:disabled,.dds-root select:disabled{background:#F5F6F8;color:#4A5A6B}',
      '.dds-chk{display:inline-flex;align-items:center;gap:6px;font-size:13px}.dds-chk input{width:auto}',
      '.dds-by{display:inline-flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:12px;color:#4A5A6B}',
      '.dds-by button{border:1px solid #D8E0E8;background:#fff;border-radius:20px;padding:2px 9px;font-size:12px;cursor:pointer}.dds-by.big button{padding:4px 11px;font-size:13px}',
      '.dds-by button[aria-pressed="true"]{background:#1c2b45;color:#fff;border-color:#1c2b45}',
      '.dds-grp{font-weight:700;font-size:13px;margin:12px 0 4px;color:#4A5A6B}',
      '.dds-two{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:end}.dds-ppl{align-items:center;margin-bottom:6px}',
      '.dds-fld{display:block;margin-bottom:10px;font-size:12.5px;color:#4A5A6B}.dds-fld input,.dds-fld select{margin-top:3px;color:#16202A;font-size:14px}',
      '.dds-big{font-size:28px;font-weight:700;color:#16202A}',
      '.dds-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}.dds-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}',
      '.dds-grid2 .dds-card,.dds-grid3 .dds-card{margin-bottom:0}.dds-grid3{margin-bottom:12px}',
      '@media (max-width:700px){.dds-grid2,.dds-grid3{grid-template-columns:1fr}}',
      '.dds-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:8px}',
      '.dds-kpi{border:1px solid #D8E0E8;border-radius:12px;padding:10px 12px}.dds-kpi .l{font-size:12px;color:#4A5A6B}.dds-kpi .v{font-size:22px;font-weight:700}.dds-kpi .n{font-size:11.5px;color:#8393A3}',
      '.dds-kpi.good .v{color:#2F7D55}.dds-kpi.bad .v{color:#DC2626}',
      '.dds-spark{position:relative;display:flex;align-items:flex-end;gap:5px;height:96px;padding-bottom:16px}',
      '.dds-spark .sb{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;position:relative}',
      '.dds-spark .sb div{width:100%;border-radius:3px 3px 0 0;opacity:.72}.dds-spark .sb.last div{opacity:1}',
      '.dds-spark .sb span{position:absolute;bottom:-16px;font-size:10px;color:#8393A3;white-space:nowrap}',
      '.dds-spark .tl{position:absolute;left:0;right:0;border-top:2px dashed #1c2b45}.dds-spark .tl span{position:absolute;left:0;top:-15px;font-size:10px;color:#1c2b45;background:rgba(255,255,255,.85);padding:0 3px}',
      '.dds-task{display:grid;grid-template-columns:1fr auto;gap:6px 10px;border-top:1px solid #EEF2F6;padding:10px 0}.dds-task:first-of-type{border-top:0}',
      '.dds-task .what{font-weight:500}.dds-task .meta{font-size:12px;color:#4A5A6B;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;margin-top:2px}',
      '.dds-task .ctl{display:flex;flex-direction:column;gap:4px;align-items:stretch;min-width:118px}.dds-task select{width:auto}',
      '.dds-due{font-size:11px;color:#4A5A6B}.dds-due input{font-size:12px;padding:3px 5px}',
      '.dds-own{display:inline-flex;gap:4px;flex-wrap:wrap}.dds-own span{background:#EEF2F6;border-radius:6px;padding:0 6px;font-size:12px;color:#16202A}.dds-own span.nm{background:#FFF7E6}',
      '.dds-sugs{margin-top:8px}.dds-sugh{font-size:12px;color:#4A5A6B;margin-bottom:4px}',
      '.dds-sug{display:block;width:100%;text-align:right;border:1px solid #D8E0E8;background:#FAFBFD;border-radius:10px;padding:7px 10px;margin-bottom:5px;font-size:13px;color:#16202A;cursor:pointer}',
      'button.dds-sug:hover:not(:disabled){border-color:#2a78d6;background:#F2F7FD}button.dds-sug:disabled{cursor:default}',
      '.dds-sug b{font-weight:500}.dds-sug .why{display:block;font-size:11.5px;color:#8393A3;margin-top:2px}.dds-sug.open{background:#F1FAF4;border-color:#BFE3CB}',
      '.dds-fromprep{font-size:12.5px;background:#F7FCF8;border:1px solid #BFE3CB;border-radius:8px;padding:6px 9px;margin-top:8px}',
      '.dds-check{padding:7px 10px;border:1px solid #D8E0E8;border-radius:8px;margin-bottom:6px;font-size:13px}.dds-check.ok{background:#F1FAF4;border-color:#BFE3CB}',
      '.dds-hb{display:grid;grid-template-columns:90px 1fr auto;gap:5px 10px;align-items:center;font-size:12.5px}.dds-hb .trk{height:14px;background:#EEF2F6;border-radius:3px}.dds-hb .fill{height:100%;border-radius:3px;background:#8A93A8}',
      '.dds-scrim{position:fixed;inset:0;background:rgba(22,32,42,.45);display:none;z-index:1000}.dds-scrim.open{display:block}',
      '.dds-sheet{position:fixed;left:0;right:0;bottom:0;max-height:92vh;overflow:auto;background:#fff;border-radius:16px 16px 0 0;padding:16px;z-index:1001;transform:translateY(110%);visibility:hidden;transition:transform .2s,visibility .2s;color:#16202A;font-size:14px}',
      '.dds-sheet.open{transform:none;visibility:visible}@media (min-width:760px){.dds-sheet{max-width:560px;margin:0 auto}}',
      '.dds-sheet h3{margin:0 0 10px;font-size:17px}.dds-sheet input.err{border-color:#DC2626}',
      '.dds-namerow{display:flex;gap:6px;margin:6px 0}.dds-namerow input{flex:1}',
      '.dds-link{background:#FEE2E2;color:#991B1B;border-radius:8px;padding:6px 10px;font-size:12.5px;margin-bottom:8px}',
      '.dds-toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#1c2b45;color:#fff;border-radius:10px;padding:8px 14px;font-size:13px;z-index:1100;box-shadow:0 4px 14px rgba(0,0,0,.2)}.dds-toast.bad{background:#991B1B}'
    ].join('\n');
    document.head.appendChild(s);
  }

  window.OEE_DDS = { attach: attach, refresh: refresh, config: CFG };
})();
