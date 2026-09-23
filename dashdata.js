/* Dashboard data layer: reads the uploaded MES data from Supabase for the selected period
 * (day / Sat–Fri week / calendar month) and turns it into the numbers the "מנהל ייצור" screen shows.
 *   - official numbers come from the OEE report of that layer (DAY / WEEK / MONTH are never mixed)
 *   - a week or month whose official report was not uploaded yet is computed from the daily layer
 *     with the master-file formula (engine.js); the official report replaces it once uploaded
 *   - the computed value is always shown next to the official one, with the gap, as a reliability check */
(function () {
  'use strict';
  var API = window.OEE_API;
  var ENG = window.OEE_ENGINE;

  // ---------- calendar (Date_Dim rules: production day 07:00–07:00, week Saturday → Friday) ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function parseIso(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function toIso(d) { return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function addDays(s, n) { var d = parseIso(s); d.setUTCDate(d.getUTCDate() + n); return toIso(d); }
  function daysBetween(a, b) { return Math.round((parseIso(b) - parseIso(a)) / 86400000); }
  function fmt(s) { var p = s.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function fmtShort(s) { var p = s.split('-'); return p[2] + '/' + p[1]; }
  var MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  function weekStart(s) { var d = parseIso(s); return addDays(s, -((d.getUTCDay() + 1) % 7)); }
  function weekLabel(s) {
    var ws = weekStart(s), we = addDays(ws, 6);
    var wy = parseIso(we).getUTCFullYear();
    var wn = Math.floor(daysBetween(weekStart(iso(wy, 1, 1)), ws) / 7) + 1;
    return wy + '-W' + pad(wn) + ' | ' + fmtShort(ws) + '–' + fmtShort(we);
  }
  function monthStart(s) { return s.slice(0, 8) + '01'; }
  function monthEnd(s) { var p = s.split('-'); return toIso(new Date(Date.UTC(+p[0], +p[1], 0))); }
  function addMonths(s, n) { var p = s.split('-'); return toIso(new Date(Date.UTC(+p[0], +p[1] - 1 + n, 1))); }

  var CAL = {
    range: function (type, key) {
      if (type === 'day') return { from: key, to: key };
      if (type === 'week') return { from: key, to: addDays(key, 6) };
      return { from: key, to: monthEnd(key) };
    },
    keyOf: function (type, day) { return type === 'day' ? day : type === 'week' ? weekStart(day) : monthStart(day); },
    step: function (type, key, n) { return type === 'day' ? addDays(key, n) : type === 'week' ? addDays(key, 7 * n) : addMonths(key, n); },
    label: function (type, key) {
      if (type === 'day') return fmt(key) + ' · ' + WEEKDAYS[parseIso(key).getUTCDay()] + ' · 07:00–07:00';
      if (type === 'week') return weekLabel(key);
      var p = key.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0];
    },
    days: function (type, key) { var r = CAL.range(type, key); return daysBetween(r.from, r.to) + 1; }
  };
  var LAYER = { day: 'DAY', week: 'WEEK', month: 'MONTH' };

  // ---------- fetch helpers ----------
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
    (rows || []).forEach(function (r) {
      if (r.valid_from <= day && (!r.valid_to || r.valid_to >= day) && (!best || r.valid_from > best.valid_from)) best = r;
    });
    return best;
  }

  var STATIC = null, INDEX = null, CACHE = {};

  function loadStatic() {
    return Promise.all([
      API.select('machines?select=id,name,department_id,sort_order,is_active&order=sort_order'),
      API.select('departments?select=id,name,color,sort_order&order=sort_order'),
      API.select('machine_oee_targets?select=machine_id,oee_target,valid_from,valid_to'),
      API.select('machine_weights?select=machine_id,plant_weight,department_weight,valid_from,valid_to'),
      API.select('classification_rules?select=*'),
      selectAll('product_target_rates?select=machine_id,sku,target_rate,valid_from,valid_to'),
      selectAll('products?select=sku,product_name,unit')
    ]).then(function (r) {
      var products = {};
      r[6].forEach(function (p) { products[p.sku] = p; });
      STATIC = { machines: r[0].filter(function (m) { return m.is_active; }), depts: r[1], targets: r[2], weights: r[3],
        rules: ENG.prepareRules(r[4]), rates: r[5], products: products };
      return STATIC;
    });
  }

  // which periods have data: official uploads per layer + weeks/months covered by daily uploads
  function loadIndex() {
    return selectAll('uploads?select=id,period_type,report_type,period_from,period_to&status=eq.OK').then(function (ups) {
      var idx = { day: {}, week: {}, month: {}, official: {} };
      ups.forEach(function (u) {
        var k = u.period_type + '|' + u.period_from + '|' + u.period_to;
        idx.official[k] = idx.official[k] || {};
        idx.official[k][u.report_type] = u.id;
        if (u.period_type === 'DAY') {
          idx.day[u.period_from] = true;
          idx.week[weekStart(u.period_from)] = true;
          idx.month[monthStart(u.period_from)] = true;
        } else if (u.period_type === 'WEEK') idx.week[u.period_from] = true;
        else if (u.period_type === 'MONTH') idx.month[u.period_from] = true;
      });
      ['day', 'week', 'month'].forEach(function (t) { idx[t] = Object.keys(idx[t]).sort(); });
      INDEX = idx;
      return idx;
    });
  }
  function officialOf(type, key) {
    var r = CAL.range(type, key);
    var o = INDEX.official[LAYER[type] + '|' + r.from + '|' + r.to];
    return o && o.OEE && o.RAW ? o : null;
  }
  function officialRawOf(type, key) {
    if (type === 'day') return null;
    var r = CAL.range(type, key);
    var o = INDEX.official[LAYER[type] + '|' + r.from + '|' + r.to];
    return o && o.RAW ? o.RAW : null;
  }

  var RAW_COLS = 'machine_id,production_date,status,stop_group,station,description,sku,duration_min,output_qty,output_uom';
  var OEE_COLS = 'entity_level,entity_name,machine_id,period_from,period_to,oee,availability,performance,quality,tdt_pct,sap_good_units,net_minutes';

  // ---------- the numbers for one period ----------
  var PROD_STATUSES = ['ייצור', 'ייצור ללא פק"ע'];
  var NO_STATION = '(ללא תחנה)';
  function pct(v) { return v === null || v === undefined ? null : Number(v) * 100; }

  function isFailure(e, machineId) {
    var r = ENG.classify(e, STATIC.rules, machineId, e.production_date);
    if (r) return !!r.counts_as_failure;
    return e.status === 'עצירת השבתה' && e.stop_group === 'תקלה';
  }

  // MTBF inputs from aggregated combos (production minutes, failure count)
  function mtbfFromCombos(combos, day, onlyIds) {
    var per = {};
    combos.forEach(function (c) {
      if (onlyIds && onlyIds.indexOf(c.machine_id) < 0) return;
      var m = per[c.machine_id] = per[c.machine_id] || { prod: 0, fails: 0 };
      if (PROD_STATUSES.indexOf(c.status) >= 0) m.prod += Number(c.minutes) || 0;
      var ev = { status: c.status, stop_group: c.stop_group, description: c.description, production_date: day };
      if (isFailure(ev, c.machine_id)) m.fails += c.n;
    });
    var prod = 0, fails = 0;
    Object.keys(per).forEach(function (k) { prod += per[k].prod; fails += per[k].fails; });
    return { prod: prod, fails: fails, mtbf: fails ? prod / fails : null };
  }

  function weightedOee(list, wKey) {
    // master formula: each component weighted by the machine weight, then multiplied
    var w = 0, a = 0, p = 0, q = 0;
    list.forEach(function (x) { w += x[wKey]; a += x[wKey] * x.calc.availability; p += x[wKey] * x.calc.performance; q += x[wKey] * x.calc.quality; });
    return w ? (a / w) * (p / w) * (q / w) * 100 : null;
  }

  // dept = a department name for the Line Lead view (same screen, scoped to one department; weights = weight within the department)
  function buildModel(type, key, offRows, events, dailyRows, official, dept) {
    var S = STATIC, r = CAL.range(type, key), day = r.to;   // targets & weights valid at the end of the period
    var deptById = {};
    S.depts.forEach(function (d) { deptById[d.id] = d; });
    var offBy = {};
    offRows.forEach(function (o) { offBy[o.entity_name] = o; });
    // computed mode: sum the daily official SAP per entity (a sum is valid for good units)
    var sapSum = {}, daysWithData = {};
    dailyRows.forEach(function (o) {
      sapSum[o.entity_name] = (sapSum[o.entity_name] || 0) + (Number(o.sap_good_units) || 0);
      daysWithData[o.period_from] = true;
    });
    var byMachine = {};
    events.forEach(function (e) { (byMachine[e.machine_id] = byMachine[e.machine_id] || []).push(e); });

    var deptObj = dept ? S.depts.filter(function (d) { return d.name === dept; })[0] : null;
    var machines = S.machines.filter(function (m) { return !deptObj || m.department_id === deptObj.id; }).map(function (m) {
      var ev = byMachine[m.id] || [];
      var off = offBy[m.name] || null;
      var t = validOn(S.targets.filter(function (x) { return x.machine_id === m.id; }), day);
      var w = validOn(S.weights.filter(function (x) { return x.machine_id === m.id; }), day);
      var sap = official ? (off ? Number(off.sap_good_units) || 0 : 0) : (sapSum[m.name] || 0);
      var calc = ENG.computeMachine(ev, S.rules, S.rates, m.id, (official ? off : sapSum[m.name] !== undefined) ? sap : null);
      var prod = 0, fails = 0, stations = {}, descs = {}, skus = {};
      ev.forEach(function (e) {
        var d = Number(e.duration_min) || 0;
        if (PROD_STATUSES.indexOf(e.status) >= 0) prod += d;
        if (isFailure(e, m.id)) {
          fails++;
          var st = e.station || NO_STATION;
          var sn = stations[st] = stations[st] || { station: st, min: 0, count: 0 };
          sn.min += d; sn.count++;
          var dk = e.description || e.stop_group || 'ללא תיאור';
          var dn = descs[dk] = descs[dk] || { desc: dk, count: 0, min: 0, st: {} };
          dn.count++; dn.min += d; dn.st[st] = (dn.st[st] || 0) + 1;
        }
        if (e.status === 'ייצור' && e.sku && Number(e.output_qty) > 0) {
          var p = S.products[e.sku];
          var sk = skus[e.sku] = skus[e.sku] || { sku: e.sku, desc: p ? p.product_name : '', qty: 0, unit: e.output_uom || (p && p.unit) || '' };
          sk.qty += Number(e.output_qty);
        }
      });
      var oeeOff = off ? pct(off.oee) : null, tdtOff = off ? pct(off.tdt_pct) : null;
      var oee = official ? oeeOff : pct(calc.oee);
      var tdt = official ? tdtOff : pct(calc.tdt);
      return {
        id: m.id, name: m.name, dept: deptById[m.department_id] ? deptById[m.department_id].name : '', deptId: m.department_id,
        oee: oee, oeeTarget: t ? Number(t.oee_target) : 0, weight: w ? Number(dept ? w.department_weight : w.plant_weight) : 0, deptWeight: w ? Number(w.department_weight) : 0,
        output: sap, tdt: tdt, oeeOff: oeeOff, tdtOff: tdtOff, oeeCalc: pct(calc.oee), tdtCalc: pct(calc.tdt), calc: calc,
        prodMin: prod, fails: fails, mtbfMin: fails ? prod / fails : null, hasEvents: ev.length > 0,
        stations: Object.keys(stations).map(function (k) { return stations[k]; }),
        faults: Object.keys(descs).map(function (k) {
          var dn = descs[k], top = Object.keys(dn.st).sort(function (a, b) { return dn.st[b] - dn.st[a]; })[0];
          return { desc: dn.desc, station: top, count: dn.count, min: dn.min };
        }),
        skus: Object.keys(skus).map(function (k) { return skus[k]; })
      };
    });
    var totalOut = machines.reduce(function (s, m) { return s + m.output; }, 0);
    machines.forEach(function (m) {
      m.outputShare = totalOut ? m.output / totalOut * 100 : 0;
      m.contribution = m.oee === null ? null : m.weight * m.oee / 100;
    });

    function calcGroup(list, wKey) {
      var ok = list.filter(function (m) { return m.calc.oee !== null && m[wKey] > 0; });
      var wAll = list.reduce(function (s, m) { return s + m[wKey]; }, 0);
      var wOk = ok.reduce(function (s, m) { return s + m[wKey]; }, 0);
      var tdtOk = list.every(function (m) { return !m.hasEvents || m.calc.tdt !== null; });
      var base = 0, tdtMin = 0;
      list.forEach(function (m) { if (m.calc.tdt !== null) { base += m.calc.base; tdtMin += m.calc.tdt * m.calc.base; } });
      return {
        oee: ok.length ? weightedOee(ok, wKey) : null,
        partial: ok.length > 0 && ok.length < list.filter(function (m) { return m[wKey] > 0; }).length,
        names: ok.map(function (m) { return m.name; }), share: wAll ? wOk / wAll * 100 : 0,
        tdt: tdtOk && base > 0 ? tdtMin / base * 100 : null
      };
    }

    var depts = S.depts.filter(function (d) { return !deptObj || d.id === deptObj.id; }).map(function (d) {
      var list = machines.filter(function (m) { return m.deptId === d.id; });
      var off = offBy[d.name] || null;
      var prod = list.reduce(function (s, m) { return s + m.prodMin; }, 0), fails = list.reduce(function (s, m) { return s + m.fails; }, 0);
      var c = calcGroup(list, 'deptWeight');
      return {
        id: d.id, name: d.name, color: d.color, machines: list,
        oee: official ? (off ? pct(off.oee) : null) : c.oee, tdt: official ? (off ? pct(off.tdt_pct) : null) : c.tdt,
        output: official ? (off ? Number(off.sap_good_units) || 0 : 0) : (sapSum[d.name] || 0),
        prodMin: prod, fails: fails, mtbfMin: fails ? prod / fails : null, calc: c
      };
    });

    var isTop = function (o) { return dept ? o.entity_name === dept : o.entity_level === 'PLANT'; };
    var plantOff = offRows.filter(isTop)[0] || null;
    var dailyPlantSap = 0;
    dailyRows.forEach(function (o) { if (isTop(o)) dailyPlantSap += Number(o.sap_good_units) || 0; });
    var pc = calcGroup(machines, 'weight');
    var prodAll = machines.reduce(function (s, m) { return s + m.prodMin; }, 0), failsAll = machines.reduce(function (s, m) { return s + m.fails; }, 0);
    var unclassified = machines.reduce(function (s, m) { return s + m.calc.unclassified; }, 0);
    var missingRates = machines.filter(function (m) { return m.calc.missingRateSkus.length; }).map(function (m) { return m.name; });
    return {
      type: type, key: key, from: r.from, to: r.to, official: official,
      daysUploaded: official ? CAL.days(type, key) : Object.keys(daysWithData).length, daysTotal: CAL.days(type, key),
      machines: machines, depts: depts,
      plant: {
        oeeOff: plantOff ? pct(plantOff.oee) : null, tdtOff: plantOff ? pct(plantOff.tdt_pct) : null,
        oee: official ? (plantOff ? pct(plantOff.oee) : null) : pc.oee,
        tdt: official ? (plantOff ? pct(plantOff.tdt_pct) : null) : pc.tdt,
        output: official ? (plantOff ? Number(plantOff.sap_good_units) || 0 : null) : (dailyPlantSap || null),
        calc: pc, prodMin: prodAll, fails: failsAll, mtbfMin: failsAll ? prodAll / failsAll : null
      },
      dq: { unclassified: unclassified, missingRates: missingRates },
      // official report exported with an entity filter: machines that produced but have no official row, or no plant row
      offMissing: official ? machines.filter(function (m) { return m.prodMin > 0 && !offBy[m.name]; }).map(function (m) { return m.name; }) : [],
      plantMissing: official ? !plantOff : dailyRows.length > 0 && !dailyRows.some(isTop)
    };
  }

  function loadPeriod(type, key, dept) {
    var ck = type + '|' + key + '|' + (dept || '');
    if (CACHE[ck]) return Promise.resolve(CACHE[ck]);
    var r = CAL.range(type, key), off = officialOf(type, key), L = LAYER[type];
    var jobs;
    if (off) {
      jobs = [
        selectAll('oee_report_rows?select=' + OEE_COLS + '&upload_id=eq.' + off.OEE),
        selectAll('raw_events?select=' + RAW_COLS + '&upload_id=eq.' + off.RAW + '&machine_id=not.is.null'),
        Promise.resolve([])
      ];
    } else {
      jobs = [
        Promise.resolve([]),
        selectAll('raw_events?select=' + RAW_COLS + '&period_type=eq.DAY&production_date=gte.' + r.from + '&production_date=lte.' + r.to + '&machine_id=not.is.null'),
        selectAll('oee_report_rows?select=' + OEE_COLS + '&period_type=eq.DAY&period_from=gte.' + r.from + '&period_from=lte.' + r.to)
      ];
    }
    return Promise.all(jobs).then(function (x) {
      var model = buildModel(type, key, x[0], x[1], x[2], !!off, dept);
      var ids = dept ? model.machines.map(function (m) { return m.id; }) : null;
      return loadHistory(type, key, dept, ids).then(function (h) { model.history = h; CACHE[ck] = model; return model; });
    });
  }

  // previous period + average of the last N periods of the same kind (official plant numbers; MTBF from the daily events)
  var HIST_N = { day: 7, week: 4, month: 3 };
  function loadHistory(type, key, dept, ids) {
    var keys = [];
    for (var i = 1; i <= HIST_N[type]; i++) keys.push(CAL.step(type, key, -i));
    var L = LAYER[type];
    return Promise.all([
      selectAll('oee_report_rows?select=period_from,period_to,oee,tdt_pct,sap_good_units' + (dept ? '&entity_name=eq.' + encodeURIComponent(dept) : '&entity_level=eq.PLANT') + '&period_type=eq.' + L +
        '&period_from=gte.' + keys[keys.length - 1] + '&period_from=lt.' + key),
      Promise.all(keys.map(function (k) {
        var r = CAL.range(type, k);
        var rawId = officialRawOf(type, k);
        var has = rawId || INDEX.day.some(function (d) { return d >= r.from && d <= r.to; });
        var args = rawId ? { p_layer: L, p_from: r.from, p_to: r.to, p_upload: rawId } : { p_layer: 'DAY', p_from: r.from, p_to: r.to };
        return has ? API.rpc('period_combos', args).then(function (c) { return mtbfFromCombos(c || [], r.from, ids); }) : null;
      }))
    ]).then(function (x) {
      var byFrom = {};
      x[0].forEach(function (o) { byFrom[o.period_from] = o; });
      return keys.map(function (k, i) {
        var o = byFrom[k];
        return { key: k, oee: o ? pct(o.oee) : null, tdt: o ? pct(o.tdt_pct) : null, output: o ? Number(o.sap_good_units) : null,
          mtbf: x[1][i] ? x[1][i].mtbf : null };
      });
    });
  }

  // init is shared by the plant and department screens; invalidate() (after an upload or a settings change) forces a reload
  var INIT = null;
  function invalidate() { INIT = null; }
  function init() {
    if (!INIT) {
      INIT = Promise.all([loadStatic(), loadIndex()]).then(function (x) { CACHE = {}; STATIC = x[0]; INDEX = x[1]; return INDEX; });
      INIT.catch(function () { INIT = null; });
    }
    return INIT;
  }

  window.OEE_DASH = { init: init, invalidate: invalidate, static: function () { return STATIC; }, selectAll: selectAll, loadPeriod: loadPeriod, cal: CAL, index: function () { return INDEX; }, depts: function () { return STATIC ? STATIC.depts : []; }, officialOf: officialOf, officialRawOf: officialRawOf };
})();
