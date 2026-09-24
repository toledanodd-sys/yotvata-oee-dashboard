/* IWS loss-tree view — an additional view mode next to the approved role screens (not instead of them).
 * Every role screen gets a selector: "המסך הנוכחי" / "עץ הפסדים IWS". The current screen is never modified:
 * the IWS view is rendered into its own container and the host's other children are only hidden while it is on.
 * Data: the same Supabase tables the dashboard uses (raw_events, oee_report_rows, classification_rules, targets, weights).
 * Panels whose source does not exist yet (CIL / CL / BOS / PM log / actions / RCA / CM) are drawn hatched,
 * with the missing source named — they are the open list for the next characterization steps.
 * Dependencies: window.OEE_API.select / .rpc, window.OEE_ENGINE.classify / .norm / .prepareRules. */
(function () {
  'use strict';
  var API = window.OEE_API, ENG = window.OEE_ENGINE;   // re-read in init(), in case this file loads before them

  /* ---------- settings (candidates for the admin settings screen later) ---------- */
  var CFG = {
    repeatN: 3,               // day: same failure mode 3+ times = recurring
    repeatDays: { week: 3, month: 5 },  // week/month: same failure mode on N+ different days = recurring
    longAvg: 30,              // average minutes per occurrence = long (IPS / BDE)
    shortAvg: 5,              // recurring and average >= this = UPS, below = CIL / CL
    trendWeeks: 13
  };
  var C = { prod: '#4E9A6B', updt: '#DC2626', pdt: '#8A93A8', ex: '#E07B39', perf: '#B8932C', root: '#1c2b45', fail: '#991B1B', demo: '#6D5BA8', mon: '#7FA38D' };
  var PROD = ['ייצור', 'ייצור ללא פק"ע'];
  var GENERIC = ['עצירה לא מוסברת', 'אחר', 'עצירה קצרה'];
  var LAYER = { day: 'DAY', week: 'WEEK', month: 'MONTH' };
  var PNAME = { day: 'יומי', week: 'שבועי', month: 'חודשי' };
  var PWORD = { day: 'יום', week: 'שבוע', month: 'חודש' };
  var PREVW = { day: 'אתמול', week: 'השבוע הקודם', month: 'החודש הקודם' };
  var THISW = { day: 'ביום הזה', week: 'בשבוע הזה', month: 'בחודש הזה' };

  function norm(v) { return ENG && ENG.norm ? ENG.norm(v) : (v == null ? null : (String(v).replace(/[\u200e\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim() || null)); }

  /* ---------- calendar (production day 07:00–07:00, week Saturday → Friday) ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function parseIso(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function toIso(d) { return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function addDays(s, n) { var d = parseIso(s); d.setUTCDate(d.getUTCDate() + n); return toIso(d); }
  function daysBetween(a, b) { return Math.round((parseIso(b) - parseIso(a)) / 86400000); }
  function weekStart(s) { var d = parseIso(s); return addDays(s, -((d.getUTCDay() + 1) % 7)); }
  function monthStart(s) { return s.slice(0, 8) + '01'; }
  function monthEnd(s) { var p = s.split('-'); return toIso(new Date(Date.UTC(+p[0], +p[1], 0))); }
  function addMonths(s, n) { var p = s.split('-'); return toIso(new Date(Date.UTC(+p[0], +p[1] - 1 + n, 1))); }
  var MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  var WD = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  var CAL = {
    range: function (t, k) { return t === 'day' ? { from: k, to: k } : t === 'week' ? { from: k, to: addDays(k, 6) } : { from: k, to: monthEnd(k) }; },
    keyOf: function (t, day) { return t === 'day' ? day : t === 'week' ? weekStart(day) : monthStart(day); },
    step: function (t, k, n) { return t === 'day' ? addDays(k, n) : t === 'week' ? addDays(k, 7 * n) : addMonths(k, n); },
    label: function (t, k) {
      if (t === 'day') { var p = k.split('-'); return p[2] + '/' + p[1] + '/' + p[0] + ' · יום ' + WD[parseIso(k).getUTCDay()]; }
      if (t === 'week') { var e = addDays(k, 6); return 'שבוע ' + (Math.floor(daysBetween(weekStart(e.slice(0, 4) + '-01-01'), k) / 7) + 1) + ' · <span dir="ltr">' + k.slice(8) + '/' + k.slice(5, 7) + '–' + e.slice(8) + '/' + e.slice(5, 7) + '</span>'; }
      var q = k.split('-'); return MONTHS[+q[1] - 1] + ' ' + q[0];
    },
    short: function (t, k) { return t === 'day' ? WD[parseIso(k).getUTCDay()] + ' ' + k.slice(8) + '/' + k.slice(5, 7) : k.slice(8) + '/' + k.slice(5, 7); }
  };

  /* ---------- fetch ---------- */
  function selectAll(q) {
    var out = [], size = 1000;
    function page(off) {
      return API.select(q + (q.indexOf('?') < 0 ? '?' : '&') + 'limit=' + size + '&offset=' + off).then(function (rows) {
        out = out.concat(rows || []);
        return rows && rows.length === size ? page(off + size) : out;
      });
    }
    return page(0);
  }
  function validOn(rows, day) {
    var best = null;
    (rows || []).forEach(function (r) { if (r.valid_from <= day && (!r.valid_to || r.valid_to >= day) && (!best || r.valid_from > best.valid_from)) best = r; });
    return best;
  }
  var STATIC = null, INDEX = null, CACHE = {}, INIT = null;
  function init() {
    if (!INIT) {
      API = window.OEE_API; ENG = window.OEE_ENGINE;
      INIT = Promise.all([
        API.select('machines?select=id,name,department_id,sort_order,is_active&order=sort_order'),
        API.select('departments?select=id,name,color,sort_order&order=sort_order'),
        API.select('machine_oee_targets?select=machine_id,oee_target,valid_from,valid_to'),
        API.select('machine_weights?select=machine_id,plant_weight,department_weight,valid_from,valid_to'),
        API.select('classification_rules?select=*'),
        selectAll('product_target_rates?select=machine_id,sku,target_rate,valid_from,valid_to'),
        selectAll('products?select=sku,product_name'),
        selectAll('uploads?select=id,period_type,report_type,period_from,period_to&status=eq.OK')
      ]).then(function (r) {
        var products = {};
        r[6].forEach(function (p) { products[p.sku] = p.product_name; });
        STATIC = { machines: r[0].filter(function (m) { return m.is_active; }), depts: r[1], targets: r[2], weights: r[3],
          rules: ENG && ENG.prepareRules ? ENG.prepareRules(r[4]) : r[4], rates: r[5], products: products };
        var idx = { day: {}, week: {}, month: {}, official: {} };
        r[7].forEach(function (u) {
          var k = u.period_type + '|' + u.period_from + '|' + u.period_to;
          (idx.official[k] = idx.official[k] || {})[u.report_type] = u.id;
          if (u.period_type === 'DAY') { idx.day[u.period_from] = 1; idx.week[weekStart(u.period_from)] = 1; idx.month[monthStart(u.period_from)] = 1; }
          else if (u.period_type === 'WEEK') idx.week[u.period_from] = 1;
          else if (u.period_type === 'MONTH') idx.month[u.period_from] = 1;
        });
        ['day', 'week', 'month'].forEach(function (t) { idx[t] = Object.keys(idx[t]).sort(); });
        INDEX = idx; CACHE = {};
        return idx;
      });
      INIT.catch(function () { INIT = null; });
    }
    return INIT;
  }
  function invalidate() { INIT = null; CACHE = {}; }
  function officialOf(t, k) { var r = CAL.range(t, k), o = INDEX.official[LAYER[t] + '|' + r.from + '|' + r.to]; return o && o.OEE && o.RAW ? o : null; }

  var RAW_COLS = 'machine_id,production_date,status,stop_group,station,description,sku,start_at,duration_min,output_qty';
  var OEE_COLS = 'entity_level,entity_name,machine_id,period_from,period_to,oee,availability,performance,quality,tdt_pct,sap_good_units,net_minutes';
  function load(t, k) {
    var ck = t + '|' + k;
    if (CACHE[ck]) return Promise.resolve(CACHE[ck]);
    var r = CAL.range(t, k), off = officialOf(t, k), pk = CAL.step(t, k, -1), pr = CAL.range(t, pk);
    var histFrom = addDays(weekStart(r.to), -7 * (CFG.trendWeeks - 1));
    var jobs = [
      off ? selectAll('raw_events?select=' + RAW_COLS + '&upload_id=eq.' + off.RAW + '&machine_id=not.is.null')
          : selectAll('raw_events?select=' + RAW_COLS + '&period_type=eq.DAY&production_date=gte.' + r.from + '&production_date=lte.' + r.to + '&machine_id=not.is.null'),
      off ? selectAll('oee_report_rows?select=' + OEE_COLS + '&upload_id=eq.' + off.OEE) : Promise.resolve(null),
      selectAll('oee_report_rows?select=' + OEE_COLS + '&period_type=eq.DAY&period_from=gte.' + (t === 'day' ? addDays(k, -13) : r.from) + '&period_from=lte.' + r.to),
      selectAll('oee_report_rows?select=' + OEE_COLS + '&period_type=eq.WEEK&period_from=gte.' + histFrom + '&period_from=lte.' + r.to),
      // previous period: its official report when one exists (same rule as the current period), else the daily reports
      (function () {
        var po = officialOf(t, pk);
        var args = po ? { p_layer: LAYER[t], p_from: pr.from, p_to: pr.to, p_upload: po.RAW } : { p_layer: 'DAY', p_from: pr.from, p_to: pr.to };
        return API.rpc('period_combos', args).then(function (x) { return x || []; }, function () { return []; });
      })()
    ];
    return Promise.all(jobs).then(function (x) {
      var m = buildModel(t, k, r, off, x[0], x[1], x[2], x[3], x[4]);
      CACHE[ck] = m;
      return m;
    });
  }

  /* ---------- model ---------- */
  function bucketOf(rule, status) {
    if (PROD.indexOf(status) >= 0) return 'prod';
    if (!rule || rule.counts_in_oee === null || rule.counts_in_oee === undefined) return 'unknown';
    if (rule.loss_type === 'PRODUCTION') return 'prod';
    if (!rule.counts_in_oee) return 'none';
    if (rule.loss_type === 'UPDT' || rule.loss_type === 'PROCESS_FAILURE') return 'updt';
    if (rule.loss_type === 'PDT') return 'pdt';
    return 'none';
  }
  function ruleOf(mid, day, status, group, desc) {
    return ENG.classify({ status: norm(status), stop_group: norm(group), description: norm(desc), production_date: day }, STATIC.rules, mid, day);
  }
  function num(v) { return v === null || v === undefined || v === '' ? null : Number(v); }
  function aggOfficial(rows) {
    // one official row, or several daily rows combined (net-minutes weighted; good units summed)
    if (!rows || !rows.length) return null;
    if (rows.length === 1) { var o = rows[0]; return { oee: num(o.oee), av: num(o.availability), pf: num(o.performance), q: num(o.quality), good: num(o.sap_good_units) || 0, net: num(o.net_minutes) || 0, n: 1 }; }
    var w = 0, a = { oee: 0, av: 0, pf: 0, q: 0 }, good = 0, net = 0, n = 0;
    rows.forEach(function (o) {
      var ww = num(o.net_minutes) || 0; good += num(o.sap_good_units) || 0; net += ww;
      if (ww > 0) { w += ww; n++; a.oee += ww * (num(o.oee) || 0); a.av += ww * (num(o.availability) || 0); a.pf += ww * (num(o.performance) || 0); a.q += ww * (num(o.quality) || 0); }
    });
    return w ? { oee: a.oee / w, av: a.av / w, pf: a.pf / w, q: a.q / w, good: good, net: net, n: n } : { oee: null, av: null, pf: null, q: null, good: good, net: net, n: 0 };
  }
  function emptyAgg() { return { prod: 0, updt: 0, pdtIn: 0, pdtEx: 0, pfail: 0, pfailN: 0, fails: 0, failMin: 0, updtN: 0, pdtN: 0, none: 0, unknown: 0, generic: 0, perf: 0, base: 0 }; }

  function buildModel(t, k, r, off, events, offRows, dayRows, weekRows, prevCombos) {
    var S = STATIC, day = r.to;
    var deptById = {}; S.depts.forEach(function (d) { deptById[d.id] = d; });
    var inRange = function (o) { return o.period_from >= r.from && o.period_from <= r.to; };
    var officialRows = offRows || dayRows.filter(inRange);
    function offFor(level, name, mid) {
      return aggOfficial(officialRows.filter(function (o) { return o.entity_level === level && (mid ? (o.machine_id === mid || o.entity_name === name) : o.entity_name === name); }));
    }
    var byM = {};
    events.forEach(function (e) { (byM[e.machine_id] = byM[e.machine_id] || []).push(e); });

    var machines = S.machines.map(function (m) {
      var tg = validOn(S.targets.filter(function (x) { return x.machine_id === m.id; }), day);
      var w = validOn(S.weights.filter(function (x) { return x.machine_id === m.id; }), day);
      var a = emptyAgg(), items = {}, pdtItems = {}, unknown = {}, segs = [], perDay = {}, skus = {};
      (byM[m.id] || []).forEach(function (e) {
        var d = Number(e.duration_min) || 0, dd = e.production_date, status = norm(e.status);
        var st = norm(e.station) || '', desc = norm(e.description) || norm(e.stop_group) || status || 'ללא תיאור';
        var rule = ruleOf(m.id, dd, e.status, e.stop_group, e.description), b = bucketOf(rule, status);
        var pd = perDay[dd] = perDay[dd] || { prod: 0, fails: 0, updt: 0 };
        if (b === 'prod') {
          a.prod += d; pd.prod += d;
          if (status === 'ייצור' && e.sku) { var s = skus[e.sku] = skus[e.sku] || { sku: e.sku, qty: 0, min: 0 }; s.qty += Number(e.output_qty) || 0; s.min += d; }
        } else if (b === 'updt') {
          a.updt += d; a.updtN++; pd.updt += d;
          if (!st || GENERIC.indexOf(desc) >= 0) a.generic += d;
          var ik = st + '|' + desc, it = items[ik] = items[ik] || { st: st, d: desc, min: 0, n: 0, max: 0, days: {}, fail: false, pf: false, type: 'UPDT' };
          it.min += d; it.n++; it.max = Math.max(it.max, d); it.days[dd] = 1;
          if (rule.counts_as_failure) { a.fails++; a.failMin += d; pd.fails++; it.fail = true; }
          if (rule.loss_type === 'PROCESS_FAILURE') { a.pfail += d; a.pfailN++; it.pf = true; }
        } else if (b === 'pdt') {
          var std = rule.normal_duration_min ? Number(rule.normal_duration_min) : null;
          var inn = std && d > std ? std : d, ex = std && d > std ? d - std : 0;
          a.pdtIn += inn; a.pdtEx += ex; a.pdtN++;
          var pi = pdtItems[desc] = pdtItems[desc] || { d: desc, min: 0, n: 0, win: 0, ex: 0, exN: 0, std: std, days: {} };
          pi.min += d; pi.n++; pi.win += inn; pi.ex += ex; pi.days[dd] = 1; if (ex > 0) pi.exN++;
        } else if (b === 'none') a.none += d;
        else { a.unknown += d; var uk = status + '|' + (norm(e.stop_group) || '') + '|' + desc; unknown[uk] = (unknown[uk] || 0) + d; }
        if (t === 'day' && e.start_at) segs.push({ at: new Date(e.start_at), min: d, b: b, d: desc, st: st });
      });
      var o = offFor('MACHINE', m.name, m.id);
      if (o && o.pf && o.pf > 0 && o.pf < 1) a.perf = a.prod * (1 - o.pf);
      a.base = a.prod + a.updt + a.pdtIn + a.pdtEx;
      return {
        id: m.id, m: m.name, deptId: m.department_id, dept: deptById[m.department_id] ? deptById[m.department_id].name : '',
        target: tg ? Number(tg.oee_target) / 100 : null, pw: w ? Number(w.plant_weight) : 0, dw: w ? Number(w.department_weight) : 0,
        off: o, a: a, items: Object.keys(items).map(function (x) { return items[x]; }), pdt: Object.keys(pdtItems).map(function (x) { return pdtItems[x]; }),
        unknown: unknown, segs: segs, perDay: perDay,
        skus: Object.keys(skus).map(function (x) { var s = skus[x], rate = validOn(S.rates.filter(function (q) { return q.machine_id === m.id && q.sku === x; }), day);
          return { sku: x, name: S.products[x] || '', qty: s.qty, min: s.min, rate: rate ? Number(rate.target_rate) : null }; }),
        mtbf: a.fails ? a.prod / a.fails : null, mttr: a.fails ? a.failMin / a.fails : null
      };
    });

    // previous period, from the aggregated combos (station is not in the combos → compared by machine + description)
    var prev = {};
    (prevCombos || []).forEach(function (c) {
      var p = prev[c.machine_id] = prev[c.machine_id] || { prod: 0, updt: 0, pdt: 0, fails: 0, by: {}, any: false };
      var pr = CAL.range(t, CAL.step(t, k, -1));
      var rule = ruleOf(c.machine_id, pr.from, c.status, c.stop_group, c.description), b = bucketOf(rule, norm(c.status));
      var min = Number(c.minutes) || 0, desc = norm(c.description) || norm(c.stop_group) || norm(c.status);
      p.any = true;
      if (b === 'prod') p.prod += min;
      if (b === 'updt') { p.updt += min; p.by[desc] = (p.by[desc] || 0) + min; if (rule && rule.counts_as_failure) p.fails += c.n; }
      if (b === 'pdt') p.pdt += min;
    });

    function rowsOf(list, level, name) { return list.filter(function (o) { return o.entity_level === level && o.entity_name === name; }); }
    return {
      t: t, k: k, r: r, official: !!off, machines: machines, prev: prev,
      depts: S.depts.map(function (d) { return { id: d.id, name: d.name, off: offFor('DEPARTMENT', d.name) }; }),
      plantOff: aggOfficial(officialRows.filter(function (o) { return o.entity_level === 'PLANT'; })),
      daySeries: function (level, name, mid) {
        return dayRows.filter(function (o) { return o.entity_level === level && (mid ? (o.machine_id === mid || o.entity_name === name) : (level === 'PLANT' || o.entity_name === name)); })
          .sort(function (x, y) { return x.period_from < y.period_from ? -1 : 1; }).map(function (o) { return { key: o.period_from, v: num(o.oee), net: num(o.net_minutes) }; });
      },
      weekSeries: function (level, name, mid) {
        return weekRows.filter(function (o) { return o.entity_level === level && (mid ? (o.machine_id === mid || o.entity_name === name) : (level === 'PLANT' || o.entity_name === name)); })
          .sort(function (x, y) { return x.period_from < y.period_from ? -1 : 1; }).map(function (o) { return { key: o.period_from, v: num(o.oee) }; });
      },
      empty: !events.length && !officialRows.length
    };
  }

  /* ---------- selections ---------- */
  function sum(a, f) { return a.reduce(function (s, x) { return s + (f ? f(x) : x); }, 0); }
  function by(a, k) { var o = {}; a.forEach(function (x) { var kk = typeof k === 'function' ? k(x) : x[k]; (o[kk] = o[kk] || []).push(x); }); return o; }
  function group(M, ms, wKey, offRow) {
    var tw = sum(ms, function (m) { return m[wKey]; }) || 1;
    function wavg(f) { var ok = ms.filter(function (m) { return f(m) !== null && f(m) !== undefined && m[wKey] > 0; }); var w = sum(ok, function (m) { return m[wKey]; }); return w ? sum(ok, function (m) { return f(m) * m[wKey]; }) / w : null; }
    var A = emptyAgg(); ms.forEach(function (m) { Object.keys(A).forEach(function (k) { A[k] += m.a[k]; }); });
    return {
      oee: offRow && offRow.oee !== null ? offRow.oee : wavg(function (m) { return m.off ? m.off.oee : null; }),
      av: offRow && offRow.av !== null ? offRow.av : wavg(function (m) { return m.off ? m.off.av : null; }),
      pf: offRow && offRow.pf !== null ? offRow.pf : wavg(function (m) { return m.off ? m.off.pf : null; }),
      good: offRow ? offRow.good : sum(ms, function (m) { return m.off ? m.off.good : 0; }),
      target: wavg(function (m) { return m.target; }), a: A,
      mtbf: A.fails ? A.prod / A.fails : null, mttr: A.fails ? A.failMin / A.fails : null, fromOfficial: !!(offRow && offRow.oee !== null)
    };
  }
  function lossItems(ms, wKey, t) {
    var tw = sum(ms, function (m) { return wKey ? m[wKey] : 1; }) || 1, out = [];
    ms.forEach(function (m) {
      if (!m.a.base) return;
      var w = (wKey ? m[wKey] : 1) / tw;
      m.items.forEach(function (i) { out.push({ m: m.m, mid: m.id, st: i.st, d: i.d, min: i.min, n: i.n, max: i.max, days: Object.keys(i.days).length, fail: i.fail, type: 'UPDT', pts: i.min / m.a.base * w }); });
      m.pdt.forEach(function (p) { if (p.ex > 0.05) out.push({ m: m.m, mid: m.id, st: '', d: p.d + ' — חריגה מהתקן', raw: p.d, min: p.ex, n: p.exN, max: p.ex, days: Object.keys(p.days).length, type: 'PDTX', pts: p.ex / m.a.base * w }); });
    });
    return out.sort(function (a, b) { return b.pts - a.pts; });
  }
  function classify(i, t) {
    var avg = i.min / i.n, rec = t === 'day' ? i.n >= CFG.repeatN : i.days >= CFG.repeatDays[t];
    if (rec && avg >= CFG.shortAvg) return { k: 'UPS', cls: 'ups', t: 'חוזר וארוך → UPS / RCA' };
    if (rec) return { k: 'CIL', cls: 'std', t: 'חוזר וקצר → CIL / CL / BOS' };
    if (avg >= CFG.longAvg) return { k: 'IPS', cls: 'ips', t: 'חד-פעמי ארוך → IPS / BDE' };
    return { k: 'מעקב', cls: 'ok', t: 'נדיר וקצר → מעקב' };
  }

  /* ---------- formatting & widgets ---------- */
  function fm(m) { m = Math.round(m || 0); return m >= 60 ? Math.floor(m / 60) + ':' + pad(m % 60) + ' ש\'' : m + ' דק\''; }
  function p1(v) { return v === null || v === undefined || isNaN(v) ? '—' : (v * 100).toFixed(1) + '%'; }
  function p0(v) { return v === null || v === undefined || isNaN(v) ? '—' : Math.round(v * 100) + '%'; }
  function n0(v) { return Math.round(v || 0).toLocaleString('en-US'); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pts(v) { return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + ' נק׳'; }

  function panel(cls, title, hint, body, opt) {
    opt = opt || {};
    var tag = opt.demo ? '<span class="iws-tag-demo">המחשה</span>' : opt.part ? '<span class="iws-tag-part">חלקי</span>' : '';
    return '<div class="iws-panel ' + cls + (opt.demo ? ' iws-demo' : '') + '"><h3>' + title + tag + '</h3>' + (hint ? '<p class="iws-hint">' + hint + '</p>' : '') + body +
      (opt.need ? '<div class="iws-need">מקור נדרש: ' + opt.need + '</div>' : '') + '</div>';
  }
  function kpi(l, v, n, cls) { return '<div class="iws-kpi ' + (cls || '') + '"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="n">' + (n || '') + '</div></div>'; }
  function hbars(rows, opt) {
    opt = opt || {};
    if (!rows.length) return '<div class="iws-empty">אין נתונים לתקופה</div>';
    var max = opt.max || Math.max.apply(null, rows.map(function (r) { return Math.max(r.v, r.t || 0); })) || 1;
    return '<div class="iws-hb">' + rows.map(function (r) {
      return '<div class="lab" title="' + esc(r.title || r.l) + '">' + esc(r.l) + '</div><div class="trk"><div class="fill" style="width:' + (Math.max(0, r.v) / max * 100).toFixed(2) + '%;background:' + (r.c || C.updt) + '"></div>' +
        (r.t !== null && r.t !== undefined ? '<div class="tgt" style="right:' + (r.t / max * 100).toFixed(2) + '%" title="יעד"></div>' : '') + '</div><div class="val">' + r.txt + '</div>';
    }).join('') + '</div>';
  }
  function heatColor(v, max, rgb) { var a = max ? Math.min(1, v / max) : 0; return a < 0.02 ? '#F1F4F7' : 'rgba(' + rgb + ',' + (0.18 + 0.82 * a).toFixed(2) + ')'; }
  function pill(cls, txt, title) { return '<span class="iws-pill iws-p-' + cls + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + txt + '</span>'; }
  function sub(t) { return '<div class="iws-sub">' + t + '</div>'; }

  // bar series with a target line (real official numbers)
  function seriesChart(pointsIn, target, labelOf) {
    var pts2 = pointsIn.filter(function (p) { return p.v !== null && p.v !== undefined; });
    if (!pts2.length) return '<div class="iws-empty">אין דוחות רשמיים לטווח הזה</div>';
    var w = 640, h = 190, n = pts2.length, vals = pts2.map(function (p) { return p.v * 100; });
    var tg = target !== null && target !== undefined ? target * 100 : null;
    var mx = Math.max.apply(null, vals.concat(tg !== null ? [tg] : [])) * 1.12 || 1;
    function X(i) { return n === 1 ? w / 2 : w - 40 - i * (w - 80) / (n - 1); } function Y(v) { return h - 26 - v / mx * (h - 46); }
    var bw = Math.min(42, (w - 80) / n * 0.62);
    return '<svg class="iws-svg" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="מגמת OEE">' +
      (tg !== null ? '<line x1="16" x2="' + (w - 16) + '" y1="' + Y(tg) + '" y2="' + Y(tg) + '" stroke="#1c2b45" stroke-dasharray="5 4"/><text x="18" y="' + (Y(tg) - 5) + '" font-size="11" text-anchor="end" fill="#1c2b45">יעד ' + tg.toFixed(0) + '%</text>' : '') +
      pts2.map(function (p, i) {
        var v = p.v * 100, good = tg === null || v >= tg;
        return '<rect x="' + (X(i) - bw / 2) + '" y="' + Y(v) + '" width="' + bw + '" height="' + Math.max(0, h - 26 - Y(v)) + '" rx="2" fill="' + (good ? C.prod : C.updt) + '" fill-opacity=".85"><title>' + esc(labelOf(p.key)) + ': ' + v.toFixed(1) + '%</title></rect>' +
          '<text x="' + X(i) + '" y="' + (Y(v) - 4) + '" font-size="10.5" text-anchor="middle" fill="#4A5A6B">' + v.toFixed(0) + '</text>' +
          '<text x="' + X(i) + '" y="' + (h - 8) + '" font-size="10" text-anchor="middle" fill="#8393A3">' + esc(labelOf(p.key)) + '</text>';
      }).join('') + '</svg>';
  }

  /* ---------- loss tree (icicle) ---------- */
  function node(label, min, color, kids, extra) {
    var n = { label: label, min: min, color: color, kids: (kids || []).filter(function (x) { return x.min > 0.05; }) };
    for (var q in extra || {}) n[q] = extra[q];
    return n;
  }
  function buildTree(ms, title) {
    var multiDept = Object.keys(by(ms, 'dept')).length > 1, single = ms.length === 1;
    function stations(m) {
      var g = by(m.items, function (i) { return i.st || 'ללא תחנה'; });
      var list = Object.keys(g).map(function (s) {
        return node(s, sum(g[s], function (i) { return i.min; }), C.updt, g[s].sort(function (a, b) { return b.min - a.min; }).map(function (i) { return node(i.d, i.min, i.pf ? C.fail : C.updt, [], { n: i.n }); }));
      });
      var ex = m.pdt.filter(function (p) { return p.ex > 0.05; });
      if (ex.length) list.push(node('חריגת PDT מהתקן', sum(ex, function (p) { return p.ex; }), C.ex, ex.map(function (p) { return node(p.d, p.ex, C.ex, [], { n: p.exN }); })));
      return list.sort(function (a, b) { return b.min - a.min; });
    }
    function pdts(m) { return m.pdt.filter(function (p) { return p.win > 0.05; }).sort(function (a, b) { return b.win - a.win; }).map(function (p) { return node(p.d, p.win, C.pdt, [], { n: p.n }); }); }
    function grp(fn, color, val) {
      var perM = ms.map(function (m) { return node(m.m, val(m), color, fn(m)); });
      if (single) return perM[0].kids;
      if (!multiDept) return perM.sort(function (a, b) { return b.min - a.min; });
      var g = by(ms, 'dept');
      return Object.keys(g).map(function (d) {
        var kids = perM.filter(function (n) { return g[d].some(function (m) { return m.m === n.label; }); }).sort(function (a, b) { return b.min - a.min; });
        return node('אגף ' + d, sum(kids, function (x) { return x.min; }), color, kids);
      }).sort(function (a, b) { return b.min - a.min; });
    }
    var A = { base: 0, prod: 0, perf: 0, updt: 0, pdtIn: 0, pdtEx: 0 };
    ms.forEach(function (m) { Object.keys(A).forEach(function (q) { A[q] += m.a[q]; }); });
    var perfKids = single ? [] : ms.filter(function (m) { return m.a.perf > 0.05; }).map(function (m) { return node(m.m, m.a.perf, C.perf); }).sort(function (a, b) { return b.min - a.min; });
    var root = node(title, A.base, C.root, [
      node('זמן ייצור', A.prod, C.prod, [node('ייצור בקצב', A.prod - A.perf, C.prod), node('הפסד קצב', A.perf, C.perf, perfKids)]),
      node('UPDT — לא מתוכנן (כולל חריגות PDT)', A.updt + A.pdtEx, C.updt, grp(stations, C.updt, function (m) { return m.a.updt + m.a.pdtEx; })),
      node('PDT — מתוכנן, בתוך התקן', A.pdtIn, C.pdt, grp(pdts, C.pdt, function (m) { return m.a.pdtIn; }))
    ]);
    root.base = A.base;
    return root;
  }
  var LEVELS = 4;
  function icicle(host, root, focus) {
    var f = focus || root, path = [];
    (function find(n, trail) { if (n === f) { path = trail.concat(n); return true; } return n.kids.some(function (x) { return find(x, trail.concat(n)); }); })(root, []);
    var cols = []; for (var i = 0; i < LEVELS; i++) cols.push([]);
    (function lay(n, depth, y0, h) {
      if (depth >= LEVELS) return; cols[depth].push({ n: n, y: y0, h: h });
      var tot = sum(n.kids, function (x) { return x.min; }), y = y0;
      n.kids.forEach(function (x) { var hh = h * (x.min / Math.max(n.min, tot || 1)); lay(x, depth + 1, y, hh); y += hh; });
    })(f, 0, 0, 100);
    var nodes = [];
    var html = '<div class="iws-tree-bar">' + path.map(function (n, ix) { return '<button type="button" class="iws-crumb" data-crumb="' + ix + '">' + esc(n.label) + '</button>'; }).join('<span class="iws-sep">‹</span>') +
      '<span class="iws-tree-help">לחיצה על מלבן = ירידה לעומק</span></div><div class="iws-icicle">';
    if (!root.base) html += '<div class="iws-empty" style="grid-column:1/-1">אין אירועים לתקופה</div>';
    else cols.forEach(function (col, ci) {
      html += '<div class="iws-col">' + col.map(function (c) {
        var n = c.n, px = c.h * 4.3, share = n.min / root.base, clk = n.kids.length && ci > 0, ix = nodes.push(n) - 1;
        var lbl = px < 16 ? '' : '<b>' + esc(n.label) + '</b><i>' + fm(n.min) + ' · ' + p1(share) + (n.n ? ' · ' + n.n + ' מופעים' : '') + '</i>';
        return '<div class="iws-node' + (clk ? ' clk' : '') + (px < 34 ? ' tiny' : '') + '"' + (clk ? ' tabindex="0" role="button"' : '') + ' data-node="' + ix + '" title="' +
          esc(n.label + ' — ' + fm(n.min) + ' (' + p1(share) + ' מזמן הבסיס)' + (n.n ? ' · ' + n.n + ' מופעים' : '')) + '" style="top:' + c.y + '%;height:calc(' + c.h + '% - 2px);background:' + n.color + '">' + lbl + '</div>';
      }).join('') + '</div>';
    });
    html += '</div><div class="iws-legend"><span><i style="background:' + C.prod + '"></i>ייצור</span><span><i style="background:' + C.perf + '"></i>הפסד קצב</span><span><i style="background:' + C.updt + '"></i>UPDT</span><span><i style="background:' + C.fail + '"></i>כשל תהליך</span><span><i style="background:' + C.ex + '"></i>חריגת PDT מהתקן</span><span><i style="background:' + C.pdt + '"></i>PDT בתקן</span><span>גובה = דקות · % = חלק מזמן הבסיס</span></div>';
    host.innerHTML = html;
    host.onclick = function (e) {
      var cr = e.target.closest('[data-crumb]'); if (cr) { icicle(host, root, path[+cr.getAttribute('data-crumb')]); return; }
      var el = e.target.closest('.iws-node.clk'); if (el) icicle(host, root, nodes[+el.getAttribute('data-node')]);
    };
    host.onkeydown = function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('clk')) { e.preventDefault(); e.target.click(); } };
  }

  /* ---------- tables ---------- */
  function paretoTable(items, k, t, showM, prevOf) {
    if (!items.length) return '<div class="iws-empty">אין הפסדים לתקופה</div>';
    var tot = sum(items, function (i) { return i.pts; }) || 1, acc = 0, top = items.slice(0, k), max = top[0].pts || 1;
    return '<div class="iws-scroll"><table class="iws-t"><thead><tr><th>#</th><th>הפסד</th>' + (showM ? '<th>מכונה</th>' : '') + '<th style="width:26%">נק׳ OEE</th><th>דקות</th><th>' + (t === 'day' ? 'מופעים' : 'מופעים / ימים') + '</th><th>' + (prevOf ? 'מול ' + PREVW[t] : 'מצטבר') + '</th><th>כלי</th></tr></thead><tbody>' +
      top.map(function (i, ix) {
        acc += i.pts; var c = classify(i, t), last = '';
        if (prevOf) { var pv = prevOf(i); last = pv === null ? '<span class="iws-mut">—</span>' : (function () { var d = i.min - pv; return '<span style="color:' + (d > 0 ? C.updt : C.prod) + '">' + (d > 0 ? '▲ ' : '▼ ') + fm(Math.abs(d)) + '</span>'; })(); }
        else last = p0(acc / tot);
        return '<tr><td>' + (ix + 1) + '</td><td>' + esc(i.d) + (i.st ? sub(esc(i.st)) : '') + '</td>' + (showM ? '<td>' + esc(i.m) + '</td>' : '') +
          '<td><div class="iws-bar"><div style="background:' + (i.type === 'UPDT' ? C.updt : C.ex) + ';width:' + (i.pts / max * 100).toFixed(1) + '%"></div><span>' + (i.pts * 100).toFixed(2) + '</span></div></td><td>' + fm(i.min) + '</td><td>' + i.n + (t !== 'day' ? ' / ' + i.days : '') + '</td><td>' + last + '</td><td>' + pill(c.cls, c.k, c.t) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function candTable(list, t, emptyTxt) {
    return '<div class="iws-scroll"><table class="iws-t"><thead><tr><th>הפסד</th><th>כלי</th><th>בעלים</th><th>סטטוס</th></tr></thead><tbody>' +
      (list.length ? list.map(function (i) { var c = classify(i, t); return '<tr><td>' + esc(i.d) + sub(esc(i.m) + (i.st ? ' · ' + esc(i.st) : '') + ' · ' + fm(i.min) + ' · ' + i.n + ' מופעים' + (t !== 'day' ? ' ב-' + i.days + ' ימים' : '')) + '</td><td>' + pill(c.cls, c.k, c.t) + '</td><td>' + pill('demo', 'לא שויך') + '</td><td>' + pill('demo', 'לא נפתח') + '</td></tr>'; }).join('')
        : '<tr><td colspan="4" class="iws-mut">' + (emptyTxt || 'אין') + '</td></tr>') + '</tbody></table></div>';
  }
  function pdtTable(ms, onlyEx) {
    var rows = [];
    ms.forEach(function (m) { m.pdt.forEach(function (p) { if (!onlyEx || p.ex > 0.05) rows.push({ m: m.m, p: p }); }); });
    rows.sort(function (a, b) { return (onlyEx ? b.p.ex - a.p.ex : b.p.min - a.p.min); });
    if (!rows.length) return '<div class="iws-empty">' + (onlyEx ? 'אין חריגות מהתקן' : 'אין פעילויות מתוכננות') + '</div>';
    var multi = ms.length > 1;
    return '<div class="iws-scroll"><table class="iws-t"><thead><tr><th>פעילות</th>' + (multi ? '<th>מכונה</th>' : '') + '<th>מופעים</th><th>תקן</th><th>בתקן</th><th>חריגה</th></tr></thead><tbody>' + rows.slice(0, 15).map(function (x) {
      var p = x.p;
      return '<tr><td>' + esc(p.d) + '</td>' + (multi ? '<td>' + esc(x.m) + '</td>' : '') + '<td>' + p.n + '</td><td>' + (p.std ? p.std + ' דק׳' : '<span class="iws-mut">אין תקן</span>') + '</td><td>' + (p.std ? fm(p.win) : '—') + '</td><td>' + (p.ex > 0.05 ? pill('ips', fm(p.ex) + ' · ' + p.exN) : '—') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  /* ---------- demo widgets (no data source yet) ---------- */
  function routinesDemo() {
    var r = [['CIL — ביצוע משימות', 87, 100], ['CL — עמידה ב-Centerline', 91, 98], ['PM — בוצע בזמן', 94, 100], ['BOS — תצפיות מול תוכנית', 77, 100], ['MP&S — עמידה בתוכנית אחזקה', 88, 95]];
    return hbars(r.map(function (x) { return { l: x[0], v: x[1], t: x[2], c: '#B7A6E3', txt: x[1] + '% / ' + x[2] + '%' }; }), { max: 100 });
  }
  function agingDemo() {
    return hbars([['0–7 ימים', 9], ['8–14 ימים', 5], ['15–30 ימים', 3], ['מעל 30 ימים', 2]].map(function (x) { return { l: x[0], v: x[1], c: '#B7A6E3', txt: x[1] + ' פעולות' }; }));
  }
  function sustainDemo(items, t) {
    var rows = items.filter(function (i) { return i.type === 'UPDT'; }).slice(0, 4);
    if (!rows.length) return '<div class="iws-empty">אין הפסדים לתקופה</div>';
    return '<div class="iws-scroll"><table class="iws-t"><thead><tr><th>פעולה על הפסד (אמיתי)</th><th>' + PWORD[t] + ' נוכחי</th><th>30 יום</th><th>60 יום</th><th>90 יום</th><th>מצב</th></tr></thead><tbody>' + rows.map(function (i) {
      return '<tr><td>' + esc(i.d) + sub(esc(i.m) + ' · ' + classify(i, t).k) + '</td><td>' + fm(i.min) + '</td><td>' + pill('demo', '—') + '</td><td>' + pill('demo', '—') + '</td><td>' + pill('demo', '—') + '</td><td>' + pill('demo', 'אין פעולה רשומה') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function clDemo() {
    return '<div class="iws-grid3"><div><b>Centerline</b><table class="iws-t"><tr><td>לחץ אוויר ניפוח</td><td>' + pill('ups', 'מחוץ לטווח') + '</td></tr><tr><td>טמפ׳ מילוי</td><td>' + pill('ok', 'בטווח') + '</td></tr></table></div>' +
      '<div><b>CIL</b><table class="iws-t"><tr><td>בוצעו</td><td>26 / 30</td></tr><tr><td>חריגות שנמצאו</td><td>3</td></tr></table></div>' +
      '<div><b>BOS</b><table class="iws-t"><tr><td>תצפיות</td><td>2</td></tr><tr><td>עמידה בסטנדרט</td><td>1 / 2</td></tr></table></div></div>';
  }
  function flow(steps, stage) { return '<div class="iws-flow">' + steps.map(function (s, i) { return '<div class="st' + (i < stage ? ' done' : i === stage ? ' now' : '') + '">' + s + '</div>'; }).join('') + '</div>'; }
  var RCA_STEPS = ['<b>הגדרת בעיה</b>5W1H', '<b>ראיות</b>צילום, לוג PLC', '<b>5 למה</b>השערת שורש', '<b>Countermeasure</b>שינוי PM / CL', '<b>אימות 30</b>ירידה בהפסד', '<b>קיימות 60/90</b>התוצאה נשמרה'];
  function iwsGrid(items, t) {
    var cand = items.filter(function (i) { return i.type === 'UPDT'; });
    var ups = cand.filter(function (i) { return classify(i, t).k === 'UPS'; }).length, ips = cand.filter(function (i) { return classify(i, t).k === 'IPS'; }).length;
    function cell(k, s, v, src) { return '<div class="c src-' + src + '"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>'; }
    return '<div class="iws-cells">' + cell('UPS', 'מועמדים מהנתונים', ups, 'part') + cell('IPS', 'אירועים ארוכים', ips, 'part') + cell('RCA', 'פתוחות', '—', 'none') + cell('CM', 'באישור', '—', 'none') +
      cell('PM', 'בוצע בזמן', '—', 'none') + cell('MP&S', 'עמידה', '—', 'none') + cell('CL', 'עמידה', '—', 'none') + cell('CIL', 'ביצוע', '—', 'none') + cell('BOS', 'תצפיות', '—', 'none') + '</div>';
  }

  /* ---------- real-data widgets ---------- */
  function heatmap(ms) {
    var fams = [['PDT בתקן', function (m) { return m.a.pdtIn; }, '138,147,168'], ['חריגת PDT', function (m) { return m.a.pdtEx; }, '224,123,57'], ['UPDT', function (m) { return m.a.updt - m.a.pfail; }, '220,38,38'],
      ['כשל תהליך', function (m) { return m.a.pfail; }, '153,27,27'], ['קצב', function (m) { return m.a.perf; }, '184,147,44']];
    return '<div class="iws-scroll"><table class="iws-t iws-heat"><thead><tr><th>מכונה</th>' + fams.map(function (f) { return '<th>' + f[0] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      ms.filter(function (m) { return m.a.base > 0; }).map(function (m) {
        return '<tr><td>' + esc(m.m) + sub(esc(m.dept)) + '</td>' + fams.map(function (f) { var v = f[1](m) / m.a.base; return '<td class="h" style="background:' + heatColor(v, 0.3, f[2]) + ';color:' + (v > 0.04 ? '#fff' : '#4A5A6B') + '">' + (v > 0.0005 ? p1(v) : '—') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  function dqTable(ms) {
    var rows = ms.filter(function (m) { return m.a.updt > 0 || m.a.unknown > 0; }).map(function (m) { return { m: m.m, share: m.a.updt ? m.a.generic / m.a.updt : 0, gen: m.a.generic, unk: m.a.unknown, off: !!m.off }; })
      .sort(function (a, b) { return (b.gen + b.unk) - (a.gen + a.unk); });
    if (!rows.length) return '<div class="iws-empty">אין אירועים לתקופה</div>';
    return '<div class="iws-scroll"><table class="iws-t"><thead><tr><th>מכונה</th><th>UPDT בלי סיבה ברורה</th><th>אירועים בלי כלל סיווג</th><th>דוח OEE רשמי</th></tr></thead><tbody>' + rows.map(function (r) {
      return '<tr><td>' + esc(r.m) + '</td><td>' + pill(r.share > 0.3 ? 'ups' : r.share > 0.1 ? 'ips' : 'ok', p0(r.share)) + ' ' + fm(r.gen) + '</td><td>' + (r.unk > 0.5 ? pill('ips', fm(r.unk)) : '—') + '</td><td>' + (r.off ? pill('ok', 'יש') : pill('ups', 'חסר')) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function oeeVsTarget(ms, wKey) {
    return hbars(ms.filter(function (m) { return m.off && m.off.oee !== null; }).sort(function (a, b) { return b[wKey] - a[wKey]; })
      .map(function (m) { return { l: m.m + ' (' + m[wKey] + '%)', v: m.off.oee, t: m.target, c: m.target === null || m.off.oee >= m.target ? C.prod : C.updt, txt: p1(m.off.oee) + (m.target !== null ? ' / ' + p0(m.target) : '') }; }), { max: 1 });
  }
  function timeline(ms, k) {
    var start = new Date(k + 'T07:00:00'), W = 1200, rowH = 26, top = 24, lab = 90, span = W - lab - 10;
    var rows = ms.filter(function (m) { return m.segs.length; });
    if (!rows.length) return '<div class="iws-empty">אין אירועים עם שעה ליום הזה</div>';
    var H = top + rows.length * (rowH + 6) + 22;
    function X(min) { return W - lab - Math.max(0, Math.min(1440, min)) / 1440 * span; }
    var col = { prod: '#CFE6D6', updt: C.updt, pdt: C.pdt, none: '#E5E7EB', unknown: '#F59E0B' };
    var s = '<svg class="iws-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="ציר עצירות">';
    [0, 1, 2].forEach(function (i) { var x = X(i * 480); s += '<line x1="' + x + '" x2="' + x + '" y1="4" y2="' + (H - 18) + '" stroke="#1c2b45" stroke-width="' + (i ? 1 : 0) + '"/><text x="' + (x - 4) + '" y="15" font-size="12" text-anchor="start" fill="#4A5A6B">' + ['משמרת בוקר', 'משמרת ערב', 'משמרת לילה'][i] + '</text>'; });
    rows.forEach(function (m, ri) {
      var y = top + ri * (rowH + 6);
      s += '<text x="' + (W - 4) + '" y="' + (y + rowH / 2 + 4) + '" font-size="12" text-anchor="start" fill="#16202A">' + esc(m.m) + '</text><rect x="' + X(1440) + '" y="' + y + '" width="' + span + '" height="' + rowH + '" fill="#F1F4F7"/>';
      m.segs.forEach(function (g) {
        var from = (g.at - start) / 60000, x1 = X(from), x2 = X(from + g.min), w = Math.max(1, x1 - x2);
        s += '<rect x="' + x2 + '" y="' + y + '" width="' + w + '" height="' + rowH + '" fill="' + (col[g.b] || '#ccc') + '"><title>' + esc(pad(g.at.getHours()) + ':' + pad(g.at.getMinutes()) + ' · ' + g.d + (g.st ? ' · ' + g.st : '') + ' · ' + fm(g.min)) + '</title></rect>';
      });
    });
    ['07', '09', '11', '13', '15', '17', '19', '21', '23', '01', '03', '05'].forEach(function (h, i) { var x = X(i * 120); s += '<text x="' + x + '" y="' + (H - 4) + '" font-size="11" text-anchor="middle" fill="#8393A3">' + h + '</text>'; });
    return s + '</svg><div class="iws-legend"><span><i style="background:#CFE6D6"></i>ייצור</span><span><i style="background:' + C.updt + '"></i>UPDT</span><span><i style="background:' + C.pdt + '"></i>PDT</span><span><i style="background:#F59E0B"></i>לא מסווג</span><span>ריחוף מעל מקטע מציג שעה וסיבה</span></div>';
  }
  function scatter(items, t) {
    if (!items.length) return '<div class="iws-empty">אין עצירות לא מתוכננות</div>';
    var w = 620, hh = 330, pad2 = 42, occ = function (i) { return t === 'day' ? i.n : i.days; }, thr = t === 'day' ? CFG.repeatN : CFG.repeatDays[t];
    var maxN = Math.max.apply(null, items.map(occ).concat([thr + 1])), maxA = Math.max.apply(null, items.map(function (r) { return r.min / r.n; }).concat([CFG.longAvg + 5]));
    var lo = 1, hi = maxA * 1.6, cut = thr - 0.5;
    function X(n) { return w - pad2 - (n / (maxN * 1.1)) * (w - 2 * pad2); } function Y(a) { return hh - pad2 - (Math.log(Math.max(a, lo)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) * (hh - 2 * pad2); }
    var maxMin = Math.max.apply(null, items.map(function (r) { return r.min; })) || 1, lab = items.slice().sort(function (a, b) { return b.min - a.min; }).slice(0, 4);
    var col = { UPS: C.updt, IPS: C.ex, CIL: C.pdt, 'מעקב': C.mon };
    return '<svg class="iws-svg" viewBox="0 0 ' + w + ' ' + hh + '" role="img" aria-label="מפת מצבי כשל">' +
      '<rect x="' + pad2 + '" y="' + Y(hi) + '" width="' + (X(cut) - pad2) + '" height="' + (Y(CFG.shortAvg) - Y(hi)) + '" fill="#FEE2E2" opacity=".6"/>' +
      '<rect x="' + pad2 + '" y="' + Y(CFG.shortAvg) + '" width="' + (X(cut) - pad2) + '" height="' + (Y(lo) - Y(CFG.shortAvg)) + '" fill="#E6EEF6" opacity=".7"/>' +
      '<rect x="' + X(cut) + '" y="' + Y(hi) + '" width="' + (w - pad2 - X(cut)) + '" height="' + (Y(CFG.longAvg) - Y(hi)) + '" fill="#FEF3C7" opacity=".7"/>' +
      '<text x="' + (pad2 + 6) + '" y="' + (Y(hi) + 15) + '" font-size="11" text-anchor="end" fill="#991B1B">חוזר וארוך: UPS / RCA</text>' +
      '<text x="' + (pad2 + 6) + '" y="' + (Y(lo) - 8) + '" font-size="11" text-anchor="end" fill="#2F4A66">חוזר וקצר: CIL / CL</text>' +
      '<text x="' + (w - pad2 - 6) + '" y="' + (Y(CFG.longAvg) - 7) + '" font-size="11" text-anchor="start" fill="#92400E">חד-פעמי ארוך: IPS / BDE</text>' +
      '<text x="' + (w - pad2 - 6) + '" y="' + (Y(lo) - 8) + '" font-size="11" text-anchor="start" fill="#4D7A5E">נדיר וקצר: מעקב</text>' +
      [1, 5, 30, 120, 480].filter(function (v) { return v < hi; }).map(function (v) { return '<line x1="' + pad2 + '" x2="' + (w - pad2) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#E3E8EE"/><text x="' + (w - pad2 + 5) + '" y="' + (Y(v) + 4) + '" font-size="10" text-anchor="end" fill="#8393A3">' + v + '</text>'; }).join('') +
      '<line x1="' + pad2 + '" x2="' + (w - pad2) + '" y1="' + Y(lo) + '" y2="' + Y(lo) + '" stroke="#B9C4CF"/>' +
      [1, 3, 5, 10, 15, 20, 30].filter(function (v) { return v <= maxN * 1.1; }).map(function (v) { return '<text x="' + X(v) + '" y="' + (Y(lo) + 14) + '" font-size="10" text-anchor="middle" fill="#8393A3">' + v + '</text>'; }).join('') +
      '<text x="' + (w / 2) + '" y="' + (hh - 6) + '" font-size="11" text-anchor="middle" fill="#4A5A6B">' + (t === 'day' ? 'מספר מופעים' : 'מספר ימים שבהם הופיע') + '</text>' +
      '<text x="12" y="' + (hh / 2) + '" font-size="11" text-anchor="middle" fill="#4A5A6B" transform="rotate(-90 12 ' + (hh / 2) + ')">משך ממוצע לעצירה, דק׳ (לוגריתמי)</text>' +
      items.map(function (r) {
        var a = r.min / r.n, rad = 5 + 14 * Math.sqrt(r.min / maxMin), c = classify(r, t);
        var lb = lab.indexOf(r) >= 0 ? '<text x="' + (X(occ(r)) - rad - 3) + '" y="' + (Y(a) + 4) + '" font-size="10.5" text-anchor="start" fill="#16202A" paint-order="stroke" stroke="#fff" stroke-width="3">' + esc(r.d.length > 24 ? r.d.slice(0, 23) + '…' : r.d) + '</text>' : '';
        return '<g><title>' + esc(r.d + (r.st ? ' · ' + r.st : '') + ' — ' + r.n + ' מופעים' + (t !== 'day' ? ' ב-' + r.days + ' ימים' : '') + ', ' + fm(r.min) + ' → ' + c.t) + '</title><circle cx="' + X(occ(r)) + '" cy="' + Y(a) + '" r="' + rad + '" fill="' + col[c.k] + '" fill-opacity=".75" stroke="#fff"/>' + lb + '</g>';
      }).join('') + '</svg>';
  }
  function matrix(items, t) {
    if (!items.length) return '<div class="iws-empty">אין עצירות לא מתוכננות</div>';
    var g = by(items, function (i) { return i.st || 'ללא תחנה'; }), st = Object.keys(g).sort(function (a, b) { return sum(g[b], function (i) { return i.min; }) - sum(g[a], function (i) { return i.min; }); });
    return '<div class="iws-scroll" style="max-height:360px;overflow-y:auto"><table class="iws-t"><thead><tr><th>תחנה / מצב כשל</th><th>מופעים</th><th>דקות</th><th>ממוצע</th><th>כלי</th></tr></thead><tbody>' + st.map(function (s) {
      var tt = sum(g[s], function (i) { return i.min; }), n = sum(g[s], function (i) { return i.n; });
      return '<tr class="iws-grp"><td><b>' + esc(s) + '</b></td><td><b>' + n + '</b></td><td><b>' + fm(tt) + '</b></td><td>' + (tt / n).toFixed(1) + '</td><td></td></tr>' + g[s].sort(function (a, b) { return b.min - a.min; }).map(function (i) {
        var c = classify(i, t); return '<tr><td class="ind">' + esc(i.d) + (i.fail ? ' ' + pill('ups', 'תקלה') : '') + '</td><td>' + i.n + '</td><td>' + fm(i.min) + '</td><td>' + (i.min / i.n).toFixed(1) + '</td><td>' + pill(c.cls, c.k, c.t) + '</td></tr>';
      }).join('');
    }).join('') + '</tbody></table></div>';
  }
  function skuTable(ms) {
    var rows = []; ms.forEach(function (m) { m.skus.forEach(function (s) { rows.push({ m: m.m, s: s }); }); });
    rows.sort(function (a, b) { return b.s.min - a.s.min; });
    if (!rows.length) return '<div class="iws-empty">אין ייצור לתקופה</div>';
    var multi = ms.length > 1;
    return '<div class="iws-scroll"><table class="iws-t"><thead><tr><th>מוצר</th><th>תפוקה</th><th>קצב יעד</th><th>דק׳ תקן / בפועל</th><th>ביצועים</th></tr></thead><tbody>' + rows.slice(0, 15).map(function (x) {
      var s = x.s, std = s.rate ? s.qty / s.rate : null, pf = std && s.min ? std / s.min : null;
      return '<tr><td>' + esc(s.name || s.sku) + sub(esc(s.sku) + (multi ? ' · ' + esc(x.m) : '')) + '</td><td>' + n0(s.qty) + '</td><td>' + (s.rate ? Math.round(s.rate) + '/ד׳' : pill('ips', 'חסר')) + '</td><td>' + (std ? n0(std) + ' / ' + n0(s.min) : '— / ' + n0(s.min)) + '</td><td>' + (pf ? pill(pf >= 0.995 ? 'ok' : 'ips', p0(pf)) : '—') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function familyCompare(ms, M) {
    var cur = { prod: 0, updt: 0, pdt: 0 }, prv = { prod: 0, updt: 0, pdt: 0 }, any = false;
    ms.forEach(function (m) { cur.prod += m.a.prod; cur.updt += m.a.updt; cur.pdt += m.a.pdtIn + m.a.pdtEx; var p = M.prev[m.id]; if (p && p.any) { any = true; prv.prod += p.prod; prv.updt += p.updt; prv.pdt += p.pdt; } });
    if (!any) return '<div class="iws-empty">אין נתונים ל' + PREVW[M.t] + '</div>';
    var rows = [['זמן ייצור', cur.prod, prv.prod, true], ['UPDT (עצירות לא מתוכננות)', cur.updt, prv.updt, false], ['PDT (כולל חריגות)', cur.pdt, prv.pdt, false]];
    return '<div class="iws-scroll"><table class="iws-t"><thead><tr><th>משפחה</th><th>' + PREVW[M.t] + '</th><th>עכשיו</th><th>שינוי</th></tr></thead><tbody>' + rows.map(function (r) {
      var d = r[1] - r[2], good = r[3] ? d >= 0 : d <= 0;
      return '<tr><td>' + r[0] + '</td><td>' + fm(r[2]) + '</td><td>' + fm(r[1]) + '</td><td style="color:' + (good ? C.prod : C.updt) + '">' + (d >= 0 ? '▲ ' : '▼ ') + fm(Math.abs(d)) + '</td></tr>';
    }).join('') + '</tbody></table></div><div class="iws-note">חריגות PDT מהתקן נכללות כאן ב-PDT, כי בנתוני התקופה הקודמת אין פירוק לפי אירוע.</div>';
  }
  function mtbfSeries(ms, M) {
    var buckets = {};
    ms.forEach(function (m) { Object.keys(m.perDay).forEach(function (d) { var key = M.t === 'month' ? weekStart(d) : d, b = buckets[key] = buckets[key] || { prod: 0, fails: 0 }; b.prod += m.perDay[d].prod; b.fails += m.perDay[d].fails; }); });
    var keys = Object.keys(buckets).sort();
    if (!keys.length) return '<div class="iws-empty">אין נתונים</div>';
    var rows = keys.map(function (x) {
      var b = buckets[x], l, partial = false;
      if (M.t === 'month') {
        // a week that crosses the month edge: only its days inside the month are counted — say so in the label
        var ws = x < M.r.from ? M.r.from : x, we = addDays(x, 6) > M.r.to ? M.r.to : addDays(x, 6);
        partial = ws !== x || we !== addDays(x, 6);
        l = 'שבוע ' + (Math.floor(daysBetween(weekStart(addDays(x, 6).slice(0, 4) + '-01-01'), x) / 7) + 1) + (partial ? ' · ' + ws.slice(8) + '/' + ws.slice(5, 7) + '–' + we.slice(8) + '/' + we.slice(5, 7) + ' בלבד' : '');
      } else l = CAL.short('day', x);
      return { l: l, v: b.fails ? b.prod / b.fails : 0, c: partial ? '#C9CFDA' : C.pdt, txt: b.fails ? fm(b.prod / b.fails) + ' · ' + b.fails + ' תקלות' : 'אין תקלות', title: partial ? 'שבוע חלקי — רק הימים שבתוך החודש' : '' };
    });
    return hbars(rows);
  }

  /* ---------- screens ---------- */
  var QUESTION = {
    site: { day: 'מה קרה במפעל ביום הזה, ואיזה אירוע דורש תגובה?', week: 'אילו הפסדים חוזרים השבוע, ואיך עומדות השגרות והפעולות?', month: 'האם השיפורים החזיקו, ואיפה משקיעים משאבים בחודש הבא?' },
    line: { day: 'מה קרה בקו במשמרות, ומה פותרים עוד היום?', week: 'מה חוזר בקו השבוע, ומי מטפל בזה?', month: 'האם הקו מתקרב ליעד, והאם הפעולות שלו נשמרו?' },
    tech: { day: 'איזו תקלה ארוכה קרתה, ומה נדרש כדי לסגור אותה?', week: 'אילו מצבי כשל חוזרים, ואיפה פותחים RCA?', month: 'האם RCA ו-PM באמת הורידו תקלות, ומה המגמה של MTBF?' }
  };
  function prevOee(series, key) { var p = series.filter(function (x) { return x.key < key && x.v !== null; }); return p.length ? p[p.length - 1].v : null; }
  function deltaTxt(cur, prv, t) { if (cur === null || prv === null) return ''; var d = cur - prv; return '<span style="color:' + (d >= 0 ? C.prod : C.updt) + '">' + (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d * 100).toFixed(1) + ' נק׳</span> מ' + PREVW[t]; }
  function prevByDesc(M) { return function (i) { var p = M.prev[i.mid]; if (!p || !p.any) return null; return i.type === 'UPDT' ? (p.by[i.d] || 0) : null; }; }

  function siteView(M) {
    var t = M.t, ms = M.machines, G = group(M, ms, 'pw', M.plantOff), items = lossItems(ms, 'pw', t), trees = [];
    var ser = t === 'week' ? M.weekSeries('PLANT') : M.daySeries('PLANT'), pv = t === 'month' ? null : prevOee(ser, M.k);
    var lossMin = G.a.updt + G.a.pdtIn + G.a.pdtEx + G.a.perf, ipsN = items.filter(function (i) { return i.type === 'UPDT' && classify(i, t).k === 'IPS'; }).length;
    var h = '<div class="iws-kpis">' + kpi('OEE מפעל', p1(G.oee), (G.target !== null ? 'יעד משוקלל ' + p1(G.target) : '') + (pv !== null ? '<br>' + deltaTxt(G.oee, pv, t) : ''), G.target !== null ? (G.oee >= G.target ? 'good' : 'bad') : '') +
      kpi('זמינות', p1(G.av), '') + kpi('ביצועים', p1(G.pf), '') + kpi('MTBF', G.mtbf ? fm(G.mtbf) : '—', G.a.fails + ' תקלות') + kpi('MTTR', G.mttr ? fm(G.mttr) : '—', 'דקות תקלה ÷ תקלות') +
      kpi('זמן אבוד', fm(lossMin), 'UPDT + PDT + קצב') + (t === 'day' ? kpi('אירועים ארוכים', ipsN, 'מועמדים ל-IPS') : kpi('פעולות באיחור', '—', 'אין טבלת פעולות', 'demo')) + '</div><div class="iws-grid">';
    if (t === 'day') {
      h += panel('c7', 'OEE לפי מכונה מול יעד', 'רוחב = OEE רשמי, קו שחור = יעד המכונה. בסוגריים — משקל המכונה במפעל.', oeeVsTarget(ms, 'pw'));
      h += panel('c5', 'אירועים שדורשים תגובה', 'עצירות ארוכות חד-פעמיות → IPS / BDE.', candTable(items.filter(function (i) { return i.type === 'UPDT' && classify(i, t).k === 'IPS'; }).slice(0, 6), t, 'אין עצירה ארוכה חד-פעמית'), { part: true, need: 'בעלים וסטטוס לכל IPS.' });
      h += panel('c12', 'עץ ההפסדים — מפעל', '', '<div data-tree="0"></div>'); trees.push(buildTree(ms, 'זמן בסיס OEE — מפעל'));
      h += panel('c7', '5 ההפסדים הגדולים', 'מדורג לפי נקודות OEE משוקללות: דקות ÷ זמן הבסיס של המכונה × משקל המכונה במפעל.', paretoTable(items, 5, t, true));
      h += panel('c5', 'אמינות הנתונים', 'לתקן קידוד לפני שמנתחים.', dqTable(ms));
    }
    if (t === 'week') {
      h += panel('c12', 'עץ ההפסדים — מפעל, השבוע', '', '<div data-tree="0"></div>'); trees.push(buildTree(ms, 'זמן בסיס OEE — מפעל'));
      h += panel('c7', 'Pareto השבוע מול השבוע הקודם', 'השינוי מחושב לפי מכונה ותיאור העצירה.', paretoTable(items, 10, t, true, prevByDesc(M)));
      h += panel('c5', 'OEE מפעל לפי יום', 'דוחות יומיים רשמיים.', seriesChart(M.daySeries('PLANT').filter(function (x) { return x.key >= M.r.from && x.key <= M.r.to; }), G.target, function (key) { return CAL.short('day', key); }));
      h += panel('c7', 'Heatmap — משפחת הפסד × מכונה', 'אחוז מזמן הבסיס של כל מכונה.', heatmap(ms));
      h += panel('c5', 'עמידה בשגרות IWS', 'קו שחור = יעד.', routinesDemo(), { demo: true, need: 'דיווחי CIL / CL / PM / BOS / MP&S.' });
      h += panel('c6', 'הפסדים חוזרים — מועמדים ל-UPS', 'הופיעו ב-' + CFG.repeatDays.week + ' ימים או יותר בשבוע.', candTable(items.filter(function (i) { return i.type === 'UPDT' && classify(i, t).k === 'UPS'; }).slice(0, 8), t, 'אין הפסד חוזר'), { part: true, need: 'טבלת פעולות.' });
      h += panel('c6', 'גיל הפעולות הפתוחות', '', agingDemo(), { demo: true, need: 'טבלת פעולות עם תאריך פתיחה.' });
    }
    if (t === 'month') {
      h += panel('c7', 'מגמת OEE מפעל — עד ' + CFG.trendWeeks + ' שבועות', 'דוחות שבועיים רשמיים.', seriesChart(M.weekSeries('PLANT'), G.target, function (key) { return CAL.short('week', key); }));
      h += panel('c5', 'החודש מול החודש הקודם', 'דקות לפי משפחת הפסד.', familyCompare(ms, M));
      h += panel('c12', 'עץ ההפסדים — מפעל, החודש', '', '<div data-tree="0"></div>'); trees.push(buildTree(ms, 'זמן בסיס OEE — מפעל'));
      h += panel('c7', 'קיימות השיפור — 30 / 60 / 90 יום', 'ההפסדים אמיתיים; המעקב אחרי הפעולה עדיין בלי מקור.', sustainDemo(items, t), { part: true, need: 'טבלת פעולות עם תאריך הטמעה.' });
      h += panel('c5', '3 ההפסדים לטיפול בחודש הבא', 'ראש ה-Pareto של החודש.', paretoTable(items, 3, t, true), { part: true, need: 'בעלים, יעד והשפעה צפויה לכל מהלך.' });
      h += panel('c7', 'Heatmap — משפחת הפסד × מכונה', '', heatmap(ms));
      h += panel('c5', 'סטטוס כלי IWS', '', iwsGrid(items, t), { part: true, need: 'טבלאות RCA / CM / PM / CIL / CL / BOS.' });
    }
    return { html: h + '</div>', trees: trees };
  }

  function lineView(M, st) {
    var t = M.t, depts = M.depts.filter(function (d) { return M.machines.some(function (m) { return m.deptId === d.id; }); });
    var dept = depts.filter(function (d) { return d.name === st.dept; })[0] || depts[0];
    var dms = M.machines.filter(function (m) { return m.deptId === dept.id; });
    var ms = st.mid ? dms.filter(function (m) { return m.id === st.mid; }) : dms;
    if (!ms.length) ms = dms;
    var single = ms.length === 1, scope = single ? ms[0].m : 'אגף ' + dept.name;
    var G = single ? group(M, ms, 'dw', ms[0].off) : group(M, ms, 'dw', dept.off), items = lossItems(ms, 'dw', t), trees = [];
    var ser = single ? (t === 'week' ? M.weekSeries('MACHINE', ms[0].m, ms[0].id) : M.daySeries('MACHINE', ms[0].m, ms[0].id)) : (t === 'week' ? M.weekSeries('DEPARTMENT', dept.name) : M.daySeries('DEPARTMENT', dept.name));
    var pv = t === 'month' ? null : prevOee(ser, M.k);
    var h = '<div class="iws-chips">' + depts.map(function (d) { return '<button type="button" class="iws-chip" data-dept="' + esc(d.name) + '" aria-pressed="' + (d.id === dept.id && !st.mid) + '">אגף ' + esc(d.name) + '</button>'; }).join('') + '</div>';
    if (dms.length > 1) h += '<div class="iws-chips">' + dms.map(function (m) { return '<button type="button" class="iws-chip" data-mid="' + m.id + '" aria-pressed="' + (st.mid === m.id) + '">' + esc(m.m) + '</button>'; }).join('') + '</div>';
    h += '<div class="iws-kpis">' + kpi('OEE ' + esc(scope), p1(G.oee), (G.target !== null ? 'יעד ' + p1(G.target) : '') + (pv !== null ? '<br>' + deltaTxt(G.oee, pv, t) : ''), G.target !== null ? (G.oee >= G.target ? 'good' : 'bad') : '') +
      kpi('יחידות טובות', n0(G.good), 'SAP') + kpi('זמינות', p1(G.av), '') + kpi('עצירות UPDT', G.a.updtN, fm(G.a.updt)) + kpi('חריגת PDT מהתקן', fm(G.a.pdtEx), 'נספרת כ-UPDT', G.a.pdtEx > 0.5 ? 'bad' : '') +
      kpi('עמידה ב-CL', '—', 'אין מקור', 'demo') + kpi('ביצוע CIL', '—', 'אין מקור', 'demo') + '</div><div class="iws-grid">';
    if (t === 'day') {
      h += panel('c12', 'ציר עצירות לפי שעה ומשמרת', 'מאירועי ה-RAW של יום הייצור (07:00–07:00).', timeline(ms, M.k));
      h += panel('c12', 'עץ ההפסדים — ' + esc(scope), '', '<div data-tree="0"></div>'); trees.push(buildTree(ms, 'זמן בסיס OEE — ' + scope));
      h += panel('c6', 'עצירות לפי השפעה', '', paretoTable(items, 8, t, !single));
      h += panel('c6', 'לטפל היום', 'אירועים ארוכים → IPS. חריגות PDT → בירור עם המשמרת.', candTable(items.filter(function (i) { return i.type === 'UPDT' && classify(i, t).k === 'IPS'; }).slice(0, 5), t, 'אין עצירה ארוכה חד-פעמית') + '<div class="iws-subh">חריגות PDT מהתקן</div>' + pdtTable(ms, true), { part: true, need: 'בעלים לכל IPS.' });
      h += panel('c7', 'שגרות קו: CL · CIL · BOS', '', clDemo(), { demo: true, need: 'טפסי CL / CIL / BOS דיגיטליים, מקושרים למכונה ולתחנה.' });
      h += panel('c5', 'תכנון מול ביצוע לפי מק״ט', 'דק׳ תקן = תפוקה ÷ קצב יעד.', skuTable(ms));
    }
    if (t === 'week') {
      h += panel('c12', 'עץ ההפסדים — ' + esc(scope) + ', השבוע', '', '<div data-tree="0"></div>'); trees.push(buildTree(ms, 'זמן בסיס OEE — ' + scope));
      h += panel('c6', 'Pareto השבוע מול השבוע הקודם', '', paretoTable(items, 10, t, !single, prevByDesc(M)));
      h += panel('c6', 'OEE לפי יום מול יעד', 'דוחות יומיים רשמיים.', seriesChart((single ? M.daySeries('MACHINE', ms[0].m, ms[0].id) : M.daySeries('DEPARTMENT', dept.name)).filter(function (x) { return x.key >= M.r.from && x.key <= M.r.to; }), G.target, function (key) { return CAL.short('day', key); }));
      h += panel('c6', 'UPDT לפי תחנה', 'דקות · מספר עצירות.', hbars(stationRows(ms)));
      h += panel('c6', 'מה חוזר ומי מטפל', 'חוזר וארוך → UPS. חוזר וקצר → CIL / CL.', candTable(items.filter(function (i) { var k = classify(i, t).k; return i.type === 'UPDT' && (k === 'UPS' || k === 'CIL'); }).slice(0, 8), t, 'אין הפסד חוזר'), { part: true, need: 'טבלת פעולות.' });
      h += panel('c6', 'שגרות השבוע', '', routinesDemo(), { demo: true, need: 'דיווחי שגרות.' });
      h += panel('c6', 'PDT מול תקן', '', pdtTable(ms, false));
    }
    if (t === 'month') {
      h += panel('c7', 'OEE לפי שבוע מול יעד', 'דוחות שבועיים רשמיים.', seriesChart(single ? M.weekSeries('MACHINE', ms[0].m, ms[0].id) : M.weekSeries('DEPARTMENT', dept.name), G.target, function (key) { return CAL.short('week', key); }));
      h += panel('c5', 'החודש מול החודש הקודם', '', familyCompare(ms, M));
      h += panel('c12', 'עץ ההפסדים — ' + esc(scope) + ', החודש', '', '<div data-tree="0"></div>'); trees.push(buildTree(ms, 'זמן בסיס OEE — ' + scope));
      h += panel('c7', 'קיימות פעולות הקו', '', sustainDemo(items, t), { part: true, need: 'טבלת פעולות + היסטוריה.' });
      h += panel('c5', 'פעילויות PDT שחורגות מהתקן', 'מועמדות לעדכון תקן או ל-SMED.', pdtTable(ms, true));
      h += panel('c12', 'ביצועים לפי מק״ט', '', skuTable(ms));
    }
    return { html: h + '</div>', trees: trees };
  }
  function stationRows(ms) {
    var s = {}, multi = ms.length > 1;
    ms.forEach(function (m) { m.items.forEach(function (i) { var k = (multi ? m.m + ' · ' : '') + (i.st || 'ללא תחנה'); s[k] = s[k] || { min: 0, n: 0 }; s[k].min += i.min; s[k].n += i.n; }); });
    return Object.keys(s).map(function (k) { return { l: k, v: s[k].min, c: C.updt, txt: fm(s[k].min) + ' · ' + s[k].n }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 10);
  }

  function techView(M, st) {
    var t = M.t, m = M.machines.filter(function (x) { return x.id === st.mid; })[0] || M.machines.filter(function (x) { return x.a.base > 0; })[0] || M.machines[0];
    var items = lossItems([m], null, t).filter(function (i) { return i.type === 'UPDT'; });
    var top = items.slice().sort(function (a, b) { return b.min - a.min; })[0];
    var rec = items.filter(function (i) { var k = classify(i, t).k; return k === 'UPS' || k === 'CIL'; });
    var h = '<div class="iws-chips">' + M.machines.map(function (x) { return '<button type="button" class="iws-chip" data-mid="' + x.id + '" aria-pressed="' + (x.id === m.id) + '">' + esc(x.m) + '</button>'; }).join('') + '</div>';
    h += '<div class="iws-kpis">' + kpi('MTBF ' + esc(m.m), m.mtbf ? fm(m.mtbf) : '—', 'זמן ייצור ÷ תקלות') + kpi('MTTR ' + esc(m.m), m.mttr ? fm(m.mttr) : '—', 'דקות תקלה ÷ תקלות') + kpi('תקלות', m.a.fails, fm(m.a.failMin)) +
      kpi('כשלי תהליך', m.a.pfailN, fm(m.a.pfail), m.a.pfailN ? 'bad' : '') + kpi('מצבי כשל חוזרים', rec.length, t === 'day' ? CFG.repeatN + ' מופעים ומעלה' : CFG.repeatDays[t] + ' ימים ומעלה') +
      kpi('PM באיחור', '—', 'אין יומן PM', 'demo') + kpi('RCA פתוחות', '—', 'אין טבלת RCA', 'demo') + '</div><div class="iws-grid">';
    var ps = top ? '<div class="iws-ps"><b>Problem statement (מהנתונים):</b> ' + esc(top.d) + (top.st ? ' ב' + esc(top.st) : '') + ' של ' + esc(m.m) + ' — ' + top.n + ' מופעים' + (t !== 'day' ? ' ב-' + top.days + ' ימים' : '') + ', ' + fm(top.min) + ' ' + THISW[t] + ' (' + p1(top.min / (m.a.base || 1)) + ' מזמן הבסיס).</div>' : '<div class="iws-empty">אין עצירות לא מתוכננות</div>';
    if (t === 'day') {
      var longs = items.filter(function (i) { return i.max >= 15; }).sort(function (a, b) { return b.min - a.min; });
      h += panel('c7', 'תקלות שדורשות סגירה', 'עצירה של 15 דק׳ ומעלה → דו״ח BDE / IPS קצר עם הזמנת עבודה.', '<div class="iws-scroll"><table class="iws-t"><thead><tr><th>עצירה</th><th>תחנה</th><th>מופעים</th><th>הארוכה</th><th>סה״כ</th><th>כלי</th><th>הזמנת עבודה</th></tr></thead><tbody>' +
        (longs.length ? longs.map(function (i) { var c = classify(i, t); return '<tr><td>' + esc(i.d) + (i.fail ? ' ' + pill('ups', 'תקלה') : '') + '</td><td>' + esc(i.st || '—') + '</td><td>' + i.n + '</td><td>' + fm(i.max) + '</td><td>' + fm(i.min) + '</td><td>' + pill(c.cls, c.k, c.t) + '</td><td>' + pill('demo', 'אין מקור') + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="iws-mut">אין עצירה ארוכה</td></tr>') + '</tbody></table></div>', { part: true, need: 'קישור עצירה ↔ הזמנת עבודה.' });
      h += panel('c5', 'IPS על העצירה הגדולה', '', ps + flow(RCA_STEPS, 0), { part: true, need: 'טבלת IPS / RCA עם שלבים ובעלים.' });
      h += panel('c12', 'Failure Mode Matrix — ' + esc(m.m), 'תחנה → מצב כשל.', matrix(items, t));
    }
    if (t === 'week') {
      h += panel('c7', 'מפת מצבי כשל — תדירות × משך', 'גודל העיגול = סך הדקות. המיקום קובע את כלי ה-IWS.', scatter(items, t));
      h += panel('c5', 'Failure Mode Matrix — ' + esc(m.m), '', matrix(items, t));
      h += panel('c7', 'RCA / UPS על מצב הכשל המוביל', '', ps + flow(RCA_STEPS, 0), { part: true, need: 'טבלת RCA / UPS.' });
      h += panel('c5', 'MTBF לפי יום', 'זמן ייצור ÷ תקלות, מאירועי ה-RAW.', mtbfSeries([m], M));
      h += panel('c6', 'ממצאי CIL מול תקלות', 'ממצא CIL שלא טופל → תקלה באותה תחנה.', '<div class="iws-empty">אין ממצאי CIL במערכת</div>', { demo: true, need: 'ממצאי CIL עם תחנה.' });
      h += panel('c6', 'PM השבוע — ביצוע וממצאים', '', '<div class="iws-empty">אין יומן PM במערכת</div>', { demo: true, need: 'יומן PM: משימה, תדירות, ביצוע, ממצא.' });
    }
    if (t === 'month') {
      h += panel('c7', 'MTBF לפי שבוע', 'זמן ייצור ÷ תקלות, מאירועי ה-RAW של החודש.', mtbfSeries([m], M));
      h += panel('c5', 'מצבי כשל כרוניים — לתיק BDE ולעדכון PM', 'הופיעו ב-' + CFG.repeatDays.month + ' ימים או יותר בחודש.', candTable(rec.slice(0, 8).map(function (i) { return i; }), t, 'אין מצב כשל כרוני'), { part: true });
      h += panel('c12', 'מפת מצבי כשל — תדירות × משך, החודש', '', scatter(items, t));
      h += panel('c6', 'אימות RCA — 30 / 60 / 90', '', ps + flow(RCA_STEPS, 0), { part: true, need: 'טבלת RCA עם תאריכי הטמעה ואימות.' });
      h += panel('c6', 'יעילות PM ו-Change Management', '', '<div class="iws-empty">אין יומן PM וטבלת CM במערכת</div>', { demo: true, need: 'יומן PM מקושר לתחנה + טבלת CM.' });
    }
    return { html: h + '</div>', trees: [], mid: m.id };
  }

  /* ---------- view-mode switch + host integration ---------- */
  var VIEW_OF = { pm: 'site', ll: 'line', pl: 'tech', ml: 'tech' };
  var VIEW_NAME = { site: 'IWS מפעל', line: 'IWS קו / אגף', tech: 'IWS מקצועי' };
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

  function ensure(host, role, opts) {
    if (!host || !VIEW_OF[role]) return null;
    injectCss();
    var ctl = host.__iws;
    if (ctl && ctl.role === role && host.contains(ctl.bar) && host.contains(ctl.root)) return ctl;
    ctl = host.__iws = { host: host, role: role, view: VIEW_OF[role], opts: opts || {},
      st: lsGet('oee_iws_state_' + role, { t: 'day', k: null, dept: null, mid: null }), mode: lsGet('oee_iws_mode_' + role, 'cur') };
    var bar = document.createElement('div');
    bar.className = 'iws-switch'; bar.setAttribute('dir', 'rtl');
    bar.innerHTML = '<span class="lbl">אופן תצוגה</span><div class="iws-seg" role="group" aria-label="אופן תצוגה"><button type="button" data-mode="cur">המסך הנוכחי</button><button type="button" data-mode="iws">עץ הפסדים IWS</button></div>';
    var root = document.createElement('div');
    root.className = 'iws-root'; root.setAttribute('dir', 'rtl');
    host.insertBefore(bar, host.firstChild); host.appendChild(root);
    ctl.bar = bar; ctl.root = root;
    bar.addEventListener('click', function (e) { var b = e.target.closest('[data-mode]'); if (b) setMode(ctl, b.getAttribute('data-mode')); });
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-period],[data-step],[data-dept],[data-mid],[data-pick-open]'); if (!b || b.disabled) return;
      if (b.hasAttribute('data-pick-open')) {
        if (window.OEE_PICKER && INDEX) window.OEE_PICKER.open({ type: ctl.st.t, value: ctl.st.k, keys: INDEX[ctl.st.t], onPick: function (k) { ctl.st.k = k; lsSet('oee_iws_state_' + ctl.role, ctl.st); render(ctl); } });
        return;
      }
      if (b.hasAttribute('data-period')) { ctl.st.t = b.getAttribute('data-period'); ctl.st.k = ctl.opts.getKey ? ctl.opts.getKey(ctl.st.t) : null; }
      if (b.hasAttribute('data-step')) { var list = INDEX[ctl.st.t], i = list.indexOf(ctl.st.k) + Number(b.getAttribute('data-step')); if (i < 0 || i >= list.length) return; ctl.st.k = list[i]; }
      if (b.hasAttribute('data-dept')) { ctl.st.dept = b.getAttribute('data-dept'); ctl.st.mid = null; }
      if (b.hasAttribute('data-mid')) { var id = Number(b.getAttribute('data-mid')); ctl.st.mid = ctl.view === 'line' && ctl.st.mid === id ? null : id; }
      lsSet('oee_iws_state_' + ctl.role, ctl.st); render(ctl);
    });
    setMode(ctl, ctl.mode);
    return ctl;
  }
  function setMode(ctl, mode) {
    ctl.mode = mode; lsSet('oee_iws_mode_' + ctl.role, mode);
    ctl.bar.querySelectorAll('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode)); });
    ctl.host.classList.toggle('iws-on', mode === 'iws');
    if (mode === 'iws') {
      if (ctl.opts.getPeriod) { var p = ctl.opts.getPeriod(); if (p && p.type) { ctl.st.t = p.type; ctl.st.k = p.key || null; } }
      render(ctl);
    }
  }
  function render(ctl) {
    var root = ctl.root, st = ctl.st;
    root.innerHTML = '<div class="iws-loading">טוען את תצוגת ה-IWS…</div>';
    init().then(function (idx) {
      var list = idx[st.t] || [];
      if (!list.length) { root.innerHTML = '<div class="iws-loading">עדיין לא הועלו דוחות</div>'; return null; }
      if (!st.k || list.indexOf(st.k) < 0) st.k = list[list.length - 1];
      return load(st.t, st.k);
    }).then(function (M) {
      if (!M) return;
      var v = ctl.view === 'site' ? siteView(M) : ctl.view === 'line' ? lineView(M, st) : techView(M, st);
      if (v.mid) st.mid = v.mid;
      var list = INDEX[st.t], pos = list.indexOf(st.k);
      root.innerHTML = '<div class="iws-head"><div class="iws-title">' + VIEW_NAME[ctl.view] + ' <span class="iws-pill iws-p-std">' + PNAME[st.t] + '</span></div>' +
        '<div class="iws-q">השאלה של המסך: <b>' + QUESTION[ctl.view][st.t] + '</b></div>' +
        '<div class="iws-ctrl"><div class="iws-seg iws-seg-light">' + ['day', 'week', 'month'].map(function (x) { return '<button type="button" data-period="' + x + '" aria-pressed="' + (x === st.t) + '">' + PNAME[x] + '</button>'; }).join('') + '</div>' +
        (window.OEE_PICKER ? window.OEE_PICKER.barHtml(CAL.label(st.t, st.k), pos > 0, pos < list.length - 1, { prev: 'data-step="-1"', next: 'data-step="1"', open: 'data-pick-open' })
          : '<div class="iws-nav"><button type="button" data-step="-1" ' + (pos > 0 ? '' : 'disabled') + ' aria-label="תקופה קודמת">›</button><span>' + CAL.label(st.t, st.k) + '</span><button type="button" data-step="1" ' + (pos < list.length - 1 ? '' : 'disabled') + ' aria-label="תקופה הבאה">‹</button></div>') +
        '<div class="iws-srcrow"><span class="iws-pill ' + (M.official ? 'iws-p-ok' : 'iws-p-ips') + '">' + (M.official ? 'רשמי · דוח ' + PNAME[st.t] + ' מה-MES' : (st.t === 'day' ? 'אין דוח רשמי ליום' : 'מחושב מהדוחות היומיים')) + '</span>' +
        '<span class="iws-legend-src"><i class="sw-demo"></i>מקווקו = אין עדיין מקור נתונים</span></div></div></div>' + v.html;
      root.querySelectorAll('[data-tree]').forEach(function (el) { icicle(el, v.trees[+el.getAttribute('data-tree')]); });
    }).catch(function (e) {
      root.innerHTML = '<div class="iws-loading">שגיאה בטעינת תצוגת ה-IWS: ' + esc(e && e.message ? e.message : e) + '</div>';
    });
  }
  function refreshAll() { invalidate(); document.querySelectorAll('.iws-on').forEach(function (h) { if (h.__iws) render(h.__iws); }); }

  /* ---------- styles (all scoped to .iws-*) ---------- */
  function injectCss() {
    if (document.getElementById('iws-css')) return;
    var s = document.createElement('style'); s.id = 'iws-css';
    s.textContent = [
      '.iws-on > :not(.iws-switch):not(.iws-root){display:none !important}',
      '.iws-root{display:none;min-width:0;max-width:100%;overflow-x:hidden}.iws-on > .iws-root{display:block}',
      '.iws-on{min-width:0}',
      '.iws-switch{box-sizing:border-box;max-width:100%;min-width:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;margin:0 0 10px;border:1px solid #BFD6EE;background:#EEF5FC;border-radius:12px;font-size:13px;color:#23476B}',
      '.iws-switch .lbl{font-weight:600}',
      '.iws-seg{display:inline-flex;background:#fff;border:1px solid #D8E0E8;border-radius:9px;padding:3px;gap:2px}',
      '.iws-seg button{border:0;background:transparent;color:#4A5A6B;padding:6px 13px;border-radius:7px;font:inherit;font-size:13px;cursor:pointer}',
      '.iws-seg button[aria-pressed="true"]{background:#1c2b45;color:#fff;font-weight:600}',
      '.iws-switch .iws-seg button[data-mode="iws"][aria-pressed="true"]{background:#2a78d6}',
      '.iws-root{color:#16202A;font-size:14px;line-height:1.45}',
      '.iws-root *{box-sizing:border-box}',
      '.iws-head{margin-bottom:12px}.iws-title{font-size:17px;font-weight:700;margin-bottom:2px}.iws-q{color:#4A5A6B;margin-bottom:8px}.iws-q b{color:#16202A}',
      '.iws-ctrl{display:flex;flex-direction:column;align-items:stretch;gap:8px}.iws-ctrl>.iws-seg{align-self:flex-start}',
      '.iws-srcrow{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}',
      '.iws-nav{display:inline-flex;align-items:center;gap:6px;font-weight:600}.iws-nav button{border:1px solid #D8E0E8;background:#fff;border-radius:8px;width:30px;height:30px;font-size:16px;cursor:pointer}.iws-nav button:disabled{opacity:.35;cursor:default}',
      '.iws-legend-src{font-size:12px;color:#6D5BA8}.sw-demo{display:inline-block;width:14px;height:10px;border-radius:2px;vertical-align:middle;margin-inline-end:5px;background:repeating-linear-gradient(135deg,#B7ABE0 0 3px,#6D5BA8 3px 6px)}',
      '.iws-loading{padding:40px;text-align:center;color:#8393A3}',
      '.iws-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}.iws-chip{border:1px solid #D8E0E8;background:#fff;border-radius:20px;padding:5px 14px;color:#4A5A6B;font:inherit;font-size:13px;cursor:pointer}.iws-chip[aria-pressed="true"]{background:#1c2b45;color:#fff;border-color:#1c2b45}',
      '.iws-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:10px;margin-bottom:14px}',
      '.iws-kpi{background:#fff;border:1px solid #D8E0E8;border-radius:10px;padding:10px 12px}.iws-kpi .l{font-size:12px;color:#4A5A6B}.iws-kpi .v{font-size:23px;font-weight:700;font-variant-numeric:tabular-nums}.iws-kpi .n{font-size:11.5px;color:#8393A3}',
      '.iws-kpi.good .v{color:#4E9A6B}.iws-kpi.bad .v{color:#DC2626}.iws-kpi.demo{border:1px dashed #A99BD6;background:repeating-linear-gradient(135deg,#fff 0 8px,#F6F3FD 8px 16px)}.iws-kpi.demo .v{color:#6D5BA8}',
      '.iws-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}.iws-grid .c12{grid-column:span 12}.iws-grid .c7{grid-column:span 7}.iws-grid .c6{grid-column:span 6}.iws-grid .c5{grid-column:span 5}',
      '@media (max-width:900px){.iws-grid .c7,.iws-grid .c6,.iws-grid .c5{grid-column:span 12}}',
      '.iws-panel{background:#fff;border:1px solid #D8E0E8;border-radius:14px;padding:14px 16px 16px;min-width:0;overflow-x:auto}',
      '.iws-panel h3{font-size:15px;font-weight:700;margin:0 0 2px}.iws-hint{font-size:12px;color:#8393A3;margin:0 0 10px}',
      '.iws-panel.iws-demo{border:1px dashed #A99BD6;background:#FBFAFE}',
      '.iws-tag-demo{font-size:11px;font-weight:500;color:#fff;background:#6D5BA8;border-radius:20px;padding:1px 9px;margin-inline-start:8px;vertical-align:2px}',
      '.iws-tag-part{font-size:11px;font-weight:500;color:#6D5BA8;border:1px solid #6D5BA8;border-radius:20px;padding:0 8px;margin-inline-start:8px;vertical-align:2px}',
      '.iws-need{font-size:12px;color:#6D5BA8;margin-top:10px;border-top:1px dashed #CFC6EC;padding-top:8px}',
      '.iws-empty{padding:18px;text-align:center;color:#8393A3;font-size:13px}.iws-mut{color:#8393A3}.iws-sub{color:#8393A3;font-size:11.5px}.iws-subh{font-weight:600;font-size:13px;margin:12px 0 4px}',
      '.iws-note{font-size:12.5px;color:#4A5A6B;background:#EEF3F8;border-radius:8px;padding:8px 11px;margin-top:10px}',
      '.iws-ps{font-size:12.5px;background:#FEE2E2;color:#991B1B;border-radius:8px;padding:8px 11px;margin-bottom:10px}',
      '.iws-hb{display:grid;grid-template-columns:minmax(90px,1.1fr) 3fr auto;gap:4px 10px;align-items:center;font-size:12.5px}.iws-hb .lab{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.iws-hb .trk{height:16px;background:#EEF2F6;border-radius:3px;position:relative}.iws-hb .fill{height:100%;border-radius:3px}.iws-hb .tgt{position:absolute;top:-3px;bottom:-3px;width:2px;background:#1c2b45}.iws-hb .val{color:#4A5A6B;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.iws-t{width:100%;border-collapse:collapse;font-size:12.5px}.iws-t th{font-weight:500;color:#8393A3;text-align:right;padding:5px 6px;border-bottom:1px solid #D8E0E8;white-space:nowrap}.iws-t td{padding:6px;border-bottom:1px solid #EEF2F6;vertical-align:top;font-variant-numeric:tabular-nums}',
      '.iws-t .iws-grp td{background:#F3F6F9}.iws-t td.ind{padding-inline-start:18px}.iws-heat td.h{text-align:center;font-weight:600;min-width:62px}.iws-heat th{text-align:center}',
      '.iws-scroll{overflow-x:auto}.iws-bar{display:flex;align-items:center;gap:6px}.iws-bar div{height:12px;border-radius:3px}',
      '.iws-pill{display:inline-block;font-size:11px;border-radius:20px;padding:1px 8px;white-space:nowrap}.iws-p-ups{background:#FEE2E2;color:#991B1B}.iws-p-ips{background:#FEF3C7;color:#92400E}.iws-p-std{background:#E6EEF6;color:#2F4A66}.iws-p-ok{background:#DCFCE7;color:#166534}.iws-p-demo{background:#ECE7FA;color:#4F3F8F}',
      '.iws-tree-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px;font-size:13px}.iws-crumb{background:none;border:1px solid #D8E0E8;border-radius:20px;padding:3px 11px;color:#4A5A6B;font:inherit;font-size:12.5px;cursor:pointer}.iws-crumb:last-of-type{background:#1c2b45;color:#fff;border-color:#1c2b45}.iws-sep{color:#8393A3}.iws-tree-help{margin-inline-start:auto;color:#8393A3;font-size:12px}',
      '.iws-icicle{position:relative;height:430px;display:grid;grid-template-columns:1.05fr 1.15fr 1.2fr 1.4fr;gap:3px}.iws-col{position:relative}',
      '.iws-node{position:absolute;left:0;right:0;border-radius:4px;overflow:hidden;color:#fff;padding:5px 8px;font-size:12px;line-height:1.25;border:1px solid rgba(255,255,255,.55);text-align:right}',
      '.iws-node.clk{cursor:zoom-in}.iws-node.clk:hover{filter:brightness(1.08)}.iws-node b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.iws-node i{font-style:normal;opacity:.92;white-space:nowrap}.iws-node.tiny{padding:0 6px}.iws-node.tiny i{display:none}',
      '.iws-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:#4A5A6B;margin-top:10px}.iws-legend i{display:inline-block;width:14px;height:10px;border-radius:2px;vertical-align:middle;margin-inline-end:5px}',
      '.iws-svg{width:100%;height:auto;display:block}.iws-svg text{font-family:inherit}',
      '.iws-cells{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}.iws-cells .c{border:1px solid #D8E0E8;border-radius:10px;padding:8px 10px}.iws-cells .k{font-weight:700}.iws-cells .v{font-size:20px;font-weight:700}.iws-cells .s{font-size:11.5px;color:#4A5A6B}',
      '.iws-cells .src-part{border-inline-start:4px solid #B8932C}.iws-cells .src-none{border:1px dashed #A99BD6;background:repeating-linear-gradient(135deg,#fff 0 8px,#F6F3FD 8px 16px)}.iws-cells .src-none .v{color:#6D5BA8}',
      '.iws-flow{display:flex;flex-wrap:wrap;gap:4px}.iws-flow .st{flex:1 1 105px;border:1px solid #D8E0E8;border-radius:8px;padding:7px 9px;font-size:12px;background:#fff}.iws-flow .st b{display:block;font-size:12.5px}.iws-flow .st.now{border-color:#2a78d6;box-shadow:0 0 0 2px #D4E4F6}.iws-flow .st.done{border-color:#9CCBB0;background:#F1FAF4}',
      '.iws-grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}',
      '.iws-root button:focus-visible,.iws-switch button:focus-visible,.iws-node:focus-visible{outline:2px solid #2a78d6;outline-offset:2px}'
    ].join('\n');
    document.head.appendChild(s);
  }

  window.OEE_IWS = { attach: ensure, ensure: ensure, invalidate: invalidate, refresh: refreshAll, config: CFG, _load: load, _init: init };
})();
