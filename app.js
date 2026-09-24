/* Runtime for the locked "מנהל ייצור" screen.
 * Renders the approved design template (template.html, generated from the canvas mockup)
 * with a tiny {{...}} / <sc-for> / <sc-if> engine, loads live settings from Supabase,
 * and registers the service worker so the app can be installed as a PWA. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://jskvdgtakcaopaqwrttn.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impza3ZkZ3Rha2Nhb3BhcXdydHRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTI1OTEsImV4cCI6MjEwNTU4ODU5MX0.y9keJjeZkwP5ezi1-Pj5e2yYBPqfHi7SHtNlbI1ztbQ';

  // ---------- template engine ----------
  var EXPR = /\{\{\s*([^}]+?)\s*\}\}/g;

  function lookup(expr, scope) {
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    var parts = expr.split('.');
    var cur = scope;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function interpolate(str, scope) {
    return str.replace(EXPR, function (_, e) {
      var v = lookup(e, scope);
      return v === null || v === undefined ? '' : String(v);
    });
  }

  function singleExpr(str) {
    var m = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/.exec(str);
    return m ? m[1] : null;
  }

  function renderNode(node, scope, out) {
    if (node.nodeType === 3) {
      var t = node.nodeValue;
      out.push(document.createTextNode(t.indexOf('{{') === -1 ? t : interpolate(t, scope)));
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.localName;

    if (tag === 'sc-for') {
      var list = lookup(singleExpr(node.getAttribute('list')) || '', scope) || [];
      var as = node.getAttribute('as') || 'item';
      for (var i = 0; i < list.length; i++) {
        var child = Object.create(scope);
        child[as] = list[i];
        renderChildren(node, child, out);
      }
      return;
    }
    if (tag === 'sc-if') {
      if (lookup(singleExpr(node.getAttribute('value')) || '', scope)) renderChildren(node, scope, out);
      return;
    }

    var el = node.cloneNode(false);
    for (var a = 0; a < node.attributes.length; a++) {
      var attr = node.attributes[a];
      if (attr.value.indexOf('{{') === -1) continue;
      var name = attr.name;
      if (name.slice(0, 2).toLowerCase() === 'on') {
        el.removeAttribute(name);
        var fn = lookup(singleExpr(attr.value) || '', scope);
        if (typeof fn === 'function') {
          el.addEventListener(name.slice(2).toLowerCase(), fn);
          el.style.cursor = 'pointer';
        }
      } else {
        el.setAttribute(name, interpolate(attr.value, scope));
      }
    }
    var kids = [];
    renderChildren(node, scope, kids);
    for (var k = 0; k < kids.length; k++) el.appendChild(kids[k]);
    out.push(el);
  }

  function renderChildren(node, scope, out) {
    var src = node.content || node; // <template> has .content
    for (var c = src.firstChild; c; c = c.nextSibling) renderNode(c, scope, out);
  }

  // ---------- component shim (same API the canvas mockup used) ----------
  var rerender = function () {};
  window.DCLogic = function DCLogic(props) { this.props = props || {}; this.state = {}; };
  window.DCLogic.prototype.setState = function (patch) {
    for (var k in patch) this.state[k] = patch[k];
    if (this._rerender) this._rerender(); else rerender();
  };

  function currentScreen(root) {
    var el = root.__oeeCurrentScreen;
    if (!el || !root.contains(el)) {
      el = document.createElement('div');
      el.className = 'oee-current-screen';
      root.appendChild(el);
      root.__oeeCurrentScreen = el;
    }
    return el;
  }

  function attachIws(root, role) {
    if (window.OEE_IWS) window.OEE_IWS.attach(root, role);
  }

  // one screen = one component instance rendered from one template into one root
  function mount(root, tpl, props, Ctor, role) {
    var comp = new (Ctor || window.Component)(props || {});
    comp._rerender = function () {
      var out = [];
      renderChildren(tpl, comp.renderVals(), out);
      var screen = currentScreen(root);
      screen.textContent = '';
      for (var i = 0; i < out.length; i++) screen.appendChild(out[i]);
      attachIws(root, role);
    };
    comp._rerender();
    comp.start();
    return comp;
  }

  // ---------- live settings from Supabase ----------
  function setStatus(kind, text) {
    var el = document.getElementById('conn');
    if (!el) return;
    el.className = 'conn conn-' + kind;
    el.textContent = text;
    el.title = arguments[2] || text;
  }

  function validOn(rows, day) {
    return (rows || []).filter(function (r) {
      return r.valid_from <= day && (!r.valid_to || r.valid_to >= day);
    })[0];
  }

  function loadLiveSettings() {
    var q = SUPABASE_URL + '/rest/v1/machines?select=name,sort_order,is_active,' +
      'departments(name,color),machine_oee_targets(oee_target,valid_from,valid_to),' +
      'machine_weights(plant_weight,valid_from,valid_to)&order=sort_order';
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    return fetch(q, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (rows) {
      var day = new Date().toISOString().slice(0, 10);
      var live = {};
      rows.forEach(function (m) {
        var t = validOn(m.machine_oee_targets, day);
        var w = validOn(m.machine_weights, day);
        if (t && w) live[m.name] = { target: Number(t.oee_target), weight: Number(w.plant_weight) };
      });
      return live;
    });
  }

  // ---------- boot ----------
  function boot() {
    var root = document.getElementById('root');
    var tpl = document.getElementById('view');
    var comp = null;

    rerender = function () {
      if (!comp) return;
      var out = [];
      renderChildren(tpl, comp.renderVals(), out);
      var screen = currentScreen(root);
      screen.textContent = '';
      for (var i = 0; i < out.length; i++) screen.appendChild(out[i]);
      attachIws(root, 'pm');
    };

    var llComp = null;
    function start() {
      comp = mount(root, tpl, {}, null, 'pm');
    }
    // Line Lead screen (same screen scoped to one department) — mounted the first time it is opened
    // Process Lead screen (loss analysis for one line)
    var plComp = null, plRoot = document.getElementById('pl-root');
    window.OEE_ROUTER.register('#/pl', plRoot, 'Process Lead — ניתוח הפסדים', function () {
      if (!plComp) plComp = mount(plRoot, document.getElementById('view-pl'), {}, window.OEE_PL.Component, 'pl');
      else attachIws(plRoot, 'pl');
    });

    // Maintenance Lead screen (equipment reliability for one line)
    var mlComp = null, mlRoot = document.getElementById('ml-root');
    window.OEE_ROUTER.register('#/ml', mlRoot, 'Maintenance Lead — אמינות הציוד', function () {
      if (!mlComp) mlComp = mount(mlRoot, document.getElementById('view-ml'), {}, window.OEE_ML.Component, 'ml');
      else attachIws(mlRoot, 'ml');
    });

    var llRoot = document.getElementById('ll-root');
    window.OEE_ROUTER.register('#/ll', llRoot, 'Line Lead — תצוגת אגף', function () {
      if (!llComp) llComp = mount(llRoot, document.getElementById('view-ll'), { scope: 'dept' }, null, 'll');
      else attachIws(llRoot, 'll');
    });

    var ddsRoot = document.getElementById('dds-root');
    window.OEE_ROUTER.register('#/dds', ddsRoot, 'DDS', function () {
      if (window.OEE_DDS) window.OEE_DDS.attach(ddsRoot);
    });

    function refreshLive() {
      setStatus('wait', 'מתחבר…');
      return loadLiveSettings().then(function (live) {
        var n = Object.keys(live).length;
        window.__LIVE = live;
        setStatus('ok', '● מחובר', 'מחובר למסד הנתונים — יעדים ומשקלים של ' + n + ' מכונות נטענו מהמסד');
      }).catch(function () {
        window.__LIVE = null;
        setStatus('off', '● לא מחובר', 'אין חיבור למסד הנתונים — מוצגים ערכי ברירת מחדל');
      });
    }

    // called by the settings screen after a change, so the dashboard shows the new targets/weights
    window.__reloadDashboard = function () {
      refreshLive().then(function () {
        // reload targets, weights, rules and uploaded data; the component keeps its period / tab state
        if (window.OEE_DASH) window.OEE_DASH.invalidate();
        if (window.OEE_IWS) window.OEE_IWS.refresh();
        if (window.OEE_DDS) window.OEE_DDS.refresh();
        if (comp) comp.start(); else start();
        if (llComp) llComp.start();
        if (plComp) { window.OEE_PL.clearCache(); plComp.start(); }
        if (mlComp) { window.OEE_ML.clearCache(); mlComp.start(); }
      });
    };

    refreshLive().then(start);

    // KPI tooltip: tap to open on touch screens (hover still works with a mouse)
    function kpiTap(e) {
      var card = e.target.closest ? e.target.closest('.card-plant') : null;
      var open = document.querySelectorAll('.card-plant.tt-open');
      for (var i = 0; i < open.length; i++) if (open[i] !== card) open[i].classList.remove('tt-open');
      if (card) card.classList.toggle('tt-open');
    }
    root.addEventListener('click', kpiTap);
    llRoot.addEventListener('click', kpiTap);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
