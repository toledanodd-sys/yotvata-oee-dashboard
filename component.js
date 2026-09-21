class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { view: 'home', selectedDept: null, shareView: 'dept', tdtView: 'machine', mtbfView: 'machine' };
  }

  goDrill(deptKey) {
    return () => this.setState({ view: 'drill', selectedDept: deptKey });
  }
  goHome() {
    return () => this.setState({ view: 'home' });
  }
  setShareView(v) {
    return () => this.setState({ shareView: v });
  }
  setTdtView(v) {
    return () => this.setState({ tdtView: v });
  }
  setMtbfView(v) {
    return () => this.setState({ mtbfView: v });
  }

  renderVals() {
    const DEPTS = {
      'קרטונים': {
        color: '#B5651D',
        stats: [
          { l: '%TDT', v: '8.1%', n: 'זמן עצירות מתוך זמן כולל' },
          { l: 'OEE', v: '66.7%', n: 'ישירות מדוח ה-OEE' },
          { l: 'MTBF', v: '0:41', n: "זמן ייצור ÷ מס' תקלות (39)" },
          { l: 'תפוקה (SAP טובים)', v: '100,808', n: 'יחידות טובות שנספרו ב-SAP' }
        ],
        machines: [
          { name: 'איליג', stats: [
            { l: '%TDT', v: '4.9%', n: 'זמן עצירות מתוך זמן כולל' },
            { l: 'OEE', v: '58.1%', n: 'ישירות מדוח ה-OEE' },
            { l: 'MTBF', v: '0:44', n: "זמן ייצור ÷ מס' תקלות (5)" },
            { l: 'תפוקה (SAP טובים)', v: '9,548', n: 'יחידות טובות שנספרו ב-SAP' }
          ]},
          { name: 'טטרה', stats: [
            { l: '%TDT', v: '6.1%', n: 'זמן עצירות מתוך זמן כולל' },
            { l: 'OEE', v: '81.3%', n: 'ישירות מדוח ה-OEE' },
            { l: 'MTBF', v: '0:39', n: "זמן ייצור ÷ מס' תקלות (14)" },
            { l: 'תפוקה (SAP טובים)', v: '19,308', n: 'יחידות טובות שנספרו ב-SAP' }
          ]},
          { name: 'מרין', stats: [
            { l: '%TDT', v: '11.6%', n: 'זמן עצירות מתוך זמן כולל' },
            { l: 'OEE', v: '62.8%', n: 'ישירות מדוח ה-OEE' },
            { l: 'MTBF', v: '0:41', n: "זמן ייצור ÷ מס' תקלות (20)" },
            { l: 'תפוקה (SAP טובים)', v: '71,952', n: 'יחידות טובות שנספרו ב-SAP' }
          ]}
        ]
      },
      'בקבוקים': {
        color: '#C9932E',
        stats: [
          { l: '%TDT', v: '21.2%', n: 'זמן עצירות מתוך זמן כולל' },
          { l: 'OEE', v: '64.4%', n: 'ישירות מדוח ה-OEE' },
          { l: 'MTBF', v: '0:31', n: "זמן ייצור ÷ מס' תקלות (61)" },
          { l: 'תפוקה (SAP טובים)', v: '268,766', n: 'יחידות טובות שנספרו ב-SAP' }
        ],
        machines: [
          { name: 'קומבי', stats: [
            { l: '%TDT', v: '30.1%', n: 'זמן עצירות מתוך זמן כולל' },
            { l: 'OEE', v: '53.9%', n: 'ישירות מדוח ה-OEE' },
            { l: 'MTBF', v: '0:21', n: "זמן ייצור ÷ מס' תקלות (36)" },
            { l: 'תפוקה (SAP טובים)', v: '154,272', n: 'יחידות טובות שנספרו ב-SAP' }
          ]},
          { name: 'מטריקס', stats: [
            { l: '%TDT', v: '11.1%', n: 'זמן עצירות מתוך זמן כולל' },
            { l: 'OEE', v: '76.3%', n: 'ישירות מדוח ה-OEE' },
            { l: 'MTBF', v: '0:45', n: "זמן ייצור ÷ מס' תקלות (25)" },
            { l: 'תפוקה (SAP טובים)', v: '114,494', n: 'יחידות טובות שנספרו ב-SAP' }
          ]}
        ]
      },
      'שקיות משקאות': {
        color: '#4A7A6E',
        stats: [
          { l: '%TDT', v: '12.4%', n: 'זמן עצירות מתוך זמן כולל' },
          { l: 'OEE', v: '30.6%', n: 'ישירות מדוח ה-OEE' },
          { l: 'MTBF', v: '0:40', n: "זמן ייצור ÷ מס' תקלות (7)" },
          { l: 'תפוקה (SAP טובים)', v: '7,425', n: 'יחידות טובות שנספרו ב-SAP' }
        ],
        machines: [
          { name: 'טימון', stats: [
            { l: '%TDT', v: '4.9%', n: 'זמן עצירות מתוך זמן כולל' },
            { l: 'OEE', v: '34.1%', n: 'ישירות מדוח ה-OEE' },
            { l: 'MTBF', v: '1:16', n: "זמן ייצור ÷ מס' תקלות (2)" },
            { l: 'תפוקה (SAP טובים)', v: '4,185', n: 'יחידות טובות שנספרו ב-SAP' }
          ]},
          { name: 'פומבה', stats: [
            { l: '%TDT', v: '20%', n: 'זמן עצירות מתוך זמן כולל' },
            { l: 'OEE', v: '27.2%', n: 'ישירות מדוח ה-OEE' },
            { l: 'MTBF', v: '0:26', n: "זמן ייצור ÷ מס' תקלות (5)" },
            { l: 'תפוקה (SAP טובים)', v: '3,240', n: 'יחידות טובות שנספרו ב-SAP' }
          ]}
        ]
      },
      'כוכבים': {
        color: null,
        isZero: true,
        stats: [
          { l: '%TDT', v: '0%', n: 'זמן עצירות מתוך זמן כולל' },
          { l: 'OEE', v: '0%', n: 'ישירות מדוח ה-OEE' },
          { l: 'MTBF', v: '—', n: 'אין אירועי תקלה בתקופה' },
          { l: 'תפוקה (SAP טובים)', v: '23,805', n: 'יחידות טובות שנספרו ב-SAP' }
        ],
        machines: [
          { name: 'גלאקסי', stats: [
            { l: '%TDT', v: '0%', n: 'זמן עצירות מתוך זמן כולל' },
            { l: 'OEE', v: '0%', n: 'ישירות מדוח ה-OEE' },
            { l: 'MTBF', v: '—', n: 'אין אירועי תקלה בתקופה' },
            { l: 'תפוקה (SAP טובים)', v: '23,805', n: 'יחידות טובות שנספרו ב-SAP' }
          ]}
        ]
      }
    };

    const plantStats = [
      { l: 'OEE', v: '58.4%', n: 'ישירות מדוח ה-OEE',
        tt: { yest: '61.2%', yestDelta: '▼ 2.8 נק\' מאתמול', week: '59.5%', weekDelta: '▼ 1.1 נק\' מהממוצע' } },
      { l: '%TDT', v: '17.5%', n: 'זמן עצירות מתוך זמן כולל',
        tt: { yest: '14.9%', yestDelta: '▲ 2.6 נק\' מאתמול (החמרה)', week: '15.8%', weekDelta: '▲ 1.7 נק\' מהממוצע (החמרה)' } },
      { l: 'תפוקה (SAP טובים)', v: '400,804', n: 'יחידות טובות שנספרו ב-SAP',
        tt: { yest: '418,200', yestDelta: '▼ 4.2% מאתמול', week: '405,900', weekDelta: '▼ 1.3% מהממוצע' } },
      { l: 'MTBF', v: '0:35', n: "זמן ייצור ÷ מס' תקלות (107)",
        tt: { yest: '0:41', yestDelta: '▼ מאתמול (החמרה)', week: '0:38', weekDelta: '▼ מהממוצע (החמרה)' } }
    ];

    const alerts = [
      {
        level: 'crit',
        title: 'קומבי (בקבוקים) — הפסד הנק\' הגדול ביותר מול היעד העצמי שלה',
        detail: "OEE 53.9% מול יעד 60% שלה — 2.38 נק' OEE מפעלי אבודים היום, הגבוה ביותר מכל מכונה במפעל (אף שיש מכונות עם OEE נמוך יותר, המשקל הגדול של קומבי — 39% — הופך את זה לפגיעה הכי גדולה). הערכה: כ-17.5K יחידות פחות ביחס למה שהייתה מייצרת בקצב היעד (הערכה מבוססת יחס תפוקה/OEE, לא נמדד ישירות)"
      },
      {
        level: 'crit',
        title: 'גלאקסי (כוכבים) — ללא ייצור היום',
        detail: "OEE 0% מול יעד 35% שלה → 2.10 נק' OEE מפעלי אבודים, השני בגודלו. קודם לבדוק אם זו עצירה מתוכננת/סידור עבודה ולא תקלה"
      },
      {
        level: 'warn',
        title: 'שקיות משקאות — כל האגף מתחת ליעד, לא רק מכונה בודדת',
        detail: "גם טימון (34.1% מול יעד 55%) וגם פומבה (27.2% מול יעד 55%) מתחת ליעד שלהן. כששני קווי הייצור באגף חורגים ביחד, כדאי לבדוק גורם משותף (כוח אדם, חומר גלם, משמרת) ולא רק תקלת ציוד נקודתית"
      }
    ];

    const ALERT_COLORS = {
      crit: { row: '#FEF2F2', dot: '#DC2626' },
      warn: { row: '#FFFBEB', dot: '#D97706' },
      info: { row: '#F1F5F9', dot: '#475569' }
    };

    const alertsOut = alerts.map((a) => ({
      title: a.title,
      detail: a.detail,
      rowStyle: 'background:' + ALERT_COLORS[a.level].row + ';',
      dotStyle: 'background:' + ALERT_COLORS[a.level].dot + ';'
    }));

    const DEPT_COLOR = {
      'בקבוקים': '#2a78d6',
      'קרטונים': '#eb6834',
      'שקיות משקאות': '#1baf7a',
      'כוכבים': '#eda100'
    };

    const MACHINES = [
      { name: 'קומבי', dept: 'בקבוקים', oee: 53.9, oeeTarget: 60, output: 154272, outputShare: 38.49, contribution: 21.03, weight: 39, tdt: 30.1, mtbfHours: 0.35, mtbfLabel: '0:21' },
      { name: 'מטריקס', dept: 'בקבוקים', oee: 76.3, oeeTarget: 60, output: 114494, outputShare: 28.57, contribution: 25.93, weight: 34, tdt: 11.1, mtbfHours: 0.75, mtbfLabel: '0:45' },
      { name: 'מרין', dept: 'קרטונים', oee: 62.7, oeeTarget: 50, output: 71952, outputShare: 17.95, contribution: 3.76, weight: 6, tdt: 11.6, mtbfHours: 0.6833, mtbfLabel: '0:41' },
      { name: 'טטרה', dept: 'קרטונים', oee: 81.3, oeeTarget: 62, output: 19308, outputShare: 4.82, contribution: 3.25, weight: 4, tdt: 6.1, mtbfHours: 0.65, mtbfLabel: '0:39' },
      { name: 'איליג', dept: 'קרטונים', oee: 58.1, oeeTarget: 50, output: 9548, outputShare: 2.38, contribution: 2.32, weight: 4, tdt: 4.9, mtbfHours: 0.7333, mtbfLabel: '0:44' },
      { name: 'טימון', dept: 'שקיות משקאות', oee: 34.1, oeeTarget: 55, output: 4185, outputShare: 1.04, contribution: 1.19, weight: 3.5, tdt: 4.9, mtbfHours: 1.2667, mtbfLabel: '1:16' },
      { name: 'פומבה', dept: 'שקיות משקאות', oee: 27.2, oeeTarget: 55, output: 3240, outputShare: 0.81, contribution: 0.95, weight: 3.5, tdt: 20.0, mtbfHours: 0.4333, mtbfLabel: '0:26' },
      { name: 'גלאקסי', dept: 'כוכבים', oee: 0.0, oeeTarget: 35, output: 23805, outputShare: 5.94, contribution: 0.00, weight: 6, tdt: 0.0, mtbfHours: null, mtbfLabel: '—' }
    ];

    if (window.__LIVE) {
      MACHINES.forEach((m) => {
        const l = window.__LIVE[m.name];
        if (l) { m.oeeTarget = l.target; m.weight = l.weight; m.contribution = +(m.weight * m.oee / 100).toFixed(2); }
      });
    }

    const plantOeeTargetWeighted = MACHINES.reduce((sum, m) => sum + m.weight * m.oeeTarget, 0) / 100;
    plantStats[0].n = plantStats[0].n + ' · יעד מפעלי משוקלל (כל מכונה בדיוק ביעד שלה): ' + plantOeeTargetWeighted.toFixed(1) + '%';

    function buildBarChart(getVal, getLabel, opts) {
      opts = opts || {};
      let list = MACHINES.slice();
      if (opts.sortDesc) {
        list = list.sort((a, b) => getVal(b) - getVal(a));
      }
      const vals = list.map(getVal);
      const max = Math.max.apply(null, vals);
      return list.map((m) => {
        let color = opts.fixedColor || DEPT_COLOR[m.dept];
        if (opts.perMachineColor) {
          color = MACHINE_COLOR[m.name];
        }
        if (opts.getTarget) {
          color = (getVal(m) >= opts.getTarget(m)) ? '#16A34A' : '#DC2626';
        }
        const out = {
          name: m.name,
          valueLabel: getLabel(getVal(m)),
          barHeight: Math.round((getVal(m) / max) * 120) + 'px',
          colorStyle: 'background:' + color + ';'
        };
        if (opts.getTarget) {
          out.targetHeight = Math.round((opts.getTarget(m) / max) * 120) + 'px';
        }
        return out;
      });
    }

    const MACHINE_COLOR = {
      'קומבי': '#4E79A7',
      'מטריקס': '#F28E2B',
      'מרין': '#9C755F',
      'טטרה': '#B07AA1',
      'איליג': '#76B7B2',
      'טימון': '#EDC948',
      'פומבה': '#FF9DA7',
      'גלאקסי': '#9D9D9D'
    };

    const oeeChart = buildBarChart((m) => m.oee, (v) => v.toFixed(1) + '%', { sortDesc: true, fixedColor: '#3B77A8', getTarget: (m) => m.oeeTarget });
    const tdtChart = buildBarChart((m) => m.tdt, (v) => v.toFixed(1) + '%', { sortDesc: true, fixedColor: '#3B77A8' });

    // תחנות שבהן נרשמו עצירות מסוג "תקלה" בלבד (סטטוס בדוח RAW) לכל מכונה — לא סטטוסים
    // אחרים כמו הפסקה/המתנה/סט-אפ/זמן ניהולי. מס' דקות מצטבר ומס' אירועים לכל תחנה,
    // מתוך RAW_Fact בפועל (stopGroupStations['תקלה'] במנוע הצבירה).
    const MACHINE_STATION_FAULTS = {
      'קומבי': [
        { station: 'מכונת מילוי', min: 167.7, count: 11 },
        { station: 'מדפסת imaje פג תוקף', min: 103.3, count: 3 },
        { station: 'אלפא', min: 55.78, count: 9 },
        { station: 'ניפוח', min: 49.38, count: 11 },
        { station: 'מסועים', min: 10.82, count: 1 },
        { station: 'פלטייזר: רובוט (FANUC)', min: 1.93, count: 1 }
      ],
      'מטריקס': [
        { station: 'ניפוח-קו מטריקס', min: 59.58, count: 9 },
        { station: 'מכונת מילוי- קו מטריקס', min: 40.15, count: 9 },
        { station: 'סרמקס-קו מטריקס', min: 15.9, count: 1 },
        { station: 'קו מטריקס - FUJI', min: 15.03, count: 3 },
        { station: 'פיקוק', min: 13.9, count: 1 },
        { station: 'קולוס פג תוקף-מטריקס', min: 6.82, count: 1 },
        { station: 'פלטייזר - ממשטח-קו מטריקס', min: 6.5, count: 1 }
      ],
      'מרין': [
        { station: 'מכונת ניפוח ONE BLOW', min: 36.75, count: 5 },
        { station: 'מסועי קו מרין', min: 35.42, count: 1 },
        { station: 'תוויות GERNEP', min: 24.15, count: 5 },
        { station: 'ניפוח מרין', min: 16.42, count: 5 },
        { station: 'עוטפת מרין/לנה', min: 11.15, count: 1 },
        { station: 'רובוט - מרין', min: 4.95, count: 3 }
      ],
      'טטרה': [
        { station: 'מפוקק', min: 24.07, count: 7 },
        { station: 'מכונת מילוי', min: 12.53, count: 6 },
        { station: 'אורז קרטון', min: 6.35, count: 1 }
      ],
      'איליג': [
        { station: 'מסועי קו איליג', min: 10.52, count: 4 },
        { station: 'אורז - איליג', min: 1.35, count: 1 }
      ],
      'טימון': [
        { station: '(ללא תחנה)', min: 13.23, count: 2 }
      ],
      'פומבה': [
        { station: 'פומבה', min: 31.67, count: 1 },
        { station: '(ללא תחנה)', min: 22.42, count: 4 }
      ],
      'גלאקסי': []
    };

    function formatMin(min) {
      const rounded = Math.round(min);
      if (rounded >= 60) {
        const h = Math.floor(rounded / 60), mm = rounded % 60;
        return h + ':' + (mm < 10 ? '0' : '') + mm + ' שעות';
      }
      return rounded + ' דק\'';
    }

    function buildTdtStationFaults() {
      const sorted = MACHINES.slice().sort((a, b) => b.tdt - a.tdt);
      return sorted.map((m) => {
        const stations = (MACHINE_STATION_FAULTS[m.name] || []).slice().sort((a, b) => b.min - a.min).slice(0, 3);
        return {
          name: m.name,
          tdtLabel: 'TDT ' + m.tdt.toFixed(1) + '%',
          isEmpty: stations.length === 0,
          stations: stations.map((s) => ({
            station: s.station,
            durLabel: formatMin(s.min),
            countLabel: s.count === 1 ? 'עצירה אחת' : s.count + ' עצירות'
          }))
        };
      });
    }
    const tdtStationFaults = buildTdtStationFaults();

    function buildMtbfChart() {
      const sorted = MACHINES.slice().sort((a, b) => {
        if (a.mtbfHours === null) return 1;
        if (b.mtbfHours === null) return -1;
        return a.mtbfHours - b.mtbfHours;
      });
      const withData = sorted.filter((m) => m.mtbfHours !== null);
      const maxHours = Math.max.apply(null, withData.map((m) => m.mtbfHours));
      return sorted.map((m) => {
        if (m.mtbfHours === null) {
          return { name: m.name, valueLabel: 'אין תקלות', barHeight: '3px', colorStyle: 'background:#D8D5C8;' };
        }
        return {
          name: m.name,
          valueLabel: m.mtbfLabel,
          barHeight: Math.max(Math.round((m.mtbfHours / maxHours) * 120), 4) + 'px',
          colorStyle: 'background:#3B77A8;'
        };
      });
    }
    const mtbfChart = buildMtbfChart();

    // תיאורי תקלה בפועל לכל מכונה — סטטוס "תקלה" בלבד מדוח RAW, עם מספר המופעים (count),
    // משך מצטבר (min) והתחנה שבה נרשם התיאור (station, מתוך stopGroupStationDetail['תקלה']).
    // שלושת התיאורים עם הכי הרבה מופעים = TOP 3 להצגה.
    const MACHINE_FAULT_DESCRIPTIONS = {
      'קומבי': [
        { desc: 'מבחנה שבורה נתקעה בסורטר', station: 'ניפוח', count: 10, min: 30.98 },
        { desc: 'תקלה באקומולצית חיישנים מערך פיקוק', station: 'מכונת מילוי', count: 8, min: 38.28 },
        { desc: 'בעיה בזיהוי קו עין', station: 'אלפא', count: 6, min: 36.75 },
        { desc: 'תקלת חשמל', station: 'מדפסת imaje פג תוקף', count: 2, min: 18.40 },
        { desc: 'תקלה ביחידת מחסנית תוויות', station: 'אלפא', count: 2, min: 16.78 }
      ],
      'מטריקס': [
        { desc: 'תקלת חיישנים', station: 'קו מטריקס - FUJI', count: 4, min: 20.38 },
        { desc: 'תקלה בסורטר מבחנות', station: 'ניפוח-קו מטריקס', count: 4, min: 13.28 },
        { desc: 'מילוי לא תקין', station: 'מכונת מילוי- קו מטריקס', count: 3, min: 9.75 },
        { desc: 'תקלה במהפך דולבים', station: 'ניפוח-קו מטריקס', count: 2, min: 25.13 },
        { desc: 'תקלה מערכת חיישנים', station: 'מכונת מילוי- קו מטריקס', count: 2, min: 16.73 }
      ],
      'מרין': [
        { desc: 'תבנית 1', station: 'מכונת ניפוח ONE BLOW', count: 5, min: 36.75 },
        { desc: 'מכונת ניפוח ONE BLOW', station: 'ניפוח מרין', count: 5, min: 16.42 },
        { desc: 'אחר', station: 'רובוט - מרין', count: 4, min: 16.10 },
        { desc: 'שולחן', station: 'תוויות GERNEP', count: 3, min: 20.93 }
      ],
      'טטרה': [
        { desc: 'משיכת קרטון לא עובדת', station: 'אורז קרטון', count: 2, min: 7.48 },
        { desc: 'קלאץ\' לא במקום', station: 'מפוקק', count: 2, min: 3.65 },
        { desc: 'מערכת חימום בלאוור תקולה', station: 'מפוקק', count: 2, min: 2.87 }
      ],
      'איליג': [
        { desc: 'מסוע לא עובד', station: 'מסועי קו איליג', count: 3, min: 8.05 },
        { desc: 'תקלה במערכת שוטרים', station: 'מסועי קו איליג', count: 1, min: 2.47 },
        { desc: 'תקלה במסוע הזנת גביעים', station: 'אורז - איליג', count: 1, min: 1.35 }
      ],
      'טימון': [
        { desc: 'עצירה לא מוסברת', station: '(ללא תחנה)', count: 2, min: 13.23 }
      ],
      'פומבה': [
        { desc: 'עצירה לא מוסברת', station: '(ללא תחנה)', count: 4, min: 22.42 },
        { desc: 'אחר', station: 'פומבה', count: 1, min: 31.67 }
      ],
      'גלאקסי': []
    };

    function mtbfSortCompare(a, b) {
      if (a.mtbfHours === null) return 1;
      if (b.mtbfHours === null) return -1;
      return a.mtbfHours - b.mtbfHours;
    }

    const VAGUE_FAULT_DESCS = ['אחר', 'עצירה לא מוסברת'];

    function buildMtbfTop3Faults() {
      const sorted = MACHINES.slice().sort(mtbfSortCompare);
      return sorted.map((m) => {
        const faults = (MACHINE_FAULT_DESCRIPTIONS[m.name] || []).slice().sort((a, b) => b.count - a.count).slice(0, 3);
        return {
          name: m.name,
          mtbfLabel: 'MTBF ' + m.mtbfLabel,
          isEmpty: faults.length === 0,
          faults: faults.map((f) => {
            const isVague = VAGUE_FAULT_DESCS.indexOf(f.desc) !== -1;
            return {
              desc: f.desc,
              station: f.station,
              countLabel: f.count === 1 ? 'מופע אחד' : f.count + ' מופעים',
              durLabel: formatMin(f.min) + ' סה"כ',
              descStyle: isVague ? 'font-style:italic; color:#D97706; font-weight:700;' : ''
            };
          })
        };
      });
    }
    const mtbfTop3Faults = buildMtbfTop3Faults();

    function buildOutputCombinedChart() {
      const list = MACHINES.slice().sort((a, b) => b.output - a.output);
      const maxOut = Math.max.apply(null, list.map((m) => m.output));
      return list.map((m) => ({
        name: m.name,
        valueLabel: formatK(m.output),
        shareLabel: m.outputShare.toFixed(1) + '%',
        barHeight: Math.round((m.output / maxOut) * 120) + 'px',
        colorStyle: 'background:#3B77A8;'
      }));
    }
    const outputCombinedChart = buildOutputCombinedChart();

    // ייצור בפועל לפי מק"ט לכל מכונה — sku, שם המוצר (desc) וכמות (qty, ליטר/יח').
    // מתוך machine_drilldown.json['<machine>'].production בפועל (שורות ריקות/מק"ט חסר הוסרו).
    function fmtQty(qty, unit) {
      const rounded = Math.round(qty);
      const withCommas = rounded.toLocaleString('en-US');
      return withCommas + (unit ? ' ' + unit : '');
    }

    const MACHINE_SKU_PRODUCTION = {
      'קומבי': [
        { sku: '347799', desc: 'חלב בבקבוק נטול לקטוז 2%', qty: 53687, unit: 'ליטר' },
        { sku: '344073', desc: 'חלב בבקבוק 3% מועשר- מהדרין', qty: 44060, unit: 'ליטר' },
        { sku: '346958', desc: 'חלב 3% בבקבוק 1 ליטר', qty: 42875, unit: 'ליטר' },
        { sku: '343666', desc: 'שוקו 1 ליטר', qty: 3151, unit: 'ליטר' }
      ],
      'מטריקס': [
        { sku: '365089', desc: 'יטבתה פרו קפה 350 מ"ל', qty: 90546, unit: 'ליטר' },
        { sku: '364774', desc: 'יטבתה פרו שוקולד אגוזים לל"ס 350 מל', qty: 24577, unit: 'ליטר' }
      ],
      'מרין': [
        { sku: '351247', desc: 'חלב 3% בקבוק 2 ליטר', qty: 67640, unit: 'ליטר' },
        { sku: '351519', desc: 'שמנת מתוקה 42%, 2 ליטר', qty: 3206, unit: 'ליטר' }
      ],
      'טטרה': [
        { sku: '364871', desc: 'שמנת לבישול 9%', qty: 17970, unit: 'ליטר' }
      ],
      'איליג': [
        { sku: '217122', desc: 'שמנת חמוצה 15% מועשרת מהדרין', qty: 9430, unit: 'ליטר' }
      ],
      'טימון': [
        { sku: '329103', desc: 'מארז 6 שקיות מוקה', qty: 3998, unit: 'ליטר' }
      ],
      'פומבה': [
        { sku: '329103', desc: 'מארז 6 שקיות מוקה', qty: 3453, unit: 'ליטר' }
      ],
      'גלאקסי': []
    };

    function buildProductionSkuList() {
      const sorted = MACHINES.slice().sort((a, b) => b.output - a.output);
      return sorted.map((m) => {
        const skus = (MACHINE_SKU_PRODUCTION[m.name] || []).slice().sort((a, b) => b.qty - a.qty);
        return {
          name: m.name,
          totalLabel: formatK(m.output),
          isEmpty: skus.length === 0,
          skus: skus.map((p) => ({
            sku: p.sku,
            desc: p.desc,
            qtyLabel: fmtQty(p.qty, p.unit)
          }))
        };
      });
    }
    const productionSkuList = buildProductionSkuList();

    function buildOutputCombinedDeptPie() {
      const deptNames = Object.keys(DEPT_COLOR);
      const totals = deptNames.map((d) => {
        const rows = MACHINES.filter((m) => m.dept === d);
        return {
          name: d,
          output: rows.reduce((sum, m) => sum + m.output, 0),
          share: rows.reduce((sum, m) => sum + m.outputShare, 0)
        };
      });
      const grandTotal = totals.reduce((sum, t) => sum + t.output, 0) || 1;
      const CX = 100, CY = 100, R = 92;
      let cumAngle = -90;
      return totals.map((t) => {
        const pct = (t.output / grandTotal) * 100;
        const angle = (pct / 100) * 360;
        const startAngle = cumAngle;
        const endAngle = cumAngle + angle;
        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;
        const x1 = CX + R * Math.cos(startRad);
        const y1 = CY + R * Math.sin(startRad);
        const x2 = CX + R * Math.cos(endRad);
        const y2 = CY + R * Math.sin(endRad);
        const largeArc = angle > 180 ? 1 : 0;
        const path = 'M ' + CX + ' ' + CY + ' L ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
          ' A ' + R + ' ' + R + ' 0 ' + largeArc + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z';
        const midAngle = (startAngle + endAngle) / 2;
        const midRad = (midAngle * Math.PI) / 180;
        const labelR = R * 0.62;
        const labelX = CX + labelR * Math.cos(midRad);
        const labelY = CY + labelR * Math.sin(midRad);
        cumAngle = endAngle;
        return {
          name: t.name,
          valueLabel: formatK(t.output),
          shareLabel: t.share.toFixed(1) + '%',
          fillStyle: 'fill:' + DEPT_COLOR[t.name] + ';',
          dotStyle: 'background:' + DEPT_COLOR[t.name] + ';',
          path,
          labelX: labelX.toFixed(1),
          labelY: labelY.toFixed(1),
          showLabel: pct >= 8
        };
      });
    }

    const outputCombinedDeptPie = buildOutputCombinedDeptPie();
    const shareView = this.state.shareView;
    const isShareDept = shareView !== 'machine' && shareView !== 'sku';
    const isShareMachine = shareView === 'machine';
    const isShareSku = shareView === 'sku';
    const TAB_ACTIVE = 'background:#1c2b45;color:#fff;border-color:#1c2b45;';
    const TAB_INACTIVE = '';
    const shareMachineTabStyle = isShareMachine ? TAB_ACTIVE : TAB_INACTIVE;
    const shareDeptTabStyle = isShareDept ? TAB_ACTIVE : TAB_INACTIVE;
    const shareSkuTabStyle = isShareSku ? TAB_ACTIVE : TAB_INACTIVE;

    const tdtView = this.state.tdtView;
    const isTdtViewMachine = tdtView !== 'stations';
    const isTdtViewStations = tdtView === 'stations';
    const tdtViewMachineTabStyle = isTdtViewMachine ? TAB_ACTIVE : TAB_INACTIVE;
    const tdtViewStationsTabStyle = isTdtViewStations ? TAB_ACTIVE : TAB_INACTIVE;

    const mtbfView = this.state.mtbfView;
    const isMtbfViewMachine = mtbfView !== 'faults';
    const isMtbfViewFaults = mtbfView === 'faults';
    const mtbfViewMachineTabStyle = isMtbfViewMachine ? TAB_ACTIVE : TAB_INACTIVE;
    const mtbfViewFaultsTabStyle = isMtbfViewFaults ? TAB_ACTIVE : TAB_INACTIVE;

    function formatK(v) {
      return (v / 1000).toFixed(1) + 'K';
    }

    function buildContributionBulletChart() {
      const list = MACHINES.map((m) => {
        const target = (m.weight * m.oeeTarget) / 100;
        const actual = m.contribution;
        const pct = target > 0 ? (actual / target) * 100 : 0;
        return { name: m.name, actual: actual, target: target, pct: pct, good: actual >= target };
      });
      list.sort((a, b) => b.pct - a.pct);
      return list.map((d) => {
        const scaleMax = (d.target * 1.5) || 1;
        const fillPct = Math.min((d.actual / scaleMax) * 100, 100);
        const targetPct = (d.target / scaleMax) * 100;
        const color = d.good ? '#16A34A' : '#DC2626';
        return {
          name: d.name,
          fillWidth: fillPct.toFixed(1) + '%',
          targetPos: targetPct.toFixed(1) + '%',
          colorStyle: 'background:' + color + ';',
          targetLabel: 'יעד ' + d.target.toFixed(2),
          pointsLabel: d.actual.toFixed(2),
          labelColorStyle: 'color:' + color + ';'
        };
      });
    }
    const contributionBulletChart = buildContributionBulletChart();

    const depts = Object.keys(DEPTS).map((name) => {
      const d = DEPTS[name];
      return {
        name,
        isZero: !!d.isZero,
        hasDot: !d.isZero,
        color: d.color,
        stats: d.stats,
        onClick: this.goDrill(name)
      };
    });

    const view = this.state.view;
    const selected = this.state.selectedDept ? DEPTS[this.state.selectedDept] : null;

    return {
      isHome: view === 'home',
      isDrill: view === 'drill',
      plantStats,
      oeeChart,
      tdtChart,
      mtbfChart,
      outputCombinedChart,
      outputCombinedDeptPie,
      isShareMachine,
      isShareDept,
      isShareSku,
      shareMachineTabStyle,
      shareDeptTabStyle,
      shareSkuTabStyle,
      setShareMachineFn: this.setShareView('machine'),
      setShareDeptFn: this.setShareView('dept'),
      setShareSkuFn: this.setShareView('sku'),
      productionSkuList,
      isTdtViewMachine,
      isTdtViewStations,
      tdtViewMachineTabStyle,
      tdtViewStationsTabStyle,
      setTdtViewMachineFn: this.setTdtView('machine'),
      setTdtViewStationsFn: this.setTdtView('stations'),
      tdtStationFaults,
      isMtbfViewMachine,
      isMtbfViewFaults,
      mtbfViewMachineTabStyle,
      mtbfViewFaultsTabStyle,
      setMtbfViewMachineFn: this.setMtbfView('machine'),
      setMtbfViewFaultsFn: this.setMtbfView('faults'),
      mtbfTop3Faults,
      contributionBulletChart,
      alerts: alertsOut,
      depts,
      drillDeptName: this.state.selectedDept || '',
      drillMachines: selected ? selected.machines : [],
      onBack: this.goHome()
    };
  }
}
window.Component = Component;
