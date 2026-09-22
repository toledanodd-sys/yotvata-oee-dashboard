/* "מנהל ייצור" dashboard view-model — same outputs and chart logic as the approved canvas mockups
 * (Main + Period selector), fed by the uploaded data (dashdata.js) instead of the mockup's sample day.
 * props.scope === 'dept' → the Line Lead screen (approved mockup "Line Lead — אגף"): the same screen scoped
 * to one department, weights = each machine's weight within the department. */
const LL_DEPT_KEY = 'oee_ll_dept_v1';
const MACHINE_COLOR = { 'קומבי': '#4E79A7', 'מטריקס': '#F28E2B', 'מרין': '#9C755F', 'טטרה': '#B07AA1', 'איליג': '#76B7B2', 'טימון': '#EDC948', 'פומבה': '#FF9DA7', 'גלאקסי': '#9D9D9D' };
const EXTRA_COLORS = ['#59A14F', '#E15759', '#AF7AA1', '#FF9DA7', '#BAB0AC'];
class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { view: 'home', selectedDept: null, shareView: 'dept', tdtView: 'machine', mtbfView: 'machine',
      period: 'day', keys: {}, model: null, loading: true, error: null, empty: false, dept: null };
    this.isLL = !!(props && props.scope === 'dept');
    if (this.isLL) { try { this.state.dept = localStorage.getItem(LL_DEPT_KEY); } catch (e) { /* private mode */ } }
  }
  pickDept(name) {
    return () => {
      if (this.state.dept === name) return;
      this.state.dept = name;
      try { localStorage.setItem(LL_DEPT_KEY, name); } catch (e) { /* private mode */ }
      this.load();
    };
  }

  // ----- data loading -----
  start() {
    const D = window.OEE_DASH;
    return D.init().then((idx) => {
      if (!idx.day.length && !idx.week.length && !idx.month.length) { this.setState({ loading: false, empty: true, model: null }); return; }
      const keys = {};
      const prevIdx = this.lastIdx || {};
      ['day', 'week', 'month'].forEach((t) => {
        // keep the period the user is looking at, unless it was the latest one — then follow the newest upload
        const cur = this.state.keys[t], old = prevIdx[t] || [];
        const wasLatest = !cur || cur === old[old.length - 1];
        keys[t] = !wasLatest && idx[t].indexOf(cur) >= 0 ? cur : idx[t][idx[t].length - 1];
      });
      this.lastIdx = { day: idx.day.slice(), week: idx.week.slice(), month: idx.month.slice() };
      this.state.keys = keys; this.state.empty = false;
      if (this.isLL) {
        const names = D.depts().map((d) => d.name);
        if (names.indexOf(this.state.dept) < 0) this.state.dept = names[0] || null;
      }
      return this.load();
    }).catch((e) => this.setState({ loading: false, error: e.message || String(e) }));
  }
  load() {
    const t = this.state.period, k = this.state.keys[t];
    this.setState({ loading: true, error: null });
    const dept = this.isLL ? this.state.dept : null;
    return window.OEE_DASH.loadPeriod(t, k, dept).then((model) => {
      if (this.state.period === t && this.state.keys[t] === k && (!this.isLL || this.state.dept === dept)) this.setState({ model, loading: false });
    }).catch((e) => this.setState({ loading: false, error: e.message || String(e) }));
  }
  pickPeriod(p) { return () => { if (this.state.period !== p) { this.state.period = p; this.state.view = 'home'; this.load(); } }; }
  stepPeriod(dir) {
    return () => {
      const t = this.state.period, list = window.OEE_DASH.index()[t], i = list.indexOf(this.state.keys[t]);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      this.state.keys[t] = list[j]; this.load();
    };
  }

  goDrill(deptKey) { return () => this.setState({ view: 'drill', selectedDept: deptKey }); }
  goHome() { return () => this.setState({ view: 'home' }); }
  setShareView(v) { return () => this.setState({ shareView: v }); }
  setTdtView(v) { return () => this.setState({ tdtView: v }); }
  setMtbfView(v) { return () => this.setState({ mtbfView: v }); }

  renderVals() {
    const st = this.state, M = st.model, period = st.period;
    const D = window.OEE_DASH;
    const WORD = { day: 'היום', week: 'השבוע', month: 'החודש' }[period];
    const LL = this.isLL;
    const SCOPE = LL ? 'אגפי' : 'מפעלי';          // "OEE מפעלי" / "OEE אגפי"
    const deptChips = LL ? D.depts().map((d) => ({ label: d.name, style: d.name === st.dept ? 'background: #1c2b45; color: #FFFFFF;' : '', pick: this.pickDept(d.name) })) : [];
    const LAYER_NAME = { day: 'יומי', week: 'שבועי', month: 'חודשי' }[period];

    const pct1 = (v) => (v === null || v === undefined ? '—' : (+v).toFixed(1) + '%');
    const num = (v) => Math.round(v || 0).toLocaleString('en-US');
    function formatK(v) { return (v / 1000).toFixed(1) + 'K'; }
    function hm(min) {
      if (min === null || min === undefined) return '—';
      const r = Math.round(min), h = Math.floor(r / 60), mm = r % 60;
      return h + ':' + (mm < 10 ? '0' : '') + mm;
    }
    function formatMin(min) {
      const rounded = Math.round(min);
      if (rounded >= 60) { const h = Math.floor(rounded / 60), mm = rounded % 60; return h + ':' + (mm < 10 ? '0' : '') + mm + ' שעות'; }
      return rounded + ' דק\'';
    }
    function fmtQty(qty, unit) { return Math.round(qty).toLocaleString('en-US') + (unit ? ' ' + unit : ''); }
    const gapLabel = (calc, off) => { const g = calc - off; return (g >= 0 ? '+' : '−') + Math.abs(g).toFixed(2) + ' נק\''; };

    // ----- period selector -----
    const PERIOD_DEFS = [{ key: 'day', label: 'יום' }, { key: 'week', label: 'שבוע' }, { key: 'month', label: 'חודש' }];
    const periods = PERIOD_DEFS.map((p) => ({ label: p.label, style: p.key === period ? 'background: #1c2b45; color: #FFFFFF;' : '', pick: this.pickPeriod(p.key) }));
    const idx = D.index();
    const list = idx ? idx[period] : [];
    const pos = list.indexOf(st.keys[period]);
    const NAV_OFF = 'opacity: 0.35; cursor: default;';
    const prevStyle = pos > 0 ? '' : NAV_OFF, nextStyle = pos >= 0 && pos < list.length - 1 ? '' : NAV_OFF;
    const SRC_OFFICIAL = 'background: #DCFCE7; color: #166534;';
    const SRC_CALC = 'background: #FEF3C7; color: #92400E;';
    const SRC_WAIT = 'background: #F0EFEA; color: #5B594F;';

    const base = {
      deptName: st.dept || '', deptChips,
      isHome: st.view === 'home', isDrill: st.view === 'drill', periods, prevFn: this.stepPeriod(-1), nextFn: this.stepPeriod(1), prevStyle, nextStyle,
      periodLabel: st.keys[period] ? D.cal.label(period, st.keys[period]) : '—',
      shareView: st.shareView, onBack: this.goHome(),
      setShareMachineFn: this.setShareView('machine'), setShareDeptFn: this.setShareView('dept'), setShareSkuFn: this.setShareView('sku'),
      setTdtViewMachineFn: this.setTdtView('machine'), setTdtViewStationsFn: this.setTdtView('stations'),
      setMtbfViewMachineFn: this.setMtbfView('machine'), setMtbfViewFaultsFn: this.setMtbfView('faults')
    };
    const TAB_ACTIVE = 'background:#1c2b45;color:#fff;border-color:#1c2b45;';
    const isShareMachine = st.shareView === 'machine', isShareSku = st.shareView === 'sku', isShareDept = !isShareMachine && !isShareSku;
    const isTdtViewStations = st.tdtView === 'stations', isMtbfViewFaults = st.mtbfView === 'faults';
    Object.assign(base, {
      isShareMachine, isShareDept, isShareSku,
      shareMachineTabStyle: isShareMachine ? TAB_ACTIVE : '', shareDeptTabStyle: isShareDept ? TAB_ACTIVE : '', shareSkuTabStyle: isShareSku ? TAB_ACTIVE : '',
      isTdtViewMachine: !isTdtViewStations, isTdtViewStations,
      tdtViewMachineTabStyle: !isTdtViewStations ? TAB_ACTIVE : '', tdtViewStationsTabStyle: isTdtViewStations ? TAB_ACTIVE : '',
      isMtbfViewMachine: !isMtbfViewFaults, isMtbfViewFaults,
      mtbfViewMachineTabStyle: !isMtbfViewFaults ? TAB_ACTIVE : '', mtbfViewFaultsTabStyle: isMtbfViewFaults ? TAB_ACTIVE : ''
    });

    if (!M) {
      let msg = 'טוען נתונים…', note = '';
      if (st.error) { msg = 'שגיאה בטעינה'; note = 'לא הצלחנו לקרוא את הנתונים מהמסד: ' + st.error; }
      else if (st.empty) { msg = 'עדיין לא הועלו דוחות'; note = 'אחרי שיועלה הדוח היומי הראשון (אייקון ההעלאה, למנהל בלבד), הנתונים יופיעו כאן.'; }
      const dash = { l: '', v: '—', n: '', hasSrc: false, src: '', tt: { prevLabel: '', avgLabel: '', yest: '—', yestDelta: '', week: '—', weekDelta: '' } };
      return Object.assign(base, {
        showBanner: st.empty || !!st.error, bannerText: note, srcLabel: msg, srcStyle: SRC_WAIT, srcNote: st.empty ? '' : note,
        plantStats: ['OEE', '%TDT', 'תפוקה (SAP טובים)', 'MTBF'].map((l) => Object.assign({}, dash, { l })),
        alerts: [], oeeChart: [], tdtChart: [], mtbfChart: [], outputCombinedChart: [], outputCombinedDeptPie: [], productionSkuList: [],
        tdtStationFaults: [], mtbfTop3Faults: [], contributionBulletChart: [], depts: [], drillDeptName: '', drillMachines: []
      });
    }

    const MACHINES = M.machines;
    const official = M.official;
    const P = M.plant;
    const DEPT_COLOR = {};
    M.depts.forEach((d) => { DEPT_COLOR[d.name] = d.color || '#9D9D9D'; });

    // ----- source badge and note -----
    let srcLabel, srcStyle, srcNote;
    if (official) {
      srcLabel = 'רשמי · דוח ' + LAYER_NAME + ' מה-MES';
      srcStyle = SRC_OFFICIAL;
      srcNote = period === 'day'
        ? 'המספר הגדול הוא הרשמי מה-MES. מתחתיו — החישוב הפנימי והפער, לבדיקת אמינות.'
        : 'דוח ' + LAYER_NAME + ' רשמי — לא סכום של הדוחות היומיים. אירועים שחוצים את 07:00 נספרים בו בשלמותם, ולכן הוא יכול להיות שונה מעט מהיומיים.';
    } else {
      srcLabel = 'מחושב · הדוח ה' + LAYER_NAME + ' עוד לא הועלה';
      srcStyle = SRC_CALC;
      srcNote = (period === 'week' ? 'שבוע ייצור הוא שבת–שישי, ומספור השבועות כמו בטבלת Date_Dim בקובץ המאסטר. ' : '') +
        'עד שמעלים את הדוח ה' + LAYER_NAME + ' מה-MES, המספרים מחושבים מהדוחות היומיים לפי הנוסחה (זמינות × יעילות × איכות). כשהדוח הרשמי עולה — הוא מחליף אותם אוטומטית. ' +
        'הועלו ' + M.daysUploaded + ' מתוך ' + M.daysTotal + ' ימים בתקופה.';
    }

    // ----- plant KPI cards -----
    const plantOeeTargetWeighted = MACHINES.reduce((s, m) => s + m.weight * m.oeeTarget, 0) / 100;
    const H = M.history || [];
    const prevH = H[0] || {};
    const avg = (k) => { const v = H.map((h) => h[k]).filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const TT = { day: ['אתמול', 'ממוצע 7 ימים', 'מאתמול'], week: ['שבוע קודם', 'ממוצע 4 שבועות', 'משבוע קודם'], month: ['חודש קודם', 'ממוצע 3 חודשים', 'מחודש קודם'] }[period];
    function ptsDelta(cur, ref, word, worseWhenUp) {
      if (cur === null || ref === null || cur === undefined || ref === undefined) return '';
      const d = cur - ref, up = d > 0;
      if (Math.abs(d) < 0.05) return 'ללא שינוי ' + word;
      const worse = worseWhenUp ? up : !up;
      return (up ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + ' נק\' ' + word + (worse && worseWhenUp ? ' (החמרה)' : '');
    }
    function relDelta(cur, ref, word) {
      if (!ref || cur === null || cur === undefined) return '';
      const d = (cur - ref) / ref * 100;
      return (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + '% ' + word;
    }
    function mtbfDelta(cur, ref, word) {
      if (cur === null || ref === null || cur === undefined || ref === undefined) return '';
      if (Math.round(cur) === Math.round(ref)) return 'ללא שינוי ' + word;
      return cur > ref ? '▲ ' + word + ' (שיפור)' : '▼ ' + word + ' (החמרה)';
    }
    const tt = (cur, k, fmtV, deltaFn, worseUp) => {
      const a = avg(k);
      return { prevLabel: TT[0], avgLabel: TT[1], yest: fmtV(prevH[k]), week: fmtV(a),
        yestDelta: deltaFn(cur, prevH[k], TT[2], worseUp), weekDelta: deltaFn(cur, a, 'מהממוצע', worseUp) };
    };
    const fmtNum = (v) => (v === null || v === undefined ? '—' : num(v));
    const fmtHm = (v) => (v === null || v === undefined ? '—' : hm(v));

    const pc = P.calc;
    let oeeSrc, tdtSrc;
    const partialTxt = () => 'חלקי (' + pc.names.join(', ') + ' בלבד, ' + Math.round(pc.share) + '% ממשקל ' + (LL ? 'האגף' : 'המפעל') + '), לכן לא בר השוואה לרשמי';
    const reasonTxt = () => {
      const r = [];
      if (M.dq.unclassified) r.push(M.dq.unclassified + ' אירועים לא מסווגים');
      if (M.dq.missingRates.length) r.push('חסרים קצבי מטרה (' + M.dq.missingRates.join(', ') + ')');
      return r.length ? r.join(' · ') : 'אין מספיק נתונים';
    };
    const plantStats = [];
    if (official) {
      if (pc.oee === null) oeeSrc = 'מחושב: לא ניתן — ' + reasonTxt();
      else if (pc.partial) oeeSrc = 'מחושב: ' + pct1(pc.oee) + ' — ' + partialTxt();
      else oeeSrc = 'מחושב: ' + pct1(pc.oee) + ' · פער ' + (P.oeeOff === null ? '—' : gapLabel(pc.oee, P.oeeOff));
      tdtSrc = pc.tdt === null ? 'TDT מחושב: ממתין להגדרת "נכנס ל-TDT" בכללי הסיווג'
        : 'TDT מחושב: ' + pct1(pc.tdt) + ' · פער ' + (P.tdtOff === null ? '—' : gapLabel(pc.tdt, P.tdtOff));
      plantStats.push({ l: 'OEE', v: pct1(P.oee), n: (P.oee === null ? (LL ? 'אין שורת אגף בדוח ה-OEE שהועלה' : 'אין שורת מפעל (יטבתה) בדוח ה-OEE שהועלה') : 'ישירות מדוח ה-OEE') + ' · יעד ' + SCOPE + ' משוקלל (כל מכונה בדיוק ביעד שלה): ' + plantOeeTargetWeighted.toFixed(1) + '%', hasSrc: true, src: oeeSrc, tt: tt(P.oee, 'oee', pct1, ptsDelta, false) });
      plantStats.push({ l: '%TDT', v: pct1(P.tdt), n: P.tdt === null ? 'אין שורת מפעל (יטבתה) בדוח ה-OEE שהועלה' : 'זמן עצירות מתוך זמן כולל', hasSrc: true, src: tdtSrc, tt: tt(P.tdt, 'tdt', pct1, ptsDelta, true) });
      plantStats.push({ l: 'תפוקה (SAP טובים)', v: fmtNum(P.output), n: P.output === null ? 'אין שורת מפעל בדוח ה-OEE שהועלה' : 'יחידות טובות שנספרו ב-SAP', hasSrc: false, src: '', tt: tt(P.output, 'output', fmtNum, relDelta) });
    } else {
      const oeeN = pc.oee === null ? 'לא ניתן לחשב — ' + reasonTxt()
        : pc.partial ? 'מחושב חלקי — ' + pc.names.join(', ') + ' בלבד (' + Math.round(pc.share) + '% ממשקל ' + (LL ? 'האגף' : 'המפעל') + ') · ' + reasonTxt()
        : 'מחושב לפי הנוסחה · יעד ' + SCOPE + ' משוקלל: ' + plantOeeTargetWeighted.toFixed(1) + '%';
      plantStats.push({ l: 'OEE', v: pct1(pc.oee), n: oeeN, hasSrc: true, src: 'יוחלף במספר הרשמי כשהדוח ה' + LAYER_NAME + ' יועלה', tt: tt(pc.oee, 'oee', pct1, ptsDelta, false) });
      plantStats.push({ l: '%TDT', v: pct1(pc.tdt), n: pc.tdt === null ? 'TDT מחושב ממתין להגדרת "נכנס ל-TDT" בכללי הסיווג' : 'מחושב מהאירועים', hasSrc: false, src: '', tt: tt(pc.tdt, 'tdt', pct1, ptsDelta, true) });
      plantStats.push({ l: 'תפוקה (SAP טובים)', v: fmtNum(P.output), n: 'סכום SAP טובים מהדוחות היומיים שעלו (' + M.daysUploaded + ' מתוך ' + M.daysTotal + ' ימים)', hasSrc: false, src: '', tt: tt(P.output, 'output', fmtNum, relDelta) });
    }
    plantStats.push({ l: 'MTBF', v: hm(P.mtbfMin), n: 'זמן ייצור ÷ מס\' תקלות (' + P.fails + ')', hasSrc: false, src: '', tt: tt(P.mtbfMin, 'mtbf', fmtHm, mtbfDelta) });

    // ----- alerts: plant OEE points lost vs each machine's own target (weight × (target − actual)) -----
    const alerts = [];
    if (M.offMissing.length || M.plantMissing) {
      alerts.push({ level: 'crit', title: 'דוח ה-OEE שהועלה חלקי — חסרים נתונים רשמיים',
        detail: (M.plantMissing ? 'אין בו שורת מפעל (יטבתה)' : '') + (M.plantMissing && M.offMissing.length ? ', ו' : '') +
          (M.offMissing.length ? 'חסרות בו מכונות שעבדו: ' + M.offMissing.join(', ') : '') +
          '. כנראה הדוח יוצא מה-MES עם סינון ישויות. להפיק מחדש את דוח ה-OEE עם כל הישויות ולהעלות שוב עם אותו דוח האירועים — "החלפה" במסך ההעלאה' });
    }
    const withOee = MACHINES.filter((m) => m.oee !== null);
    const lost = withOee.map((m) => ({ m, lost: m.weight * (m.oeeTarget - m.oee) / 100 })).filter((x) => x.lost > 0).sort((a, b) => b.lost - a.lost);
    const noProd = MACHINES.filter((m) => m.oeeTarget > 0 && m.prodMin === 0);
    const worst = lost.filter((x) => noProd.indexOf(x.m) < 0)[0];
    if (worst) {
      alerts.push({ level: 'crit', title: LL ? worst.m.name + ' — הפסד הנק\' הגדול ביותר באגף מול היעד העצמי שלה' : worst.m.name + ' (' + worst.m.dept + ') — הפסד הנק\' הגדול ביותר מול היעד העצמי שלה',
        detail: 'OEE ' + pct1(worst.m.oee) + ' מול יעד ' + worst.m.oeeTarget + '% שלה — ' + worst.lost.toFixed(2) + ' נק\' OEE ' + SCOPE + ' אבודים ' + WORD +
          (LL ? ' (משקל ' + worst.m.weight + '% באגף)' : ', הגבוה ביותר מכל מכונה במפעל (משקל ' + worst.m.weight + '%)') });
    }
    noProd.slice(0, 2).forEach((m) => {
      const l = m.weight * m.oeeTarget / 100;
      alerts.push({ level: 'crit', title: m.name + (LL ? '' : ' (' + m.dept + ')') + ' — ללא ייצור ' + WORD,
        detail: 'OEE 0% מול יעד ' + m.oeeTarget + '% שלה → ' + l.toFixed(2) + ' נק\' OEE ' + SCOPE + ' אבודים. קודם לבדוק אם זו עצירה מתוכננת/סידור עבודה ולא תקלה' });
    });
    M.depts.forEach((d) => {
      const ms = d.machines.filter((m) => m.oee !== null && m.output > 0);
      if (ms.length >= 2 && ms.every((m) => m.oee < m.oeeTarget)) {
        alerts.push({ level: 'warn', title: LL ? 'כל קווי האגף מתחת ליעד, לא רק מכונה בודדת' : d.name + ' — כל האגף מתחת ליעד, לא רק מכונה בודדת',
          detail: ms.map((m) => m.name + ' (' + pct1(m.oee) + ' מול יעד ' + m.oeeTarget + '%)').join(' וגם ') + ' מתחת ליעד שלהן. כשכל קווי הייצור באגף חורגים ביחד, כדאי לבדוק גורם משותף (כוח אדם, חומר גלם, משמרת) ולא רק תקלת ציוד נקודתית' });
      }
    });
    const second = lost.filter((x) => x !== worst && noProd.indexOf(x.m) < 0)[0];
    if (second && alerts.length < 4) {
      alerts.push({ level: 'warn', title: second.m.name + (LL ? '' : ' (' + second.m.dept + ')') + ' — מתחת ליעד',
        detail: 'OEE ' + pct1(second.m.oee) + ' מול יעד ' + second.m.oeeTarget + '% — ' + second.lost.toFixed(2) + ' נק\' OEE ' + SCOPE + ' אבודים ' + WORD });
    }
    if (M.dq.unclassified || M.dq.missingRates.length) {
      alerts.push({ level: 'info', title: 'איכות נתונים — החישוב הפנימי חלקי',
        detail: reasonTxt() + '. אפשר להשלים ב"הגדרות מערכת" (כללי סיווג / מוצרים וקצב מטרה), והחישוב יתעדכן. המספרים הרשמיים לא מושפעים' });
    }
    if (LL) {
      // in the department view, machines that met their target get a grey line too, so the list is not only red
      MACHINES.filter((m) => m.oee !== null && m.prodMin > 0 && m.oee >= m.oeeTarget).forEach((m) => alerts.push({ level: 'info', title: m.name + ' — עמדה ביעד ' + WORD,
        detail: 'OEE ' + pct1(m.oee) + ' מול יעד ' + m.oeeTarget + '% · תרומה ' + (m.contribution || 0).toFixed(2) + ' נק\' לאגף' }));
    }
    if (!alerts.length) alerts.push({ level: 'info', title: 'כל המכונות עמדו ביעד ' + WORD, detail: 'אין מכונה שה-OEE שלה מתחת ליעד העצמי שלה' });
    const ALERT_COLORS = { crit: { row: '#FEF2F2', dot: '#DC2626' }, warn: { row: '#FFFBEB', dot: '#D97706' }, info: { row: '#F1F5F9', dot: '#475569' } };
    const alertsOut = alerts.slice(0, 5).map((a) => ({ title: a.title, detail: a.detail,
      rowStyle: 'background:' + ALERT_COLORS[a.level].row + ';', dotStyle: 'background:' + ALERT_COLORS[a.level].dot + ';' }));

    // ----- charts (same logic as the mockup; a missing value shows "—" with an empty bar) -----
    function buildBarChart(getVal, getLabel, opts) {
      opts = opts || {};
      let list = MACHINES.slice();
      const v = (m) => { const x = getVal(m); return x === null || x === undefined ? null : x; };
      if (opts.sortDesc) list = list.sort((a, b) => (v(b) === null ? -1 : v(b)) - (v(a) === null ? -1 : v(a)));
      const vals = list.map(v).filter((x) => x !== null).concat(opts.getTarget ? list.map(opts.getTarget) : []);
      const max = Math.max.apply(null, vals.concat([0.0001]));
      return list.map((m) => {
        const x = v(m);
        let color = opts.fixedColor || DEPT_COLOR[m.dept];
        if (opts.getTarget && x !== null) color = x >= opts.getTarget(m) ? '#16A34A' : '#DC2626';
        const out = { name: m.name, valueLabel: x === null ? '—' : getLabel(x), barHeight: x === null ? '0px' : Math.round((x / max) * 120) + 'px', colorStyle: 'background:' + color + ';' };
        if (opts.getTarget) out.targetHeight = Math.round((opts.getTarget(m) / max) * 120) + 'px';
        return out;
      });
    }
    const oeeChart = buildBarChart((m) => m.oee, (x) => x.toFixed(1) + '%', { sortDesc: true, fixedColor: '#3B77A8', getTarget: (m) => m.oeeTarget });
    const tdtChart = buildBarChart((m) => m.tdt, (x) => x.toFixed(1) + '%', { sortDesc: true, fixedColor: '#3B77A8' });

    const byTdt = MACHINES.slice().sort((a, b) => (b.tdt === null ? -1 : b.tdt) - (a.tdt === null ? -1 : a.tdt));
    const tdtStationFaults = byTdt.map((m) => {
      const stations = m.stations.slice().sort((a, b) => b.min - a.min).slice(0, 3);
      return { name: m.name, tdtLabel: 'TDT ' + pct1(m.tdt), isEmpty: stations.length === 0,
        stations: stations.map((s) => ({ station: s.station, durLabel: formatMin(s.min), countLabel: s.count === 1 ? 'עצירה אחת' : s.count + ' עצירות' })) };
    });

    const mtbfSort = (a, b) => { if (a.mtbfMin === null) return 1; if (b.mtbfMin === null) return -1; return a.mtbfMin - b.mtbfMin; };
    const byMtbf = MACHINES.slice().sort(mtbfSort);
    const maxMtbf = Math.max.apply(null, byMtbf.filter((m) => m.mtbfMin !== null).map((m) => m.mtbfMin).concat([0.0001]));
    const mtbfChart = byMtbf.map((m) => m.mtbfMin === null
      ? { name: m.name, valueLabel: 'אין תקלות', barHeight: '3px', colorStyle: 'background:#D8D5C8;' }
      : { name: m.name, valueLabel: hm(m.mtbfMin), barHeight: Math.max(Math.round((m.mtbfMin / maxMtbf) * 120), 4) + 'px', colorStyle: 'background:#3B77A8;' });
    const VAGUE = ['אחר', 'עצירה לא מוסברת'];
    const mtbfTop3Faults = byMtbf.map((m) => {
      const faults = m.faults.slice().sort((a, b) => b.count - a.count || b.min - a.min).slice(0, 3);
      return { name: m.name, mtbfLabel: 'MTBF ' + hm(m.mtbfMin), isEmpty: faults.length === 0,
        faults: faults.map((f) => ({ desc: f.desc, station: f.station, countLabel: f.count === 1 ? 'מופע אחד' : f.count + ' מופעים',
          durLabel: formatMin(f.min) + ' סה"כ', descStyle: VAGUE.indexOf(f.desc) !== -1 ? 'font-style:italic; color:#D97706; font-weight:700;' : '' })) };
    });

    const byOut = MACHINES.slice().sort((a, b) => b.output - a.output);
    const maxOut = Math.max.apply(null, byOut.map((m) => m.output).concat([1]));
    const outputCombinedChart = byOut.map((m) => ({ name: m.name, valueLabel: formatK(m.output), shareLabel: m.outputShare.toFixed(1) + '%',
      barHeight: Math.round((m.output / maxOut) * 120) + 'px', colorStyle: 'background:#3B77A8;' }));
    const productionSkuList = byOut.map((m) => {
      const skus = m.skus.slice().sort((a, b) => b.qty - a.qty);
      return { name: m.name, totalLabel: formatK(m.output), isEmpty: skus.length === 0,
        skus: skus.map((p) => ({ sku: p.sku, desc: p.desc, qtyLabel: fmtQty(p.qty, p.unit) })) };
    });

    const totals = (LL
      ? MACHINES.slice().sort((a, b) => b.output - a.output).map((m, i) => ({ name: m.name, output: m.output, share: m.outputShare, color: MACHINE_COLOR[m.name] || EXTRA_COLORS[i % EXTRA_COLORS.length] }))
      : M.depts.map((d) => {
        const rows = MACHINES.filter((m) => m.deptId === d.id);
        return { name: d.name, output: rows.reduce((s, m) => s + m.output, 0), share: rows.reduce((s, m) => s + m.outputShare, 0), color: DEPT_COLOR[d.name] };
      })).filter((t) => t.output > 0);
    const grand = totals.reduce((s, t) => s + t.output, 0) || 1;
    const CX = 100, CY = 100, R = 92;
    let cum = -90;
    const outputCombinedDeptPie = totals.map((t) => {
      const p = (t.output / grand) * 100;
      const ang = Math.min((p / 100) * 360, 359.99), a0 = cum, a1 = cum + ang;
      const r0 = a0 * Math.PI / 180, r1 = a1 * Math.PI / 180;
      const path = 'M ' + CX + ' ' + CY + ' L ' + (CX + R * Math.cos(r0)).toFixed(2) + ' ' + (CY + R * Math.sin(r0)).toFixed(2) +
        ' A ' + R + ' ' + R + ' 0 ' + (ang > 180 ? 1 : 0) + ' 1 ' + (CX + R * Math.cos(r1)).toFixed(2) + ' ' + (CY + R * Math.sin(r1)).toFixed(2) + ' Z';
      const mid = ((a0 + a1) / 2) * Math.PI / 180;
      cum = a1;
      return { name: t.name, valueLabel: formatK(t.output), shareLabel: t.share.toFixed(1) + '%', fillStyle: 'fill:' + t.color + ';',
        dotStyle: 'background:' + t.color + ';', path, labelX: (CX + R * 0.62 * Math.cos(mid)).toFixed(1), labelY: (CY + R * 0.62 * Math.sin(mid)).toFixed(1), showLabel: p >= 8 };
    });

    const contributionBulletChart = MACHINES.map((m) => {
      const target = (m.weight * m.oeeTarget) / 100, actual = m.contribution;
      return { name: m.name, actual, target, pct: actual === null ? -1 : (target > 0 ? actual / target * 100 : 0), good: actual !== null && actual >= target };
    }).sort((a, b) => b.pct - a.pct).map((d) => {
      const scaleMax = (d.target * 1.5) || 1;
      const color = d.actual === null ? '#9D9D9D' : d.good ? '#16A34A' : '#DC2626';
      return { name: d.name, fillWidth: (d.actual === null ? 0 : Math.min((d.actual / scaleMax) * 100, 100)).toFixed(1) + '%',
        targetPos: ((d.target / scaleMax) * 100).toFixed(1) + '%', colorStyle: 'background:' + color + ';',
        targetLabel: 'יעד ' + d.target.toFixed(2), pointsLabel: d.actual === null ? '—' : d.actual.toFixed(2), labelColorStyle: 'color:' + color + ';' };
    });

    // ----- department drill-down -----
    const stat4 = (x) => [
      { l: '%TDT', v: pct1(x.tdt), n: 'זמן עצירות מתוך זמן כולל' },
      { l: 'OEE', v: pct1(x.oee), n: official ? 'ישירות מדוח ה-OEE' : 'מחושב לפי הנוסחה' },
      { l: 'MTBF', v: hm(x.mtbfMin), n: x.fails ? 'זמן ייצור ÷ מס\' תקלות (' + x.fails + ')' : 'אין אירועי תקלה בתקופה' },
      { l: 'תפוקה (SAP טובים)', v: num(x.output), n: 'יחידות טובות שנספרו ב-SAP' }
    ];
    const depts = M.depts.map((d) => ({ name: d.name, isZero: !d.output, hasDot: !!d.output, color: d.color, stats: stat4(d), onClick: this.goDrill(d.name) }));
    const sel = M.depts.filter((d) => d.name === st.selectedDept)[0];

    return Object.assign(base, {
      showBanner: false, bannerText: '', srcLabel: st.loading ? 'טוען…' : srcLabel, srcStyle, srcNote,
      plantStats, oeeChart, tdtChart, mtbfChart, outputCombinedChart, outputCombinedDeptPie, productionSkuList,
      tdtStationFaults, mtbfTop3Faults, contributionBulletChart, alerts: alertsOut, depts,
      drillDeptName: st.selectedDept || '', drillMachines: sel ? sel.machines.map((m) => ({ name: m.name, stats: stat4(m) })) : []
    });
  }
}
window.Component = Component;
