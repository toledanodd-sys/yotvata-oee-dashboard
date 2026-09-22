/* OEE engine — same formula as pq_FACT_Calc / OEE_Check_Fact_Only / OEE_Compare_Check in
 * LOSS_TREE_FACTORY_MASTER, but classification comes from the app's classification rules.
 *   Availability = (base − loss) / base          base = minutes of events that count in OEE
 *                                                loss = minutes of PDT / UPDT / process-failure events that count in OEE
 *   Performance  = target minutes / actual production minutes
 *                  target minutes = Σ output ÷ target rate (machine + SKU), actual = minutes of status "ייצור"
 *   Quality      = SAP good units ÷ Σ output (from the RAW report)
 *   OEE          = A × P × Q
 * Works in the browser (window.OEE_ENGINE) and in node (module.exports) for testing. */
(function (root) {
  'use strict';

  function norm(s) {
    if (s === null || s === undefined) return null;
    var t = String(s).replace(/[‎‏﻿]/g, '').replace(/\s+/g, ' ').trim();
    return t === '' ? null : t;
  }

  function validOn(r, day) { return r.valid_from <= day && (!r.valid_to || r.valid_to >= day); }

  // most specific rule wins: description (4) > stop group (2) > machine (1); ties → latest valid_from
  function classify(ev, rules, machineId, day) {
    var best = null, bestScore = -1;
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.status !== ev.status) continue;
      if (r.stop_group !== null && r.stop_group !== ev.stop_group) continue;
      if (r.description !== null && r.description !== ev.description) continue;
      if (r.machine_id !== null && r.machine_id !== machineId) continue;
      if (!validOn(r, day)) continue;
      var score = (r.description !== null ? 4 : 0) + (r.stop_group !== null ? 2 : 0) + (r.machine_id !== null ? 1 : 0);
      if (score > bestScore || (score === bestScore && r.valid_from > best.valid_from)) { best = r; bestScore = score; }
    }
    return best;
  }

  function prepareRules(rules) {
    return rules.map(function (r) {
      var o = {};
      for (var k in r) o[k] = r[k];
      o.status = norm(r.status); o.stop_group = norm(r.stop_group); o.description = norm(r.description);
      return o;
    });
  }

  function rateFor(rates, machineId, sku, day) {
    for (var i = 0; i < rates.length; i++) {
      var r = rates[i];
      if (r.machine_id === machineId && r.sku === sku && validOn(r, day)) return Number(r.target_rate);
    }
    return null;
  }

  var LOSS_TYPES = { PDT: 1, UPDT: 1, PROCESS_FAILURE: 1 };

  /* events: [{status, stop_group, description, sku, duration_min, output_qty, production_date}]
   * returns per-machine components and why a value could not be computed */
  function computeMachine(events, rules, rates, machineId, sapGood) {
    var base = 0, loss = 0, actual = 0, target = 0, output = 0, tdtMin = 0, tdtKnown = true;
    var unclassified = 0, missingRate = {}, stopMin = 0;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var d = Number(e.duration_min) || 0;
      var q = Number(e.output_qty) || 0;
      if (q > 0) output += q;
      var r = classify(e, rules, machineId, e.production_date);
      if (!r || r.counts_in_oee === null || r.counts_in_oee === undefined) { unclassified++; continue; }
      if (r.counts_in_tdt === true) tdtMin += d;
      else if (r.counts_in_tdt !== false) tdtKnown = false;
      if (r.loss_type !== 'PRODUCTION' && r.counts_in_oee) stopMin += d;
      if (!r.counts_in_oee) continue;
      base += d;
      if (LOSS_TYPES[r.loss_type]) loss += d;
      if (e.status === 'ייצור') actual += d;
      if (q > 0) {
        var rate = rateFor(rates, machineId, e.sku, e.production_date);
        if (rate) target += q / rate;
        else missingRate[e.sku || '—'] = true;
      }
    }
    var missing = Object.keys(missingRate);
    var A = base > 0 ? (base - loss) / base : null;
    var P = (actual > 0 && !missing.length) ? target / actual : null;
    var Q = (output > 0 && sapGood !== null && sapGood !== undefined) ? Number(sapGood) / output : null;
    var reason = null;
    if (!events.length) reason = 'אין אירועים';
    else if (unclassified) reason = unclassified + ' אירועים לא מסווגים';
    else if (actual === 0 && output === 0) reason = 'לא היה ייצור';
    else if (missing.length) reason = 'חסר קצב מטרה';
    else if (Q === null) reason = 'חסרה איכות (SAP טובים)';
    var oee = (!reason && A !== null && P !== null && Q !== null) ? A * P * Q : null;
    var tdt = (!unclassified && tdtKnown && base > 0) ? tdtMin / base : null;
    return {
      base: base, loss: loss, actual: actual, target: target, output: output,
      availability: A, performance: P, quality: Q, oee: oee, reason: reason,
      unclassified: unclassified, missingRateSkus: missing, tdt: tdt, tdtKnown: tdtKnown
    };
  }

  var api = { norm: norm, classify: classify, prepareRules: prepareRules, computeMachine: computeMachine, validOn: validOn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OEE_ENGINE = api;
})(this);
