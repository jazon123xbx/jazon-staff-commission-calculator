/* Jazon Staff Commission Calculator - vanilla JS, no dependencies. */
(function () {
  'use strict';

  var RATES = {
    GAME_GIFT: { basePer100: 40, customerPer100: 45, commissionPer100: 5 },
    VIA_PLUS:  { basePer100: 70, customerPer100: 75, commissionPer100: 5 }
  };
  var STORE_KEY = 'jazon.staff.commission.sales.v1';
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

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      sales = Array.isArray(parsed) ? parsed.filter(function (s) { return s && s.id; }) : [];
    } catch (e) {
      sales = [];
    }
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(sales)); } catch (e) { /* storage full/blocked */ }
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
      ['catRobux', 'catPrice', 'catBase', 'catComm', 'catNet'].forEach(function (id) { $(id).textContent = '\u2014'; });
      $('catNet').className = '';
      $('catAdd').disabled = true;
      return;
    }

    var robux = p.r, price = p.p;
    var base = baseCents(robux, 'GAME_GIFT'), comm = commissionCents(robux, 'GAME_GIFT'), net = price - base - comm;

    $('catRobux').textContent = fmtRobux(robux * qty);
    $('catPrice').textContent = fmt(price * qty);
    $('catBase').textContent = fmt(base * qty);
    $('catComm').textContent = fmt(comm * qty);
    $('catNet').textContent = fmt(net * qty);
    $('catNet').className = net < 0 ? 'neg' : '';
    $('catAdd').disabled = false;
  }

  function currentSaleType() {
    var el = $('manType');
    return el && RATES[el.value] ? el.value : 'GAME_GIFT';
  }

  function renderManualPreview() {
    var saleType = currentSaleType();
    var robux = Math.floor(Number($('manRobux').value) || 0);
    var qty = Math.max(1, Math.floor(Number($('manQty').value) || 1));
    var raw = $('manPrice').value.trim();
    var custom = raw !== '' && isFinite(Number(raw));

    $('manPrice').placeholder = 'Blank = Robux \u00d7 \u20b1' + ratesFor(saleType).customerPer100 + '/100';

    if (robux <= 0) {
      ['manSell', 'manBase', 'manComm', 'manNet'].forEach(function (id) { $(id).textContent = '\u2014'; });
      $('manNet').className = '';
      $('manAdd').disabled = true;
      return null;
    }

    var sell = custom ? pesosToCents(raw) : defaultSellCents(robux, saleType);
    var base = baseCents(robux, saleType), comm = commissionCents(robux, saleType), net = sell - base - comm;

    $('manSell').textContent = fmt(sell * qty) + (custom ? '' : ' (default)');
    $('manBase').textContent = fmt(base * qty);
    $('manComm').textContent = fmt(comm * qty);
    $('manNet').textContent = fmt(net * qty);
    $('manNet').className = net < 0 ? 'neg' : '';
    $('manAdd').disabled = false;

    return { saleType: saleType, robux: robux, qty: qty, sell: sell, base: base, comm: comm, net: net, custom: custom };
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
    setTimeout(function () { btn.textContent = original; btn.disabled = false; renderCatalogPreview(); renderManualPreview(); }, 800);
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
      netC: price - base - comm
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
    if (!staff || !desc || !m) return;

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
      grossC: m.sell,
      baseC: m.base,
      commC: m.comm,
      netC: m.net,
      customPrice: m.custom
    });

    $('manDesc').value = '';
    $('manRobux').value = '';
    $('manPrice').value = '';
    $('manQty').value = '1';
    renderManualPreview();
    flash($('manAdd'), 'Sale added');
  }

  /* ---------- totals ---------- */

  function sum(list) {
    return list.reduce(function (acc, s) {
      var q = s.qty || 1;
      acc.gross += s.grossC * q;
      acc.base += s.baseC * q;
      acc.comm += s.commC * q;
      acc.net += s.netC * q;
      acc.robux += s.robux * q;
      acc.count += 1;
      return acc;
    }, { gross: 0, base: 0, comm: 0, net: 0, robux: 0, count: 0 });
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
      var g = groups[s.staff] || (groups[s.staff] = { staff: s.staff, count: 0, robux: 0, gross: 0, comm: 0 });
      var q = s.qty || 1;
      g.count += 1;
      g.robux += s.robux * q;
      g.gross += s.grossC * q;
      g.comm += s.commC * q;
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
    if (s.type === 'manual') return RATES[s.saleType] ? s.saleType : 'GAME_GIFT';
    return 'Catalog';
  }

  function typeClass(s) {
    if (s.type !== 'manual') return 'catalog';
    return s.saleType === 'VIA_PLUS' ? 'via' : 'manual';
  }

  function renderHistory(list) {
    var rows = list.slice().sort(function (a, b) { return b.ts - a.ts || (a.id < b.id ? 1 : -1); });
    var body = $('historyTable').tBodies[0];

    body.innerHTML = rows.map(function (s) {
      var q = s.qty || 1;
      return '<tr>' +
        '<td>' + esc(fmtTime(s.ts)) + '</td>' +
        '<td>' + esc(s.staff) + '</td>' +
        '<td><span class="pill ' + typeClass(s) + '">' + esc(typeLabel(s)) + '</span></td>' +
        '<td>' + esc(s.gameDesc) + '</td>' +
        '<td>' + esc(s.product || '\u2014') + '</td>' +
        '<td class="num">' + fmtRobux(s.robux) + '</td>' +
        '<td class="num">' + q + '</td>' +
        '<td class="num">' + fmt(s.grossC * q) + '</td>' +
        '<td class="num">' + fmt(s.baseC * q) + '</td>' +
        '<td class="num accent">' + fmt(s.commC * q) + '</td>' +
        '<td class="num' + (s.netC < 0 ? ' neg' : '') + '">' + fmt(s.netC * q) + '</td>' +
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
    'Gross Sale', 'Base Cost', 'Commission', 'Business Net'];

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
        (s.commC * q / 100).toFixed(2), (s.netC * q / 100).toFixed(2)
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

  /* ---------- init ---------- */

  function init() {
    if (typeof CATALOG === 'undefined' || !CATALOG.length) {
      document.querySelector('main').innerHTML =
        '<p class="card">Catalog failed to load. Make sure catalog.js sits next to index.html.</p>';
      return;
    }

    load();
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

    ['manType', 'manRobux', 'manQty', 'manPrice'].forEach(function (id) {
      $(id).addEventListener(id === 'manType' ? 'change' : 'input', renderManualPreview);
    });
    $('manualForm').addEventListener('submit', onManualSubmit);

    // keep the two staff fields in sync for faster entry
    $('catStaff').addEventListener('input', function () { if (this.value) $('manStaff').value = this.value; });
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

    renderAll();
    renderCatalogPreview();
    renderManualPreview();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
