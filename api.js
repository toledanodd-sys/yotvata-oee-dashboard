/* Minimal Supabase client (REST + Auth) — no external library needed.
 * Reads work for everyone (anon). Writes go through RPC functions that the
 * database only allows for the admin account. */
(function () {
  'use strict';

  var URL_ = 'https://jskvdgtakcaopaqwrttn.supabase.co';
  var KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impza3ZkZ3Rha2Nhb3BhcXdydHRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTI1OTEsImV4cCI6MjEwNTU4ODU5MX0.y9keJjeZkwP5ezi1-Pj5e2yYBPqfHi7SHtNlbI1ztbQ';
  var LS_KEY = 'oee_admin_session_v1';

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveSession(s) {
    try {
      if (s) localStorage.setItem(LS_KEY, JSON.stringify(s));
      else localStorage.removeItem(LS_KEY);
    } catch (e) { /* private mode: session lives in memory only */ }
  }

  var session = loadSession();

  function fromAuthResponse(j) {
    if (!j || !j.access_token) return null;
    return {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Date.now() + (j.expires_in || 3600) * 1000,
      user: { id: j.user && j.user.id, email: j.user && j.user.email }
    };
  }

  function errorFrom(res, body) {
    var msg = (body && (body.message || body.msg || body.error_description || body.error)) || ('שגיאה ' + res.status);
    var map = {
      'Invalid login credentials': 'אימייל או סיסמה שגויים',
      'User already registered': 'כבר קיים חשבון עם האימייל הזה — אפשר פשוט להיכנס',
      'Email not confirmed': 'האימייל עדיין לא אומת'
    };
    var err = new Error(map[msg] || msg);
    err.status = res.status;
    return err;
  }

  function request(method, path, body, useAuth, extraHeaders) {
    var headers = { apikey: KEY, 'Content-Type': 'application/json' };
    headers.Authorization = 'Bearer ' + (useAuth && session ? session.access_token : KEY);
    for (var k in (extraHeaders || {})) headers[k] = extraHeaders[k];
    return fetch(URL_ + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (res) {
        return res.text().then(function (t) {
          var j = null;
          try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
          if (!res.ok) throw errorFrom(res, j);
          return j;
        });
      });
  }

  function refresh() {
    if (!session || !session.refresh_token) return Promise.reject(new Error('not signed in'));
    return request('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token }, false)
      .then(function (j) { session = fromAuthResponse(j); saveSession(session); return session; })
      .catch(function (e) { session = null; saveSession(null); throw e; });
  }

  function ensureFresh() {
    if (!session) return Promise.resolve(null);
    if (session.expires_at - Date.now() > 60 * 1000) return Promise.resolve(session);
    return refresh();
  }

  function authed(method, path, body, extraHeaders) {
    return ensureFresh().catch(function () { return null; }).then(function () {
      return request(method, path, body, true, extraHeaders).catch(function (e) {
        if (e.status === 401 && session) {
          return refresh().then(function () { return request(method, path, body, true, extraHeaders); });
        }
        throw e;
      });
    });
  }

  window.OEE_API = {
    url: URL_,
    key: KEY,
    session: function () { return session; },
    signIn: function (email, password) {
      return request('POST', '/auth/v1/token?grant_type=password', { email: email, password: password }, false)
        .then(function (j) { session = fromAuthResponse(j); saveSession(session); return session; });
    },
    signUp: function (email, password) {
      return request('POST', '/auth/v1/signup', { email: email, password: password }, false);
    },
    signOut: function () {
      var s = session;
      session = null;
      saveSession(null);
      if (s) return request('POST', '/auth/v1/logout', {}, false, { Authorization: 'Bearer ' + s.access_token }).catch(function () {});
      return Promise.resolve();
    },
    select: function (pathAndQuery) { return authed('GET', '/rest/v1/' + pathAndQuery); },
    rpc: function (fn, args) { return authed('POST', '/rest/v1/rpc/' + fn, args || {}); },
    insert: function (table, row) {
      return authed('POST', '/rest/v1/' + table, row, { Prefer: 'return=representation' });
    },
    update: function (table, filter, patch) {
      return authed('PATCH', '/rest/v1/' + table + '?' + filter, patch, { Prefer: 'return=representation' });
    }
  };
})();
