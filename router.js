/* Tiny hash router: #/ = dashboard, #/settings, #/upload. Each admin page registers itself. */
(function () {
  'use strict';
  var pages = {};   // hash -> { el, role, onShow, onLeave }
  var current = null;

  function applyAdminUI() {
    var link = document.getElementById('upload-link');
    if (link) link.hidden = !(window.OEE_API && window.OEE_API.session());
  }

  function route() {
    var hash = location.hash.split('?')[0];
    var page = pages[hash] || null;
    var dash = document.getElementById('root');
    dash.hidden = !!page;
    Object.keys(pages).forEach(function (h) { pages[h].el.hidden = pages[h] !== page; });
    var role = document.querySelector('.appbar-role');
    if (role) role.textContent = page ? page.role : 'מנהל ייצור — תצוגת מפעל';
    // role switch: plant view (#/) or department view (#/ll); the choice is remembered for the next launch
    var onLL = hash === '#/ll', onPlant = !page;
    var rp = document.getElementById('role-plant'), rl = document.getElementById('role-ll');
    if (rp) rp.classList.toggle('active', onPlant);
    if (rl) rl.classList.toggle('active', onLL);
    if (onLL || onPlant) { try { localStorage.setItem('oee_role_v1', onLL ? 'll' : 'plant'); } catch (e) { /* private mode */ } }
    [['gear', '#/settings'], ['upload-link', '#/upload']].forEach(function (x) {
      var a = document.getElementById(x[0]);
      if (!a) return;
      var active = hash === x[1];
      a.classList.toggle('active', active);
      a.setAttribute('href', active ? '#/' : x[1]);
    });
    if (current && current !== page && current.onLeave) current.onLeave();
    current = page;
    applyAdminUI();
    window.scrollTo(0, 0);
    if (page && page.onShow) page.onShow();
  }

  window.OEE_ROUTER = {
    register: function (hash, el, role, onShow, onLeave) {
      pages[hash] = { el: el, role: role, onShow: onShow, onLeave: onLeave };
    },
    start: function () {
      if (!location.hash) {
        var saved = null;
        try { saved = localStorage.getItem('oee_role_v1'); } catch (e) { /* private mode */ }
        if (saved === 'll') history.replaceState(null, '', '#/ll');
      }
      window.addEventListener('hashchange', route);
      route();
    },
    refreshAdminUI: applyAdminUI
  };
})();
