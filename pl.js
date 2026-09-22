/* Process Lead screen (approved mockup "PL — שילוב B + C"): the daily loss analysis of one line.
 * Everything here is computed from the uploaded MES data: the official OEE row of the machine,
 * the RAW events of the production day, and the classification rules (PDT / UPDT / failure / standard duration). */
(function () {
  'use strict';
  var API = window.OEE_API, ENG = window.OEE_ENGINE, D = window.OEE_DASH;
  var PROD = ['ייצור', 'ייצור ללא פק"ע'];
  var NO_STATION = '(ללא תחנה)';
  var COLORS = { prod: '#4E9A6B', updt: '#DC2626', pdt: '#8A93A8', clean: '#4A7A6E', none: '#D8D5C8', unknown: '#F59E0B' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(min) {
    if (min === null || min === undefined) return '—';
    var r = Math.round(min);
    return Math.floor(r / 60) + ':' + pad(r % 60);
  }
  function fmtMin(min) {
    var r = Math.round(min);
    if (r >= 60) return hm(r) + ' ש\'';
    return r + ' דק\'';
  }
  function pct(v) { return v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%'; }

  // which bucket an event falls into, by the classification rules
  function bucket(rule, ev) {
    if (!rule || rule.counts_in_oee === null || rule.counts_in_oee === undefined) return 'unknown';
    if (rule.loss_type === 'PRODUCTION') return 'prod';
    if (!rule.counts_in_oee) return 'none';
    if (rule.loss_type === 'UPDT' || rule.loss_type === 'PROCESS_FAILURE') return 'updt';
    if (rule.loss_type === 'PDT') return ev.status === 'פעילות' ? 'clean' : 'pdt';
    return 'none';
  }

  var CACHE = {};
  function loadDay(machineId, day) {
    var ck = machineId + '|' + day;
    if (CACHE[ck]) return Promise.resolve(CACHE[ck]);
    var prev = [];
    for (var i = 1; i <= 6; i++) prev.push(D.cal.step('day', day, -i));
    return Promise.all([
      D.selectAll('oee_report_rows?select=oee,availability,performance,quality,tdt_pct,sap_good_units,net_minutes&period_type=eq.DAY&period_from=eq.' + day + '&machine_id=eq.' + machineId),
      D.selectAll('raw_events?select=status,stop_group,station,description,sku,start_at,duration_min,output_qty&period_type=eq.DAY&production_date=eq.' + day + '&machine_id=eq.' + machineId + '&order=start_at'),
      Promise.all(prev.concat([day]).map(function (d) {
        return API.rpc('period_combos', { p_layer: 'DAY', p_from: d, p_to: d }).then(function (rows) {
          return { day: d, rows: (rows || []).filter(function (r) { return r.machine_id === machineId; }) };
        });
      }))
    ]).then(function (x) {
      var m = build(machineId, day, x[0][0] || null, x[1], x[2]);
      CACHE[ck] = m;
      return m;
    });
  }

  function build(machineId, day, off, events, history) {
    var S = D.static();
    var base = 0, updt = 0, pdt = 0, clean = 0, none = 0, prodMin = 0, fails = 0, unclassified = 0;
    var updtN = 0, pdtN = 0, overMin = 0, overN = 0, stdN = 0, overTop = null;
    var par = {}, segs = [], longs = [], shifts = [{ a: 0, b: 480 }, { a: 480, b: 960 }, { a: 960, b: 1440 }];
    shifts.forEach(function (s) { s.agg = {}; s.stops = 0; s.longest = 0; });
    var dayStart = new Date(day + 'T00:00:00');
    dayStart.setHours(7, 0, 0, 0);

    events.forEach(function (e) {
      var d = Number(e.duration_min) || 0;
      var r = ENG.classify({ status: ENG.norm(e.status), stop_group: ENG.norm(e.stop_group), description: ENG.norm(e.description), production_date: day }, S.rules, machineId, day);
      var b = bucket(r, e);
      if (b === 'unknown') unclassified++;
      if (r && r.counts_in_oee) base += d;
      if (b === 'prod') prodMin += d;
      if (b === 'updt') { updt += d; updtN++; }
      if (b === 'pdt') { pdt += d; pdtN++; }
      if (b === 'clean') { clean += d; pdtN++; }
      if (r && r.counts_as_failure) fails++;
      if (r && r.normal_duration_min) {
        stdN++;
        var over = d - Number(r.normal_duration_min);
        if (over > 0) {
          overMin += over; overN++;
          if (!overTop || over > overTop.over) overTop = { desc: e.description || e.stop_group || e.status, over: over, dur: d, std: Number(r.normal_duration_min) };
        }
      }
      // pareto (everything that is not production)
      if (b !== 'prod' && b !== 'none') {
        var key = (e.description || e.stop_group || e.status) + '|' + (e.station || '');
        var p = par[key] = par[key] || { desc: e.description || e.stop_group || e.status, station: e.station || '', group: e.stop_group || e.status, min: 0, n: 0, color: COLORS[b] };
        p.min += d; p.n++;
      }
      // timeline + shifts + long stops
      var start = (new Date(e.start_at) - dayStart) / 60000;
      if (start < 0) start += 1440;
      segs.push({ start: start, min: d, color: COLORS[b], label: (e.description || e.stop_group || e.status) + ' · ' + fmtMin(d) });
      shifts.forEach(function (s) {
        var ov = Math.max(0, Math.min(start + d, s.b) - Math.max(start, s.a));
        if (ov > 0) s.agg[b] = (s.agg[b] || 0) + ov;
        if (start >= s.a && start < s.b && b !== 'prod' && b !== 'none') { s.stops++; s.longest = Math.max(s.longest, d); }
      });
      if (d >= 15 && b !== 'prod') {
        var t = new Date(e.start_at);
        longs.push({ start: start, t: pad(t.getHours()) + ':' + pad(t.getMinutes()), dur: fmtMin(d), desc: e.description || e.stop_group || e.status, station: e.station || '—', kindStyle: 'background: ' + COLORS[b] + ';' });
      }
    });

    // pareto list with cumulative share
    var list = Object.keys(par).map(function (k) { return par[k]; }).sort(function (a, b) { return b.min - a.min; });
    var lossTotal = list.reduce(function (s, p) { return s + p.min; }, 0) || 1;
    var maxP = list.length ? list[0].min : 1;
    var cum = 0;
    var pareto = list.slice(0, 12).map(function (p, i) {
      cum += p.min;
      return { rank: i + 1, desc: p.desc, sub: p.group + (p.station ? ' · ' + p.station : '') + ' · ' + (p.n === 1 ? 'פעם אחת' : p.n + ' פעמים'),
        min: fmtMin(p.min), cum: 'מצטבר ' + Math.round(cum / lossTotal * 100) + '%',
        fillStyle: 'width: ' + (p.min / maxP * 100).toFixed(1) + '%; background: ' + p.color + ';',
        cumStyle: 'right: calc(' + Math.min(cum / lossTotal * 100, 100).toFixed(1) + '% - 1px);' };
    });

    // recurring over the last 7 production days
    var days = history.map(function (h) { return h.day; }).sort();
    var byKey = {};
    history.forEach(function (h) {
      h.rows.forEach(function (row) {
        if (PROD.indexOf(ENG.norm(row.status)) >= 0) return;
        var r = ENG.classify({ status: ENG.norm(row.status), stop_group: ENG.norm(row.stop_group), description: ENG.norm(row.description), production_date: h.day }, S.rules, machineId, h.day);
        var b = bucket(r, row);
        if (b === 'none' || b === 'prod') return;
        var key = (row.description || row.stop_group || row.status) + '|' + (row.stop_group || '');
        var k = byKey[key] = byKey[key] || { desc: row.description || row.stop_group || row.status, group: row.stop_group || row.status, per: {}, tot: 0, n: 0, days: 0, updt: b === 'updt' };
        k.per[h.day] = (k.per[h.day] || 0) + Number(row.minutes || 0);
        k.tot += Number(row.minutes || 0); k.n += row.n;
      });
    });
    var TAG = {
      ups: ['חוזר — מועמד ל-UPS', 'background: #FEE2E2; color: #991B1B;'],
      ips: ['חד-פעמי ארוך — IPS', 'background: #FEF3C7; color: #92400E;'],
      plan: ['מתוכנן — לבדוק מול סטנדרט', 'background: #E5E7EB; color: #374151;']
    };
    function heat(v) {
      if (!v) return 'background: #F4F2EC; color: #C9C6B8;';
      if (v >= 60) return 'background: #DC2626; color: #FFFFFF;';
      if (v >= 30) return 'background: #F87171; color: #FFFFFF;';
      if (v >= 10) return 'background: #FECACA; color: #7F1D1D;';
      return 'background: #FEE2E2; color: #7F1D1D;';
    }
    var recurring = Object.keys(byKey).map(function (k) { return byKey[k]; })
      .map(function (k) { k.days = days.filter(function (d) { return k.per[d]; }).length; return k; })
      .sort(function (a, b) { return b.tot - a.tot; }).slice(0, 12)
      .map(function (k) {
        var tag = !k.updt ? 'plan' : (k.days >= 4 ? 'ups' : (k.tot >= 60 ? 'ips' : 'plan'));
        return { desc: k.desc, sub: k.group + ' · ' + k.n + ' פעמים',
          cells: days.map(function (d) { var v = Math.round(k.per[d] || 0); return { v: v || '·', style: heat(v) }; }),
          tot: fmtMin(k.tot), tag: TAG[tag][0] + (tag === 'ups' ? ' (' + k.days + '/' + days.length + ')' : ''), tagStyle: TAG[tag][1] };
      });

    var SH_NAMES = ['בוקר · 07:00 עד 15:00', 'ערב · 15:00 עד 23:00', 'לילה · 23:00 עד 07:00'];
    var shiftsOut = shifts.map(function (s, i) {
      return { name: SH_NAMES[i],
        parts: ['prod', 'updt', 'pdt', 'clean', 'none', 'unknown'].filter(function (k) { return s.agg[k]; }).map(function (k) {
          return { style: 'width: ' + (s.agg[k] / 480 * 100).toFixed(1) + '%; background: ' + COLORS[k] + ';' };
        }),
        lines: [
          { l: 'זמן ייצור', v: fmtMin(s.agg.prod || 0) + ' (' + Math.round((s.agg.prod || 0) / 480 * 100) + '%)' },
          { l: 'לא מתוכנן (UPDT)', v: fmtMin(s.agg.updt || 0) },
          { l: 'מתוכנן (PDT)', v: fmtMin((s.agg.pdt || 0) + (s.agg.clean || 0)) },
          { l: 'מספר עצירות', v: s.stops },
          { l: 'העצירה הארוכה ביותר', v: fmtMin(s.longest) }
        ] };
    });

    var ticks = [];
    for (var h = 0; h <= 24; h += 2) ticks.push({ label: pad((7 + h) % 24) + ':00', style: 'right: ' + (h / 24 * 100).toFixed(2) + '%;' });
    var legend = [['prod', 'ייצור'], ['updt', 'לא מתוכנן (UPDT)'], ['pdt', 'מתוכנן (PDT)'], ['clean', 'שטיפה / חיטוי'], ['none', 'לא נספר ב-OEE'], ['unknown', 'לא מסווג']]
      .map(function (x) { return { name: x[1], style: 'background: ' + COLORS[x[0]] + ';' }; });

    var mtbf = fails ? prodMin / fails : null;
    var pdtAll = pdt + clean;
    var kpis = [
      { l: 'OEE', v: off ? pct(off.oee) : '—', n: off ? 'ישירות מדוח ה-OEE' : 'אין שורה למכונה בדוח ה-OEE של היום' },
      { l: 'זמינות', v: off ? pct(off.availability) : '—', n: 'חלק הזמן שהקו ייצר מתוך הזמן הנספר' },
      { l: 'יעילות (קצב)', v: off ? pct(off.performance) : '—', n: 'קצב בפועל מול קצב מטרה' },
      { l: '%TDT', v: off ? pct(off.tdt_pct) : '—', n: 'זמן עצירות מתוך זמן כולל' },
      { l: 'MTBF', v: hm(mtbf), n: 'זמן ייצור (' + hm(prodMin) + ') ÷ מס\' תקלות (' + fails + ')' },
      { l: 'UPDT — לא מתוכנן', v: base ? pct(updt / base) : '—', sub: hm(updt) + ' שעות', n: 'תקלות והפסקות לא מתוכננות · ' + updtN + ' אירועים' },
      { l: 'PDT — מתוכנן', v: base ? pct(pdtAll / base) : '—', sub: hm(pdtAll) + ' שעות', n: 'שטיפות, פתיחת מיכל, סוף מנה והמתנות מוגדרות · ' + pdtN + ' אירועים' },
      { l: 'חריגה מזמן מטרה', v: base ? pct(overMin / base) : '—', sub: Math.round(overMin) + ' דק\' מעל התקן',
        n: overN + ' מתוך ' + stdN + ' אירועים עם זמן תקן חרגו' + (overTop ? ' · הגדול: ' + overTop.desc + ' (' + Math.round(overTop.dur) + ' מול תקן ' + overTop.std + ')' : '') },
      { l: 'עצירות לא מתוכננות', v: String(updtN), n: 'מספר האירועים שסווגו UPDT ביום הזה' }
    ];
    kpis.forEach(function (k) { k.hasSub = !!k.sub; k.sub = k.sub || ''; });

    return {
      day: day, machineId: machineId, kpis: kpis, pareto: pareto, days: days.map(function (d) { return d.slice(8) + '/' + d.slice(5, 7); }),
      recurring: recurring, shifts: shiftsOut, ticks: ticks, legend: legend,
      segs: segs.map(function (s) { return { style: 'right: ' + (s.start / 1440 * 100).toFixed(3) + '%; width: ' + Math.max(s.min / 1440 * 100, 0.12).toFixed(3) + '%; background: ' + s.color + ';', title: s.label }; }),
      longEvents: longs.sort(function (a, b) { return a.start - b.start; }),
      unclassified: unclassified, hasEvents: events.length > 0, official: !!off
    };
  }

  /* ---------- the screen ---------- */
  function PLComponent(props) { window.DCLogic.call(this, props); this.state = { machineId: null, day: null, model: null, loading: true, error: null, empty: false }; }
  PLComponent.prototype = Object.create(window.DCLogic.prototype);
  PLComponent.prototype.constructor = PLComponent;
  var LS = 'oee_pl_machine_v1';

  PLComponent.prototype.start = function () {
    var self = this;
    return D.init().then(function (idx) {
      if (!idx.day.length) { self.setState({ loading: false, empty: true }); return; }
      var S = D.static();
      if (!self.state.machineId) {
        var saved = null;
        try { saved = Number(localStorage.getItem(LS)) || null; } catch (e) { /* private mode */ }
        var ok = S.machines.filter(function (m) { return m.id === saved; })[0];
        self.state.machineId = ok ? ok.id : S.machines[0].id;
      }
      if (!self.state.day || idx.day.indexOf(self.state.day) < 0) self.state.day = idx.day[idx.day.length - 1];
      return self.load();
    }).catch(function (e) { self.setState({ loading: false, error: e.message || String(e) }); });
  };
  PLComponent.prototype.load = function () {
    var self = this, mid = this.state.machineId, day = this.state.day;
    this.setState({ loading: true, error: null });
    return loadDay(mid, day).then(function (model) {
      if (self.state.machineId === mid && self.state.day === day) self.setState({ model: model, loading: false });
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
  PLComponent.prototype.stepDay = function (dir) {
    var self = this;
    return function () {
      var list = D.index().day, i = list.indexOf(self.state.day) + dir;
      if (i < 0 || i >= list.length) return;
      self.state.day = list[i];
      self.load();
    };
  };

  PLComponent.prototype.renderVals = function () {
    var st = this.state, M = st.model, S = D.static();
    var machines = S ? S.machines : [];
    var mach = machines.filter(function (m) { return m.id === st.machineId; })[0];
    var deptName = '';
    if (mach && S) { var d = S.depts.filter(function (x) { return x.id === mach.department_id; })[0]; deptName = d ? d.name : ''; }
    var list = D.index() ? D.index().day : [];
    var pos = list.indexOf(st.day);
    var NAV_OFF = 'opacity: 0.35; cursor: default;';
    var base = {
      machineChips: machines.map(function (m) {
        return { name: m.name, style: m.id === st.machineId ? 'background: #1c2b45; color: #FFFFFF;' : '', pick: this.pickMachine(m.id) };
      }, this),
      subTitle: (mach ? mach.name : '') + (deptName ? ' · אגף ' + deptName : '') + (st.day ? ' · יום ייצור ' + st.day.slice(8) + '/' + st.day.slice(5, 7) + '/' + st.day.slice(0, 4) : ''),
      periodLabel: st.day ? D.cal.label('day', st.day) : '—',
      prevFn: this.stepDay(-1), nextFn: this.stepDay(1),
      prevStyle: pos > 0 ? '' : NAV_OFF, nextStyle: pos >= 0 && pos < list.length - 1 ? '' : NAV_OFF
    };
    if (!M) {
      var msg = st.empty ? 'עדיין לא הועלו דוחות' : (st.error ? 'שגיאה בטעינה: ' + st.error : 'טוען נתונים…');
      return Object.assign(base, { showBanner: true, bannerText: msg, srcLabel: st.empty ? 'אין נתונים' : 'טוען…', srcStyle: 'background: #F0EFEA; color: #5B594F;',
        kpis: [], pareto: [], days: [], recurring: [], shifts: [], ticks: [], legend: [], segs: [], longEvents: [] });
    }
    var note = M.unclassified ? M.unclassified + ' אירועים ביום הזה לא מסווגים בכללי הסיווג — הם לא נספרים ב-PDT/UPDT' : '';
    return Object.assign(base, {
      showBanner: !!note, bannerText: note,
      srcLabel: st.loading ? 'טוען…' : (M.official ? 'רשמי · דוח יומי מה-MES' : 'אין שורה למכונה בדוח ה-OEE'),
      srcStyle: M.official ? 'background: #DCFCE7; color: #166534;' : 'background: #FEF3C7; color: #92400E;',
      kpis: M.kpis, pareto: M.pareto, days: M.days, recurring: M.recurring, shifts: M.shifts, ticks: M.ticks, legend: M.legend, segs: M.segs, longEvents: M.longEvents
    });
  };

  window.OEE_PL = { Component: PLComponent, loadDay: loadDay, clearCache: function () { CACHE = {}; } };
})();
