/* Process Lead screens (approved mockups: daily "PL — שילוב B + C", weekly "PL שבועי — מגמות",
 * monthly "PL חודשי — סיכום ופעולות"). Everything is computed from the uploaded MES data:
 * the official OEE rows, the RAW events of the production days, and the classification rules
 * (PDT / UPDT / failure / standard duration). */
(function () {
  'use strict';
  var API = window.OEE_API, ENG = window.OEE_ENGINE, D = window.OEE_DASH;
  var PROD = ['ייצור', 'ייצור ללא פק"ע'];
  var COLORS = { prod: '#4E9A6B', updt: '#DC2626', pdt: '#8A93A8', clean: '#4A7A6E', none: '#D8D5C8', unknown: '#F59E0B', rate: '#F59E0B' };
  var TYPE_WORD = { day: 'היום', week: 'השבוע', month: 'החודש' };
  var PREV_WORD = { day: 'מאתמול', week: 'מהשבוע הקודם', month: 'מהחודש הקודם' };
  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(min) { if (min === null || min === undefined) return '—'; var r = Math.round(min); return Math.floor(r / 60) + ':' + pad(r % 60); }
  function fmtMin(min) { var r = Math.round(min); return r >= 60 ? hm(r) + ' ש\'' : r + ' דק\''; }
  function pctS(v) { return v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%'; }
  function fmtDM(d) { return d.slice(8) + '/' + d.slice(5, 7); }
  function num(v) { return Math.round(v || 0).toLocaleString('en-US'); }

  function bucket(rule, status) {
    if (PROD.indexOf(status) >= 0) return 'prod';
    if (!rule || rule.counts_in_oee === null || rule.counts_in_oee === undefined) return 'unknown';
    if (rule.loss_type === 'PRODUCTION') return 'prod';
    if (!rule.counts_in_oee) return 'none';
    if (rule.loss_type === 'UPDT' || rule.loss_type === 'PROCESS_FAILURE') return 'updt';
    if (rule.loss_type === 'PDT') return status === 'פעילות' ? 'clean' : 'pdt';
    return 'none';
  }
  function ruleOf(machineId, day, status, group, desc) {
    return ENG.classify({ status: ENG.norm(status), stop_group: ENG.norm(group), description: ENG.norm(desc), production_date: day },
      D.static().rules, machineId, day);
  }

  /* ---------- scanning ---------- */
  function emptyAgg() { return { base: 0, prod: 0, updt: 0, pdt: 0, clean: 0, none: 0, unknown: 0, fails: 0, updtN: 0, pdtN: 0, stops: 0, longest: 0 }; }
  function addAgg(a, b, min, n) {
    a[b] = (a[b] || 0) + min;
    if (b === 'updt') a.updtN += (n || 1);
    if (b === 'pdt' || b === 'clean') a.pdtN += (n || 1);
    if (b !== 'prod' && b !== 'none' && b !== 'unknown') a.base += min;
    if (b === 'prod') a.base += min;
  }

  // full scan of raw events (the selected period)
  function scan(events, machineId) {
    var all = emptyAgg(), perDay = {}, perShift = [emptyAgg(), emptyAgg(), emptyAgg()], par = {}, longs = [], segs = [];
    var overMin = 0, overN = 0, stdN = 0, overTop = null, firstDay = null;
    events.forEach(function (e) {
      var d = Number(e.duration_min) || 0, day = e.production_date;
      if (!firstDay || day < firstDay) firstDay = day;
      var r = ruleOf(machineId, day, e.status, e.stop_group, e.description);
      var b = bucket(r, ENG.norm(e.status));
      addAgg(all, b, d);
      var pd = perDay[day] = perDay[day] || emptyAgg();
      addAgg(pd, b, d);
      if (r && r.counts_as_failure) { all.fails++; pd.fails++; }
      if (r && r.normal_duration_min) {
        stdN++;
        var over = d - Number(r.normal_duration_min);
        if (over > 0) {
          overMin += over; overN++;
          if (!overTop || over > overTop.over) overTop = { desc: e.description || e.stop_group || e.status, over: over, dur: d, std: Number(r.normal_duration_min) };
        }
      }
      if (b !== 'prod' && b !== 'none') {
        var key = (e.description || e.stop_group || e.status) + '|' + (e.station || '');
        var p = par[key] = par[key] || { desc: e.description || e.stop_group || e.status, station: e.station || '', group: e.stop_group || e.status, min: 0, n: 0, days: {}, color: COLORS[b] };
        p.min += d; p.n++; p.days[day] = true;
      }
      var t = new Date(e.start_at);
      var mins = t.getHours() * 60 + t.getMinutes();
      var si = (mins >= 7 * 60 && mins < 15 * 60) ? 0 : ((mins >= 15 * 60 && mins < 23 * 60) ? 1 : 2);
      addAgg(perShift[si], b, d);
      if (b !== 'prod' && b !== 'none') { perShift[si].stops++; perShift[si].longest = Math.max(perShift[si].longest, d); }
      if (d >= 15 && b !== 'prod') longs.push({ day: day, at: t, t: pad(t.getHours()) + ':' + pad(t.getMinutes()), dur: fmtMin(d), desc: e.description || e.stop_group || e.status, station: e.station || '—', kindStyle: 'background: ' + COLORS[b] + ';' });
      segs.push({ day: day, start: t, min: d, color: COLORS[b], label: (e.description || e.stop_group || e.status) + ' · ' + fmtMin(d) });
    });
    return { all: all, perDay: perDay, perShift: perShift, par: par, longs: longs, segs: segs,
      overMin: overMin, overN: overN, stdN: stdN, overTop: overTop, firstDay: firstDay, count: events.length };
  }

  // lighter scan of aggregated combos (previous periods / week matrix)
  function scanCombos(rows, machineId, day) {
    var a = emptyAgg(), byReason = {};
    (rows || []).forEach(function (c) {
      var r = ruleOf(machineId, day, c.status, c.stop_group, c.description);
      var b = bucket(r, ENG.norm(c.status));
      var min = Number(c.minutes) || 0;
      addAgg(a, b, min, c.n);
      if (r && r.counts_as_failure) a.fails += c.n;
      if (b !== 'prod' && b !== 'none') {
        var key = (c.description || c.stop_group || c.status);
        var k = byReason[key] = byReason[key] || { desc: key, group: c.stop_group || c.status, min: 0, n: 0, updt: b === 'updt' };
        k.min += min; k.n += c.n;
      }
    });
    return { agg: a, byReason: byReason };
  }

  /* ---------- loading ---------- */
  var CACHE = {};
  var RAW_COLS = 'status,stop_group,station,description,production_date,start_at,duration_min,output_qty';
  function officialRow(type, from, to, machineId) {
    var L = { day: 'DAY', week: 'WEEK', month: 'MONTH' }[type];
    return D.selectAll('oee_report_rows?select=oee,availability,performance,quality,tdt_pct,sap_good_units,net_minutes&period_type=eq.' + L +
      '&period_from=eq.' + from + '&period_to=eq.' + to + '&machine_id=eq.' + machineId).then(function (r) { return r[0] || null; });
  }
  function dailyRows(from, to, machineId) {
    return D.selectAll('oee_report_rows?select=period_from,oee,availability,performance,tdt_pct,sap_good_units&period_type=eq.DAY&period_from=gte.' + from +
      '&period_from=lte.' + to + '&machine_id=eq.' + machineId + '&order=period_from');
  }
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

  function load(machineId, type, key) {
    var ck = machineId + '|' + type + '|' + key;
    if (CACHE[ck]) return Promise.resolve(CACHE[ck]);
    var r = D.cal.range(type, key);
    var prevKeys = [];
    var n = type === 'day' ? 6 : (type === 'week' ? 3 : 2);
    for (var i = 1; i <= n; i++) prevKeys.push(D.cal.step(type, key, -i));
    var jobs = [
      officialRow(type, r.from, r.to, machineId),
      rawOf(machineId, type, key),
      dailyRows(r.from, r.to, machineId),
      Promise.all(prevKeys.map(function (k) {
        var pr = D.cal.range(type, k);
        return Promise.all([combos(machineId, type, k), dailyRows(pr.from, pr.to, machineId)])
          .then(function (x) { return { key: k, from: pr.from, to: pr.to, combos: x[0], daily: x[1] }; });
      })),
      type === 'month' ? weeksOfMonth(machineId, r) : Promise.resolve([])
    ];
    return Promise.all(jobs).then(function (x) {
      var m = buildModel(machineId, type, key, x[0], x[1], x[2], x[3], x[4]);
      CACHE[ck] = m;
      return m;
    });
  }
  function weeksOfMonth(machineId, r) {
    var keys = [], k = D.cal.keyOf('week', r.from);
    while (k <= r.to) { keys.push(k); k = D.cal.step('week', k, 1); }
    return Promise.all(keys.map(function (wk) {
      var wr = D.cal.range('week', wk);
      return Promise.all([officialRow('week', wr.from, wr.to, machineId), dailyRows(wr.from, wr.to, machineId)])
        .then(function (x) { return { key: wk, off: x[0], daily: x[1] }; });
    }));
  }

  /* ---------- model ---------- */
  function avg(list, f) { var v = list.map(f).filter(function (x) { return x !== null && x !== undefined; }); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; }
  function officialOf(off, daily, field) {
    if (off && off[field] !== null && off[field] !== undefined) return Number(off[field]);
    return avg(daily, function (d) { return d[field] === null || d[field] === undefined ? null : Number(d[field]); });
  }

  function buildModel(machineId, type, key, off, events, daily, prev, monthWeeks) {
    var S = D.static(), r = D.cal.range(type, key);
    var sc = scan(events, machineId), A = sc.all;
    var mtbf = A.fails ? A.prod / A.fails : null;
    var pdtAll = A.pdt + A.clean;
    var kpi = {
      oee: officialOf(off, daily, 'oee'), avail: officialOf(off, daily, 'availability'),
      perf: officialOf(off, daily, 'performance'), tdt: officialOf(off, daily, 'tdt_pct'),
      mtbf: mtbf, updt: A.base ? A.updt / A.base : null, pdt: A.base ? pdtAll / A.base : null,
      over: A.base ? sc.overMin / A.base : null, stops: A.updtN
    };
    // previous period (from combos + daily official rows)
    var prevAgg = prev.length ? scanCombos(prev[0].combos, machineId, prev[0].from) : null;
    if (prevAgg && !prevAgg.agg.base && !prevAgg.agg.none) prevAgg = null;   // no data at all in the previous period
    var prevK = null;
    if (prevAgg) {
      var pa = prevAgg.agg, pOff = prev[0].daily;
      prevK = { oee: avg(pOff, function (d) { return Number(d.oee); }), avail: avg(pOff, function (d) { return Number(d.availability); }),
        perf: avg(pOff, function (d) { return Number(d.performance); }), tdt: avg(pOff, function (d) { return Number(d.tdt_pct); }),
        mtbf: pa.fails ? pa.prod / pa.fails : null, updt: pa.base ? pa.updt / pa.base : null,
        pdt: pa.base ? (pa.pdt + pa.clean) / pa.base : null, stops: pa.updtN };
    }
    var W = PREV_WORD[type];
    function dPts(cur, p, worseWhenUp) {
      if (cur === null || p === null || p === undefined || cur === undefined) return { t: 'אין תקופה קודמת להשוואה', s: 'color: #8a93a8;' };
      var d = (cur - p) * 100, good = worseWhenUp ? d <= 0 : d >= 0;
      return { t: (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + ' נק\' ' + W, s: 'color: ' + (good ? '#16A34A' : '#DC2626') + ';' };
    }
    function dMin(cur, p) {
      if (cur === null || p === null || p === undefined) return { t: 'אין תקופה קודמת להשוואה', s: 'color: #8a93a8;' };
      var d = Math.round(cur - p);
      return { t: (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d) + ' דק\' ' + W, s: 'color: ' + (d >= 0 ? '#16A34A' : '#DC2626') + ';' };
    }
    function dCount(cur, p) {
      if (cur === null || p === null || p === undefined) return { t: 'אין תקופה קודמת להשוואה', s: 'color: #8a93a8;' };
      var d = cur - p;
      return { t: (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d) + ' ' + W, s: 'color: ' + (d <= 0 ? '#16A34A' : '#DC2626') + ';' };
    }
    var official = !!off;
    var srcName = { day: 'יומי', week: 'שבועי', month: 'חודשי' }[type];
    var kpis = [
      { l: type === 'day' ? 'OEE' : 'OEE ' + (official ? '' : 'ממוצע'), v: pctS(kpi.oee),
        n: official ? 'מהדוח ה' + srcName + ' הרשמי' : 'ממוצע ה-OEE היומי בתקופה', d: dPts(kpi.oee, prevK && prevK.oee, false) },
      { l: 'זמינות', v: pctS(kpi.avail), n: official ? 'מהדוח הרשמי' : 'ממוצע יומי', d: dPts(kpi.avail, prevK && prevK.avail, false) },
      { l: 'יעילות (קצב)', v: pctS(kpi.perf), n: official ? 'מהדוח הרשמי' : 'ממוצע יומי', d: dPts(kpi.perf, prevK && prevK.perf, false) },
      { l: '%TDT', v: pctS(kpi.tdt), n: 'זמן עצירות מתוך זמן כולל', d: dPts(kpi.tdt, prevK && prevK.tdt, true) },
      { l: 'MTBF', v: hm(kpi.mtbf), n: 'זמן ייצור (' + hm(A.prod) + ') ÷ מס\' תקלות (' + A.fails + ')', d: dMin(kpi.mtbf, prevK && prevK.mtbf) },
      { l: 'UPDT — לא מתוכנן', v: pctS(kpi.updt), sub: hm(A.updt) + ' שעות', n: A.updtN + ' אירועים · מתוך הזמן הנספר ב-OEE (' + hm(A.base) + ')', d: dPts(kpi.updt, prevK && prevK.updt, true) },
      { l: 'PDT — מתוכנן', v: pctS(kpi.pdt), sub: hm(pdtAll) + ' שעות', n: A.pdtN + ' אירועים · שטיפות, CIP/SIP, אחזקה מונעת והמתנות מוגדרות', d: dPts(kpi.pdt, prevK && prevK.pdt, true) },
      { l: 'חריגה מזמן מטרה', v: pctS(kpi.over), sub: Math.round(sc.overMin) + ' דק\' מעל התקן',
        n: sc.overN + ' מתוך ' + sc.stdN + ' אירועים עם זמן תקן חרגו' + (sc.overTop ? ' · הגדול: ' + sc.overTop.desc + ' (' + Math.round(sc.overTop.dur) + ' מול תקן ' + sc.overTop.std + ')' : ''),
        d: { t: '', s: '' } },
      { l: 'עצירות לא מתוכננות', v: String(A.updtN), n: 'מספר אירועי UPDT ב' + TYPE_WORD[type], d: dCount(A.updtN, prevK && prevK.stops) }
    ];
    kpis.forEach(function (k) { k.hasSub = !!k.sub; k.sub = k.sub || ''; k.delta = k.d.t; k.deltaStyle = k.d.s; });

    // pareto of the period (with the change vs the previous period for week/month)
    var prevReason = prevAgg ? prevAgg.byReason : null;
    var list = Object.keys(sc.par).map(function (k) { return sc.par[k]; }).sort(function (a, b) { return b.min - a.min; });
    var lossTotal = list.reduce(function (s, p) { return s + p.min; }, 0) || 1;
    var maxP = list.length ? list[0].min : 1;
    var cum = 0;
    var pareto = list.slice(0, type === 'day' ? 12 : 14).map(function (p, i) {
      cum += p.min;
      var days = Object.keys(p.days).length;
      var o = { rank: i + 1, desc: p.desc, sub: p.group + (p.station ? ' · ' + p.station : '') + ' · ' + p.n + ' פעמים' + (type === 'day' ? '' : ' · ' + days + ' ימים'),
        min: fmtMin(p.min), cum: 'מצטבר ' + Math.round(cum / lossTotal * 100) + '%',
        fillStyle: 'width: ' + (p.min / maxP * 100).toFixed(1) + '%; background: ' + p.color + ';',
        cumStyle: 'right: calc(' + Math.min(cum / lossTotal * 100, 100).toFixed(1) + '% - 1px);' };
      if (prevReason) {
        var pv = prevReason[p.desc] ? prevReason[p.desc].min : 0;
        var diff = Math.round(p.min - pv);
        o.chg = diff > 0 ? '▲ +' + diff + ' דק\' ' + W : (diff < 0 ? '▼ ' + Math.abs(diff) + ' דק\' ' + W : 'ללא שינוי');
        o.chgStyle = diff > 0 ? 'background: #FEE2E2; color: #991B1B;' : (diff < 0 ? 'background: #DCFCE7; color: #166534;' : 'background: #E5E7EB; color: #374151;');
      } else { o.chg = ''; o.chgStyle = ''; }
      return o;
    });

    var model = { type: type, key: key, from: r.from, to: r.to, official: official, kpis: kpis, pareto: pareto,
      unclassified: A.unknown, base: A.base, agg: A, hasEvents: events.length > 0 };

    if (type === 'day') Object.assign(model, dayView(sc, machineId, key, prev));
    if (type === 'week') Object.assign(model, weekView(sc, machineId, key, prev, daily, r));
    if (type === 'month') Object.assign(model, monthView(sc, machineId, key, prev, daily, monthWeeks, r, kpi));
    return model;
  }

  function heat(v, big) {
    if (!v) return 'background: #F4F2EC; color: #C9C6B8;';
    if (v >= big) return 'background: #DC2626; color: #FFFFFF;';
    if (v >= big * 0.6) return 'background: #F87171; color: #FFFFFF;';
    if (v >= big * 0.25) return 'background: #FECACA; color: #7F1D1D;';
    return 'background: #FEE2E2; color: #7F1D1D;';
  }
  var TAG = {
    ups: ['חוזר — מועמד ל-UPS', 'background: #FEE2E2; color: #991B1B;'],
    ips: ['חד-פעמי ארוך — IPS', 'background: #FEF3C7; color: #92400E;'],
    plan: ['מתוכנן — לבדוק מול סטנדרט', 'background: #E5E7EB; color: #374151;'],
    worse: ['החמיר מול התקופה הקודמת', 'background: #FEE2E2; color: #991B1B;'],
    better: ['השתפר — לוודא שנשמר', 'background: #DCFCE7; color: #166534;'],
    stable: ['יציב — מועמד ל-UPS', 'background: #FEF3C7; color: #92400E;']
  };
  function legendOf(keys) {
    var NAMES = { prod: 'ייצור', updt: 'לא מתוכנן (UPDT)', pdt: 'מתוכנן (PDT)', clean: 'שטיפה / חיטוי', none: 'לא נספר ב-OEE', unknown: 'לא מסווג' };
    return keys.map(function (k) { return { name: NAMES[k], style: 'background: ' + COLORS[k] + ';' }; });
  }
  function shiftCards(perShift) {
    var NAMES = ['בוקר · 07:00 עד 15:00', 'ערב · 15:00 עד 23:00', 'לילה · 23:00 עד 07:00'];
    return perShift.map(function (s, i) {
      var tot = s.prod + s.updt + s.pdt + s.clean + s.unknown || 1;
      return { name: NAMES[i],
        parts: ['prod', 'updt', 'pdt', 'clean', 'unknown'].filter(function (k) { return s[k]; }).map(function (k) {
          return { style: 'width: ' + (s[k] / tot * 100).toFixed(1) + '%; background: ' + COLORS[k] + ';' };
        }),
        prodTxt: 'ייצור ' + (s.prod / tot * 100).toFixed(1) + '%', updtTxt: 'UPDT ' + (s.updt / tot * 100).toFixed(1) + '%',
        lines: [
          { l: 'זמן ייצור', v: fmtMin(s.prod) + ' (' + Math.round(s.prod / tot * 100) + '%)' },
          { l: 'לא מתוכנן (UPDT)', v: fmtMin(s.updt) },
          { l: 'מתוכנן (PDT)', v: fmtMin(s.pdt + s.clean) },
          { l: 'מספר עצירות', v: s.stops },
          { l: 'העצירה הארוכה ביותר', v: fmtMin(s.longest) }
        ] };
    });
  }

  function dayView(sc, machineId, day, prev) {
    var dayStart = new Date(day + 'T00:00:00'); dayStart.setHours(7, 0, 0, 0);
    var segs = sc.segs.map(function (s) {
      var start = (s.start - dayStart) / 60000; if (start < 0) start += 1440;
      return { start: start, style: 'right: ' + (start / 1440 * 100).toFixed(3) + '%; width: ' + Math.max(s.min / 1440 * 100, 0.12).toFixed(3) + '%; background: ' + s.color + ';', title: s.label };
    });
    var ticks = [];
    for (var h = 0; h <= 24; h += 2) ticks.push({ label: pad((7 + h) % 24) + ':00', style: 'right: ' + (h / 24 * 100).toFixed(2) + '%;' });
    // recurring over the last 7 production days
    var days = prev.map(function (p) { return p.key; }).concat([day]).sort();
    var byKey = {};
    prev.concat([{ key: day, combos: null }]).forEach(function (p) {
      var rows = p.combos;
      if (!rows) { // current day: from the scanned events
        Object.keys(sc.par).forEach(function (k) {
          var x = sc.par[k], key = x.desc;
          var e = byKey[key] = byKey[key] || { desc: x.desc, group: x.group, per: {}, tot: 0, n: 0, updt: x.color === COLORS.updt };
          e.per[day] = (e.per[day] || 0) + x.min; e.tot += x.min; e.n += x.n;
        });
        return;
      }
      var s = scanCombos(rows, machineId, p.key);
      Object.keys(s.byReason).forEach(function (k) {
        var x = s.byReason[k];
        var e = byKey[k] = byKey[k] || { desc: x.desc, group: x.group, per: {}, tot: 0, n: 0, updt: x.updt };
        e.per[p.key] = (e.per[p.key] || 0) + x.min; e.tot += x.min; e.n += x.n;
      });
    });
    var recurring = Object.keys(byKey).map(function (k) { return byKey[k]; }).sort(function (a, b) { return b.tot - a.tot; }).slice(0, 12)
      .map(function (k) {
        var nd = days.filter(function (d) { return k.per[d]; }).length;
        var tag = !k.updt ? 'plan' : (nd >= 4 ? 'ups' : (k.tot >= 60 ? 'ips' : 'plan'));
        return { desc: k.desc, sub: k.group + ' · ' + k.n + ' פעמים',
          cells: days.map(function (d) { var v = Math.round(k.per[d] || 0); return { v: v || '·', style: heat(v, 60) }; }),
          tot: fmtMin(k.tot), tag: TAG[tag][0] + (tag === 'ups' ? ' (' + nd + '/' + days.length + ')' : ''), tagStyle: TAG[tag][1] };
      });
    return { segs: segs, ticks: ticks, legend: legendOf(['prod', 'updt', 'pdt', 'clean', 'none', 'unknown']),
      shifts: shiftCards(sc.perShift), days: days.map(fmtDM), recurring: recurring,
      longEvents: sc.longs.sort(function (a, b) { return a.at - b.at; }) };
  }

  function weekView(sc, machineId, key, prev, daily, range) {
    var TARGET = targetOf(machineId, range.to);
    // 4-week trend (this week + the 3 before), from the daily official rows
    var trend = prev.slice().reverse().concat([{ key: key, daily: daily }]).map(function (p) {
      return { key: p.key, val: avg(p.daily, function (d) { return Number(d.oee) * 100; }) };
    }).filter(function (t, i, arr) { return t.val !== null || i === arr.length - 1; });   // weeks with no data at all are left out
    var weeks = trend.map(function (t, i) {
      var prevVal = i ? trend[i - 1].val : null;
      var d = (t.val !== null && prevVal !== null) ? t.val - prevVal : null;
      return { name: D.cal.label('week', t.key), val: t.val === null ? '—' : t.val.toFixed(1) + '%',
        barStyle: 'height: ' + ((t.val || 0) / 100 * 150).toFixed(0) + 'px; background: ' + ((t.val || 0) >= TARGET ? '#16A34A' : '#DC2626') + ';' + (i === trend.length - 1 ? '' : ' opacity: 0.6;'),
        targetStyle: 'bottom: ' + (TARGET / 100 * 150).toFixed(0) + 'px;',
        delta: d === null ? '' : (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + ' נק\'',
        deltaStyle: d === null ? '' : 'color: ' + (d >= 0 ? '#16A34A' : '#DC2626') + ';' };
    });
    var cur = trend[trend.length - 1].val, prv = trend[trend.length - 2] ? trend[trend.length - 2].val : null;
    var trendNote = cur === null ? 'אין עדיין נתונים לשבוע הזה.'
      : 'ממוצע ה-OEE השבוע: ' + cur.toFixed(1) + '%' + (prv !== null ? ' — ' + (cur >= prv ? 'עלייה' : 'ירידה') + ' של ' + Math.abs(cur - prv).toFixed(1) + ' נקודות מול השבוע הקודם' : '') + '. היעד: ' + TARGET + '%.';

    // days of the week: official OEE + the split of the day
    var offByDay = {};
    daily.forEach(function (d) { offByDay[d.period_from] = Number(d.oee) * 100; });
    var dayKeys = [];
    for (var i = 0; i < 7; i++) dayKeys.push(D.cal.step('day', range.from, i));
    var below = 0, vals = [];
    var days = dayKeys.map(function (dk) {
      var a = sc.perDay[dk] || emptyAgg(), o = offByDay[dk];
      if (o !== undefined) { vals.push(o); if (o < TARGET) below++; }
      return { name: WEEKDAYS[new Date(dk + 'T12:00:00').getDay()] + ' ' + fmtDM(dk),
        oee: o === undefined ? '—' : o.toFixed(1) + '%', oeeStyle: 'color: ' + (o === undefined ? '#8A8776' : (o >= TARGET ? '#16A34A' : '#DC2626')) + ';',
        parts: ['prod', 'updt', 'pdt', 'clean', 'unknown', 'none'].filter(function (k) { return a[k]; }).map(function (k) {
          return { style: 'height: ' + (a[k] / 1440 * 170).toFixed(1) + 'px; background: ' + COLORS[k] + ';' };
        }) };
    });
    var stabilityNote = vals.length ? 'טווח ה-OEE בשבוע: ' + Math.min.apply(null, vals).toFixed(1) + '% עד ' + Math.max.apply(null, vals).toFixed(1) +
      '% — פער של ' + (Math.max.apply(null, vals) - Math.min.apply(null, vals)).toFixed(1) + ' נקודות. ' + below + ' מתוך ' + vals.length + ' ימים מתחת ליעד.' : 'אין דוחות יומיים לשבוע הזה.';

    // recurring across the 4 weeks
    var cols = prev.slice().reverse().concat([{ key: key }]);
    var byKey = {};
    prev.forEach(function (p) {
      var s = scanCombos(p.combos, machineId, p.from);
      Object.keys(s.byReason).forEach(function (k) {
        var x = s.byReason[k];
        var e = byKey[k] = byKey[k] || { desc: x.desc, group: x.group, per: {}, tot: 0, updt: x.updt };
        e.per[p.key] = (e.per[p.key] || 0) + x.min; e.tot += x.min;
      });
    });
    Object.keys(sc.par).forEach(function (k) {
      var x = sc.par[k];
      var e = byKey[x.desc] = byKey[x.desc] || { desc: x.desc, group: x.group, per: {}, tot: 0, updt: x.color === COLORS.updt };
      e.per[key] = (e.per[key] || 0) + x.min; e.tot += x.min;
    });
    var recurring = Object.keys(byKey).map(function (k) { return byKey[k]; }).sort(function (a, b) { return b.tot - a.tot; }).slice(0, 12)
      .map(function (k) {
        var last = k.per[key] || 0, before = k.per[cols[cols.length - 2] ? cols[cols.length - 2].key : ''] || 0;
        var rel = before ? (last - before) / before : (last ? 1 : 0);
        var tag = rel > 0.25 ? 'worse' : (rel < -0.25 ? 'better' : 'stable');
        return { desc: k.desc, sub: k.group, cells: cols.map(function (c) { var v = Math.round(k.per[c.key] || 0); return { v: v || '·', style: heat(v, 250) }; }),
          tot: fmtMin(k.tot), tag: TAG[tag][0], tagStyle: TAG[tag][1] };
      });

    var sh = shiftCards(sc.perShift);
    var prods = sh.map(function (s) { return parseFloat(s.prodTxt.replace(/[^\d.]/g, '')); });
    var shiftNote = 'הפער בין המשמרות השבוע: ' + Math.min.apply(null, prods).toFixed(1) + '% עד ' + Math.max.apply(null, prods).toFixed(1) +
      '% זמן ייצור — ' + (Math.max.apply(null, prods) - Math.min.apply(null, prods)).toFixed(1) + ' נקודות.';
    return { weeks: weeks, trendNote: trendNote, days: days, legend: legendOf(['prod', 'updt', 'pdt', 'clean', 'unknown', 'none']),
      stabilityNote: stabilityNote, weekCols: cols.map(function (c) { return D.cal.label('week', c.key).split(' | ')[0]; }),
      recurring: recurring, shifts: sh, shiftNote: shiftNote };
  }

  function targetOf(machineId, day) {
    var S = D.static(), best = null;
    (S.targets || []).forEach(function (t) {
      if (t.machine_id === machineId && t.valid_from <= day && (!t.valid_to || t.valid_to >= day) && (!best || t.valid_from > best.valid_from)) best = t;
    });
    return best ? Number(best.oee_target) : 60;
  }

  function monthView(sc, machineId, key, prev, daily, monthWeeks, range, kpi) {
    var TARGET = targetOf(machineId, range.to);
    var weeks = monthWeeks.map(function (w, i) {
      var val = w.off ? Number(w.off.oee) * 100 : avg(w.daily, function (d) { return Number(d.oee) * 100; });
      return { key: w.key, val: val };
    }).filter(function (w) { return w.val !== null; });
    var weeksOut = weeks.map(function (w, i) {
      var d = i ? w.val - weeks[i - 1].val : null;
      return { name: D.cal.label('week', w.key), val: w.val.toFixed(1) + '%',
        barStyle: 'height: ' + (w.val / 100 * 150).toFixed(0) + 'px; background: ' + (w.val >= TARGET ? '#16A34A' : '#DC2626') + ';' + (i === weeks.length - 1 ? '' : ' opacity: 0.6;'),
        targetStyle: 'bottom: ' + (TARGET / 100 * 150).toFixed(0) + 'px;',
        delta: d === null ? '' : (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + ' נק\'',
        deltaStyle: d === null ? '' : 'color: ' + (d >= 0 ? '#16A34A' : '#DC2626') + ';' };
    });
    var belowW = weeks.filter(function (w) { return w.val < TARGET; }).length;
    var trendNote = weeks.length ? belowW + ' מתוך ' + weeks.length + ' שבועות בחודש היו מתחת ליעד ' + TARGET + '%.' : 'אין נתונים שבועיים לחודש הזה.';

    var A = sc.all, base = A.base || 1;
    var rate = (kpi.perf !== null && kpi.perf !== undefined) ? A.prod * (1 - kpi.perf) : 0;
    var steps = [
      { name: 'זמן שנספר ב-OEE', sub: 'כל הזמן שנכנס לחישוב', min: base, kind: 'total', color: '#1c2b45' },
      { name: 'לא מתוכנן (UPDT)', sub: 'תקלות והמתנות לא מתוכננות · ' + A.updtN + ' אירועים', min: A.updt, color: COLORS.updt },
      { name: 'מתוכנן (PDT)', sub: 'CIP/SIP, אחזקה מונעת, שטיפות · ' + A.pdtN + ' אירועים', min: A.pdt + A.clean, color: COLORS.pdt },
      { name: 'איבוד קצב', sub: 'יעילות ' + pctS(kpi.perf) + ' — ייצור מתחת לקצב המטרה', min: rate, color: COLORS.rate },
      { name: 'זמן ייצור אפקטיבי', sub: 'מה שנשאר', min: base - A.updt - A.pdt - A.clean - rate, kind: 'result', color: COLORS.prod }
    ];
    var left = base;
    var waterfall = steps.map(function (s) {
      var start, width;
      if (s.kind === 'total') { start = 0; width = base; }
      else if (s.kind === 'result') { start = 0; width = s.min; }
      else { left -= s.min; start = left; width = s.min; }
      return { name: s.name, sub: s.sub, val: fmtMin(s.min), pct: s.kind === 'total' ? '' : (s.min / base * 100).toFixed(1) + '%',
        barStyle: 'right: ' + (start / base * 100).toFixed(2) + '%; width: ' + Math.max(width / base * 100, 0.4).toFixed(2) + '%; background: ' + s.color + ';' };
    });
    var wfNote = 'מחוץ לבסיס: ' + hm(A.none) + ' שעות של "ללא פק\'ע" — זמן שהקו לא תוכנן לייצור' +
      (A.unknown ? ' — ועוד ' + hm(A.unknown) + ' שעות של אירועים בלי כלל סיווג, שגם הם לא נספרים' : '') + '.';

    // action candidates
    var actions = Object.keys(sc.par).map(function (k) { return sc.par[k]; }).sort(function (a, b) { return b.min - a.min; }).slice(0, 10)
      .map(function (p) {
        var days = Object.keys(p.days).length;
        var planned = p.color === COLORS.pdt || p.color === COLORS.clean;
        var tag = planned ? 'std' : (days >= 5 ? 'ups' : 'ips');
        var TAGS = { ups: ['UPS — פתרון בעיות מעמיק', 'background: #FEE2E2; color: #991B1B;'],
          ips: ['IPS — תחקיר אירוע', 'background: #FEF3C7; color: #92400E;'],
          std: ['לבחון את הסטנדרט', 'background: #E5E7EB; color: #374151;'] };
        return { desc: p.desc, sub: p.group + (p.station ? ' · ' + p.station : '') + ' · ' + p.n + ' פעמים',
          min: fmtMin(p.min), days: days + ' ימים', pot: '+' + (p.min / base * 100).toFixed(1) + ' נק\'',
          tag: TAGS[tag][0], tagStyle: TAGS[tag][1] };
      });

    // day-of-week pattern
    var byDow = [[], [], [], [], [], [], []];
    daily.forEach(function (d) { byDow[new Date(d.period_from + 'T12:00:00').getDay()].push(Number(d.oee) * 100); });
    var dow = byDow.map(function (v, i) {
      var a = v.length ? v.reduce(function (x, y) { return x + y; }, 0) / v.length : null;
      return { name: WEEKDAYS[i], val: a === null ? '—' : a.toFixed(1) + '%', raw: a,
        barStyle: 'height: ' + ((a || 0) / 100 * 130).toFixed(0) + 'px; background: ' + ((a || 0) >= TARGET ? '#16A34A' : '#DC2626') + ';',
        targetStyle: 'bottom: ' + (TARGET / 100 * 130).toFixed(0) + 'px;' };
    });
    var withVals = dow.filter(function (d) { return d.raw !== null; });
    var worst = withVals.slice().sort(function (a, b) { return a.raw - b.raw; })[0];
    var best = withVals.slice().sort(function (a, b) { return b.raw - a.raw; })[0];
    var dowNote = worst && best ? 'היום החלש בחודש: ' + worst.name + ' (' + worst.val + '), והחזק: ' + best.name + ' (' + best.val +
      '). דפוס קבוע מצביע על סיבה מערכתית — סידור עבודה, שטיפות או תחילת ריצה — ולא על תקלה מקרית.' : '';

    var daysInMonth = D.cal.days('month', key);
    var dq = [
      { l: 'זמן לא מסווג', v: hm(A.unknown) + ' שעות', n: 'אירועים שאין להם כלל סיווג · ' + (A.unknown / base * 100).toFixed(1) + '% מהזמן הנספר — לא נכנסים ל-PDT או ל-UPDT',
        style: A.unknown ? 'color: #D97706;' : 'color: #166534;' },
      { l: 'אירועים שחרגו מזמן תקן', v: String(sc.overN), n: 'מתוך ' + sc.stdN + ' אירועים עם זמן תקן מוגדר · ' + hm(sc.overMin) + ' שעות מעבר לתקן', style: '' },
      { l: 'ימים עם נתונים', v: Object.keys(sc.perDay).length + ' מתוך ' + daysInMonth, n: 'דוחות יומיים שהועלו לחודש · ככל שחסרים פחות ימים, הניתוח מדויק יותר', style: '' }
    ];
    return { weeks: weeksOut, trendNote: trendNote, waterfall: waterfall, wfNote: wfNote, actions: actions, dow: dow, dowNote: dowNote, dq: dq };
  }

  /* ---------- the screen ---------- */
  function PLComponent(props) { window.DCLogic.call(this, props); this.state = { machineId: null, period: 'day', keys: {}, model: null, loading: true, error: null, empty: false }; }
  PLComponent.prototype = Object.create(window.DCLogic.prototype);
  PLComponent.prototype.constructor = PLComponent;
  var LS = 'oee_pl_machine_v1', LS_P = 'oee_pl_period_v1';

  PLComponent.prototype.start = function () {
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
  PLComponent.prototype.load = function () {
    var self = this, mid = this.state.machineId, t = this.state.period, k = this.state.keys[t];
    this.setState({ loading: true, error: null });
    return load(mid, t, k).then(function (model) {
      if (self.state.machineId === mid && self.state.period === t && self.state.keys[t] === k) self.setState({ model: model, loading: false });
    }).catch(function (e) { self.setState({ loading: false, error: e.message || String(e) }); });
  };
  PLComponent.prototype.pickMachine = function (id) {
    var self = this;
    return function () {
      if (self.state.machineId === id) return;
      self.state.machineId = id;
      try { localStorage.setItem(LS, String(id)); } catch (e) { /* private mode */ }
      self.load();
    };
  };
  PLComponent.prototype.pickPeriod = function (p) {
    var self = this;
    return function () {
      if (self.state.period === p) return;
      self.state.period = p;
      try { localStorage.setItem(LS_P, p); } catch (e) { /* private mode */ }
      self.load();
    };
  };
  PLComponent.prototype.step = function (dir) {
    var self = this;
    return function () {
      var t = self.state.period, list = D.index()[t], i = list.indexOf(self.state.keys[t]) + dir;
      if (i < 0 || i >= list.length) return;
      self.state.keys[t] = list[i];
      self.load();
    };
  };

  PLComponent.prototype.renderVals = function () {
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
      srcNote: { day: 'המספרים הרשמיים מגיעים מדוח ה-OEE היומי; פירוק ההפסדים מחושב מאירועי ה-RAW לפי כללי הסיווג',
        week: 'שבוע ייצור שבת–שישי, מספור לפי Date_Dim. פירוק ההפסדים מחושב מאירועי ה-RAW של השבוע',
        month: 'חודש קלנדרי. אם הועלה דוח חודשי רשמי — הוא המקור למספרים הרשמיים; אחרת מוצג ממוצע הימים' }[t]
    };
    var EMPTY = { kpis: [], pareto: [], days: [], recurring: [], shifts: [], ticks: [], legend: [], segs: [], longEvents: [],
      weeks: [], weekCols: [], waterfall: [], actions: [], dow: [], dq: [], trendNote: '', stabilityNote: '', shiftNote: '', wfNote: '' };
    if (!M) {
      var msg = st.empty ? 'עדיין לא הועלו דוחות' : (st.error ? 'שגיאה בטעינה: ' + st.error : 'טוען נתונים…');
      return Object.assign(base, EMPTY, { showBanner: true, bannerText: msg, srcLabel: st.empty ? 'אין נתונים' : 'טוען…', srcStyle: 'background: #F0EFEA; color: #5B594F;' });
    }
    var note = M.unclassified ? (Math.round(M.unclassified) + ' דקות ב' + TYPE_WORD[t] + ' הזה הן אירועים בלי כלל סיווג — הם לא נספרים ב-PDT/UPDT') : '';
    var srcLabel = st.loading ? 'טוען…' : (M.official ? 'רשמי · דוח ' + { day: 'יומי', week: 'שבועי', month: 'חודשי' }[t] + ' מה-MES'
      : (t === 'day' ? 'אין שורה למכונה בדוח ה-OEE' : 'מחושב מהדוחות היומיים'));
    return Object.assign(base, EMPTY, M, {
      showBanner: !!note, bannerText: note, srcLabel: srcLabel,
      srcStyle: M.official ? 'background: #DCFCE7; color: #166534;' : 'background: #FEF3C7; color: #92400E;'
    });
  };

  window.OEE_PL = { Component: PLComponent, load: load, clearCache: function () { CACHE = {}; } };
})();
