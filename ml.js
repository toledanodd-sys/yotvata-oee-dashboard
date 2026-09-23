/* Maintenance Lead screens (approved mockups: "ML יומי — אמינות הציוד", "ML שבועי — מגמת אמינות",
 * "ML חודשי — תיק BDE"). Everything is computed from the uploaded MES data: the RAW events of the
 * production days and the classification rules (a rule with counts_as_failure = a breakdown).
 * MTBF = production minutes / number of breakdowns, MTTR = repair minutes / number of breakdowns. */
(function () {
  'use strict';
  var API = window.OEE_API, ENG = window.OEE_ENGINE, D = window.OEE_DASH;
  var PROD = ['ייצור', 'ייצור ללא פק"ע'];
  var RED = '#DC2626', BLUE = '#2a78d6', PREV = '#D8D5C8', GRAY = '#8A8776';
  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  var PREV_WORD = { day: 'מאתמול', week: 'מהשבוע הקודם', month: 'מהחודש הקודם' };
  var NO_PREV = 'אין תקופה קודמת להשוואה';
  var PERIOD_WORD = { day: 'ביום הזה', week: 'בשבוע הזה', month: 'בחודש הזה' };
  var BUCKETS = [
    { name: 'עד 5 דק\'', lo: 0, hi: 5 },
    { name: '5–15 דק\'', lo: 5, hi: 15 },
    { name: '15–30 דק\'', lo: 15, hi: 30 },
    { name: '30–60 דק\'', lo: 30, hi: 60 },
    { name: '60 דק\' ומעלה', lo: 60, hi: Infinity }
  ];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(min) { if (min === null || min === undefined) return '—'; var r = Math.round(min); return Math.floor(r / 60) + ':' + pad(r % 60); }
  function fmtMin(min) { var r = Math.round(min); return r >= 60 ? hm(r) + ' ש\'' : r + ' דק\''; }
  function fmtDM(d) { return d.slice(8) + '/' + d.slice(5, 7); }
  function pct1(v) { return (v * 100).toFixed(1) + '%'; }
  function pct0(v) { return Math.round(v * 100) + '%'; }
  function evN(n) { return n === 1 ? 'מופע אחד' : n + ' מופעים'; }
  function dayN(n) { return n === 1 ? 'יום אחד' : n + ' ימים'; }

  function isPM(desc) {
    var s = ENG.norm(desc) || '';
    return s.indexOf('אחזקה מתוכננת') >= 0 || s.indexOf('אחזקה מונעת') >= 0 || s.indexOf('מונעת') >= 0;
  }
  function bucketOf(rule, status) {
    if (PROD.indexOf(status) >= 0) return 'prod';
    if (!rule || rule.counts_in_oee === null || rule.counts_in_oee === undefined) return 'unknown';
    if (rule.loss_type === 'PRODUCTION') return 'prod';
    if (!rule.counts_in_oee) return 'none';
    if (rule.loss_type === 'UPDT' || rule.loss_type === 'PROCESS_FAILURE') return 'updt';
    if (rule.loss_type === 'PDT') return 'pdt';
    return 'none';
  }
  function ruleOf(machineId, day, status, group, desc) {
    return ENG.classify({ status: ENG.norm(status), stop_group: ENG.norm(group), description: ENG.norm(desc), production_date: day },
      D.static().rules, machineId, day);
  }
  function bucketIndex(d) { for (var i = 0; i < BUCKETS.length; i++) if (d < BUCKETS[i].hi) return i; return BUCKETS.length - 1; }

  /* ---------- scanning ---------- */
  function emptyDay() { return { prod: 0, pm: 0, fm: 0, fn: 0, base: 0 }; }

  // full scan of the raw events of a period
  function scan(events, machineId) {
    var s = { prod: 0, base: 0, pm: 0, pmDays: {}, fm: 0, fn: 0, perDay: {}, stations: {}, reasons: {},
      buckets: BUCKETS.map(function () { return { n: 0, min: 0 }; }), longest: null, log: [], days: {} };
    events.forEach(function (e) {
      var d = Number(e.duration_min) || 0, day = e.production_date;
      s.days[day] = true;
      var pd = s.perDay[day] = s.perDay[day] || emptyDay();
      var r = ruleOf(machineId, day, e.status, e.stop_group, e.description);
      var b = bucketOf(r, ENG.norm(e.status));
      if (b === 'prod') { s.prod += d; pd.prod += d; }
      if (b === 'prod' || b === 'updt' || b === 'pdt') { s.base += d; pd.base += d; }
      if (isPM(e.description)) { s.pm += d; s.pmDays[day] = true; pd.pm += d; }
      if (!r || !r.counts_as_failure) return;
      var station = ENG.norm(e.station) || '(ללא תחנה)';
      var desc = ENG.norm(e.description) || ENG.norm(e.stop_group) || ENG.norm(e.status) || '—';
      s.fm += d; s.fn++; pd.fm += d; pd.fn++;
      var st = s.stations[station] = s.stations[station] || { name: station, min: 0, n: 0, days: {}, longest: 0 };
      st.min += d; st.n++; st.days[day] = true; st.longest = Math.max(st.longest, d);
      var rk = s.reasons[desc] = s.reasons[desc] || { desc: desc, station: station, min: 0, n: 0, days: {}, longest: 0 };
      rk.min += d; rk.n++; rk.days[day] = true; rk.longest = Math.max(rk.longest, d);
      var bi = bucketIndex(d);
      s.buckets[bi].n++; s.buckets[bi].min += d;
      var t = new Date(e.start_at);
      if (!s.longest || d > s.longest.dur) s.longest = { dur: d, desc: desc, station: station, day: day, t: pad(t.getHours()) + ':' + pad(t.getMinutes()) };
      if (d >= 5) s.log.push({ at: t, day: day, t: pad(t.getHours()) + ':' + pad(t.getMinutes()), durMin: d, station: station, desc: desc });
    });
    return s;
  }

  // lighter scan of aggregated combos (previous periods) — no station / no per-event duration
  function scanCombos(rows, machineId, day) {
    var a = { prod: 0, base: 0, pm: 0, fm: 0, fn: 0, reasons: {} };
    (rows || []).forEach(function (c) {
      var min = Number(c.minutes) || 0, n = Number(c.n) || 0;
      var r = ruleOf(machineId, day, c.status, c.stop_group, c.description);
      var b = bucketOf(r, ENG.norm(c.status));
      if (b === 'prod') a.prod += min;
      if (b === 'prod' || b === 'updt' || b === 'pdt') a.base += min;
      if (isPM(c.description)) a.pm += min;
      if (r && r.counts_as_failure) {
        a.fm += min; a.fn += n;
        var k = ENG.norm(c.description) || ENG.norm(c.stop_group) || ENG.norm(c.status) || '—';
        var e = a.reasons[k] = a.reasons[k] || { desc: k, min: 0, n: 0 };
        e.min += min; e.n += n;
      }
    });
    return a;
  }
  function emptyAgg() { return { prod: 0, base: 0, pm: 0, fm: 0, fn: 0, reasons: {} }; }
  function hasData(a) { return !!(a && (a.base || a.fm || a.pm)); }

  /* ---------- loading ---------- */
  var CACHE = {};
  var RAW_COLS = 'status,stop_group,station,description,production_date,start_at,duration_min';
  function rawOf(machineId, type, key) {
    var r = D.cal.range(type, key), rawId = D.officialRawOf(type, key);
    var q = rawId ? '&upload_id=eq.' + rawId : '&period_type=eq.DAY&production_date=gte.' + r.from + '&production_date=lte.' + r.to;
    return D.selectAll('raw_events?select=' + RAW_COLS + q + '&machine_id=eq.' + machineId + '&order=start_at');
  }
  function combos(machineId, type, key) {
    var r = D.cal.range(type, key), rawId = D.officialRawOf(type, key);
    var args = rawId ? { p_layer: { week: 'WEEK', month: 'MONTH' }[type], p_from: r.from, p_to: r.to, p_upload: rawId } : { p_layer: 'DAY', p_from: r.from, p_to: r.to };
    return API.rpc('period_combos', args).then(function (rows) {
      return (rows || []).filter(function (r) { return r.machine_id === machineId; });
    });
  }
  function dailyCombos(machineId, from, to) {
    return API.rpc('period_combos', { p_layer: 'DAY', p_from: from, p_to: to }).then(function (rows) {
      return (rows || []).filter(function (r) { return r.machine_id === machineId; });
    });
  }
  function weeksOfMonth(machineId, r) {
    var keys = [], k = D.cal.keyOf('week', r.from);
    while (k <= r.to) { keys.push(k); k = D.cal.step('week', k, 1); }
    return Promise.all(keys.map(function (wk) {
      var wr = D.cal.range('week', wk);
      var from = wr.from < r.from ? r.from : wr.from, to = wr.to > r.to ? r.to : wr.to;   // clipped to the month
      return dailyCombos(machineId, from, to).then(function (c) { return { key: wk, from: from, to: to, agg: scanCombos(c, machineId, to) }; });
    }));
  }

  function load(machineId, type, key) {
    var ck = machineId + '|' + type + '|' + key;
    if (CACHE[ck]) return Promise.resolve(CACHE[ck]);
    var r = D.cal.range(type, key);
    // the previous periods are the ones that actually have data (a day with no report is skipped)
    var n = type === 'day' ? 6 : 3;
    var list = (D.index() && D.index()[type]) || [];
    var at = list.indexOf(key);
    var prevKeys = [];
    for (var i = 1; i <= n; i++) { var j = at - i; if (j >= 0) prevKeys.push(list[j]); }
    var jobs = [
      rawOf(machineId, type, key),
      Promise.all(prevKeys.map(function (k) {
        var pr = D.cal.range(type, k);
        return combos(machineId, type, k).then(function (c) { return { key: k, from: pr.from, to: pr.to, agg: scanCombos(c, machineId, pr.to) }; });
      })),
      type === 'month' ? weeksOfMonth(machineId, r) : Promise.resolve([]),
      // the weekly screen compares the repair-time distribution and the stations with the previous week,
      // and that needs the events themselves — combos hold neither station nor per-event duration
      (type === 'week' && prevKeys.length) ? rawOf(machineId, 'week', prevKeys[0]) : Promise.resolve(null)
    ];
    return Promise.all(jobs).then(function (x) {
      var m = buildModel(machineId, type, key, x[0], x[1], x[2], x[3]);
      CACHE[ck] = m;
      return m;
    });
  }

  /* ---------- shared pieces ---------- */
  function deltaMin(cur, prev, w, lowerIsBetter) {
    if (cur === null || prev === null || prev === undefined || cur === undefined) return { t: NO_PREV, s: 'color: ' + GRAY + ';' };
    var d = cur - prev;
    if (Math.abs(d) < 0.05) return { t: 'ללא שינוי ' + w, s: 'color: ' + GRAY + ';' };
    var good = lowerIsBetter ? d < 0 : d > 0;
    return { t: (d > 0 ? '▲ ' : '▼ ') + (Math.abs(d) >= 60 ? hm(Math.abs(d)) + ' ש\'' : Math.abs(d).toFixed(1) + ' דק\'') + ' ' + w,
      s: 'color: ' + (good ? '#16A34A' : RED) + ';' };
  }
  function deltaCount(cur, prev, w, lowerIsBetter) {
    if (cur === null || prev === null || prev === undefined) return { t: NO_PREV, s: 'color: ' + GRAY + ';' };
    var d = cur - prev;
    if (!d) return { t: 'ללא שינוי ' + w, s: 'color: ' + GRAY + ';' };
    var good = lowerIsBetter ? d < 0 : d > 0;
    return { t: (d > 0 ? '▲ ' : '▼ ') + Math.abs(d) + ' ' + w, s: 'color: ' + (good ? '#16A34A' : RED) + ';' };
  }
  function deltaPts(cur, prev, w, lowerIsBetter) {
    if (cur === null || prev === null || prev === undefined) return { t: NO_PREV, s: 'color: ' + GRAY + ';' };
    var d = (cur - prev) * 100;
    if (Math.abs(d) < 0.05) return { t: 'ללא שינוי ' + w, s: 'color: ' + GRAY + ';' };
    var good = lowerIsBetter ? d < 0 : d > 0;
    return { t: (d > 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + ' נק\' ' + w, s: 'color: ' + (good ? '#16A34A' : RED) + ';' };
  }
  function plain(t) { return { t: t, s: 'color: ' + GRAY + ';' }; }

  function stationRows(sc, totalDays) {
    var list = Object.keys(sc.stations).map(function (k) { return sc.stations[k]; }).sort(function (a, b) { return b.min - a.min; });
    var max = list.length ? list[0].min : 1;
    return { list: list, max: max, rows: list.map(function (s) {
      var nd = Object.keys(s.days).length;
      return { name: s.name, tot: fmtMin(s.min), n: s.n, mttr: (s.min / s.n).toFixed(1) + ' דק\'',
        longest: 'הארוכה ' + fmtMin(s.longest), days: 'נפלה ב-' + dayN(nd) + (totalDays ? ' מתוך ' + totalDays : ''),
        fillStyle: 'width: ' + (s.min / max * 100).toFixed(1) + '%; background: ' + RED + ';' };
    }) };
  }
  function bucketRows(sc, prevSc) {
    var maxN = 1;
    sc.buckets.forEach(function (b) { maxN = Math.max(maxN, b.n); });
    if (prevSc) prevSc.buckets.forEach(function (b) { maxN = Math.max(maxN, b.n); });
    return BUCKETS.map(function (def, i) {
      var b = sc.buckets[i], p = prevSc ? prevSc.buckets[i] : null;
      return { name: def.name, n: b.n, tot: fmtMin(b.min), pct: sc.fm ? Math.round(b.min / sc.fm * 100) + '% מהזמן' : '—',
        barStyle: 'height: ' + (b.n / maxN * 130).toFixed(0) + 'px;',
        curStyle: 'height: ' + (b.n / maxN * 130).toFixed(0) + 'px; background: ' + RED + ';',
        prevStyle: 'height: ' + ((p ? p.n : 0) / maxN * 130).toFixed(0) + 'px; background: ' + PREV + ';' };
    });
  }
  var TAG = {
    ups: ['חוזרת — UPS ועדכון PM', 'background: #FEE2E2; color: #991B1B;'],
    rising: ['עולה — מועמדת ל-BDE', 'background: #FEE2E2; color: #991B1B;'],
    ips: ['חד-פעמית ארוכה — IPS', 'background: #FEF3C7; color: #92400E;'],
    better: ['יורדת — הפעולה עבדה', 'background: #DCFCE7; color: #166534;'],
    chronic: ['כרונית יציבה — לתכנון PM', 'background: #E0E7FF; color: #3730A3;'],
    watch: ['לעקוב — עוד לא דפוס', 'background: #E5E7EB; color: #374151;']
  };
  function heat(v, big) {
    if (!v) return 'background: #F4F2EC; color: #C9C6B8;';
    if (v >= big) return 'background: #DC2626; color: #FFFFFF;';
    if (v >= big * 0.6) return 'background: #F87171; color: #FFFFFF;';
    if (v >= big * 0.25) return 'background: #FECACA; color: #7F1D1D;';
    return 'background: #FEE2E2; color: #7F1D1D;';
  }
  function splitSegs(pm, fm) {
    var tot = pm + fm || 1, p = pm / tot * 100;
    return [{ label: pm ? fmtMin(pm) : '', style: 'width: ' + p.toFixed(1) + '%; background: ' + BLUE + ';' },
      { label: fm ? fmtMin(fm) : '', style: 'width: ' + (100 - p).toFixed(1) + '%; background: ' + RED + ';' }];
  }
  var PM_LEGEND = [{ name: 'תיקוני שבר', style: 'background: ' + RED + ';' }, { name: 'אחזקה מתוכננת / מונעת', style: 'background: ' + BLUE + ';' }];

  /* ---------- model ---------- */
  function buildModel(machineId, type, key, events, prev, monthWeeks, prevRaw) {
    var r = D.cal.range(type, key);
    var sc = scan(events, machineId);
    var prevAgg = (prev.length && hasData(prev[0].agg)) ? prev[0].agg : null;
    var prevSc = prevRaw ? scan(prevRaw, machineId) : null;
    var W = PREV_WORD[type];
    if (prev.length && prev[0].key !== D.cal.step(type, key, -1)) W = 'מהתקופה הקודמת שהועלתה';

    var mtbf = sc.fn ? sc.prod / sc.fn : null;
    var mttr = sc.fn ? sc.fm / sc.fn : null;
    var failShare = sc.base ? sc.fm / sc.base : null;
    var pmShare = (sc.pm + sc.fm) ? sc.pm / (sc.pm + sc.fm) : null;
    var micro = sc.buckets[0], longB = sc.buckets[4];
    var pMtbf = prevAgg && prevAgg.fn ? prevAgg.prod / prevAgg.fn : null;
    var pMttr = prevAgg && prevAgg.fn ? prevAgg.fm / prevAgg.fn : null;
    var pFailShare = prevAgg && prevAgg.base ? prevAgg.fm / prevAgg.base : null;
    var pPmShare = prevAgg && (prevAgg.pm + prevAgg.fm) ? prevAgg.pm / (prevAgg.pm + prevAgg.fm) : null;

    var nDays = Object.keys(sc.days).length;
    var pmDays = Object.keys(sc.pmDays).length;
    var nStations = Object.keys(sc.stations).length;
    // a repeat = the same failure on 4 days or more. On the daily screen the window is the last
    // production days that have data (this day + the previous ones), not the single day shown.
    var repeatThreshold = 4, repeatWindow = PERIOD_WORD[type];
    var repeatN;
    if (type === 'day') {
      var perReason = {};
      Object.keys(sc.reasons).forEach(function (k) { perReason[k] = 1; });
      prev.forEach(function (pv) { Object.keys(pv.agg.reasons).forEach(function (k) { perReason[k] = (perReason[k] || 0) + 1; }); });
      repeatN = Object.keys(perReason).filter(function (k) { return perReason[k] >= repeatThreshold; }).length;
      repeatWindow = 'ב-' + (prev.length + 1) + ' ימי הייצור האחרונים';
    } else {
      repeatN = Object.keys(sc.reasons).filter(function (k) { return Object.keys(sc.reasons[k].days).length >= repeatThreshold; }).length;
    }

    var PERIOD_IN = { day: 'ביום הזה', week: 'בשבוע הזה', month: 'בחודש הזה' }[type];
    var kpis = [
      { l: 'MTBF', v: hm(mtbf), n: 'זמן ייצור (' + hm(sc.prod) + ') חלקי ' + sc.fn + ' תקלות', d: deltaMin(mtbf, pMtbf, W, false) },
      { l: 'MTTR', v: mttr === null ? '—' : mttr.toFixed(1) + ' דק\'', n: 'זמן תיקון ממוצע · סה"כ ' + hm(sc.fm) + ' שעות', d: deltaMin(mttr, pMttr, W, true) },
      { l: 'השבתת שבר', v: failShare === null ? '—' : pct1(failShare), sub: hm(sc.fm) + ' שעות',
        n: 'מתוך זמן הבסיס של ה-OEE ' + PERIOD_IN, d: deltaPts(failShare, pFailShare, W, true) },
      { l: 'מס\' תקלות', v: String(sc.fn), n: nStations + ' תחנות · ' + dayN(nDays) + ' עם נתונים', d: deltaCount(sc.fn, prevAgg ? prevAgg.fn : null, W, true) },
      { l: 'התקלה הארוכה', v: sc.longest ? hm(sc.longest.dur) : '—',
        n: sc.longest ? sc.longest.desc + ' · ' + sc.longest.station + ' · ' + (type === 'day' ? sc.longest.t : fmtDM(sc.longest.day)) : 'לא נרשמו תקלות',
        d: plain(sc.longest && sc.fm ? 'אירוע יחיד = ' + Math.round(sc.longest.dur / sc.fm * 100) + '% מזמן השבר' : '') },
      { l: 'מיקרו-עצירות (עד 5 דק\')', v: String(micro.n),
        n: sc.fn ? Math.round(micro.n / sc.fn * 100) + '% מהאירועים · ' + (sc.fm ? Math.round(micro.min / sc.fm * 100) : 0) + '% מזמן ההשבתה' : '—',
        d: prevSc ? deltaCount(micro.n, prevSc.buckets[0].n, W, true) : plain('מדד לתנאי בסיס ולתחזוקה אוטונומית') },
      { l: 'אחזקה מתוכננת', v: sc.pm ? hm(sc.pm) : '0 דק\'',
        n: pmDays ? 'בוצעה ב-' + dayN(pmDays) + (nDays > 1 ? ' מתוך ' + nDays : '') : 'לא בוצעה אחזקה מונעת ' + PERIOD_IN,
        d: deltaMin(sc.pm, prevAgg ? prevAgg.pm : null, W, false) },
      { l: 'חלק האחזקה המתוכננת', v: pmShare === null ? '—' : pct0(pmShare), n: 'מסך זמן האחזקה ' + PERIOD_IN + ' (מתוכנן + שבר)',
        d: deltaPts(pmShare, pPmShare, W, false) },
      { l: 'תקלות ארוכות (60 דק\' ומעלה)', v: String(longB.n),
        n: sc.fm ? Math.round(longB.min / sc.fm * 100) + '% מזמן ההשבתה · ' + hm(longB.min) + ' שעות' : '—',
        d: plain('היעד המרכזי ל-BDE') }
    ];
    if (type !== 'month') {
      kpis[8] = { l: 'תקלות חוזרות', v: String(repeatN), n: 'אותה תקלה ב-' + repeatThreshold + ' ימים או יותר ' + repeatWindow, d: plain('מועמדות ל-UPS') };
    }
    kpis.forEach(function (k) { k.hasSub = !!k.sub; k.sub = k.sub || ''; k.delta = k.d.t; k.deltaStyle = k.d.s; });

    var model = { type: type, key: key, from: r.from, to: r.to, kpis: kpis, hasEvents: events.length > 0, fn: sc.fn };
    if (type === 'day') Object.assign(model, dayView(sc, machineId, key, prev));
    if (type === 'week') Object.assign(model, weekView(sc, prevSc, machineId, key, prev, r, W));
    if (type === 'month') Object.assign(model, monthView(sc, machineId, key, monthWeeks, r));
    return model;
  }

  /* ---------- daily ---------- */
  function dayView(sc, machineId, key, prev) {
    var st = stationRows(sc, 0);
    var stationNote = st.list.length
      ? st.list[0].name + ' לקחה ' + fmtMin(st.list[0].min) + ' מתוך ' + fmtMin(sc.fm) + ' — ' + Math.round(st.list[0].min / (sc.fm || 1) * 100) +
        '% מזמן השבר של היום, ב-' + evN(st.list[0].n) + '.'
      : 'לא נרשמו תקלות שבר ביום הזה.';
    var buckets = bucketRows(sc, null);
    var longMin = sc.buckets[3].min + sc.buckets[4].min, longN = sc.buckets[3].n + sc.buckets[4].n;
    var bucketNote = sc.fn
      ? Math.round(sc.buckets[0].n / sc.fn * 100) + '% מהתקלות היום היו קצרות מ-5 דקות, אבל הן ' + Math.round(sc.buckets[0].min / (sc.fm || 1) * 100) +
        '% מזמן ההשבתה. ' + longN + ' תקלות ארוכות (30 דקות ומעלה) לקחו ' + Math.round(longMin / (sc.fm || 1) * 100) +
        '% מהזמן — שם נמצא הפוטנציאל ל-BDE, בעוד המיקרו-עצירות שייכות לתנאי בסיס ולתחזוקה אוטונומית.'
      : '';

    // the last production days that have data (previous days + today)
    var cols = prev.slice().reverse().concat([{ key: key, agg: null }]);
    var byKey = {};
    cols.forEach(function (c) {
      var reasons = c.agg ? c.agg.reasons : null;
      if (!reasons) {
        Object.keys(sc.reasons).forEach(function (k) {
          var x = sc.reasons[k];
          var e = byKey[k] = byKey[k] || { desc: x.desc, station: x.station, per: {}, tot: 0, n: 0, longest: 0 };
          e.per[key] = (e.per[key] || 0) + x.min; e.tot += x.min; e.n += x.n; e.longest = Math.max(e.longest, x.longest);
        });
        return;
      }
      Object.keys(reasons).forEach(function (k) {
        var x = reasons[k];
        var e = byKey[k] = byKey[k] || { desc: x.desc, station: '', per: {}, tot: 0, n: 0, longest: 0 };
        e.per[c.key] = (e.per[c.key] || 0) + x.min; e.tot += x.min; e.n += x.n;
      });
    });
    var nCols = cols.length;
    var repeats = Object.keys(byKey).map(function (k) { return byKey[k]; }).sort(function (a, b) { return b.tot - a.tot; }).slice(0, 12)
      .map(function (k) {
        var nd = cols.filter(function (c) { return k.per[c.key]; }).length;
        var tag = nd >= 4 ? 'ups' : (k.longest >= 60 || (k.n <= 2 && k.tot >= 60) ? 'ips' : 'watch');
        return { desc: k.desc, station: k.station || '—', tot: fmtMin(k.tot), n: evN(k.n), days: nd + '/' + nCols,
          mttr: (k.tot / (k.n || 1)).toFixed(1) + ' דק\'', tag: TAG[tag][0], tagStyle: TAG[tag][1] };
      });

    var pmDays = cols.map(function (c) {
      var a = c.agg || { pm: sc.pm, fm: sc.fm };
      return { key: c.key, pm: a.pm, fm: a.fm };
    });
    var maxPM = 1;
    pmDays.forEach(function (d) { maxPM = Math.max(maxPM, d.pm + d.fm); });
    var totPM = 0, totFail = 0;
    pmDays.forEach(function (d) { totPM += d.pm; totFail += d.fm; });
    var pmOut = pmDays.map(function (d) {
      return { name: fmtDM(d.key), txt: (d.pm ? fmtMin(d.pm) + ' / ' : '') + fmtMin(d.fm),
        parts: [[d.pm, BLUE], [d.fm, RED]].filter(function (x) { return x[0]; }).map(function (x) {
          return { style: 'height: ' + (x[0] / maxPM * 140).toFixed(1) + 'px; background: ' + x[1] + ';' };
        }) };
    });
    var withPM = pmDays.filter(function (d) { return d.pm; });
    var pmNote = 'ב-' + nCols + ' ימי הייצור האחרונים בוצעה אחזקה מונעת ב-' + (withPM.length ? dayN(withPM.length) : 'אף יום') +
      ' (' + hm(totPM) + ' שעות), מול ' + hm(totFail) + ' שעות של תיקוני שבר — ' + pct0(totPM / (totPM + totFail || 1)) + ' מתוכנן.';

    var log = sc.log.sort(function (a, b) { return a.at - b.at; }).map(function (e) {
      return { t: e.t, dur: fmtMin(e.durMin), station: e.station, desc: e.desc, durStyle: e.durMin >= 30 ? 'color: ' + RED + ';' : '' };
    });
    return { stations: st.rows, stationNote: stationNote, buckets: buckets, bucketNote: bucketNote,
      repeats: repeats, pmDays: pmOut, pmLegend: PM_LEGEND, split: splitSegs(totPM, totFail), pmNote: pmNote, log: log };
  }

  /* ---------- weekly ---------- */
  function weekView(sc, prevSc, machineId, key, prev, range, W) {
    var cols = prev.slice().reverse().concat([{ key: key, agg: null }]);
    var series = cols.map(function (c) {
      var a = c.agg || { prod: sc.prod, fm: sc.fm, fn: sc.fn, pm: sc.pm };
      return { key: c.key, mtbf: a.fn ? a.prod / a.fn : null, mttr: a.fn ? a.fm / a.fn : null,
        pm: a.pm, fm: a.fm, pmPct: (a.pm + a.fm) ? a.pm / (a.pm + a.fm) : null };
    }).filter(function (s) { return s.mtbf !== null; });
    var maxM = 1;
    series.forEach(function (s) { maxM = Math.max(maxM, s.mtbf); });
    var weeks = series.map(function (s, i) {
      var d = i ? s.mtbf - series[i - 1].mtbf : null;
      return { name: D.cal.label('week', s.key).replace(' | ', ' · ').replace('–', ' עד ').replace(/^\d{4}-/, ''),
        val: hm(s.mtbf), barStyle: 'height: ' + (s.mtbf / maxM * 150).toFixed(0) + 'px; background: ' + (i === series.length - 1 ? BLUE : '#9DB7D8') + ';',
        delta: d === null ? '' : (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + ' דק\'',
        deltaStyle: d === null ? '' : 'color: ' + (d >= 0 ? '#16A34A' : RED) + ';',
        mttr: 'MTTR ' + s.mttr.toFixed(1) + ' דק\'' };
    });
    var last = series[series.length - 1], before = series[series.length - 2];
    var trendNote = before
      ? 'ה-MTBF ' + (last.mtbf >= before.mtbf ? 'עלה' : 'ירד') + ' מ-' + hm(before.mtbf) + ' ל-' + hm(last.mtbf) + ' — הקו רץ בממוצע ' +
        Math.abs(last.mtbf - before.mtbf).toFixed(1) + ' דקות ' + (last.mtbf >= before.mtbf ? 'יותר' : 'פחות') + ' בין תקלה לתקלה. במקביל ה-MTTR ' +
        (last.mttr >= before.mttr ? 'עלה' : 'ירד') + ' מ-' + before.mttr.toFixed(1) + ' ל-' + last.mttr.toFixed(1) + ' דקות.'
      : 'אין עדיין שבוע קודם עם נתונים להשוואה.';

    // the 7 days of the week
    var dayKeys = [];
    for (var i = 0; i < 7; i++) dayKeys.push(D.cal.step('day', range.from, i));
    var maxD = 1;
    dayKeys.forEach(function (dk) { var a = sc.perDay[dk]; if (a) maxD = Math.max(maxD, a.fm + a.pm); });
    var days = dayKeys.map(function (dk) {
      var a = sc.perDay[dk] || emptyDay();
      return { name: WEEKDAYS[new Date(dk + 'T12:00:00').getDay()] + ' ' + fmtDM(dk),
        mtbf: a.fn ? hm(a.prod / a.fn) : '—', txt: fmtMin(a.fm) + (a.pm ? ' + ' + fmtMin(a.pm) : ''),
        parts: [[a.pm, BLUE], [a.fm, RED]].filter(function (x) { return x[0]; }).map(function (x) {
          return { style: 'height: ' + (x[0] / maxD * 140).toFixed(1) + 'px; background: ' + x[1] + ';' };
        }) };
    });
    var worstDay = null, bestDay = null;
    dayKeys.forEach(function (dk) {
      var a = sc.perDay[dk]; if (!a || !a.fn) return;
      var m = a.prod / a.fn;
      if (!worstDay || m < worstDay.m) worstDay = { k: dk, m: m, a: a };
      if (!bestDay || m > bestDay.m) bestDay = { k: dk, m: m, a: a };
    });
    var dayNote = worstDay ? 'היום החלש בשבוע: ' + fmtDM(worstDay.k) + ' — MTBF של ' + hm(worstDay.m) + ' מול ' + hm(bestDay.m) + ' ב-' + fmtDM(bestDay.k) +
      '. ' + (Object.keys(sc.pmDays).length ? 'אחזקה מתוכננת בוצעה ב-' + dayN(Object.keys(sc.pmDays).length) + ' מתוך 7.' : 'לא בוצעה אחזקה מתוכננת השבוע.') : '';

    // stations vs the previous week
    var st = stationRows(sc, 7);
    var stations = st.rows.map(function (row, i) {
      var cur = st.list[i], pv = prevSc && prevSc.stations[cur.name] ? prevSc.stations[cur.name].min : null;
      var o = { name: row.name, tot: row.tot, n: row.n, mttr: (cur.min / cur.n).toFixed(1) + ' דק\'',
        days: Object.keys(cur.days).length + ' ימים מתוך 7', fillStyle: row.fillStyle };
      if (pv === null) { o.chg = 'אין שבוע קודם'; o.chgStyle = 'background: #E5E7EB; color: #374151;'; return o; }
      var d = cur.min - pv, rel = pv ? Math.round(d / pv * 100) : 100;
      o.chg = (d > 0 ? '▲ +' : '▼ ') + fmtMin(Math.abs(d)) + ' (' + (d > 0 ? '+' : '') + rel + '%)';
      o.chgStyle = d > 0 ? 'background: #FEE2E2; color: #991B1B;' : 'background: #DCFCE7; color: #166534;';
      o.fillStyle = 'width: ' + row.fillStyle.split('width: ')[1].split(';')[0] + '; background: ' + (d > 0 ? RED : '#C99A9A') + ';';
      return o;
    });
    var worstSt = null;
    stations.forEach(function (s, i) { if (s.chg.indexOf('▲') === 0 && (!worstSt || st.list[i].min > st.list[worstSt].min)) worstSt = i; });
    var stationNote = worstSt !== null
      ? st.list[worstSt].name + ' היא החריגה של השבוע: ' + fmtMin(st.list[worstSt].min) + ', והיא ' +
        Math.round(st.list[worstSt].min / (sc.fm || 1) * 100) + '% מכל זמן השבר.'
      : (st.list.length ? st.list[0].name + ' מובילה עם ' + fmtMin(st.list[0].min) + ' — ' + Math.round(st.list[0].min / (sc.fm || 1) * 100) + '% מזמן השבר, וכל התחנות השתפרו מול השבוע הקודם.' : '');

    // recurring failures across the 4 weeks
    var byKey = {};
    cols.forEach(function (c) {
      var reasons = c.agg ? c.agg.reasons : null;
      if (!reasons) {
        Object.keys(sc.reasons).forEach(function (k) {
          var x = sc.reasons[k];
          var e = byKey[k] = byKey[k] || { desc: x.desc, station: x.station, per: {}, tot: 0, n: 0, mttr: 0 };
          e.per[key] = (e.per[key] || 0) + x.min; e.tot += x.min; e.n += x.n; e.station = x.station; e.mttr = x.min / x.n;
        });
        return;
      }
      Object.keys(reasons).forEach(function (k) {
        var x = reasons[k];
        var e = byKey[k] = byKey[k] || { desc: x.desc, station: '', per: {}, tot: 0, n: 0, mttr: 0 };
        e.per[c.key] = (e.per[c.key] || 0) + x.min; e.tot += x.min; e.n += x.n;
      });
    });
    var maxCell = 1;
    Object.keys(byKey).forEach(function (k) { cols.forEach(function (c) { maxCell = Math.max(maxCell, byKey[k].per[c.key] || 0); }); });
    var recurring = Object.keys(byKey).map(function (k) { return byKey[k]; }).sort(function (a, b) { return (b.per[key] || 0) - (a.per[key] || 0); }).slice(0, 12)
      .map(function (k) {
        var vals = cols.map(function (c) { return Math.round(k.per[c.key] || 0); });
        var cur = vals[vals.length - 1], pv = vals[vals.length - 2] || 0;
        var rising = vals.length >= 3 && cur > vals[vals.length - 2] && vals[vals.length - 2] > vals[vals.length - 3];
        var tag = !pv && cur ? 'watch' : (rising ? 'rising' : (cur > pv * 1.25 ? 'ups' : (cur < pv * 0.75 ? 'better' : 'chronic')));
        return { desc: k.desc, sub: (k.station || '—') + (k.mttr ? ' · MTTR ' + k.mttr.toFixed(1) + ' דק\'' : ''),
          cells: vals.map(function (v) { return { v: v || '·', style: heat(v, maxCell) }; }),
          tot: fmtMin(k.tot), n: (k.per[key] ? Math.round(k.per[key]) : 0) + ' דק\' השבוע',
          tag: TAG[tag][0], tagStyle: TAG[tag][1] };
      });
    var weekCols = cols.map(function (c) { return D.cal.label('week', c.key).split(' | ')[0].replace(/^\d{4}-/, ''); });

    var pmWeeks = series.map(function (s) {
      var wr = D.cal.range('week', s.key);
      return { name: D.cal.label('week', s.key).split(' | ')[0].replace(/^\d{4}-/, ''),
        sub: fmtDM(wr.from) + ' עד ' + fmtDM(wr.to) + ' · סה"כ ' + fmtMin(s.pm + s.fm),
        pct: s.pmPct === null ? '—' : pct0(s.pmPct) + ' מתוכנן', days: '', segs: splitSegs(s.pm, s.fm) };
    });
    var pmTrend = series.map(function (s) { return s.pmPct === null ? '—' : pct0(s.pmPct); }).join(' ← ');
    var pmNote = 'חלק האחזקה המתוכננת לאורך השבועות: ' + pmTrend + '. אחזקה מתוכננת בוצעה השבוע ב-' +
      (Object.keys(sc.pmDays).length ? dayN(Object.keys(sc.pmDays).length) : 'אף יום') + ' מתוך 7.';

    var buckets = bucketRows(sc, prevSc);
    var buckLegend = [{ name: 'השבוע', style: 'background: ' + RED + ';' }, { name: 'השבוע הקודם', style: 'background: ' + PREV + ';' }];
    var longMin = sc.buckets[3].min + sc.buckets[4].min, longN = sc.buckets[3].n + sc.buckets[4].n;
    var buckNote = (prevSc ? 'המיקרו-עצירות ' + (sc.buckets[0].n <= prevSc.buckets[0].n ? 'ירדו' : 'עלו') + ' מ-' + prevSc.buckets[0].n + ' ל-' + sc.buckets[0].n + '. ' : '') +
      longN + ' תקלות ארוכות (30 דקות ומעלה) לקחו ' + hm(longMin) + ' שעות, שהן ' + Math.round(longMin / (sc.fm || 1) * 100) + '% מכל זמן השבר.';

    return { weeks: weeks, trendNote: trendNote, days: days, legend: PM_LEGEND, dayNote: dayNote,
      stations: stations, stationNote: stationNote, weekCols: weekCols, recurring: recurring,
      pmWeeks: pmWeeks, pmNote: pmNote, buckets: buckets, buckLegend: buckLegend, buckNote: buckNote };
  }

  /* ---------- monthly ---------- */
  function monthView(sc, machineId, key, monthWeeks, range) {
    var series = monthWeeks.map(function (w) {
      var a = w.agg;
      return { key: w.key, from: w.from, to: w.to, mtbf: a.fn ? a.prod / a.fn : null, mttr: a.fn ? a.fm / a.fn : null,
        pm: a.pm, fm: a.fm, pmPct: (a.pm + a.fm) ? a.pm / (a.pm + a.fm) : null };
    }).filter(function (s) { return s.mtbf !== null; });
    var maxM = 1;
    series.forEach(function (s) { maxM = Math.max(maxM, s.mtbf); });
    var weeks = series.map(function (s, i) {
      var d = i ? s.mtbf - series[i - 1].mtbf : null;
      return { name: D.cal.label('week', s.key).split(' | ')[0].replace(/^\d{4}-/, '') + ' · ' + fmtDM(s.from) + ' עד ' + fmtDM(s.to),
        val: hm(s.mtbf), barStyle: 'height: ' + (s.mtbf / maxM * 150).toFixed(0) + 'px; background: ' + (i === series.length - 1 ? BLUE : '#9DB7D8') + ';',
        delta: d === null ? '' : (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + ' דק\'',
        deltaStyle: d === null ? '' : 'color: ' + (d >= 0 ? '#16A34A' : RED) + ';',
        sub: 'MTTR ' + s.mttr.toFixed(1) + ' דק\'' + (s.pmPct === null ? '' : ' · PM ' + pct0(s.pmPct)) };
    });
    var first = series[0], last = series[series.length - 1];
    var trendNote = series.length > 1
      ? 'ה-MTBF ' + (last.mtbf >= first.mtbf ? 'עלה' : 'ירד') + ' מ-' + hm(first.mtbf) + ' בתחילת החודש ל-' + hm(last.mtbf) + ' בסופו' +
        (last.pmPct !== null && first.pmPct !== null ? ', וחלק האחזקה המתוכננת ' + (last.pmPct >= first.pmPct ? 'עלה' : 'ירד') + ' מ-' + pct0(first.pmPct) + ' ל-' + pct0(last.pmPct) : '') + '.'
      : 'אין מספיק שבועות עם נתונים כדי להראות מגמה בתוך החודש.';

    var st = stationRows(sc, D.cal.days('month', key));
    var stations = st.rows.map(function (row, i) {
      var cur = st.list[i];
      return { name: row.name, days: row.days, tot: row.tot, n: row.n,
        mtbf: cur.n ? hm(sc.prod / cur.n) : '—', mttr: (cur.min / cur.n).toFixed(1) + ' דק\'', fillStyle: row.fillStyle };
    });
    var nTop = Math.min(4, st.list.length);
    var top4 = st.list.slice(0, nTop).reduce(function (s, x) { return s + x.min; }, 0);
    var chronic = st.list.slice().sort(function (a, b) { return b.n - a.n; })[0];
    var WORD = { 1: 'התחנה המובילה מחזיקה', 2: 'שתי התחנות המובילות מחזיקות', 3: 'שלוש התחנות המובילות מחזיקות', 4: 'ארבע התחנות המובילות מחזיקות' };
    var stationNote = st.list.length
      ? WORD[nTop] + ' ' + Math.round(top4 / (sc.fm || 1) * 100) + '% מזמן השבר של החודש. ' + st.list[0].name + ' היא הכבדה ביותר (' +
        fmtMin(st.list[0].min) + ' ב-' + evN(st.list[0].n) + ')' +
        (chronic && chronic.name !== st.list[0].name ? ', ואילו ' + chronic.name + ' נופלת הכי הרבה פעמים (' + chronic.n + ') אבל עם MTTR של ' +
          (chronic.min / chronic.n).toFixed(1) + ' דקות — כלומר בעיית תנאי בסיס ולא כשל ציוד' : '') + '.'
      : 'לא נרשמו תקלות שבר בחודש הזה.';

    var conc = bucketRows(sc, null);
    var longMin = sc.buckets[4].min, longN = sc.buckets[4].n;
    var concNote = sc.fn
      ? Math.round(sc.buckets[0].n / sc.fn * 100) + '% מהאירועים היו קצרים מ-5 דקות ולקחו ' + Math.round(sc.buckets[0].min / (sc.fm || 1) * 100) +
        '% מהזמן; ' + longN + ' אירועים בלבד — ' + Math.round(longN / sc.fn * 100) + '% מהתקלות — לקחו ' + hm(longMin) + ' שעות, שהן ' +
        Math.round(longMin / (sc.fm || 1) * 100) + '% מכל זמן השבר של החודש.'
      : '';

    var list = Object.keys(sc.reasons).map(function (k) { return sc.reasons[k]; }).sort(function (a, b) { return b.min - a.min; });
    var top5 = list.slice(0, 5);
    var bde = top5.map(function (p, i) {
      var nd = Object.keys(p.days).length, mttr = p.min / p.n;
      var isChronic = nd >= 8 || (p.n >= 10 && mttr < 30);
      var T = isChronic ? ['כרונית — UPS ועדכון תוכנית PM', 'background: #FEE2E2; color: #991B1B;']
        : ['ספוראדית — IPS ותחקיר כשל', 'background: #FEF3C7; color: #92400E;'];
      return { rank: i + 1, desc: p.desc, sub: p.station + ' · ' + dayN(nd) + ' · MTTR ' + mttr.toFixed(1) + ' דק\'',
        tot: fmtMin(p.min), n: evN(p.n), gain: '+' + fmtMin(p.min / 2), tag: T[0], tagStyle: T[1] };
    });
    var top5min = top5.reduce(function (s, x) { return s + x.min; }, 0);
    var bdeNote = top5.length
      ? 'חמש התקלות האלה לקחו יחד ' + hm(top5min) + ' שעות — ' + Math.round(top5min / (sc.fm || 1) * 100) +
        '% מזמן השבר של החודש. הפחתה של חצי בכל אחת מהן מחזירה כ-' + hm(top5min / 2) + ' שעות ייצור בחודש, שהן כ-' +
        (top5min / 2 / (sc.base || 1) * 100).toFixed(1) + ' נקודות זמינות לקו.'
      : '';

    var pmWeeks = series.map(function (s) {
      return { name: D.cal.label('week', s.key).split(' | ')[0].replace(/^\d{4}-/, ''),
        sub: fmtDM(s.from) + ' עד ' + fmtDM(s.to) + ' · סה"כ ' + fmtMin(s.pm + s.fm),
        pct: s.pmPct === null ? '—' : pct0(s.pmPct) + ' מתוכנן', days: '', segs: splitSegs(s.pm, s.fm) };
    });
    var pmDaysN = Object.keys(sc.pmDays).length, daysInMonth = D.cal.days('month', key);
    var pmNote = 'חלק האחזקה המתוכננת לאורך החודש: ' + series.map(function (s) { return s.pmPct === null ? '—' : pct0(s.pmPct); }).join(' ← ') +
      '. בסך הכול בוצעה אחזקה מתוכננת ב-' + (pmDaysN ? dayN(pmDaysN) : 'אף יום') + ' מתוך ' + daysInMonth + ' — ' + hm(sc.pm) + ' שעות.';

    return { weeks: weeks, trendNote: trendNote, stations: stations, stationNote: stationNote,
      conc: conc, concNote: concNote, bde: bde, bdeNote: bdeNote, pmWeeks: pmWeeks, pmNote: pmNote };
  }

  /* ---------- the screen ---------- */
  function MLComponent(props) { window.DCLogic.call(this, props); this.state = { machineId: null, period: 'day', keys: {}, model: null, loading: true, error: null, empty: false }; }
  MLComponent.prototype = Object.create(window.DCLogic.prototype);
  MLComponent.prototype.constructor = MLComponent;
  var LS = 'oee_ml_machine_v1', LS_P = 'oee_ml_period_v1';

  MLComponent.prototype.start = function () {
    var self = this;
    return D.init().then(function (idx) {
      if (!idx.day.length) { self.setState({ loading: false, empty: true }); return; }
      var S = D.static();
      if (!self.state.machineId) {
        var saved = null, sp = null;
        try { saved = Number(localStorage.getItem(LS)) || null; sp = localStorage.getItem(LS_P); } catch (e) { /* private mode */ }
        var ok = S.machines.filter(function (m) { return m.id === saved; })[0];
        self.state.machineId = ok ? ok.id : S.machines[0].id;
        if (sp === 'week' || sp === 'month') self.state.period = sp;
      }
      ['day', 'week', 'month'].forEach(function (t) {
        var cur = self.state.keys[t];
        if (!cur || idx[t].indexOf(cur) < 0) self.state.keys[t] = idx[t][idx[t].length - 1];
      });
      return self.load();
    }).catch(function (e) { self.setState({ loading: false, error: e.message || String(e) }); });
  };
  MLComponent.prototype.load = function () {
    var self = this, mid = this.state.machineId, t = this.state.period, k = this.state.keys[t];
    this.setState({ loading: true, error: null });
    return load(mid, t, k).then(function (model) {
      if (self.state.machineId === mid && self.state.period === t && self.state.keys[t] === k) self.setState({ model: model, loading: false });
    }).catch(function (e) { self.setState({ loading: false, error: e.message || String(e) }); });
  };
  MLComponent.prototype.pickMachine = function (id) {
    var self = this;
    return function () {
      if (self.state.machineId === id) return;
      self.state.machineId = id;
      try { localStorage.setItem(LS, String(id)); } catch (e) { /* private mode */ }
      self.load();
    };
  };
  MLComponent.prototype.pickPeriod = function (p) {
    var self = this;
    return function () {
      if (self.state.period === p) return;
      self.state.period = p;
      try { localStorage.setItem(LS_P, p); } catch (e) { /* private mode */ }
      self.load();
    };
  };
  MLComponent.prototype.step = function (dir) {
    var self = this;
    return function () {
      var t = self.state.period, list = D.index()[t], i = list.indexOf(self.state.keys[t]) + dir;
      if (i < 0 || i >= list.length) return;
      self.state.keys[t] = list[i];
      self.load();
    };
  };

  MLComponent.prototype.renderVals = function () {
    var st = this.state, M = st.model, S = D.static();
    var machines = S ? S.machines : [];
    var mach = machines.filter(function (m) { return m.id === st.machineId; })[0];
    var deptName = '';
    if (mach && S) { var d = S.depts.filter(function (x) { return x.id === mach.department_id; })[0]; deptName = d ? d.name : ''; }
    var t = st.period, list = D.index() ? D.index()[t] : [], key = st.keys[t];
    var pos = list.indexOf(key);
    var NAV_OFF = 'opacity: 0.35; cursor: default;';
    var PER = [{ k: 'day', l: 'יום' }, { k: 'week', l: 'שבוע' }, { k: 'month', l: 'חודש' }];
    var periodTxt = { day: key ? 'יום ייצור ' + key.slice(8) + '/' + key.slice(5, 7) + '/' + key.slice(0, 4) : '',
      week: key ? 'שבוע ייצור ' + D.cal.label('week', key) : '', month: key ? D.cal.label('month', key) : '' }[t];
    var base = {
      isDay: t === 'day', isWeek: t === 'week', isMonth: t === 'month',
      periods: PER.map(function (p) { return { label: p.l, style: p.k === t ? 'background: #1c2b45; color: #FFFFFF;' : '', pick: this.pickPeriod(p.k) }; }, this),
      machineChips: machines.map(function (m) { return { name: m.name, style: m.id === st.machineId ? 'background: #1c2b45; color: #FFFFFF;' : '', pick: this.pickMachine(m.id) }; }, this),
      subTitle: (mach ? mach.name : '') + (deptName ? ' · אגף ' + deptName : '') + (periodTxt ? ' · ' + periodTxt : ''),
      periodLabel: key ? D.cal.label(t, key) : '—',
      prevFn: this.step(-1), nextFn: this.step(1),
      prevStyle: pos > 0 ? '' : NAV_OFF, nextStyle: pos >= 0 && pos < list.length - 1 ? '' : NAV_OFF,
      srcNote: { day: 'תקלות שבר = סטטוס "עצירת השבתה" בקבוצה "תקלה" לפי כללי הסיווג. זמן התיקון הוא משך האירוע כפי שדווח ב-MES. MTBF = זמן ייצור חלקי מספר התקלות',
        week: 'שבוע ייצור שבת–שישי לפי Date_Dim. אחזקה מתוכננת = אירועי "אחזקה מתוכננת / מונעת". ההשוואה היא מול השבוע הקודם שהועלה',
        month: 'חודש קלנדרי. ההשוואות בעמוד הן בתוך החודש — שבוע מול שבוע. תיק ה-BDE מדורג לפי זמן מצטבר' }[t]
    };
    var EMPTY = { kpis: [], stations: [], buckets: [], repeats: [], pmDays: [], pmLegend: [], split: [], log: [],
      weeks: [], weekCols: [], recurring: [], pmWeeks: [], days: [], legend: [], buckLegend: [], conc: [], bde: [],
      stationNote: '', bucketNote: '', pmNote: '', trendNote: '', dayNote: '', buckNote: '', concNote: '', bdeNote: '' };
    if (!M) {
      var msg = st.empty ? 'עדיין לא הועלו דוחות' : (st.error ? 'שגיאה בטעינה: ' + st.error : 'טוען נתונים…');
      return Object.assign(base, EMPTY, { showBanner: true, bannerText: msg, srcLabel: st.empty ? 'אין נתונים' : 'טוען…', srcStyle: 'background: #F0EFEA; color: #5B594F;' });
    }
    var note = !M.hasEvents ? 'אין אירועי RAW למכונה הזו בתקופה שנבחרה' : (M.fn ? '' : 'לא נרשמו תקלות שבר בתקופה הזו — כל המסך מבוסס על אירועי תקלה');
    return Object.assign(base, EMPTY, M, {
      showBanner: !!note, bannerText: note,
      srcLabel: st.loading ? 'טוען…' : 'מחושב מדוח האירועים (RAW)',
      srcStyle: 'background: #E0E7FF; color: #3730A3;'
    });
  };

  window.OEE_ML = { Component: MLComponent, load: load, clearCache: function () { CACHE = {}; } };
})();
