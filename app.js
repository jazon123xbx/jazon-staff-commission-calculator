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

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- state ---------- */

  var sales = [];
  var activeStaff = '';
  var loadFailed = false;

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

  function showStorageWarning() {
    var el = $('storageWarning');
    if (!el) return;
    $('storageWarningText').textContent =
      'The saved history in ' + STORE_KEY + ' is unreadable and has been left untouched. ' +
      'New sales will not be written until you restore. Use "Restore Last Backup" or "Restore JSON Backup".';
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

  function $(id) { return document.getElementById(id); }

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
      note.textContent = 'Filtered to ' + activeStaff + ' \u2014 dashboard, earnings, history and CSV export show this staff only.';
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

  function fmtTime(ts) {
    var d = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : n; };
    var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(h) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + ap;
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

  function renderHistory(list) {
    var rows = list.slice().sort(function (a, b) { return b.ts - a.ts || (a.id < b.id ? 1 : -1); });
    var body = $('historyTable').tBodies[0];

    body.innerHTML = rows.map(function (s) {
      var q = s.qty || 1;
      var margin = extraMarginOf(s), net = businessNetOf(s), ownerEarning = ownerEarningOf(s);
      return '<tr>' +
        '<td>' + esc(fmtTime(s.ts)) + '</td>' +
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
    }).join('');

    $('historyEmpty').hidden = rows.length > 0;
  }

  function renderStaffOptions() {
    var names = {};
    sales.forEach(function (s) { names[s.staff] = true; });
    var list = Object.keys(names).sort();

    var filter = $('staffFilter');
    var keep = filter.value;
    filter.innerHTML = '<option value="">All Staff</option>' +
      list.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    filter.value = (keep && (list.indexOf(keep) !== -1 || keep === '')) ? keep : '';

    if (filter.value !== activeStaff) activeStaff = filter.value;
    if (activeStaff && list.indexOf(activeStaff) === -1) { activeStaff = ''; filter.value = ''; }

    $('staffList').innerHTML = list.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('');
  }

  function renderAll() {
    renderStaffOptions();
    var list = visibleSales();
    renderStats(list);
    renderEarnings(list);
    renderHistory(list);
  }

  /* ---------- CSV ---------- */

  var CSV_HEAD = ['Time', 'Staff', 'Type', 'Game / Description', 'Product', 'Robux', 'Qty',
    'Gross Sale', 'Business Base', 'Commission', 'Owner Earning', 'Extra Margin', 'Business Net'];

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    var list = visibleSales().slice().sort(function (a, b) { return a.ts - b.ts || (a.id > b.id ? 1 : -1); });
    if (!list.length) { alert('No sales to export.'); return; }

    var lines = [CSV_HEAD.map(csvCell).join(',')];
    list.forEach(function (s) {
      var q = s.qty || 1;
      lines.push([
        fmtTime(s.ts), s.staff, typeLabel(s),
        s.gameDesc, s.product || '', s.robux, q,
        (s.grossC * q / 100).toFixed(2), (s.baseC * q / 100).toFixed(2),
        (s.commC * q / 100).toFixed(2),
        (ownerEarningOf(s) * q / 100).toFixed(2),
        (extraMarginOf(s) * q / 100).toFixed(2),
        (businessNetOf(s) * q / 100).toFixed(2)
      ].map(csvCell).join(','));
    });

    var csv = '\ufeff' + lines.join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var suffix = activeStaff ? '-' + activeStaff.replace(/[^A-Za-z0-9]+/g, '-') : '';
    a.href = url;
    a.download = 'jazon-staff-sales' + suffix + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
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
    var raw = readStoredRaw(STORE_KEY);
    var stored = raw ? parseSaleList(raw) : null;
    var list = stored || sales;
    if (!list || !list.length) { alert('No sales to back up.'); return; }

    var json = stored ? raw : JSON.stringify(list, null, 2);
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

  function applyRestored(list) {
    sales = list;
    loadFailed = false;
    hideStorageWarning();
    save();
    renderAll();
    renderCatalogPreview();
    renderManualPreview();
  }

  function restoreFromFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var list = parseSaleList(String(reader.result == null ? '' : reader.result));
      if (!list) {
        alert('That file is not a valid sales backup. Nothing was imported.');
        return;
      }
      if (!confirm('Restore this backup and replace current sales history?')) return;
      applyRestored(list);
      alert('Backup restored \u2014 ' + list.length + ' sale(s).');
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
    if (!confirm('Restore this backup and replace current sales history?')) return;
    applyRestored(list);
    alert('Last backup restored \u2014 ' + list.length + ' sale(s).');
  }

  /* ---------- init ---------- */


  function init() {
    if (typeof CATALOG === 'undefined' || !CATALOG.length) {
      document.querySelector('main').innerHTML =
        '<p class="card">Catalog failed to load. Make sure catalog.js sits next to index.html.</p>';
      return;
    }

    load();
    if (loadFailed) showStorageWarning();
    buildGames();
    applyProductFilter();

    var last = '';
    try { last = localStorage.getItem(LAST_STAFF_KEY) || ''; } catch (e) {}
    if (last) { $('catStaff').value = last; $('manStaff').value = last; }

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

    // keep the two staff fields in sync for faster entry
    $('catStaff').addEventListener('input', function () { if (this.value) { $('manStaff').value = this.value; renderManualPreview(); } });
    $('manStaff').addEventListener('input', function () { if (this.value) $('catStaff').value = this.value; });

    $('staffFilter').addEventListener('change', function () { activeStaff = this.value; renderAll(); });

    $('historyTable').tBodies[0].addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-del]') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-del');
      sales = sales.filter(function (s) { return s.id !== id; });
      save();
      renderAll();
    });

    $('clearBtn').addEventListener('click', function () {
      if (!sales.length) { alert('No sales to clear.'); return; }
      if (confirm('Delete ALL ' + sales.length + ' sale(s)? This cannot be undone.')) {
        sales = [];
        save();
        renderAll();
      }
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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
