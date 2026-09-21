/* Settings screen (admin only) — built from the approved canvas mockup "הגדרות מערכת".
 * Same layout and styles as the mockup; data is live from Supabase and every change is
 * saved through database functions that keep a dated history. */
(function () {
  'use strict';

  var API = window.OEE_API;
  var root, appRole;

  // ---------- small helpers ----------
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function addDays(iso, n) {
    var p = iso.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function num(v, digits) {
    if (v === null || v === undefined || v === '') return '—';
    var n = Number(v);
    var d = digits === undefined ? 2 : digits;
    return String(Math.round(n * Math.pow(10, d)) / Math.pow(10, d));
  }
  function validOn(row, day) { return row.valid_from <= day && (!row.valid_to || row.valid_to >= day); }
  function currentOf(rows, day) { return rows.filter(function (r) { return validOn(r, day); })[0] || null; }
  function futureOf(rows, day) {
    return rows.filter(function (r) { return r.valid_from > day; })
      .sort(function (a, b) { return a.valid_from < b.valid_from ? -1 : 1; })[0] || null;
  }
  function byId(list) { var m = {}; list.forEach(function (x) { m[x.id] = x; }); return m; }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function numOrNull(s) { s = String(s || '').trim(); return s === '' ? null : Number(s); }

  var TYPE = {
    PRODUCTION: { c: 's-type t-prod', l: 'ייצור' },
    PDT: { c: 's-type t-pdt', l: 'PDT' },
    UPDT: { c: 's-type t-updt', l: 'UPDT' },
    PROCESS_FAILURE: { c: 's-type t-proc', l: 'כשל בתהליך' },
    NOT_COUNTED: { c: 's-type t-none', l: 'לא נספר' }
  };
  var TYPE_OPTIONS = [
    ['PRODUCTION', 'ייצור'], ['PDT', 'PDT · מתוכנן'], ['UPDT', 'UPDT · לא מתוכנן'],
    ['PROCESS_FAILURE', 'כשל בתהליך'], ['NOT_COUNTED', 'לא נספר']
  ];
  var VAGUE = ['אחר', 'עצירה לא מוסברת'];

  // ---------- state ----------
  var S = {
    mode: 'login',          // login | signup | loading | notadmin | ready
    tab: 'targets',
    data: null,
    selMachineId: null,
    form: null,             // { kind: 'weights' | 'rule' | 'product' | 'machine' | 'dept', ... }
    prodFilter: 'all',
    search: '',
    busy: false,
    authMsg: '',
    dirty: false
  };

  function toast(msg, isErr) {
    var t = document.createElement('div');
    t.className = 's-toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, isErr ? 6000 : 2600);
  }

  // ---------- data ----------
  function loadData() {
    return Promise.all([
      API.select('departments?select=*&order=sort_order'),
      API.select('machines?select=*&order=sort_order'),
      API.select('machine_oee_targets?select=*&order=valid_from.desc'),
      API.select('machine_weights?select=*&order=valid_from.desc'),
      API.select('products?select=*'),
      API.select('product_target_rates?select=*&order=valid_from.desc'),
      API.select('classification_rules?select=*'),
      API.select('v_unclassified_combos?select=*&order=events.desc'),
      API.select('v_missing_rates?select=*&order=events.desc')
    ]).then(function (r) {
      S.data = {
        depts: r[0], machines: r[1], targets: r[2], weights: r[3], products: r[4],
        rates: r[5], rules: r[6], unclassified: r[7], missing: r[8]
      };
      var active = S.data.machines.filter(function (m) { return m.is_active; });
      if (!S.selMachineId && active.length) S.selMachineId = active[0].id;
    });
  }

  function reloadAndRender(msg) {
    return loadData().then(function () {
      S.dirty = true;
      render();
      if (msg) toast(msg);
    });
  }

  function run(promise, okMsg) {
    S.busy = true;
    return promise.then(function () {
      S.form = null;
      S.busy = false;
      return reloadAndRender(okMsg);
    }).catch(function (e) {
      S.busy = false;
      toast(e.message || 'השמירה נכשלה', true);
    });
  }

  // ---------- auth flow ----------
  function afterSignIn() {
    S.mode = 'loading';
    render();
    return API.rpc('am_i_admin').then(function (isAdmin) {
      if (!isAdmin) { S.mode = 'notadmin'; render(); return; }
      return loadData().then(function () { S.mode = 'ready'; render(); });
    }).catch(function (e) {
      S.mode = 'login';
      S.authMsg = e.message;
      render();
    });
  }

  function start() {
    if (API.session()) afterSignIn();
    else { S.mode = 'login'; render(); }
  }

  // ---------- rendering ----------
  function render() {
    if (!root) return;
    var html = '<div class="page">';
    html += '<a class="s-back" href="#/">→ חזרה לדשבורד</a>';
    if (S.mode === 'login' || S.mode === 'signup') html += renderLogin();
    else if (S.mode === 'loading') html += '<div class="s-loading">טוען הגדרות…</div>';
    else if (S.mode === 'notadmin') html += renderNotAdmin();
    else html += renderReady();
    html += '</div>';
    root.innerHTML = html;
    afterRender();
  }

  function renderLogin() {
    var signup = S.mode === 'signup';
    var h = '<div class="s-login"><div class="s-panel">';
    h += '<h1 class="s-h2" style="font-size: 20px;">' + (signup ? 'יצירת חשבון מנהל' : 'כניסת מנהל מערכת') + '</h1>';
    h += '<div class="s-muted" style="margin-bottom: 16px;">' + (signup
      ? 'פעם אחת בלבד. החשבון הראשון שנוצר במערכת מקבל הרשאות מנהל.'
      : 'המסך הזה מיועד רק למנהל המערכת. עובדי המפעל לא צריכים חשבון — הם פשוט צופים בדשבורד.') + '</div>';
    h += '<form id="auth-form">';
    h += '<div class="s-field"><label for="a-email">אימייל</label><input id="a-email" class="s-input" type="email" autocomplete="username" required dir="ltr"></div>';
    h += '<div class="s-field"><label for="a-pass">סיסמה</label><input id="a-pass" class="s-input" type="password" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" required minlength="6" dir="ltr"></div>';
    if (signup) h += '<div class="s-field"><label for="a-pass2">אימות סיסמה</label><input id="a-pass2" class="s-input" type="password" autocomplete="new-password" required minlength="6" dir="ltr"></div>';
    if (S.authMsg) h += '<div class="s-muted s-bad" style="margin-bottom: 10px;">' + esc(S.authMsg) + '</div>';
    h += '<button class="s-btn" type="submit" style="width: 100%;"' + (S.busy ? ' disabled' : '') + '>' + (signup ? 'יצירת חשבון' : 'כניסה') + '</button>';
    h += '</form>';
    h += '<button class="s-link" type="button" data-act="toggle-signup">' + (signup ? 'כבר יש לי חשבון — כניסה' : 'פעם ראשונה? יצירת חשבון מנהל') + '</button>';
    h += '</div></div>';
    return h;
  }

  function renderNotAdmin() {
    var s = API.session();
    return '<div class="s-login"><div class="s-panel"><h1 class="s-h2">אין הרשאת מנהל</h1>' +
      '<div class="s-muted" style="margin-bottom: 14px;">החשבון ' + esc(s && s.user.email) +
      ' מחובר, אבל הוא לא מוגדר כמנהל המערכת, ולכן אי אפשר לשנות ממנו הגדרות.</div>' +
      '<button class="s-btn s-btn-ghost" type="button" data-act="logout">יציאה</button></div></div>';
  }

  function renderReady() {
    var d = S.data;
    var s = API.session();
    var pendingRules = d.unclassified.length;
    var pendingRates = d.missing.length;
    var h = '';
    h += '<div class="s-top"><div><h1 class="s-title">הגדרות מערכת</h1>' +
      '<div class="s-sub">גלוי רק למנהל המערכת. כל שינוי נשמר עם תאריך כניסה לתוקף, כך שחישובים על תקופות קודמות נשארים לפי הערכים שהיו אז</div></div>' +
      '<div class="s-admin"><span class="s-admin-dot"></span><span>מחובר כמנהל · <span dir="ltr">' + esc(s && s.user.email) + '</span></span>' +
      '<button type="button" data-act="logout">יציאה</button></div></div>';

    var NAV = [
      { key: 'targets', label: 'יעדים ומשקלים', badge: '' },
      { key: 'rules', label: 'כללי סיווג', badge: pendingRules ? pendingRules + ' לסיווג' : '' },
      { key: 'products', label: 'מוצרים וקצב מטרה', badge: pendingRates ? pendingRates + ' חסרים' : '' },
      { key: 'machines', label: 'מכונות ואגפים', badge: '' }
    ];
    h += '<div class="s-layout"><nav class="s-nav" aria-label="קטגוריות הגדרות">';
    NAV.forEach(function (n) {
      h += '<button class="s-nav-item" type="button" data-act="tab" data-tab="' + n.key + '"' +
        (n.key === S.tab ? ' style="background: #1c2b45; color: #FFFFFF;" aria-current="page"' : '') + '><span>' + n.label + '</span>' +
        (n.badge ? '<span class="s-nav-badge">' + esc(n.badge) + '</span>' : '') + '</button>';
    });
    h += '<div class="s-nav-hint">עובדי המפעל לא רואים את המסך הזה ולא יכולים לשנות אף ערך — הם רק צופים בדשבורד</div></nav><div>';
    if (S.tab === 'targets') h += renderTargets();
    else if (S.tab === 'rules') h += renderRules();
    else if (S.tab === 'products') h += renderProducts();
    else h += renderMachines();
    h += '</div></div>';
    return h;
  }

  // ----- targets & weights -----
  function machineRows() {
    var d = S.data, day = todayISO();
    var deptById = byId(d.depts);
    return d.machines.filter(function (m) { return m.is_active; }).map(function (m) {
      var ts = d.targets.filter(function (t) { return t.machine_id === m.id; });
      var ws = d.weights.filter(function (w) { return w.machine_id === m.id; });
      return {
        m: m, dept: deptById[m.department_id] || { name: '—', color: '#999' },
        t: currentOf(ts, day), tf: futureOf(ts, day), w: currentOf(ws, day), wf: futureOf(ws, day),
        ts: ts, ws: ws
      };
    });
  }

  function renderTargets() {
    var d = S.data;
    var rows = machineRows();
    var sumW = rows.reduce(function (a, r) { return a + (r.w ? Number(r.w.plant_weight) : 0); }, 0);
    var wTarget = rows.reduce(function (a, r) { return a + (r.w && r.t ? Number(r.w.plant_weight) * Number(r.t.oee_target) : 0); }, 0) / 100;
    var last = d.targets.concat(d.weights).map(function (x) { return x.valid_from; }).sort().pop();
    var sumOk = Math.round(sumW * 100) / 100 === 100;

    var h = '<div class="s-summary">';
    h += '<div class="s-sum-card"><div class="s-sum-l">סה"כ משקלים במפעל</div><div class="s-sum-v ' + (sumOk ? 's-ok' : 's-bad') + '">' + num(sumW) + '% ' + (sumOk ? '✓' : '✗') + '</div><div class="s-sum-n">חייב להסתכם ל-100% — אחרת השמירה נחסמת</div></div>';
    h += '<div class="s-sum-card"><div class="s-sum-l">יעד OEE מפעלי משוקלל</div><div class="s-sum-v">' + num(wTarget, 1) + '%</div><div class="s-sum-n">מחושב אוטומטית: Σ משקל × יעד</div></div>';
    h += '<div class="s-sum-card"><div class="s-sum-l">תאריך השינוי האחרון</div><div class="s-sum-v" style="font-size: 18px; margin-top: 8px;">' + fmtDate(last) + '</div><div class="s-sum-n">מועד הכניסה לתוקף של הערך העדכני ביותר</div></div>';
    h += '</div>';

    if (S.form && S.form.kind === 'weights') return h + renderWeightsEditor(rows);

    h += '<div class="s-panel"><div class="s-panel-head"><div><h2 class="s-h2">יעדי OEE ומשקלים לפי מכונה</h2>' +
      '<div class="s-muted">הערכים שבתוקף היום. לחיצה על "עדכון" פותחת את טופס השינוי וההיסטוריה של המכונה</div></div>' +
      '<button class="s-btn s-btn-ghost" type="button" data-act="open-weights">עדכון משקלים לכל המכונות</button></div>';
    h += '<div class="s-table-wrap"><table class="s-table"><thead><tr><th>אגף</th><th>מכונה</th><th>יעד OEE</th><th>משקל במפעל</th><th>משקל באגף</th><th>בתוקף מ-</th><th></th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var sel = r.m.id === S.selMachineId;
      h += '<tr class="' + (sel ? 's-row-sel' : '') + '">';
      h += '<td><span class="s-dept"><span class="s-dot" style="background:' + esc(r.dept.color) + ';"></span>' + esc(r.dept.name) + '</span></td>';
      h += '<td style="font-weight: 700;">' + esc(r.m.name) + '</td>';
      h += '<td class="s-num">' + (r.t ? num(r.t.oee_target) + '%' : '<span class="s-unk">חסר</span>') +
        (r.tf ? ' <span class="s-future">' + num(r.tf.oee_target) + '% מ-' + fmtDate(r.tf.valid_from) + '</span>' : '') + '</td>';
      h += '<td class="s-num">' + (r.w ? num(r.w.plant_weight) + '%' : '<span class="s-unk">חסר</span>') + '</td>';
      h += '<td class="s-num">' + (r.w && r.w.department_weight !== null ? num(r.w.department_weight) + '%' : '—') + '</td>';
      h += '<td class="s-code">' + fmtDate(r.t && r.t.valid_from) + '</td>';
      h += '<td style="text-align: left;"><button class="s-btn s-btn-ghost s-btn-sm" type="button" data-act="sel-machine" data-id="' + r.m.id + '">עדכון</button></td></tr>';
    });
    h += '</tbody></table></div></div>';

    var sel = rows.filter(function (r) { return r.m.id === S.selMachineId; })[0];
    if (!sel) return h;
    var curT = sel.t ? num(sel.t.oee_target) : '';
    var defFrom = addDays(todayISO(), 1);
    h += '<div class="s-panel"><h2 class="s-h2" style="margin-bottom: 14px;">עדכון יעד OEE — ' + esc(sel.m.name) + '</h2><div class="s-edit-grid"><div>';
    h += '<div class="s-input-row">';
    h += '<div class="s-field"><label for="f-target">יעד OEE חדש (%)</label><input id="f-target" class="s-input" type="number" min="0" max="100" step="0.1" value="' + esc(curT) + '"></div>';
    h += '<div class="s-field"><label for="f-from">בתוקף מתאריך</label><input id="f-from" class="s-input" type="date" value="' + defFrom + '"></div>';
    h += '</div>';
    h += '<div class="s-field"><label for="f-note">סיבת השינוי (לא חובה)</label><input id="f-note" class="s-input" type="text"></div>';
    h += '<div class="s-preview" id="target-preview"></div>';
    h += '<div class="s-actions"><button class="s-btn" type="button" data-act="save-target" data-id="' + sel.m.id + '">שמירה</button>' +
      '<span class="s-spacer"></span><button class="s-btn s-btn-ghost s-btn-sm" type="button" data-act="open-weights">שינוי משקלים (כל המכונות יחד)</button></div>';
    h += '</div><div><h3 class="s-h3">היסטוריית שינויים — ' + esc(sel.m.name) + '</h3>';
    var hist = sel.ts.map(function (t) { return { v: num(t.oee_target) + '%', kind: 'יעד OEE', r: t }; })
      .concat(sel.ws.map(function (w) {
        return { v: num(w.plant_weight) + '%', kind: 'משקל במפעל' + (w.department_weight !== null ? ' (באגף ' + num(w.department_weight) + '%)' : ''), r: w };
      }))
      .sort(function (a, b) { return a.r.valid_from < b.r.valid_from ? 1 : a.r.valid_from > b.r.valid_from ? -1 : 0; });
    hist.forEach(function (x, i) {
      h += '<div class="s-hist-item"' + (i === hist.length - 1 ? ' style="border-bottom: none;"' : '') + '><span class="s-hist-v">' + esc(x.v) + '</span><span>' +
        esc(x.kind) + ' · ' + fmtDate(x.r.valid_from) + (x.r.valid_to ? ' עד ' + fmtDate(x.r.valid_to) : ' ואילך') +
        (x.r.notes ? ' · ' + esc(x.r.notes) : '') + '</span></div>';
    });
    h += '</div></div></div>';
    return h;
  }

  function renderWeightsEditor(rows) {
    var d = S.data;
    var h = '<div class="s-panel"><div class="s-panel-head"><div><h2 class="s-h2">עדכון משקלים — כל המכונות יחד</h2>' +
      '<div class="s-muted">משקל במפעל חייב להסתכם ל-100%, ומשקל באגף חייב להסתכם ל-100% בכל אגף. השמירה נפתחת רק כשכל הסכומים תקינים</div></div></div>';
    h += '<div class="s-table-wrap"><table class="s-table s-weights"><thead><tr><th>אגף</th><th>מכונה</th><th>משקל במפעל (%)</th><th>משקל באגף (%)</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr><td><span class="s-dept"><span class="s-dot" style="background:' + esc(r.dept.color) + ';"></span>' + esc(r.dept.name) + '</span></td>' +
        '<td style="font-weight: 700;">' + esc(r.m.name) + '</td>' +
        '<td><input class="s-input w-plant" type="number" step="0.1" min="0" max="100" data-mid="' + r.m.id + '" data-dept="' + r.m.department_id + '" value="' + esc(r.w ? num(r.w.plant_weight) : '0') + '" aria-label="משקל במפעל ' + esc(r.m.name) + '"></td>' +
        '<td><input class="s-input w-dept" type="number" step="0.1" min="0" max="100" data-mid="' + r.m.id + '" data-dept="' + r.m.department_id + '" value="' + esc(r.w && r.w.department_weight !== null ? num(r.w.department_weight) : '') + '" aria-label="משקל באגף ' + esc(r.m.name) + '"></td></tr>';
    });
    h += '<tr class="s-total-row"><td colspan="2">סה"כ</td><td id="w-sum-plant"></td><td id="w-sum-dept"></td></tr>';
    h += '</tbody></table></div>';
    h += '<div class="s-input-row" style="margin-top: 14px;"><div class="s-field"><label for="w-from">בתוקף מתאריך</label><input id="w-from" class="s-input" type="date" value="' + addDays(todayISO(), 1) + '"></div>' +
      '<div class="s-field"><label for="w-note">סיבת השינוי (לא חובה)</label><input id="w-note" class="s-input" type="text"></div></div>';
    h += '<div class="s-actions"><button class="s-btn" type="button" id="w-save" data-act="save-weights">שמירה</button><button class="s-btn s-btn-ghost" type="button" data-act="cancel">ביטול</button></div></div>';
    return h;
  }

  function updateWeightsTotals() {
    var plant = document.querySelectorAll('.w-plant'), dept = document.querySelectorAll('.w-dept');
    if (!plant.length) return;
    var sum = 0, per = {};
    plant.forEach(function (i) { sum += Number(i.value || 0); });
    dept.forEach(function (i) { var k = i.getAttribute('data-dept'); per[k] = (per[k] || 0) + Number(i.value || 0); });
    var plantOk = Math.round(sum * 100) / 100 === 100;
    var names = byId(S.data.depts), badDepts = [];
    Object.keys(per).forEach(function (k) { if (Math.round(per[k] * 100) / 100 !== 100) badDepts.push((names[k] || {}).name + ' ' + num(per[k]) + '%'); });
    var sp = document.getElementById('w-sum-plant'), sd = document.getElementById('w-sum-dept');
    sp.innerHTML = '<span class="' + (plantOk ? 's-ok' : 's-bad') + '">' + num(sum) + '% ' + (plantOk ? '✓' : '✗') + '</span>';
    sd.innerHTML = badDepts.length ? '<span class="s-bad">לא תקין: ' + esc(badDepts.join(', ')) + '</span>' : '<span class="s-ok">כל האגפים 100% ✓</span>';
    document.getElementById('w-save').disabled = !(plantOk && !badDepts.length);
  }

  function updateTargetPreview() {
    var el = document.getElementById('target-preview');
    if (!el) return;
    var r = machineRows().filter(function (x) { return x.m.id === S.selMachineId; })[0];
    var from = val('f-from'), nt = val('f-target');
    if (!r) return;
    if (!from) { el.textContent = 'בחר תאריך כניסה לתוקף.'; return; }
    if (!r.t) { el.textContent = 'למכונה אין כרגע יעד. היעד החדש ייכנס לתוקף מ-' + fmtDate(from) + '.'; return; }
    if (from === r.t.valid_from) {
      el.textContent = 'התאריך זהה לתחילת היעד הנוכחי, ולכן זה ייחשב תיקון של הערך הקיים (' + num(r.t.oee_target) + '%) ולא שינוי חדש.';
      return;
    }
    if (from < r.t.valid_from) { el.textContent = 'התאריך מוקדם מתחילת היעד הנוכחי (' + fmtDate(r.t.valid_from) + ') — בחר תאריך מאוחר יותר.'; return; }
    el.textContent = 'היעד הנוכחי של ' + r.m.name + ' (' + num(r.t.oee_target) + '%, בתוקף מ-' + fmtDate(r.t.valid_from) + ') ייסגר אוטומטית ב-' +
      fmtDate(addDays(from, -1)) + '. ימים עד התאריך הזה ימשיכו להיות מושווים ל-' + num(r.t.oee_target) + '%, ומ-' + fmtDate(from) +
      ' — ל-' + (nt || '?') + '%.';
  }

  // ----- classification rules -----
  function ruleSortKey(r, machinesById) {
    return [r.status || '', r.stop_group || '', r.description || '', r.machine_id ? '1' + ((machinesById[r.machine_id] || {}).name || '') : '0'].join('\u0001');
  }
  function yn(v) {
    if (v === true) return '<span class="s-yes">✓</span>';
    if (v === false) return '<span class="s-no">✗</span>';
    return '<span class="s-unk">?</span>';
  }

  function renderRules() {
    var d = S.data, day = todayISO();
    var mById = byId(d.machines);
    var h = '';
    if (d.unclassified.length) {
      h += '<div class="s-alert"><div class="s-alert-title">' + d.unclassified.length + ' צירופים שהופיעו בדוחות ועדיין לא סווגו</div>' +
        '<div class="s-muted" style="color: #92400E; margin-bottom: 6px;">ההעלאה לא נעצרת בגללם — האירועים נשמרים ומסומנים כ"לא מסווג" עד שתגדיר להם כלל, פעם אחת</div>';
      d.unclassified.forEach(function (u, i) {
        h += '<div class="s-alert-row"><span><b>' + esc(u.machine_name || '') + '</b> <span class="s-path">· ' + esc(u.status) +
          (u.stop_group ? ' › ' + esc(u.stop_group) : '') + (u.description ? ' ›</span> ' + esc(u.description) : '</span>') +
          ' <span class="s-path">(' + u.events + ' אירועים)</span></span><button class="s-btn s-btn-sm" type="button" data-act="classify" data-i="' + i + '">סווג</button></div>';
      });
      h += '</div>';
    } else {
      h += '<div class="s-empty">אין צירופים שממתינים לסיווג. אחרי שיועלו דוחות, כל צירוף של סטטוס › קבוצה › תיאור שאין לו כלל יופיע כאן.</div>';
    }

    if (S.form && S.form.kind === 'rule') h += renderRuleForm();

    var rules = d.rules.filter(function (r) { return !r.valid_to || r.valid_to >= day; })
      .sort(function (a, b) {
        var ka = ruleSortKey(a, mById), kb = ruleSortKey(b, mById);
        return ka < kb ? -1 : ka > kb ? 1 : (a.valid_from < b.valid_from ? -1 : 1);
      });
    h += '<div class="s-panel"><div class="s-panel-head"><div><h2 class="s-h2">כללי סיווג</h2>' +
      '<div class="s-muted">כלל מוגדר ברמת סטטוס › קבוצת עצירה, ואפשר לחדד אותו לתיאור מסוים או למכונה מסוימת. הכלל הכי ספציפי גובר. דקות מעבר ל"משך תקין" נספרות כהפסד לא מתוכנן (UPDT)</div></div>' +
      '<button class="s-btn" type="button" data-act="new-rule">+ כלל חדש</button></div>';
    h += '<div class="s-legend"><span class="s-type t-prod">ייצור</span><span class="s-type t-pdt">PDT · מתוכנן</span><span class="s-type t-updt">UPDT · לא מתוכנן</span><span class="s-type t-proc">כשל בתהליך</span><span class="s-type t-none">לא נספר</span>' +
      '<span style="margin-right: 8px;"><span class="s-unk">?</span> עדיין לא הוגדר</span></div>';
    h += '<div class="s-table-wrap"><table class="s-table"><thead><tr><th>סטטוס › קבוצת עצירה</th><th>תיאור</th><th>חל על</th><th>סוג</th><th>ב-OEE</th><th>ב-TDT</th><th>תקלה (MTBF)</th><th>משך תקין</th><th></th></tr></thead><tbody>';
    rules.forEach(function (r) {
      var isOverride = !!r.machine_id;
      var path = (r.status || '') + (r.stop_group ? ' › ' + r.stop_group : '');
      var t = TYPE[r.loss_type] || TYPE.NOT_COUNTED;
      var fut = r.valid_from > day ? ' <span class="s-future">מ-' + fmtDate(r.valid_from) + '</span>' : '';
      var descCls = VAGUE.indexOf(r.description) !== -1 ? ' class="s-weird"' : '';
      h += '<tr class="' + (isOverride ? 's-override' : '') + '">';
      h += isOverride ? '<td class="s-override-name">↳ חריגה למכונה</td>' : '<td>' + esc(path) + '</td>';
      h += '<td' + descCls + '>' + (isOverride ? '' : esc(r.description || 'כל התיאורים')) + '</td>';
      h += '<td>' + esc(isOverride ? (mById[r.machine_id] || {}).name : 'כל המכונות') + fut + '</td>';
      h += '<td><span class="' + t.c + '">' + t.l + '</span></td>';
      h += '<td>' + yn(r.counts_in_oee) + '</td><td>' + yn(r.counts_in_tdt) + '</td><td>' + (r.counts_as_failure ? '<span class="s-yes">✓</span>' : '<span class="s-no">✗</span>') + '</td>';
      h += '<td class="s-num">' + (r.normal_duration_min ? num(r.normal_duration_min) + ' דק\'' : '—') + '</td>';
      h += '<td style="text-align: left;"><button class="s-btn s-btn-ghost s-btn-sm" type="button" data-act="edit-rule" data-id="' + r.id + '">עריכה</button></td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  function sel3(id, v) {
    function o(value, label) { return '<option value="' + value + '"' + (v === (value === 'null' ? null : value === 'true') ? ' selected' : '') + '>' + label + '</option>'; }
    return '<select id="' + id + '" class="s-input">' + o('true', 'כן') + o('false', 'לא') + o('null', 'עדיין לא הוגדר') + '</select>';
  }

  function renderRuleForm() {
    var f = S.form, r = f.rule || {};
    var d = S.data;
    var h = '<div class="s-panel" id="rule-form"><h2 class="s-h2" style="margin-bottom: 4px;">' + (f.id ? 'עריכת כלל' : 'כלל חדש') + '</h2>';
    h += '<div class="s-muted" style="margin-bottom: 14px;">' + (f.id
      ? 'אם תבחר תאריך מאוחר מתחילת הכלל (' + fmtDate(r.valid_from) + '), הגרסה הקודמת תישמר לתקופה שלפניו. אותו תאריך = תיקון של הכלל הקיים.'
      : 'שדה ריק = "כל הקבוצות" / "כל התיאורים". כלל למכונה מסוימת גובר על כלל כללי לאותו צירוף.') + '</div>';
    h += '<div class="s-form-grid">';
    h += '<div class="s-field"><label for="r-status">סטטוס</label><input id="r-status" class="s-input" type="text" value="' + esc(r.status) + '"></div>';
    h += '<div class="s-field"><label for="r-group">קבוצת עצירה</label><input id="r-group" class="s-input" type="text" placeholder="כל הקבוצות" value="' + esc(r.stop_group) + '"></div>';
    h += '<div class="s-field"><label for="r-desc">תיאור</label><input id="r-desc" class="s-input" type="text" placeholder="כל התיאורים" value="' + esc(r.description) + '"></div>';
    h += '<div class="s-field"><label for="r-machine">חל על</label><select id="r-machine" class="s-input"><option value="">כל המכונות</option>';
    d.machines.forEach(function (m) { h += '<option value="' + m.id + '"' + (r.machine_id === m.id ? ' selected' : '') + '>' + esc(m.name) + '</option>'; });
    h += '</select></div>';
    h += '<div class="s-field"><label for="r-type">סוג</label><select id="r-type" class="s-input">';
    TYPE_OPTIONS.forEach(function (o) { h += '<option value="' + o[0] + '"' + ((r.loss_type || 'UPDT') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
    h += '</select></div>';
    h += '<div class="s-field"><label for="r-dur">משך תקין (דקות, לא חובה)</label><input id="r-dur" class="s-input" type="number" min="0" step="1" value="' + esc(r.normal_duration_min === null || r.normal_duration_min === undefined ? '' : num(r.normal_duration_min)) + '"></div>';
    h += '<div class="s-field"><label for="r-oee">נכנס ל-OEE</label>' + sel3('r-oee', r.counts_in_oee === undefined ? null : r.counts_in_oee) + '</div>';
    h += '<div class="s-field"><label for="r-tdt">נכנס ל-TDT</label>' + sel3('r-tdt', r.counts_in_tdt === undefined ? null : r.counts_in_tdt) + '</div>';
    h += '<div class="s-field"><label for="r-from">בתוקף מתאריך</label><input id="r-from" class="s-input" type="date" value="' + esc(f.id ? todayISO() : (r.valid_from || '2026-01-01')) + '"></div>';
    h += '</div>';
    h += '<label class="s-check"><input id="r-fail" type="checkbox"' + (r.counts_as_failure ? ' checked' : '') + '> נחשב תקלה — נכנס ל-MTBF ולרשימות ה-TOP 3</label>';
    h += '<div class="s-field"><label for="r-note">הערה (לא חובה)</label><input id="r-note" class="s-input" type="text"></div>';
    h += '<div class="s-actions"><button class="s-btn" type="button" data-act="save-rule">שמירה</button><button class="s-btn s-btn-ghost" type="button" data-act="cancel">ביטול</button>';
    if (f.id) h += '<span class="s-spacer"></span><button class="s-btn s-btn-danger s-btn-sm" type="button" data-act="end-rule">הפסקת הכלל מהתאריך שנבחר</button>';
    h += '</div></div>';
    return h;
  }

  // ----- products & target rates -----
  function renderProducts() {
    var d = S.data, day = todayISO();
    var mById = byId(d.machines);
    var pBySku = {};
    d.products.forEach(function (p) { pBySku[p.sku] = p; });
    var knownDescs = d.rules.map(function (r) { return r.description; }).filter(Boolean).concat(VAGUE);
    var h = '';
    if (d.missing.length) {
      h += '<div class="s-alert"><div class="s-alert-title">' + d.missing.length + ' מק"טים הופיעו בדוחות בלי קצב מטרה</div>' +
        '<div class="s-muted" style="color: #92400E; margin-bottom: 6px;">בלי קצב מטרה אי אפשר לחשב יעילות לאותו מק"ט. שמות <span class="s-weird">בכתום</span> נראים כמו תיאור עצירה ולא כמו שם מוצר — כנראה שגיאת דיווח ב-MES שכדאי לבדוק</div>';
      d.missing.forEach(function (m, i) {
        var weird = !m.product_name || knownDescs.indexOf(m.product_name) !== -1;
        h += '<div class="s-alert-row"><span><b>' + esc(m.machine_name || '') + '</b> <span class="s-path">· ' + esc(m.sku) + ' ·</span> <span class="' + (weird ? 's-weird' : '') + '">' +
          esc(m.product_name || '(ללא שם מוצר בדוח)') + '</span></span><button class="s-btn s-btn-sm" type="button" data-act="define-rate" data-i="' + i + '">הגדר קצב</button></div>';
      });
      h += '</div>';
    } else {
      h += '<div class="s-empty">אין מק"טים שחסר להם קצב מטרה. אחרי שיועלו דוחות, כל מק"ט שיוצר במכונה בלי קצב מוגדר יופיע כאן.</div>';
    }

    if (S.form && S.form.kind === 'product') h += renderProductForm();

    var current = d.rates.filter(function (r) { return validOn(r, day) || r.valid_from > day; });
    var counts = {};
    current.forEach(function (r) { counts[r.machine_id] = (counts[r.machine_id] || 0) + 1; });
    h += '<div class="s-panel"><div class="s-panel-head"><div><h2 class="s-h2">מוצרים וקצב מטרה</h2>' +
      '<div class="s-muted">קצב המטרה נקבע לכל צירוף של מכונה ומק"ט — אותו מוצר רץ בקצב שונה במכונות שונות (למשל שוקו 1 ליטר: 200 ליטר/דקה בקומבי, 225 במטריקס)</div></div>' +
      '<button class="s-btn" type="button" data-act="new-product">+ מוצר חדש</button></div>';
    h += '<div class="s-toolbar"><div class="s-chips">';
    var chips = [{ key: 'all', label: 'הכל (' + current.length + ')' }];
    d.machines.forEach(function (m) { if (counts[m.id]) chips.push({ key: String(m.id), label: m.name + ' (' + counts[m.id] + ')' }); });
    chips.forEach(function (c) {
      h += '<button class="s-chip" type="button" data-act="prod-filter" data-key="' + c.key + '"' +
        (c.key === S.prodFilter ? ' style="background: #1c2b45; color: #FFFFFF; border-color: #1c2b45;"' : '') + '>' + esc(c.label) + '</button>';
    });
    h += '</div><label for="f-search" style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0);">חיפוש</label>' +
      '<input id="f-search" class="s-input" type="search" placeholder="חיפוש לפי מק&quot;ט או שם מוצר" style="width: 240px;" value="' + esc(S.search) + '"></div>';
    h += '<div class="s-table-wrap"><table class="s-table"><thead><tr><th>מק"ט</th><th>שם מוצר</th><th>מכונה</th><th>קצב מטרה (ליטר/דקה)</th><th>בתוקף מ-</th><th></th></tr></thead><tbody id="prod-body">';
    current.filter(function (r) { return S.prodFilter === 'all' || String(r.machine_id) === S.prodFilter; })
      .map(function (r) { return { r: r, name: (pBySku[r.sku] || {}).product_name || '', m: (mById[r.machine_id] || {}).name || '' }; })
      .sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : (a.m < b.m ? -1 : 1); })
      .forEach(function (x) {
        var fut = x.r.valid_from > day ? ' <span class="s-future">מ-' + fmtDate(x.r.valid_from) + '</span>' : '';
        h += '<tr data-search="' + esc((x.r.sku + ' ' + x.name).toLowerCase()) + '"><td class="s-code">' + esc(x.r.sku) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.m) + '</td>' +
          '<td class="s-num">' + num(x.r.target_rate) + fut + '</td><td class="s-code">' + fmtDate(x.r.valid_from) + '</td>' +
          '<td style="text-align: left;"><button class="s-btn s-btn-ghost s-btn-sm" type="button" data-act="edit-rate" data-id="' + x.r.id + '">עדכון</button></td></tr>';
      });
    h += '</tbody></table></div></div>';
    return h;
  }

  function renderProductForm() {
    var f = S.form, p = f.prefill || {};
    var d = S.data;
    var locked = !!f.lockKey;
    var h = '<div class="s-panel" id="product-form"><h2 class="s-h2" style="margin-bottom: 4px;">' + (locked ? 'עדכון קצב מטרה' : 'מוצר / קצב חדש') + '</h2>';
    h += '<div class="s-muted" style="margin-bottom: 14px;">הקצב הקודם של אותו צירוף מכונה + מק"ט ייסגר יום לפני התאריך שתבחר, וההיסטוריה נשמרת</div>';
    h += '<div class="s-form-grid">';
    h += '<div class="s-field"><label for="p-machine">מכונה</label><select id="p-machine" class="s-input"' + (locked ? ' disabled' : '') + '>';
    d.machines.filter(function (m) { return m.is_active; }).forEach(function (m) {
      h += '<option value="' + m.id + '"' + (p.machine_id === m.id ? ' selected' : '') + '>' + esc(m.name) + '</option>';
    });
    h += '</select></div>';
    h += '<div class="s-field"><label for="p-sku">מק"ט</label><input id="p-sku" class="s-input" type="text" inputmode="numeric" value="' + esc(p.sku) + '"' + (locked ? ' disabled' : '') + '></div>';
    h += '<div class="s-field"><label for="p-name">שם מוצר</label><input id="p-name" class="s-input" type="text" value="' + esc(p.product_name) + '"></div>';
    h += '<div class="s-field"><label for="p-rate">קצב מטרה (ליטר/דקה)</label><input id="p-rate" class="s-input" type="number" min="0" step="0.01" value="' + esc(p.rate === undefined || p.rate === null ? '' : num(p.rate)) + '"></div>';
    h += '<div class="s-field"><label for="p-from">בתוקף מתאריך</label><input id="p-from" class="s-input" type="date" value="' + esc(p.from || addDays(todayISO(), 1)) + '"></div>';
    h += '<div class="s-field"><label for="p-note">הערה (לא חובה)</label><input id="p-note" class="s-input" type="text"></div>';
    h += '</div><div class="s-actions"><button class="s-btn" type="button" data-act="save-product">שמירה</button><button class="s-btn s-btn-ghost" type="button" data-act="cancel">ביטול</button></div></div>';
    return h;
  }

  // ----- machines & departments -----
  function renderMachines() {
    var d = S.data, day = todayISO();
    var deptById = byId(d.depts);
    var h = '<div class="s-dept-grid">';
    d.depts.forEach(function (dep) {
      var ms = d.machines.filter(function (m) { return m.department_id === dep.id && m.is_active; });
      var w = ms.reduce(function (a, m) {
        var cw = currentOf(d.weights.filter(function (x) { return x.machine_id === m.id; }), day);
        return a + (cw ? Number(cw.plant_weight) : 0);
      }, 0);
      h += '<div class="s-dept-card"><div class="s-dept-name"><span class="s-dot" style="background:' + esc(dep.color) + ';"></span>' + esc(dep.name) + '</div>' +
        '<div class="s-muted">' + (ms.length === 1 ? 'מכונה אחת' : ms.length + ' מכונות') + ' · משקל במפעל ' + num(w, 1) + '%</div></div>';
    });
    h += '</div>';

    if (S.form && (S.form.kind === 'machine' || S.form.kind === 'dept')) h += S.form.kind === 'machine' ? renderMachineForm() : renderDeptForm();

    h += '<div class="s-panel"><div class="s-panel-head"><div><h2 class="s-h2">מכונות</h2>' +
      '<div class="s-muted">מכונה שמסמנים כלא פעילה יוצאת מרשימות ההגדרות ומחישובי המשקלים, וכל ההיסטוריה שלה נשמרת. מכונה חדשה צריכה אחר כך יעד OEE ומשקל (בלשונית "יעדים ומשקלים")</div></div>' +
      '<div style="display: flex; gap: 8px;"><button class="s-btn s-btn-ghost" type="button" data-act="new-dept">+ אגף חדש</button><button class="s-btn" type="button" data-act="new-machine">+ מכונה חדשה</button></div></div>';
    h += '<div class="s-table-wrap"><table class="s-table"><thead><tr><th>סדר</th><th>מכונה</th><th>אגף</th><th>סטטוס</th><th></th></tr></thead><tbody>';
    d.machines.forEach(function (m) {
      var dep = deptById[m.department_id] || { name: '—', color: '#999' };
      var on = m.is_active;
      h += '<tr><td class="s-code">' + esc(m.sort_order) + '</td><td style="font-weight: 700;">' + esc(m.name) + '</td>' +
        '<td><span class="s-dept"><span class="s-dot" style="background:' + esc(dep.color) + ';"></span>' + esc(dep.name) + '</span></td>' +
        '<td><button class="s-switch-btn" type="button" data-act="toggle-active" data-id="' + m.id + '" aria-pressed="' + on + '"><span class="s-switch"><span class="s-switch-track" style="background: ' + (on ? '#16A34A' : '#D1D5DB') + ';"><span class="s-switch-knob" style="' + (on ? 'left: 2px;' : 'left: 16px;') + '"></span></span>' + (on ? 'פעילה' : 'לא פעילה') + '</span></button></td>' +
        '<td style="text-align: left;"><button class="s-btn s-btn-ghost s-btn-sm" type="button" data-act="edit-machine" data-id="' + m.id + '">עריכה</button></td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  function renderMachineForm() {
    var m = S.form.machine || {};
    var h = '<div class="s-panel"><h2 class="s-h2" style="margin-bottom: 14px;">' + (m.id ? 'עריכת מכונה — ' + esc(m.name) : 'מכונה חדשה') + '</h2><div class="s-form-grid">';
    h += '<div class="s-field"><label for="m-name">שם המכונה</label><input id="m-name" class="s-input" type="text" value="' + esc(m.name) + '"></div>';
    h += '<div class="s-field"><label for="m-dept">אגף</label><select id="m-dept" class="s-input">';
    S.data.depts.forEach(function (d) { h += '<option value="' + d.id + '"' + (m.department_id === d.id ? ' selected' : '') + '>' + esc(d.name) + '</option>'; });
    h += '</select></div>';
    h += '<div class="s-field"><label for="m-order">סדר תצוגה</label><input id="m-order" class="s-input" type="number" step="1" value="' + esc(m.sort_order === undefined ? S.data.machines.length + 1 : m.sort_order) + '"></div>';
    h += '</div><div class="s-actions"><button class="s-btn" type="button" data-act="save-machine">שמירה</button><button class="s-btn s-btn-ghost" type="button" data-act="cancel">ביטול</button></div></div>';
    return h;
  }

  function renderDeptForm() {
    var h = '<div class="s-panel"><h2 class="s-h2" style="margin-bottom: 14px;">אגף חדש</h2><div class="s-form-grid">';
    h += '<div class="s-field"><label for="d-name">שם האגף</label><input id="d-name" class="s-input" type="text"></div>';
    h += '<div class="s-field"><label for="d-color">צבע בגרפים</label><input id="d-color" class="s-input" type="color" value="#6b7280" style="height: 40px; padding: 4px;"></div>';
    h += '</div><div class="s-actions"><button class="s-btn" type="button" data-act="save-dept">שמירה</button><button class="s-btn s-btn-ghost" type="button" data-act="cancel">ביטול</button></div></div>';
    return h;
  }

  function afterRender() {
    updateWeightsTotals();
    updateTargetPreview();
    applySearch();
    var focusForm = document.getElementById('rule-form') || document.getElementById('product-form');
    if (focusForm && S.form && S.form.scroll) { focusForm.scrollIntoView({ behavior: 'smooth', block: 'start' }); S.form.scroll = false; }
  }

  function applySearch() {
    var body = document.getElementById('prod-body');
    if (!body) return;
    var q = S.search.trim().toLowerCase();
    Array.prototype.forEach.call(body.rows, function (tr) {
      tr.style.display = !q || (tr.getAttribute('data-search') || '').indexOf(q) !== -1 ? '' : 'none';
    });
  }

  // ---------- actions ----------
  function onClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn || !root.contains(btn) || btn.disabled) return;
    var act = btn.getAttribute('data-act');
    var id = Number(btn.getAttribute('data-id'));
    var d = S.data;

    if (act === 'toggle-signup') { S.mode = S.mode === 'signup' ? 'login' : 'signup'; S.authMsg = ''; render(); return; }
    if (act === 'logout') { API.signOut().then(function () { S.mode = 'login'; S.data = null; S.form = null; render(); }); return; }
    if (act === 'tab') { S.tab = btn.getAttribute('data-tab'); S.form = null; render(); return; }
    if (act === 'cancel') { S.form = null; render(); return; }

    if (act === 'sel-machine') { S.selMachineId = id; S.form = null; render(); return; }
    if (act === 'open-weights') { S.form = { kind: 'weights' }; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (act === 'save-target') {
      var t = numOrNull(val('f-target'));
      if (t === null) { toast('הזן יעד OEE', true); return; }
      run(API.rpc('set_machine_target', { p_machine_id: id, p_target: t, p_from: val('f-from') || null, p_note: val('f-note') || null }), 'היעד נשמר ✓');
      return;
    }
    if (act === 'save-weights') {
      var items = [];
      document.querySelectorAll('.w-plant').forEach(function (i) {
        var mid = Number(i.getAttribute('data-mid'));
        var dw = document.querySelector('.w-dept[data-mid="' + mid + '"]');
        items.push({ machine_id: mid, plant_weight: Number(i.value || 0), department_weight: numOrNull(dw && dw.value) });
      });
      run(API.rpc('set_machine_weights', { p_from: val('w-from') || null, p_items: items, p_note: val('w-note') || null }), 'המשקלים נשמרו ✓');
      return;
    }

    if (act === 'new-rule') { S.form = { kind: 'rule', rule: { counts_in_oee: null, counts_in_tdt: null }, scroll: true }; render(); return; }
    if (act === 'classify') {
      var u = d.unclassified[Number(btn.getAttribute('data-i'))];
      S.form = { kind: 'rule', rule: { status: u.status, stop_group: u.stop_group, description: u.description, counts_in_oee: null, counts_in_tdt: null, valid_from: u.first_seen }, scroll: true };
      render(); return;
    }
    if (act === 'edit-rule') {
      var r = d.rules.filter(function (x) { return x.id === id; })[0];
      S.form = { kind: 'rule', id: id, rule: r, scroll: true };
      render(); return;
    }
    if (act === 'save-rule') {
      var mid2 = val('r-machine');
      var tri = function (v) { return v === 'null' ? null : v === 'true'; };
      run(API.rpc('save_rule', {
        p_id: S.form.id || null,
        p_status: val('r-status'), p_stop_group: val('r-group') || null, p_description: val('r-desc') || null,
        p_machine_id: mid2 ? Number(mid2) : null, p_loss_type: val('r-type'),
        p_counts_in_oee: tri(val('r-oee')), p_counts_in_tdt: tri(val('r-tdt')),
        p_counts_as_failure: document.getElementById('r-fail').checked,
        p_normal_duration_min: numOrNull(val('r-dur')), p_from: val('r-from') || null, p_note: val('r-note') || null
      }), 'הכלל נשמר ✓');
      return;
    }
    if (act === 'end-rule') {
      var from = val('r-from');
      if (!from) { toast('בחר תאריך', true); return; }
      if (!window.confirm('להפסיק את הכלל החל מ-' + fmtDate(from) + '? אירועים מהתאריך הזה יחזרו להיות מסווגים לפי כלל כללי יותר (או יסומנו כלא מסווגים).')) return;
      run(API.rpc('end_rule', { p_id: S.form.id, p_last_day: addDays(from, -1) }), 'הכלל הופסק ✓');
      return;
    }

    if (act === 'prod-filter') { S.prodFilter = btn.getAttribute('data-key'); render(); return; }
    if (act === 'new-product') { S.form = { kind: 'product', prefill: {}, scroll: true }; render(); return; }
    if (act === 'define-rate') {
      var m = d.missing[Number(btn.getAttribute('data-i'))];
      S.form = { kind: 'product', prefill: { machine_id: m.machine_id, sku: m.sku, product_name: m.product_name, from: '2026-01-01' }, scroll: true };
      render(); return;
    }
    if (act === 'edit-rate') {
      var rr = d.rates.filter(function (x) { return x.id === id; })[0];
      var pr = d.products.filter(function (p) { return p.sku === rr.sku; })[0] || {};
      S.form = { kind: 'product', lockKey: true, prefill: { machine_id: rr.machine_id, sku: rr.sku, product_name: pr.product_name, rate: rr.target_rate }, scroll: true };
      render(); return;
    }
    if (act === 'save-product') {
      var pf = S.form.prefill;
      run(API.rpc('set_product_rate', {
        p_machine_id: S.form.lockKey ? pf.machine_id : Number(val('p-machine')),
        p_sku: S.form.lockKey ? pf.sku : val('p-sku'),
        p_product_name: val('p-name') || null,
        p_rate: numOrNull(val('p-rate')), p_from: val('p-from') || null, p_note: val('p-note') || null
      }), 'הקצב נשמר ✓');
      return;
    }

    if (act === 'new-machine') { S.form = { kind: 'machine', machine: {} }; render(); return; }
    if (act === 'edit-machine') { S.form = { kind: 'machine', machine: d.machines.filter(function (x) { return x.id === id; })[0] }; render(); return; }
    if (act === 'new-dept') { S.form = { kind: 'dept' }; render(); return; }
    if (act === 'save-machine') {
      var mm = S.form.machine;
      var row = { name: val('m-name').trim(), department_id: Number(val('m-dept')), sort_order: Number(val('m-order') || 0) };
      if (!row.name) { toast('הזן שם מכונה', true); return; }
      run(mm.id ? API.update('machines', 'id=eq.' + mm.id, row) : API.insert('machines', row), mm.id ? 'המכונה עודכנה ✓' : 'המכונה נוספה ✓ — עכשיו הגדר לה יעד ומשקל');
      return;
    }
    if (act === 'save-dept') {
      var name = val('d-name').trim();
      if (!name) { toast('הזן שם אגף', true); return; }
      run(API.insert('departments', { name: name, color: val('d-color'), sort_order: d.depts.length + 1 }), 'האגף נוסף ✓');
      return;
    }
    if (act === 'toggle-active') {
      var mc = d.machines.filter(function (x) { return x.id === id; })[0];
      var next = !mc.is_active;
      if (!next && !window.confirm('לסמן את ' + mc.name + ' כלא פעילה? ההיסטוריה שלה נשמרת, ואפשר להחזיר אותה בכל רגע.')) return;
      run(API.update('machines', 'id=eq.' + id, { is_active: next }), next ? 'המכונה הופעלה ✓' : 'המכונה סומנה כלא פעילה ✓');
    }
  }

  function onSubmit(e) {
    if (e.target.id !== 'auth-form') return;
    e.preventDefault();
    var email = val('a-email').trim(), pass = val('a-pass');
    S.authMsg = '';
    if (S.mode === 'signup') {
      if (pass !== val('a-pass2')) { S.authMsg = 'הסיסמאות לא זהות'; render(); return; }
      S.busy = true;
      API.signUp(email, pass)
        .then(function () { return API.signIn(email, pass); })
        .then(function () { S.busy = false; afterSignIn(); })
        .catch(function (err) { S.busy = false; S.authMsg = err.message; render(); });
      return;
    }
    S.busy = true;
    API.signIn(email, pass)
      .then(function () { S.busy = false; afterSignIn(); })
      .catch(function (err) { S.busy = false; S.authMsg = err.message; render(); });
  }

  function onInput(e) {
    var t = e.target;
    if (t.classList.contains('w-plant') || t.classList.contains('w-dept')) updateWeightsTotals();
    else if (t.id === 'f-target' || t.id === 'f-from') updateTargetPreview();
    else if (t.id === 'f-search') { S.search = t.value; applySearch(); }
  }

  // ---------- routing ----------
  function route() {
    var inSettings = location.hash.indexOf('#/settings') === 0;
    var dash = document.getElementById('root');
    dash.hidden = inSettings;
    root.hidden = !inSettings;
    var gear = document.getElementById('gear');
    if (gear) {
      gear.classList.toggle('active', inSettings);
      gear.setAttribute('href', inSettings ? '#/' : '#/settings');
      gear.setAttribute('aria-label', inSettings ? 'חזרה לדשבורד' : 'הגדרות');
    }
    if (appRole) appRole.textContent = inSettings ? 'הגדרות מערכת — מנהל בלבד' : 'מנהל ייצור — תצוגת מפעל יומית';
    window.scrollTo(0, 0);
    if (inSettings) {
      if (!S.started) { S.started = true; start(); }
    } else if (S.dirty && window.__reloadDashboard) {
      S.dirty = false;
      window.__reloadDashboard();
    }
  }

  function init() {
    root = document.getElementById('settings-root');
    appRole = document.querySelector('.appbar-role');
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    window.addEventListener('hashchange', route);
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
