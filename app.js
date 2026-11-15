/* Jazon Staff Commission Calculator - vanilla JS, no dependencies. */
(function () {
  'use strict';

  var RATES = {
    GAME_GIFT: { basePer100: 40, customerPer100: 45, commissionPer100: 5 },
    VIA_PLUS:  { basePer100: 70, customerPer100: 75, commissionPer100: 5 }
  };
  var STORE_KEY = 'jazon.staff.commission.sales.v1';
  var BACKUP_KEY = 'jazon.staff.commission.sales.backup.v1';
  var LAST_STAFF_KEY = 'jazon.staff.commission.lastStaff.v1';
  var SESSION_KEY = 'jazon.staff.commission.sessions.v1';
  var SESSION_BACKUP_KEY = 'jazon.staff.commission.sessions.backup.v1';
  var TIME_ZONE = 'Asia/Manila';
  var BACKUP_FORMAT = 'jazon-sales-backup';
  var BACKUP_VERSION = 2;

  /* ---------- money helpers (integer centavos = exact 2dp) ---------- */

  function ratesFor(saleType) { return RATES[saleType] || RATES.GAME_GIFT; }

  // robux x RATE / 100 pesos === robux x RATE centavos
  function robuxToCents(robux, per100) {
    return Math.round(Number(robux) * per100);
  }
  function baseCents(robux, saleType) { return robuxToCents(robux, ratesFor(saleType).basePer100); }
  function commissionCents(robux, saleType) { return robuxToCents(robux, ratesFor(saleType).commissionPer100); }
  function defaultSellCents(robux, saleType) { return robuxToCents(robux, ratesFor(saleType).customerPer100); }
  function pesosToCents(value) { return Math.round(Number(value) * 100); }

  function extraMarginOf(s) { return s.grossC - s.baseC - s.commC; }
  function businessNetOf(s) { return s.grossC - s.commC; }
  function ownerEarningOf(s) { return s.type === 'TIP' ? 0 : s.commC; }

  function fmt(cents) {
    var neg = cents < 0;
    var a = Math.abs(Math.round(cents));
    var pesos = Math.floor(a / 100);
    var cent = a % 100;
    var s = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + '\u20b1' + s + '.' + (cent < 10 ? '0' + cent : cent);
  }

  function fmtRobux(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* ---------- Asia/Manila calendar helpers ---------- */

  var dateKeyFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  var timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  });
  var longDateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  function dateParts(ts) {
    var out = {};
    dateKeyFmt.formatToParts(new Date(ts)).forEach(function (p) {
      if (p.type !== 'literal') out[p.type] = p.value;
    });
    return out;
  }

  function manilaDateKey(ts) {
    var p = dateParts(ts);
    return p.year + '-' + p.month + '-' + p.day;
  }

  function fmtTime(ts) {
    var out = {};
    timeFmt.formatToParts(new Date(ts)).forEach(function (p) {
      if (p.type !== 'literal') out[p.type] = p.value;
    });
    return out.year + '-' + out.month + '-' + out.day + ' ' +
      out.hour + ':' + out.minute + ':' + out.second + ' ' + (out.dayPeriod || '');
  }

  // Date groups already show the calendar date, so rows only need the clock time.
  function fmtClock(ts) {
    var out = {};
    timeFmt.formatToParts(new Date(ts)).forEach(function (p) {
      if (p.type !== 'literal') out[p.type] = p.value;
    });
    return out.hour + ':' + out.minute + ':' + out.second + ' ' + (out.dayPeriod || '');
  }

  // A date key is YYYY-MM-DD in Manila. Noon Manila = 04:00 UTC, so it is
  // impossible for the formatted label to drift into an adjacent day.
  function manilaLongDate(key) {
    var parts = String(key).split('-');
    if (parts.length !== 3) return key;
    var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 4, 0, 0));
    return longDateFmt.format(d);
  }

  function manilaTodayKey() { return manilaDateKey(Date.now()); }

  function manilaYesterdayKey() { return manilaDateKey(Date.now() - 86400000); }

  // Date filter values are compared as Manila calendar keys (YYYY-MM-DD).
  // Never derive them from Date#toISOString or locale text: both can resolve
  // to the previous/next UTC day around Manila midnight.
  function isDateKey(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function isDateFilter(value) {
    return value === 'all' || value === 'today' || value === 'yesterday' || value === 'custom';
  }

  function dateKeyLabel(key) {
    if (!key) return '';
    if (key === manilaTodayKey()) return 'Today';
    if (key === manilaYesterdayKey()) return 'Yesterday';
    return '';
  }

  function fullDateLabel(key) {
    var rel = dateKeyLabel(key);
    return manilaLongDate(key) + (rel ? ' \u00b7 ' + rel : '');
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- state ---------- */

  var sales = [];
  var sessions = [];
  var activeStaff = '';
  var loadFailed = false;
  var sessionsLoadFailed = false;
  var dateFilter = 'all';
  var customDate = '';
  var openSessionId = '';

  /* ---------- storage safety ---------- */

  function isSaleLike(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    if (typeof s.id !== 'string' || !s.id) return false;
    if (typeof s.ts !== 'number' || !isFinite(s.ts)) return false;
    if (typeof s.staff !== 'string' || !s.staff) return false;
    if (s.type !== 'catalog' && s.type !== 'manual' && s.type !== 'TIP') return false;
    if (s.saleType != null && s.saleType !== 'GAME_GIFT' && s.saleType !== 'VIA_PLUS') return false;
    if (s.gameDesc != null && typeof s.gameDesc !== 'string') return false;
    if (s.product != null && typeof s.product !== 'string') return false;
    // Optional association added by Calculation Sessions. Older records simply
    // do not have this field; they remain legacy history and are never rewritten.
    if (s.sessionId != null && (typeof s.sessionId !== 'string' || !s.sessionId)) return false;
    var nums = ['robux', 'qty', 'grossC', 'baseC', 'commC', 'netC'];
    for (var i = 0; i < nums.length; i++) {
      var v = s[nums[i]];
      if (typeof v !== 'number' || !isFinite(v)) return false;
    }
    return true;
  }

  // Strict: whole file/array accepted only when every record validates.
  function parseSaleList(text) {
    if (typeof text !== 'string') return null;
    var t = text.replace(/^\ufeff/, '').replace(/^\s+|\s+$/g, '');
    if (t === '') return null;
    var data;
    try { data = JSON.parse(t); } catch (e) { return null; }
    if (!Array.isArray(data)) return null;
    for (var i = 0; i < data.length; i++) if (!isSaleLike(data[i])) return null;
    return data;
  }

  function isSessionLike(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    if (typeof s.id !== 'string' || !s.id) return false;
    if (typeof s.staff !== 'string' || !s.staff) return false;
    if (typeof s.number !== 'number' || !isFinite(s.number) || s.number < 1 || Math.floor(s.number) !== s.number) return false;
    if (typeof s.startedAt !== 'number' || !isFinite(s.startedAt)) return false;
    if (s.status !== 'active' && s.status !== 'finished') return false;
    if (s.endedAt != null && (typeof s.endedAt !== 'number' || !isFinite(s.endedAt))) return false;
    if (s.status === 'finished') {
      if (typeof s.endedAt !== 'number' || !isFinite(s.endedAt)) return false;
      if (s.endedAt < s.startedAt) return false;
    }
    return true;
  }

  function parseSessionList(text) {
    if (typeof text !== 'string') return null;
    var t = text.replace(/^\ufeff/, '').replace(/^\s+|\s+$/g, '');
    if (t === '') return null;
    var data;
    try { data = JSON.parse(t); } catch (e) { return null; }
    if (!Array.isArray(data)) return null;
    var seen = {};
    for (var i = 0; i < data.length; i++) {
      if (!isSessionLike(data[i])) return null;
      if (seen[data[i].id]) return null;
      seen[data[i].id] = true;
    }
    return data;
  }

  // Backups may be the legacy bare sales array or the v2 object that also
  // carries session metadata. Both are validated strictly before import.
  function parseBackup(text) {
    if (typeof text !== 'string') return null;
    var t = text.replace(/^\ufeff/, '').replace(/^\s+|\s+$/g, '');
    if (t === '') return null;
    var data;
    try { data = JSON.parse(t); } catch (e) { return null; }

    if (Array.isArray(data)) {
      for (var i = 0; i < data.length; i++) if (!isSaleLike(data[i])) return null;
      return { sales: data, sessions: null, legacy: true };
    }

    if (!data || typeof data !== 'object') return null;
    if (!Array.isArray(data.sales)) return null;
    for (var j = 0; j < data.sales.length; j++) if (!isSaleLike(data.sales[j])) return null;

    var sessionList = null;
    if (data.sessions != null) {
      if (!Array.isArray(data.sessions)) return null;
      var seen = {};
      for (var k = 0; k < data.sessions.length; k++) {
        if (!isSessionLike(data.sessions[k])) return null;
        if (seen[data.sessions[k].id]) return null;
        seen[data.sessions[k].id] = true;
      }
      sessionList = data.sessions;
    }
    return { sales: data.sales, sessions: sessionList, legacy: false };
  }

  function showStorageWarning() {
    var el = $('storageWarning');
    if (!el) return;
    var msgs = [];
    if (loadFailed) {
      msgs.push('The saved history in ' + STORE_KEY + ' is unreadable and has been left untouched. ' +
        'New sales will not be written until you restore.');
    }
    if (sessionsLoadFailed) {
      msgs.push('The saved calculation sessions in ' + SESSION_KEY + ' are unreadable and have been left untouched. ' +
        'New sessions cannot be saved until you restore a valid backup.');
    }
    if (!msgs.length) msgs.push('Saved data could not be written.');
    $('storageWarningText').textContent =
      msgs.join(' ') + ' Use "Restore Last Backup" or "Restore JSON Backup".';
    el.hidden = false;
  }

  function hideStorageWarning() {
    var el = $('storageWarning');
    if (el) el.hidden = true;
  }

  function load() {
    sales = [];
    loadFailed = false;
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); }
    catch (e) { loadFailed = true; return; }
    if (raw == null || raw === '') return;
    var list = parseSaleList(raw);
    if (!list) { loadFailed = true; return; }
    sales = list;
  }

  function loadSessions() {
    sessions = [];
    sessionsLoadFailed = false;
    var raw = null;
    try { raw = localStorage.getItem(SESSION_KEY); }
    catch (e) { sessionsLoadFailed = true; return; }
    if (raw == null || raw === '') return;
    var list = parseSessionList(raw);
    if (!list) { sessionsLoadFailed = true; return; }
    sessions = list;
  }

  function save() {
    if (loadFailed) { showStorageWarning(); return false; }

    // Auto-backup: snapshot the current valid history before overwriting it.
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }
    if (raw != null && raw !== '') {
      var prev = parseSaleList(raw);
      if (prev && prev.length) {
        try { localStorage.setItem(BACKUP_KEY, raw); } catch (e) { /* ignore */ }
      }
    }

    try { localStorage.setItem(STORE_KEY, JSON.stringify(sales)); return true; }
    catch (e) { return false; }
  }

  function saveSessions() {
    if (sessionsLoadFailed) { showStorageWarning(); return false; }

    var raw = null;
    try { raw = localStorage.getItem(SESSION_KEY); } catch (e) { raw = null; }
    if (raw != null && raw !== '') {
      var prev = parseSessionList(raw);
      if (prev && prev.length) {
        try { localStorage.setItem(SESSION_BACKUP_KEY, raw); } catch (e) { /* ignore */ }
      }
    }

    try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessions)); return true; }
    catch (e) { return false; }
  }

  function $(id) { return document.getElementById(id); }

  /* ---------- calculation sessions ---------- */

  function findSession(id) {
    for (var i = 0; i < sessions.length; i++) if (sessions[i].id === id) return sessions[i];
    return null;
  }

  function sessionForSale(s) {
    if (!s || !s.sessionId) return null;
    var sess = findSession(s.sessionId);
    return sess && sess.staff === s.staff ? sess : null;
  }

  function sessionSales(sess) {
    if (!sess) return [];
    return sales.filter(function (s) {
      return s.sessionId === sess.id && s.staff === sess.staff;
    });
  }

  function activeSessionFor(staff) {
    var found = null;
    sessions.forEach(function (s) {
      if (s.staff !== staff || s.status !== 'active') return;
      if (!found || s.startedAt > found.startedAt) found = s;
    });
    return found;
  }

  function activeSessions() {
    return sessions.filter(function (s) { return s.status === 'active'; })
      .sort(function (a, b) { return b.startedAt - a.startedAt; });
  }

  function nextSessionNumber(staff) {
    var max = 0;
    sessions.forEach(function (s) {
      if (s.staff === staff && s.number > max) max = s.number;
    });
    return max + 1;
  }

  function prefillStaffForms(name) {
    ['catStaff', 'manStaff', 'sessionStaff', 'tipStaff'].forEach(function (id) {
      var el = $(id);
      if (el) el.value = name;
    });
    try { localStorage.setItem(LAST_STAFF_KEY, name); } catch (e) { /* ignore */ }
  }

  function startSession(staff) {
    var name = String(staff == null ? '' : staff).replace(/^\s+|\s+$/g, '');
    if (!name) {
      alert('Enter a staff name before starting a calculation.');
      return null;
    }
    if (sessionsLoadFailed) {
      alert('Calculation sessions could not be read from storage. Restore a valid backup before starting a new calculation.');
      return null;
    }
    var existing = activeSessionFor(name);
    if (existing) {
      alert(name + ' already has an active calculation (Session #' + existing.number + '). ' +
        'Finish it before starting a new one.');
      return null;
    }

    var sess = {
      id: 'sess' + Date.now() + Math.random().toString(36).slice(2, 8),
      staff: name,
      number: nextSessionNumber(name),
      startedAt: Date.now(),
      endedAt: null,
      status: 'active'
    };
    sessions.push(sess);
    if (!saveSessions()) {
      sessions.pop();
      alert('Could not save the new calculation session.');
      return null;
    }
    prefillStaffForms(name);
    renderAll();
    renderSessionFormState();
    return sess;
  }

  function finishSession(id, openDetails) {
    var sess = findSession(id);
    if (!sess) return false;
    if (sess.status !== 'active') {
      alert('This calculation is already finished.');
      return false;
    }
    var count = sessionSales(sess).length;
    if (!confirm('Finish Session #' + sess.number + ' for ' + sess.staff + '?\n\n' +
      count + ' sale(s) will stay linked to this calculation, and new sales will use a new session.')) {
      return false;
    }

    var prevEnd = sess.endedAt;
    sess.status = 'finished';
    sess.endedAt = Date.now();
    if (!saveSessions()) {
      sess.status = 'active';
      sess.endedAt = prevEnd;
      alert('Could not save the finished calculation.');
      return false;
    }
    renderAll();
    renderSessionFormState();
    if (openDetails) openSessionDetails(id);
    return true;
  }

  /* ---------- catalog form ---------- */

  var games = [];
  var filteredProducts = [];
  var selectedProduct = null;

  function buildGames() {
    var seen = {};
    CATALOG.forEach(function (p) { seen[p.g] = true; });
    games = Object.keys(seen).sort();
    var sel = $('catGame');
    sel.innerHTML = '<option value="">All Games</option>' +
      games.map(function (g) { return '<option value="' + esc(g) + '">' + esc(g) + '</option>'; }).join('');
  }

  function productLabel(p) {
    return p.c + ' \u203a ' + p.t + ' \u2014 ' + fmt(p.p);
  }

  function applyProductFilter() {
    var game = $('catGame').value;
    var q = $('catSearch').value.trim().toLowerCase();

    filteredProducts = CATALOG.filter(function (p) {
      if (game && p.g !== game) return false;
      if (!q) return true;
      return (p.t + ' ' + p.c + ' ' + p.g + ' ' + p.s).toLowerCase().indexOf(q) !== -1;
    });

    var sel = $('catProduct');
    var keep = sel.value;
    var html = '<option value="">Select a product (' + filteredProducts.length + ')</option>';
    html += filteredProducts.map(function (p) {
      return '<option value="' + esc(p.s) + '">' + esc(productLabel(p)) + '</option>';
    }).join('');
    sel.innerHTML = html;
    if (keep && filteredProducts.some(function (p) { return p.s === keep; })) sel.value = keep;

    $('catCount').textContent = filteredProducts.length + ' of ' + CATALOG.length + ' products';
    selectedProduct = null;
    $('catAdd').disabled = true;
    renderCatalogPreview();
  }

  function findProduct(slug) {
    for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].s === slug) return CATALOG[i];
    return null;
  }

  function renderCatalogPreview() {
    var p = findProduct($('catProduct').value);
    var qty = Math.max(1, Math.floor(Number($('catQty').value) || 1));
    selectedProduct = p;

    if (!p) {
      ['catRobux', 'catPrice', 'catBase', 'catComm', 'catOwnerEarning', 'catMargin', 'catNet'].forEach(function (id) { $(id).textContent = '\u2014'; });
      $('catMargin').className = '';
      $('catNet').className = '';
      $('catAdd').disabled = true;
      return;
    }

    var robux = p.r, price = p.p;
    var base = baseCents(robux, 'GAME_GIFT'), comm = commissionCents(robux, 'GAME_GIFT');
    var margin = price - base - comm;
    var net = price - comm;

    $('catRobux').textContent = fmtRobux(robux * qty);
    $('catPrice').textContent = fmt(price * qty);
    $('catBase').textContent = fmt(base * qty);
    $('catComm').textContent = fmt(comm * qty);
    $('catOwnerEarning').textContent = fmt(comm * qty);
    $('catMargin').textContent = fmt(margin * qty);
    $('catMargin').className = margin < 0 ? 'neg' : '';
    $('catNet').textContent = fmt(net * qty);
    $('catNet').className = net < 0 ? 'neg' : '';
    $('catAdd').disabled = false;
  }

  function currentSaleType() {
    var el = $('manType');
    return el && RATES[el.value] ? el.value : 'GAME_GIFT';
  }

  function updateManualModeUI() {
    var saleType = currentSaleType();
    var via = saleType === 'VIA_PLUS';
    var r = ratesFor(saleType);

    $('manTitle').textContent = via ? 'VIA_PLUS Sale' : 'Manual Gift Sale';
    $('manHint').textContent = via
      ? 'VIA_PLUS sale. Type the Robux amount yourself \u2014 gross, business base and commission follow the VIA_PLUS rates.'
      : 'Gamepass / item with a Robux cost you enter yourself. Rates follow the Sale Type.';

    $('manRobuxLabel').textContent = via ? 'Robux Amount' : 'Robux Cost';
    $('manRobux').placeholder = via ? 'Enter Robux amount' : '0';
    $('manRobuxExamples').hidden = !via;

    $('manDesc').required = !via;
    $('manDesc').placeholder = via ? 'Optional \u2014 e.g. Roblox top-up' : 'e.g. Drag Drive gamepass';
    $('manDescNote').hidden = !via;

    $('manRateNote').textContent = saleType + ': Base \u20b1' + r.basePer100 + '/100 \u00b7 Sell \u20b1' +
      r.customerPer100 + '/100 \u00b7 Commission \u20b1' + r.commissionPer100 + '/100';

    $('manAdd').textContent = via ? 'Add VIA_PLUS Sale' : 'Add GAME_GIFT Sale';
    $('manualForm').classList.toggle('via-mode', via);
  }

  function manualValid(saleType, robux, qty) {
    if (!$('manStaff').value.trim()) return false;
    if (saleType !== 'VIA_PLUS' && !$('manDesc').value.trim()) return false;
    return robux > 0 && qty >= 1;
  }

  function renderManualPreview() {
    var saleType = currentSaleType();
    var robux = Math.floor(Number($('manRobux').value) || 0);
    var qty = Math.max(1, Math.floor(Number($('manQty').value) || 1));

    if (robux <= 0) {
      ['manSell', 'manBase', 'manComm', 'manOwnerEarning', 'manMargin', 'manNet'].forEach(function (id) { $(id).textContent = '\u2014'; });
      $('manMargin').className = '';
      $('manNet').className = '';
      $('manAdd').disabled = true;
      return null;
    }

    var gross = defaultSellCents(robux, saleType);
    var base = baseCents(robux, saleType), comm = commissionCents(robux, saleType);
    var margin = gross - base - comm;
    var net = gross - comm;

    $('manSell').textContent = fmt(gross * qty);
    $('manBase').textContent = fmt(base * qty);
    $('manComm').textContent = fmt(comm * qty);
    $('manOwnerEarning').textContent = fmt(comm * qty);
    $('manMargin').textContent = fmt(margin * qty);
    $('manMargin').className = margin < 0 ? 'neg' : '';
    $('manNet').textContent = fmt(net * qty);
    $('manNet').className = net < 0 ? 'neg' : '';
    $('manAdd').disabled = !manualValid(saleType, robux, qty);

    return { saleType: saleType, robux: robux, qty: qty, gross: gross, base: base, comm: comm, margin: margin, net: net };
  }

  /* ---------- add sale ---------- */

  function pushSale(sale) {
    // Only the active session for this exact staff member can receive the sale.
    // Finished sessions are never reopened and legacy sales are never rewritten.
    var sess = activeSessionFor(sale.staff);
    if (sess) sale.sessionId = sess.id;

    sales.push(sale);
    save();
    var last = $('catStaff').value.trim() || $('manStaff').value.trim();
    if (last) { try { localStorage.setItem(LAST_STAFF_KEY, last); } catch (e) {} }
    renderAll();
  }

  function flash(btn, label) {
    var original = btn.textContent;
    btn.textContent = label;
    btn.disabled = true;
    setTimeout(function () { btn.textContent = original; btn.disabled = false; renderCatalogPreview(); renderManualPreview(); renderTipForm(); }, 800);
  }

  function onCatalogSubmit(e) {
    e.preventDefault();
    var staff = $('catStaff').value.trim();
    var p = selectedProduct || findProduct($('catProduct').value);
    var qty = Math.max(1, Math.floor(Number($('catQty').value) || 1));
    if (!staff || !p) return;

    var robux = p.r, price = p.p;
    var base = baseCents(robux, 'GAME_GIFT'), comm = commissionCents(robux, 'GAME_GIFT');

    pushSale({
      id: 's' + Date.now() + Math.random().toString(36).slice(2, 7),
      ts: Date.now(),
      staff: staff,
      type: 'catalog',
      gameDesc: p.g,
      product: p.t,
      robux: robux,
      qty: qty,
      grossC: price,
      baseC: base,
      commC: comm,
      netC: price - comm
    });

    $('catProduct').value = '';
    $('catQty').value = '1';
    selectedProduct = null;
    renderCatalogPreview();
    flash($('catAdd'), 'Sale added');
  }

  function onManualSubmit(e) {
    e.preventDefault();
    var staff = $('manStaff').value.trim();
    var desc = $('manDesc').value.trim();
    var m = renderManualPreview();
    if (!staff || !m) return;
    if (m.saleType !== 'VIA_PLUS' && !desc) return;

    pushSale({
      id: 's' + Date.now() + Math.random().toString(36).slice(2, 7),
      ts: Date.now(),
      staff: staff,
      type: 'manual',
      saleType: m.saleType,
      gameDesc: desc,
      product: '',
      robux: m.robux,
      qty: m.qty,
      grossC: m.gross,
      baseC: m.base,
      commC: m.comm,
      netC: m.net,
      customPrice: false
    });

    $('manDesc').value = '';
    $('manRobux').value = '';
    $('manQty').value = '1';
    renderManualPreview();
    flash($('manAdd'), 'Sale added');
  }

  /* ---------- staff tip ---------- */

  function tipAmountCents() {
    var raw = $('tipAmount').value.trim();
    if (raw === '') return 0;
    var v = Number(raw);
    if (!isFinite(v) || v <= 0) return 0;
    return pesosToCents(v);
  }

  function renderTipForm() {
    $('tipAdd').disabled = !($('tipStaff').value.trim() !== '' && tipAmountCents() > 0);
  }

  function onTipSubmit(e) {
    e.preventDefault();
    var staff = $('tipStaff').value.trim();
    var cents = tipAmountCents();
    if (!staff || cents <= 0) return;

    pushSale({
      id: 's' + Date.now() + Math.random().toString(36).slice(2, 7),
      ts: Date.now(),
      staff: staff,
      type: 'TIP',
      gameDesc: $('tipNote').value.trim() || 'Staff Tip',
      product: '',
      robux: 0,
      qty: 1,
      grossC: cents,
      baseC: 0,
      commC: cents,
      netC: 0
    });

    $('tipAmount').value = '';
    $('tipNote').value = '';
    renderTipForm();
    flash($('tipAdd'), 'Tip added');
  }

  /* ---------- totals ---------- */

  function sum(list) {
    return list.reduce(function (acc, s) {
      var q = s.qty || 1;
      acc.gross += s.grossC * q;
      acc.base += s.baseC * q;
      acc.comm += s.commC * q;
      acc.ownerEarning += ownerEarningOf(s) * q;
      acc.margin += extraMarginOf(s) * q;
      acc.net += businessNetOf(s) * q;
      acc.robux += s.robux * q;
      acc.count += 1;
      return acc;
    }, { gross: 0, base: 0, comm: 0, ownerEarning: 0, margin: 0, net: 0, robux: 0, count: 0 });
  }

  function visibleSales() {
    if (!activeStaff) return sales;
    return sales.filter(function (s) { return s.staff === activeStaff; });
  }

  function selectedDateKey() {
    if (dateFilter === 'today') return manilaTodayKey();
    if (dateFilter === 'yesterday') return manilaYesterdayKey();
    if (dateFilter === 'custom') return isDateKey(customDate) ? customDate : manilaTodayKey();
    return null;
  }

  function filteredSales() {
    var list = visibleSales();
    var key = selectedDateKey();
    if (!key) return list;
    return list.filter(function (s) { return manilaDateKey(s.ts) === key; });
  }

  // Browsers can restore a <select>/<input> value on reload (and on bfcache
  // restores) without firing "change". Read the visible controls once at
  // startup so the rendered history always agrees with what the user sees.
  // An empty/invalid custom date deliberately falls back to Today instead of
  // silently showing All Dates.
  function syncDateFilterFromDom() {
    var sel = $('dateFilter');
    var value = sel ? sel.value : dateFilter;
    if (!isDateFilter(value)) value = 'all';
    dateFilter = value;
    if (sel) sel.value = value;

    var custom = value === 'custom';
    var wrap = $('customDateWrap');
    if (wrap) wrap.hidden = !custom;

    var input = $('customDate');
    if (!custom) {
      customDate = '';
      return;
    }
    var chosen = input ? input.value : customDate;
    if (!isDateKey(chosen)) chosen = manilaTodayKey();
    customDate = chosen;
    if (input) input.value = chosen;
  }

  function sortSalesNewest(a, b) {
    return b.ts - a.ts || (a.id < b.id ? 1 : -1);
  }

  function sortSalesOldest(a, b) {
    return a.ts - b.ts || (a.id > b.id ? 1 : -1);
  }

  /* ---------- render ---------- */

  function renderStats(list) {
    var t = sum(list);
    $('statGross').textContent = fmt(t.gross);
    $('statBase').textContent = fmt(t.base);
    $('statCommission').textContent = fmt(t.comm);
    $('statOwnerEarning').textContent = fmt(t.ownerEarning);
    $('statNet').textContent = fmt(t.net);
    $('statRobux').textContent = fmtRobux(t.robux);
    $('statCount').textContent = fmtRobux(t.count);

    var note = $('filterNote');
    if (activeStaff) {
      note.hidden = false;
      note.textContent = 'Filtered to ' + activeStaff + ' \u2014 totals, earnings, calculations, daily history and CSV export show this staff only.';
    } else {
      note.hidden = true;
      note.textContent = '';
    }
  }

  function renderEarnings(list) {
    var groups = {};
    list.forEach(function (s) {
      var g = groups[s.staff] || (groups[s.staff] = { staff: s.staff, count: 0, robux: 0, gross: 0, comm: 0, ownerEarning: 0 });
      var q = s.qty || 1;
      g.count += 1;
      g.robux += s.robux * q;
      g.gross += s.grossC * q;
      g.comm += s.commC * q;
      g.ownerEarning += ownerEarningOf(s) * q;
    });

    var rows = Object.keys(groups).map(function (k) { return groups[k]; })
      .sort(function (a, b) { return b.comm - a.comm || a.staff.localeCompare(b.staff); });

    var body = $('earningsTable').tBodies[0];
    body.innerHTML = rows.map(function (g) {
      return '<tr>' +
        '<td>' + esc(g.staff) + '</td>' +
        '<td class="num">' + g.count + '</td>' +
        '<td class="num">' + fmtRobux(g.robux) + '</td>' +
        '<td class="num">' + fmt(g.gross) + '</td>' +
        '<td class="num accent">' + fmt(g.comm) + '</td>' +
        '<td class="num">' + fmt(g.ownerEarning) + '</td>' +
        '</tr>';
    }).join('');

    $('earningsEmpty').hidden = rows.length > 0;
    $('earningsCount').textContent = rows.length ? rows.length + ' staff member' + (rows.length === 1 ? '' : 's') : '';
  }

  function typeLabel(s) {
    if (s.type === 'TIP') return 'TIP';
    if (s.type === 'manual') return RATES[s.saleType] ? s.saleType : 'GAME_GIFT';
    return 'Catalog';
  }

  function typeClass(s) {
    if (s.type === 'TIP') return 'tip';
    if (s.type !== 'manual') return 'catalog';
    return s.saleType === 'VIA_PLUS' ? 'via' : 'manual';
  }

  function saleRowHtml(s) {
    var q = s.qty || 1;
    var margin = extraMarginOf(s), net = businessNetOf(s), ownerEarning = ownerEarningOf(s);
    return '<tr class="sale-row">' +
      '<td>' + esc(fmtClock(s.ts)) + '</td>' +
      '<td>' + esc(s.staff) + '</td>' +
      '<td><span class="pill ' + typeClass(s) + '">' + esc(typeLabel(s)) + '</span></td>' +
      '<td>' + esc(s.gameDesc || '\u2014') + '</td>' +
      '<td>' + esc(s.product || '\u2014') + '</td>' +
      '<td class="num">' + fmtRobux(s.robux) + '</td>' +
      '<td class="num">' + q + '</td>' +
      '<td class="num">' + fmt(s.grossC * q) + '</td>' +
      '<td class="num">' + fmt(s.baseC * q) + '</td>' +
      '<td class="num accent">' + fmt(s.commC * q) + '</td>' +
      '<td class="num">' + fmt(ownerEarning * q) + '</td>' +
      '<td class="num' + (margin < 0 ? ' neg' : '') + '">' + fmt(margin * q) + '</td>' +
      '<td class="num' + (net < 0 ? ' neg' : '') + '">' + fmt(net * q) + '</td>' +
      '<td><button type="button" class="del-btn" data-del="' + esc(s.id) + '">Delete</button></td>' +
      '</tr>';
  }

  function sessionDetailRow(s) {
    var q = s.qty || 1;
    var margin = extraMarginOf(s), net = businessNetOf(s), ownerEarning = ownerEarningOf(s);
    return '<tr class="sale-row">' +
      '<td>' + esc(fmtClock(s.ts)) + '</td>' +
      '<td><span class="pill ' + typeClass(s) + '">' + esc(typeLabel(s)) + '</span></td>' +
      '<td>' + esc(s.gameDesc || '\u2014') + '</td>' +
      '<td>' + esc(s.product || '\u2014') + '</td>' +
      '<td class="num">' + fmtRobux(s.robux) + '</td>' +
      '<td class="num">' + q + '</td>' +
      '<td class="num">' + fmt(s.grossC * q) + '</td>' +
      '<td class="num">' + fmt(s.baseC * q) + '</td>' +
      '<td class="num accent">' + fmt(s.commC * q) + '</td>' +
      '<td class="num">' + fmt(ownerEarning * q) + '</td>' +
      '<td class="num' + (margin < 0 ? ' neg' : '') + '">' + fmt(margin * q) + '</td>' +
      '<td class="num' + (net < 0 ? ' neg' : '') + '">' + fmt(net * q) + '</td>' +
      '</tr>';
  }

  function groupDateItems(items) {
    var groups = {};
    items.forEach(function (s) {
      var sess = sessionForSale(s);
      var key = sess ? sess.id : '__legacy__';
      if (!groups[key]) groups[key] = { session: sess, items: [] };
      groups[key].items.push(s);
    });
    var out = Object.keys(groups).map(function (k) {
      var g = groups[k];
      g.items.sort(sortSalesNewest);
      g.latest = g.items.length ? g.items[0].ts : 0;
      return g;
    });
    out.sort(function (a, b) {
      if (b.latest !== a.latest) return b.latest - a.latest;
      var an = a.session ? a.session.number : -1;
      var bn = b.session ? b.session.number : -1;
      return bn - an;
    });
    return out;
  }

  function renderHistory(list) {
    var byDate = {};
    list.forEach(function (s) {
      var key = manilaDateKey(s.ts);
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(s);
    });

    var keys = Object.keys(byDate).sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
    var html = '';

    keys.forEach(function (key) {
      var items = byDate[key].slice().sort(sortSalesNewest);
      var dayTotals = sum(items);
      html += '<tr class="date-head"><td colspan="14"><div class="date-head-inner">' +
        '<span class="date-title">' + esc(fullDateLabel(key)) + '</span>' +
        '<span class="date-sum">' + dayTotals.count + ' sale(s) \u00b7 Gross ' + fmt(dayTotals.gross) +
        ' \u00b7 Commission ' + fmt(dayTotals.comm) + '</span>' +
        '</div></td></tr>';

      groupDateItems(items).forEach(function (g) {
        if (g.session) {
          var sessTotals = sum(g.items);
          var statusLabel = g.session.status === 'active' ? 'Active' : 'Finished';
          var endLabel = g.session.endedAt ? fmtTime(g.session.endedAt) : '\u2014';
          html += '<tr class="session-head"><td colspan="14"><div class="session-head-inner">' +
            '<span class="session-title">Session #' + g.session.number + '</span>' +
            '<span class="pill ' + g.session.status + '">' + statusLabel + '</span>' +
            '<span class="session-staff">' + esc(g.session.staff) + '</span>' +
            '<button type="button" class="btn small" data-view-session="' + esc(g.session.id) + '">View details</button>' +
            '<span class="session-time">Start ' + esc(fmtTime(g.session.startedAt)) + ' \u00b7 End ' + esc(endLabel) + '</span>' +
            '<span class="session-sum">' + g.items.length + ' shown \u00b7 Gross ' + fmt(sessTotals.gross) +
            ' \u00b7 Commission ' + fmt(sessTotals.comm) + '</span>' +
            '</div></td></tr>';
        } else {
          html += '<tr class="session-head legacy-head"><td colspan="14"><div class="session-head-inner">' +
            '<span class="session-title">Earlier Sales \u2014 Legacy History</span>' +
            '<span class="session-sum">No calculation session recorded. Original dates and figures are preserved.</span>' +
            '</div></td></tr>';
        }
        g.items.forEach(function (s) { html += saleRowHtml(s); });
      });
    });

    $('historyTable').tBodies[0].innerHTML = html;
    var empty = $('historyEmpty');
    empty.hidden = list.length > 0;
    if (list.length) {
      empty.textContent = '';
    } else if (!sales.length) {
      empty.textContent = 'No sales recorded yet. Add a sale above.';
    } else if (selectedDateKey()) {
      // A date filter is active: never fall back to showing older sales.
      empty.textContent = 'No sales found for the selected date.';
    } else {
      empty.textContent = 'No sales found for the selected staff member.';
    }
  }

  function renderDailyTotals() {
    var panel = $('dailyTotals');
    var key = selectedDateKey();
    if (!key) {
      panel.hidden = true;
      return;
    }
    var t = sum(filteredSales());
    var rel = dateKeyLabel(key);
    $('dailyTotalsTitle').textContent = 'Daily Totals \u2014 ' +
      (rel ? rel + ' (' + manilaLongDate(key) + ')' : manilaLongDate(key));
    $('dailyCount').textContent = fmtRobux(t.count);
    $('dailyRobux').textContent = fmtRobux(t.robux);
    $('dailyGross').textContent = fmt(t.gross);
    $('dailyBase').textContent = fmt(t.base);
    $('dailyCommission').textContent = fmt(t.comm);
    $('dailyOwnerEarning').textContent = fmt(t.ownerEarning);
    $('dailyMargin').textContent = fmt(t.margin);
    $('dailyNet').textContent = fmt(t.net);
    panel.hidden = false;
  }

  function renderSessions() {
    var list = sessions.slice().sort(function (a, b) { return b.startedAt - a.startedAt; });
    if (activeStaff) {
      list = list.filter(function (s) { return s.staff === activeStaff; });
    }

    var body = $('sessionTable').tBodies[0];
    body.innerHTML = list.map(function (sess) {
      var items = sessionSales(sess);
      var t = sum(items);
      return '<tr>' +
        '<td>' + esc(fmtTime(sess.startedAt)) + '</td>' +
        '<td>' + esc(sess.staff) + '</td>' +
        '<td>#' + sess.number + '</td>' +
        '<td><span class="pill ' + sess.status + '">' + (sess.status === 'active' ? 'Active' : 'Finished') + '</span></td>' +
        '<td class="num">' + items.length + '</td>' +
        '<td class="num">' + fmt(t.gross) + '</td>' +
        '<td class="num accent">' + fmt(t.comm) + '</td>' +
        '<td><button type="button" class="btn small" data-view-session="' + esc(sess.id) + '">View</button></td>' +
        '</tr>';
    }).join('');

    $('sessionEmpty').hidden = list.length > 0;
    $('sessionEmpty').textContent = list.length > 0 ? '' :
      (activeStaff ? 'No calculations for this staff member yet.' : 'No calculations yet. Start one above.');
    $('sessionCount').textContent = list.length ?
      list.length + ' calculation' + (list.length === 1 ? '' : 's') : '';
  }

  function renderActiveSessions() {
    var panel = $('activeSessionPanel');
    var list = activeSessions();
    if (!list.length) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    panel.hidden = false;
    panel.innerHTML = list.map(function (sess) {
      var items = sessionSales(sess);
      var t = sum(items);
      return '<div class="active-session">' +
        '<div class="active-session-main">' +
        '<span class="active-badge">Active Calculation</span>' +
        '<b>' + esc(sess.staff) + ' \u00b7 Session #' + sess.number + '</b>' +
        '<span class="muted">Started ' + esc(fmtTime(sess.startedAt)) + '</span>' +
        '<span class="muted">' + items.length + ' sale(s) \u00b7 Commission ' + fmt(t.comm) + '</span>' +
        '</div>' +
        '<div class="active-session-actions">' +
        '<button type="button" class="btn small" data-view-session="' + esc(sess.id) + '">View Details</button>' +
        '<button type="button" class="btn danger small" data-finish-session="' + esc(sess.id) + '">Finish Calculation</button>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function renderSessionFormState() {
    var input = $('sessionStaff');
    var name = input.value.replace(/^\s+|\s+$/g, '');
    var active = name ? activeSessionFor(name) : null;
    $('startSessionBtn').disabled = !name;
    if (active) {
      $('sessionHint').textContent = name + ' already has an active calculation (Session #' + active.number +
        '). Finish it before starting a new one.';
    } else {
      $('sessionHint').textContent = 'Start a calculation to group all new sales for one staff member into a single session.';
    }
  }

  function sessionTotalsHtml(t) {
    function item(label, value, extraClass) {
      return '<div class="total-item"><span>' + label + '</span><b' +
        (extraClass ? ' class="' + extraClass + '"' : '') + '>' + value + '</b></div>';
    }
    return item('Total Sales', fmtRobux(t.count)) +
      item('Total Robux', fmtRobux(t.robux)) +
      item('Gross Sales', fmt(t.gross)) +
      item('Business Base', fmt(t.base)) +
      item('Staff Commission', fmt(t.comm), 'accent') +
      item('Owner Earning', fmt(t.ownerEarning)) +
      item('Extra Margin', fmt(t.margin)) +
      item('Business Net', fmt(t.net));
  }

  function openSessionDetails(id) {
    var sess = findSession(id);
    if (!sess) return;
    openSessionId = id;
    var items = sessionSales(sess).slice().sort(sortSalesNewest);
    var t = sum(items);

    $('sessionDialogTitle').textContent = 'Session #' + sess.number + ' \u2014 ' + sess.staff;
    $('sessionDialogMeta').innerHTML =
      '<div class="meta-item"><span>Date</span><b>' + esc(manilaLongDate(manilaDateKey(sess.startedAt))) + '</b></div>' +
      '<div class="meta-item"><span>Staff Name</span><b>' + esc(sess.staff) + '</b></div>' +
      '<div class="meta-item"><span>Session Number</span><b>#' + sess.number + '</b></div>' +
      '<div class="meta-item"><span>Session ID</span><b class="mono">' + esc(sess.id) + '</b></div>' +
      '<div class="meta-item"><span>Status</span><b><span class="pill ' + sess.status + '">' +
      (sess.status === 'active' ? 'Active' : 'Finished') + '</span></b></div>' +
      '<div class="meta-item"><span>Start</span><b>' + esc(fmtTime(sess.startedAt)) + '</b></div>' +
      '<div class="meta-item"><span>End</span><b>' + esc(sess.endedAt ? fmtTime(sess.endedAt) : '\u2014') + '</b></div>';

    $('sessionSalesTable').tBodies[0].innerHTML = items.map(sessionDetailRow).join('');
    $('sessionDialogEmpty').hidden = items.length > 0;
    $('sessionDialogTotals').innerHTML = sessionTotalsHtml(t);

    var finishBtn = $('sessionFinishBtn');
    finishBtn.hidden = sess.status !== 'active';
    finishBtn.setAttribute('data-finish-session', sess.id);

    var dlg = $('sessionDialog');
    if (dlg && typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
    } else if (dlg) {
      dlg.setAttribute('open', '');
    }
  }

  function closeSessionDetails() {
    openSessionId = '';
    var dlg = $('sessionDialog');
    if (!dlg) return;
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }

  function renderStaffOptions() {
    var names = {};
    sales.forEach(function (s) { names[s.staff] = true; });
    sessions.forEach(function (s) { names[s.staff] = true; });
    var list = Object.keys(names).sort();

    var filter = $('staffFilter');
    var keep = filter.value;
    var options = '<option value="">All Staff</option>' +
      list.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    filter.innerHTML = options;
    filter.value = (keep && list.indexOf(keep) !== -1) ? keep : '';

    if (filter.value !== activeStaff) activeStaff = filter.value;
    if (activeStaff && list.indexOf(activeStaff) === -1) { activeStaff = ''; filter.value = ''; }

    var hist = $('histStaffFilter');
    hist.innerHTML = options;
    hist.value = activeStaff;

    $('staffList').innerHTML = list.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('');
  }

  function renderAll() {
    renderStaffOptions();
    var all = visibleSales();
    renderStats(all);
    renderEarnings(all);
    renderDailyTotals();
    renderHistory(filteredSales());
    renderSessions();
    renderActiveSessions();
  }

  /* ---------- CSV ---------- */

  // Original columns stay in place; session columns are appended so older
  // spreadsheets/imports keep working unchanged.
  var CSV_HEAD = ['Time', 'Staff', 'Type', 'Game / Description', 'Product', 'Robux', 'Qty',
    'Gross Sale', 'Business Base', 'Commission', 'Owner Earning', 'Extra Margin', 'Business Net',
    'Session ID', 'Session Date'];

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function downloadCsv(list, filename) {
    var lines = [CSV_HEAD.map(csvCell).join(',')];
    list.forEach(function (s) {
      var q = s.qty || 1;
      var sess = sessionForSale(s);
      lines.push([
        fmtTime(s.ts), s.staff, typeLabel(s),
        s.gameDesc, s.product || '', s.robux, q,
        (s.grossC * q / 100).toFixed(2), (s.baseC * q / 100).toFixed(2),
        (s.commC * q / 100).toFixed(2),
        (ownerEarningOf(s) * q / 100).toFixed(2),
        (extraMarginOf(s) * q / 100).toFixed(2),
        (businessNetOf(s) * q / 100).toFixed(2),
        sess ? sess.id : '',
        sess ? manilaDateKey(sess.startedAt) : ''
      ].map(csvCell).join(','));
    });

    var csv = '\ufeff' + lines.join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportCsv() {
    var list = filteredSales().slice().sort(sortSalesOldest);
    if (!list.length) { alert('No sales to export.'); return; }

    var suffix = activeStaff ? '-' + activeStaff.replace(/[^A-Za-z0-9]+/g, '-') : '';
    var dateKey = selectedDateKey();
    if (dateKey) suffix += '-' + dateKey;
    downloadCsv(list, 'jazon-staff-sales' + suffix + '-' + manilaDateKey(Date.now()) + '.csv');
  }

  function exportSessionCsv(id) {
    var sess = findSession(id);
    if (!sess) return;
    var list = sessionSales(sess).slice().sort(sortSalesOldest);
    if (!list.length) { alert('This calculation has no sales to export.'); return; }
    var staffSlug = sess.staff.replace(/[^A-Za-z0-9]+/g, '-');
    downloadCsv(list, 'jazon-session-' + staffSlug + '-' + sess.number + '-' +
      manilaDateKey(sess.startedAt) + '.csv');
  }

  /* ---------- JSON backup / restore ---------- */

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function backupFileName() {
    var d = new Date();
    return 'jazon-sales-backup-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' +
      pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.json';
  }

  function readStoredRaw(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function downloadBackup() {
    if (!sales.length && !sessions.length) {
      alert('No sales or calculations to back up.');
      return;
    }
    if (loadFailed) {
      alert('The saved sales history is unreadable, so a safe backup cannot be created. Restore a valid backup first.');
      return;
    }
    if (sessionsLoadFailed) {
      alert('The saved calculation sessions are unreadable, so a safe backup cannot be created. Restore a valid backup first.');
      return;
    }

    var payload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      app: 'jazon-staff-commission-calculator',
      exportedAt: new Date().toISOString(),
      timeZone: TIME_ZONE,
      sales: sales,
      sessions: sessions
    };

    var json = JSON.stringify(payload, null, 2);
    var blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = backupFileName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function applyRestored(parsed) {
    var sessionReadFailed = sessionsLoadFailed;
    sales = parsed.sales.slice();

    // A legacy array backup has no session metadata. Keep existing session
    // records rather than deleting them; nothing is removed during restore.
    // If the session key itself was unreadable, leave that raw value untouched.
    if (parsed.sessions !== null) {
      sessions = parsed.sessions.slice();
      sessionsLoadFailed = false;
    }
    loadFailed = false;
    hideStorageWarning();

    var savedSales = save();
    var savedSessions = true;
    if (parsed.sessions !== null || !sessionReadFailed) savedSessions = saveSessions();
    if (!savedSales || !savedSessions) {
      alert('The backup was loaded, but this browser could not write all of it to localStorage. ' +
        'Export a backup before closing the page.');
    }
    if (sessionReadFailed && parsed.sessions === null) showStorageWarning();

    $('dateFilter').value = 'all';
    $('customDate').value = '';
    syncDateFilterFromDom();

    closeSessionDetails();
    renderAll();
    renderCatalogPreview();
    renderManualPreview();
    renderTipForm();
    renderSessionFormState();
  }

  function restoreFromFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed = parseBackup(String(reader.result == null ? '' : reader.result));
      if (!parsed) {
        alert('That file is not a valid sales backup. Nothing was imported.');
        return;
      }
      var prompt = parsed.sessions !== null
        ? 'Restore this backup and replace current sales history and calculations?'
        : 'Restore this legacy sales backup and replace current sales history? Current calculation sessions will be kept.';
      if (!confirm(prompt)) return;
      applyRestored(parsed);
      var sessionCount = parsed.sessions !== null ? parsed.sessions.length : sessions.length;
      alert('Backup restored \u2014 ' + parsed.sales.length + ' sale(s) and ' +
        sessionCount + ' calculation(s).');
    };
    reader.onerror = function () { alert('Could not read that file. Nothing was imported.'); };
    reader.readAsText(file);
  }

  function restoreLastBackup() {
    var raw = readStoredRaw(BACKUP_KEY);
    if (raw == null || raw === '') {
      alert('No backup found yet. A backup is created automatically after you save a sale.');
      return;
    }
    var list = parseSaleList(raw);
    if (!list) { alert('The saved backup is corrupted and cannot be restored.'); return; }

    var sessionRaw = readStoredRaw(SESSION_BACKUP_KEY);
    var sessionList = sessionRaw ? parseSessionList(sessionRaw) : null;
    var parsed = { sales: list, sessions: sessionList, legacy: true };
    if (!confirm('Restore this backup and replace current sales history?' +
      (sessionList ? ' Saved calculation sessions will also be restored.' : ' Current calculation sessions will be kept.'))) {
      return;
    }
    applyRestored(parsed);
    alert('Last backup restored \u2014 ' + list.length + ' sale(s)' +
      (sessionList ? ' and ' + sessionList.length + ' calculation(s).' : '.'));
  }

  /* ---------- init ---------- */


  function init() {
    if (typeof CATALOG === 'undefined' || !CATALOG.length) {
      document.querySelector('main').innerHTML =
        '<p class="card">Catalog failed to load. Make sure catalog.js sits next to index.html.</p>';
      return;
    }

    load();
    loadSessions();
    if (loadFailed || sessionsLoadFailed) showStorageWarning();
    // Adopt any filter value the browser restored before the first render.
    syncDateFilterFromDom();
    buildGames();
    applyProductFilter();

    var last = '';
    try { last = localStorage.getItem(LAST_STAFF_KEY) || ''; } catch (e) {}
    if (last) {
      $('catStaff').value = last;
      $('manStaff').value = last;
      $('sessionStaff').value = last;
      $('tipStaff').value = last;
    }

    $('catGame').addEventListener('change', applyProductFilter);
    $('catSearch').addEventListener('input', applyProductFilter);
    $('catProduct').addEventListener('change', renderCatalogPreview);
    $('catQty').addEventListener('input', renderCatalogPreview);
    $('catalogForm').addEventListener('submit', onCatalogSubmit);

    ['manRobux', 'manQty', 'manStaff', 'manDesc'].forEach(function (id) {
      $(id).addEventListener('input', renderManualPreview);
    });
    $('manType').addEventListener('change', function () {
      updateManualModeUI();
      renderManualPreview();
    });
    $('manRobuxExamples').addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('[data-robux]') : null;
      if (!chip) return;
      $('manRobux').value = chip.getAttribute('data-robux');
      renderManualPreview();
    });
    $('manualForm').addEventListener('submit', onManualSubmit);

    ['tipStaff', 'tipAmount', 'tipNote'].forEach(function (id) {
      $(id).addEventListener('input', renderTipForm);
    });
    $('tipForm').addEventListener('submit', onTipSubmit);

    // keep the staff fields in sync for faster entry
    $('catStaff').addEventListener('input', function () {
      if (this.value) {
        $('manStaff').value = this.value;
        $('sessionStaff').value = this.value;
        renderManualPreview();
        renderSessionFormState();
      }
    });
    $('manStaff').addEventListener('input', function () {
      if (this.value) {
        $('catStaff').value = this.value;
        $('sessionStaff').value = this.value;
        renderSessionFormState();
      }
    });
    $('sessionStaff').addEventListener('input', function () {
      renderSessionFormState();
      if (this.value) {
        $('catStaff').value = this.value;
        $('manStaff').value = this.value;
      }
    });

    $('startSessionBtn').addEventListener('click', function () {
      var sess = startSession($('sessionStaff').value);
      if (sess) renderSessionFormState();
    });
    $('viewSessionsBtn').addEventListener('click', function () {
      var target = $('sessionListHead');
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    // Session list and current-session buttons share one delegated handler.
    $('sessionCard').addEventListener('click', function (e) {
      var finishBtn = e.target.closest ? e.target.closest('[data-finish-session]') : null;
      if (finishBtn) {
        finishSession(finishBtn.getAttribute('data-finish-session'), true);
        return;
      }
      var viewBtn = e.target.closest ? e.target.closest('[data-view-session]') : null;
      if (viewBtn) openSessionDetails(viewBtn.getAttribute('data-view-session'));
    });

    $('staffFilter').addEventListener('change', function () {
      activeStaff = this.value;
      $('histStaffFilter').value = activeStaff;
      renderAll();
    });
    $('histStaffFilter').addEventListener('change', function () {
      activeStaff = this.value;
      $('staffFilter').value = activeStaff;
      renderAll();
    });

    function applyDateFilter() {
      syncDateFilterFromDom();
      renderAll();
    }
    $('dateFilter').addEventListener('change', applyDateFilter);
    $('dateFilter').addEventListener('input', applyDateFilter);
    $('customDate').addEventListener('input', function () {
      if (dateFilter !== 'custom') return;
      customDate = isDateKey(this.value) ? this.value : '';
      renderAll();
    });
    $('customDate').addEventListener('change', function () {
      if (dateFilter !== 'custom') return;
      customDate = isDateKey(this.value) ? this.value : '';
      renderAll();
    });

    $('historyTable').tBodies[0].addEventListener('click', function (e) {
      var viewBtn = e.target.closest ? e.target.closest('[data-view-session]') : null;
      if (viewBtn) {
        openSessionDetails(viewBtn.getAttribute('data-view-session'));
        return;
      }
      var btn = e.target.closest ? e.target.closest('[data-del]') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-del');
      sales = sales.filter(function (s) { return s.id !== id; });
      save();
      renderAll();
      if (openSessionId) openSessionDetails(openSessionId);
    });

    $('clearBtn').addEventListener('click', function () {
      if (!sales.length && !sessions.length) { alert('No sales or calculations to clear.'); return; }
      if (confirm('Delete ALL ' + sales.length + ' sale(s) and ' + sessions.length +
        ' calculation(s)? This cannot be undone.')) {
        sales = [];
        sessions = [];
        closeSessionDetails();
        save();
        saveSessions();
        renderAll();
      }
    });

    $('closeSessionDialog').addEventListener('click', closeSessionDetails);
    $('sessionDialog').addEventListener('click', function (e) {
      if (e.target === this) closeSessionDetails();
    });
    $('sessionDialog').addEventListener('close', function () { openSessionId = ''; });
    $('sessionExportBtn').addEventListener('click', function () {
      if (openSessionId) exportSessionCsv(openSessionId);
    });
    $('sessionFinishBtn').addEventListener('click', function () {
      var id = this.getAttribute('data-finish-session');
      if (id) finishSession(id, true);
    });

    $('exportBtn').addEventListener('click', exportCsv);

    $('backupBtn').addEventListener('click', downloadBackup);
    $('restoreBtn').addEventListener('click', function () { $('restoreFile').click(); });
    $('restoreFile').addEventListener('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      restoreFromFile(file);
    });
    $('restoreLastBtn').addEventListener('click', restoreLastBackup);
    $('warnRestoreBtn').addEventListener('click', restoreLastBackup);

    renderAll();
    renderCatalogPreview();
    updateManualModeUI();
    renderManualPreview();
    renderTipForm();
    renderSessionFormState();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
