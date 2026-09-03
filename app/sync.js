/* ============================================================
   همگام‌سازی بین دستگاه‌ها با Cloud Firestore (از راه REST)
   بدون هیچ SDK بیرونی، تا برنامه آفلاین هم سالم بماند.
   ============================================================ */
(function (global) {
  'use strict';

  var CFG_KEY = 'hesab.sync.cfg';     // {apiKey, projectId, book}
  var TOK_KEY = 'hesab.sync.tok';     // {idToken, refreshToken, expiresAt, uid}
  var CUR_KEY = 'hesab.sync.cursor';  // {lastPulledAt, lastFullAt}

  var POLL_MS = 45000;        // فاصله‌ی بررسی خودکار
  var PUSH_DEBOUNCE_MS = 2500; // مکث بعد از تغییر محلی، قبل از ارسال
  var OVERLAP_MS = 300000;    // ۵ دقیقه هم‌پوشانی، برای جبران اختلاف ساعت دستگاه‌ها
  var PAGE = 300;
  var BATCH = 150;

  var hooks = null;           // از طرف app.js پر می‌شود
  var listeners = [];
  var st = { state: 'off', message: '', lastAt: 0, busy: false };
  var pollTimer = null, pushTimer = null;

  /* ---------------- تنظیمات ---------------- */

  function readJson(key, dflt) {
    try { return JSON.parse(localStorage.getItem(key)) || dflt; } catch (e) { return dflt; }
  }
  function writeJson(key, val) {
    try {
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* حافظه پر */ }
  }

  function getConfig() { return readJson(CFG_KEY, null); }
  function isOn() {
    var c = getConfig();
    return !!(c && c.apiKey && c.projectId && c.book);
  }

  function setConfig(cfg) {
    if (!cfg) {
      writeJson(CFG_KEY, null);
      writeJson(TOK_KEY, null);
      writeJson(CUR_KEY, null);
      stop();
      setStatus('off', '');
      return;
    }
    writeJson(CFG_KEY, {
      apiKey: String(cfg.apiKey || '').trim(),
      projectId: String(cfg.projectId || '').trim(),
      book: normalizeCode(cfg.book)
    });
    writeJson(TOK_KEY, null);
    writeJson(CUR_KEY, null);
    start();
  }

  /* ---------------- کد خانواده ---------------- */

  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون I O 0 1

  function newCode() {
    var raw = '', i;
    var bytes = new Uint8Array(24);
    (global.crypto || global.msCrypto).getRandomValues(bytes);
    for (i = 0; i < 24; i++) raw += ALPHABET[bytes[i] % ALPHABET.length];
    return groupCode(raw);
  }

  function normalizeCode(code) {
    var raw = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return raw ? groupCode(raw) : '';
  }

  function groupCode(raw) {
    return (raw.match(/.{1,4}/g) || []).join('-');
  }

  /* ---------------- وضعیت ---------------- */

  function setStatus(state, message) {
    st.state = state;
    st.message = message || '';
    if (state === 'idle') st.lastAt = Date.now();
    listeners.forEach(function (fn) {
      try { fn(status()); } catch (e) { console.error(e); }
    });
  }
  function status() {
    return { state: st.state, message: st.message, lastAt: st.lastAt, busy: st.busy };
  }
  function onStatus(fn) { listeners.push(fn); fn(status()); }

  /* ---------------- ورود ناشناس ---------------- */

  function authFetch(url, options) {
    return token().then(function (t) {
      var o = options || {};
      o.headers = o.headers || {};
      o.headers['Authorization'] = 'Bearer ' + t;
      o.headers['Content-Type'] = 'application/json';
      return fetch(url, o);
    });
  }

  function token() {
    var cfg = getConfig();
    if (!cfg) return Promise.reject(new Error('همگام‌سازی تنظیم نشده است'));
    var tok = readJson(TOK_KEY, null);
    if (tok && tok.idToken && tok.expiresAt - 60000 > Date.now()) {
      return Promise.resolve(tok.idToken);
    }
    if (tok && tok.refreshToken) {
      return refreshToken(cfg, tok).catch(function () { return signUp(cfg); });
    }
    return signUp(cfg);
  }

  function signUp(cfg) {
    return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' +
      encodeURIComponent(cfg.apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true })
    }).then(readOrThrow).then(function (d) {
      writeJson(TOK_KEY, {
        idToken: d.idToken,
        refreshToken: d.refreshToken,
        uid: d.localId,
        expiresAt: Date.now() + (Number(d.expiresIn || 3600) * 1000)
      });
      return d.idToken;
    });
  }

  function refreshToken(cfg, tok) {
    return fetch('https://securetoken.googleapis.com/v1/token?key=' +
      encodeURIComponent(cfg.apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(tok.refreshToken)
    }).then(readOrThrow).then(function (d) {
      writeJson(TOK_KEY, {
        idToken: d.id_token,
        refreshToken: d.refresh_token,
        uid: d.user_id,
        expiresAt: Date.now() + (Number(d.expires_in || 3600) * 1000)
      });
      return d.id_token;
    });
  }

  function readOrThrow(res) {
    return res.text().then(function (txt) {
      var data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* پاسخ متنی */ }
      if (!res.ok) {
        var msg = (data && data.error && (data.error.message || data.error.status)) ||
          ('خطای ' + res.status);
        var err = new Error(msg);
        err.httpStatus = res.status;
        err.code = data && data.error && data.error.message;
        throw err;
      }
      return data;
    });
  }

  /* ---------------- تبدیل مقادیر Firestore ---------------- */

  function enc(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') {
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
    return { stringValue: String(v) };
  }
  function dec(v) {
    if (!v) return null;
    if ('integerValue' in v) return parseInt(v.integerValue, 10);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('booleanValue' in v) return !!v.booleanValue;
    if ('nullValue' in v) return null;
    return v.stringValue !== undefined ? v.stringValue : null;
  }
  function encFields(obj) {
    var out = {};
    Object.keys(obj).forEach(function (k) { out[k] = enc(obj[k]); });
    return out;
  }
  function decFields(fields) {
    var out = {};
    Object.keys(fields || {}).forEach(function (k) { out[k] = dec(fields[k]); });
    return out;
  }

  function base() {
    var cfg = getConfig();
    return 'https://firestore.googleapis.com/v1/projects/' +
      encodeURIComponent(cfg.projectId) + '/databases/(default)/documents';
  }
  function bookPath() { return base() + '/books/' + encodeURIComponent(getConfig().book); }
  function docName(collection, id) {
    return 'projects/' + getConfig().projectId + '/databases/(default)/documents/books/' +
      getConfig().book + '/' + collection + '/' + id;
  }

  /* ---------------- خواندن از سرور ---------------- */

  function pullAll() {
    var acc = [];
    function page(tokenStr) {
      var url = bookPath() + '/expenses?pageSize=' + PAGE +
        (tokenStr ? '&pageToken=' + encodeURIComponent(tokenStr) : '');
      return authFetch(url, { method: 'GET' }).then(readOrThrow).then(function (d) {
        (d && d.documents || []).forEach(function (doc) { acc.push(toExpense(doc)); });
        if (d && d.nextPageToken) return page(d.nextPageToken);
        return acc;
      });
    }
    return page(null);
  }

  function pullSince(sinceMs) {
    var body = {
      structuredQuery: {
        from: [{ collectionId: 'expenses' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'updatedAt' },
            op: 'GREATER_THAN',
            value: { integerValue: String(Math.max(0, sinceMs)) }
          }
        },
        orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'ASCENDING' }],
        limit: PAGE
      }
    };
    return authFetch(bookPath() + ':runQuery', {
      method: 'POST', body: JSON.stringify(body)
    }).then(readOrThrow).then(function (rows) {
      return (rows || []).filter(function (r) { return r.document; })
        .map(function (r) { return toExpense(r.document); });
    });
  }

  function toExpense(doc) {
    var f = decFields(doc.fields);
    var parts = String(doc.name || '').split('/');
    f.id = parts[parts.length - 1];
    f.deleted = !!f.deleted;
    f.amount = Number(f.amount) || 0;
    f.updatedAt = Number(f.updatedAt) || 0;
    f.createdAt = Number(f.createdAt) || f.updatedAt;
    return f;
  }

  function pullMeta() {
    return Promise.all(['entities', 'categories'].map(function (key) {
      return authFetch(bookPath() + '/config/' + key, { method: 'GET' })
        .then(function (res) {
          if (res.status === 404) return null;
          return readOrThrow(res);
        })
        .then(function (doc) {
          if (!doc) return null;
          var f = decFields(doc.fields);
          var items = null;
          try { items = JSON.parse(f.json || 'null'); } catch (e) { items = null; }
          if (!Array.isArray(items)) return null;
          return { key: key, items: items, updatedAt: Number(f.updatedAt) || 0 };
        });
    })).then(function (rows) {
      var out = {};
      rows.forEach(function (r) { if (r) out[r.key] = r; });
      return out;
    });
  }

  /* ---------------- نوشتن روی سرور ---------------- */

  function pushExpenses(list) {
    if (!list.length) return Promise.resolve(0);
    var chunks = [], i;
    for (i = 0; i < list.length; i += BATCH) chunks.push(list.slice(i, i + BATCH));
    return chunks.reduce(function (chain, chunk) {
      return chain.then(function (n) {
        var writes = chunk.map(function (x) {
          return {
            update: {
              name: docName('expenses', x.id),
              fields: encFields({
                amount: Math.round(Number(x.amount) || 0),
                title: x.title || '',
                entityId: x.entityId || '',
                categoryId: x.categoryId || '',
                date: x.date || '',
                note: x.note || '',
                createdAt: Number(x.createdAt) || 0,
                updatedAt: Number(x.updatedAt) || 0,
                deleted: !!x.deleted
              })
            }
          };
        });
        return authFetch(base() + ':commit', {
          method: 'POST', body: JSON.stringify({ writes: writes })
        }).then(readOrThrow).then(function () { return n + chunk.length; });
      });
    }, Promise.resolve(0));
  }

  function pushMeta(key, items, updatedAt) {
    return authFetch(bookPath() + '/config/' + key, {
      method: 'PATCH',
      body: JSON.stringify({
        fields: encFields({ json: JSON.stringify(items), updatedAt: updatedAt })
      })
    }).then(readOrThrow);
  }

  /* ---------------- چرخه‌ی همگام‌سازی ---------------- */

  function syncNow(opts) {
    if (!isOn()) return Promise.resolve({ skipped: 'off' });
    if (st.busy) return Promise.resolve({ skipped: 'busy' });
    if (global.navigator && global.navigator.onLine === false) {
      setStatus('offline', 'اینترنت وصل نیست');
      return Promise.resolve({ skipped: 'offline' });
    }

    st.busy = true;
    setStatus('syncing', '');
    var cursor = readJson(CUR_KEY, { lastPulledAt: 0, lastFullAt: 0 });
    var full = !!(opts && opts.full) || !cursor.lastFullAt;
    var pulled = 0, pushed = 0, metaChanged = false;

    return (full ? pullAll() : pullSince(cursor.lastPulledAt - OVERLAP_MS))
      .then(function (remote) {
        pulled = hooks.mergeRemote(remote);
        var maxAt = cursor.lastPulledAt;
        remote.forEach(function (r) { if (r.updatedAt > maxAt) maxAt = r.updatedAt; });
        writeJson(CUR_KEY, {
          lastPulledAt: Math.max(maxAt, cursor.lastPulledAt),
          lastFullAt: full ? Date.now() : cursor.lastFullAt
        });
        return pullMeta();
      })
      .then(function (meta) {
        var local = hooks.getMeta();
        var toPush = [];
        ['entities', 'categories'].forEach(function (key) {
          var r = meta[key];
          if (r && r.updatedAt > local.updatedAt) {
            hooks.setMeta(key, r.items, r.updatedAt);
            metaChanged = true;
          } else if (!r || local.updatedAt > r.updatedAt) {
            toPush.push(key);
          }
        });
        if (!toPush.length) return null;
        var fresh = hooks.getMeta();
        return Promise.all(toPush.map(function (key) {
          return pushMeta(key, fresh[key], fresh.updatedAt);
        }));
      })
      .then(function () {
        var dirty = hooks.getDirty();
        if (!dirty.length) return 0;
        var stamp = Date.now();
        return pushExpenses(dirty).then(function (n) {
          hooks.markSynced(dirty.map(function (x) { return x.id; }), stamp);
          return n;
        });
      })
      .then(function (n) {
        pushed = n || 0;
        st.busy = false;
        setStatus('idle', '');
        if (pulled || pushed || metaChanged) {
          hooks.afterSync({ pulled: pulled, pushed: pushed, meta: metaChanged });
        }
        return { pulled: pulled, pushed: pushed };
      })
      .catch(function (err) {
        st.busy = false;
        setStatus('error', friendlyError(err));
        console.error('همگام‌سازی ناموفق', err);
        return { error: err };
      });
  }

  function friendlyError(err) {
    var m = String((err && (err.code || err.message)) || '');
    if (/API key not valid|INVALID_API_KEY|API_KEY_INVALID/i.test(m)) {
      return 'کلید API درست نیست';
    }
    if (/ADMIN_ONLY_OPERATION|OPERATION_NOT_ALLOWED/i.test(m)) {
      return 'ورود ناشناس در فایربیس فعال نشده است';
    }
    if (err && err.httpStatus === 403) {
      return 'اجازه‌ی دسترسی نیست — قوانین Firestore را بررسی کنید';
    }
    if (err && err.httpStatus === 404) {
      return 'پایگاه داده پیدا نشد — شناسه پروژه یا Firestore را بررسی کنید';
    }
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'اینترنت وصل نیست';
    return m || 'خطای ناشناخته';
  }

  /* ---------------- زمان‌بندی ---------------- */

  function start() {
    stop();
    if (!isOn()) { setStatus('off', ''); return; }
    setStatus('idle', '');
    syncNow({ full: true });
    pollTimer = setInterval(function () {
      if (!global.document || global.document.visibilityState === 'visible') syncNow();
    }, POLL_MS);
  }

  function stop() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  }

  /* بعد از هر تغییر محلی صدا زده می‌شود */
  function nudge() {
    if (!isOn()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { syncNow(); }, PUSH_DEBOUNCE_MS);
  }

  if (global.addEventListener) {
    global.addEventListener('online', function () { if (isOn()) syncNow(); });
    global.addEventListener('focus', function () { if (isOn()) syncNow(); });
  }
  if (global.document) {
    global.document.addEventListener('visibilitychange', function () {
      if (global.document.visibilityState === 'visible' && isOn()) syncNow();
    });
  }

  global.Sync = {
    bind: function (h) { hooks = h; },
    start: start,
    stop: stop,
    nudge: nudge,
    syncNow: syncNow,
    isOn: isOn,
    getConfig: getConfig,
    setConfig: setConfig,
    newCode: newCode,
    normalizeCode: normalizeCode,
    status: status,
    onStatus: onStatus,
    /* برای تست */
    _internals: { enc: enc, dec: dec, encFields: encFields, decFields: decFields }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
