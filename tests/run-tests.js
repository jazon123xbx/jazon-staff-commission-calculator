/*
 * Deterministic local tests for the Jazon Staff Commission Calculator.
 *
 * These tests run app.js inside a small fake DOM and fake localStorage. They do
 * not open a browser, do not use a real browser profile, and never touch real
 * browser sales history. Run with: node tests/run-tests.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const CATALOG_SRC = fs.readFileSync(path.join(ROOT, 'catalog.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

const STORE_KEY = 'jazon.staff.commission.sales.v1';
const SESSION_KEY = 'jazon.staff.commission.sessions.v1';
const BACKUP_KEY = 'jazon.staff.commission.sales.backup.v1';
const LAST_STAFF_KEY = 'jazon.staff.commission.lastStaff.v1';

const T0 = Date.UTC(2026, 10, 16, 2, 0, 0); // 2026-11-16 10:00 Asia/Manila
const T1 = Date.UTC(2026, 10, 17, 1, 0, 0); // 2026-11-17 09:00 Asia/Manila
const LEGACY_TS = Date.UTC(2026, 10, 15, 2, 0, 0); // 2026-11-15 10:00 Asia/Manila

const IDS = Array.from(new Set(Array.from(HTML.matchAll(/\bid="([^"]+)"/g), (m) => m[1])));
const TABLE_IDS = new Set(['historyTable', 'earningsTable', 'sessionTable', 'sessionSalesTable']);

class FakeStorage {
  constructor(initial) {
    this.map = new Map(Object.entries(initial || {}));
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(String(key), String(value));
  }
  removeItem(key) {
    this.map.delete(String(key));
  }
  clear() {
    this.map.clear();
  }
}

function fmtPHP(cents) {
  const neg = cents < 0;
  const a = Math.abs(Math.round(cents));
  const pesos = Math.floor(a / 100);
  const cent = a % 100;
  const s = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + '\u20b1' + s + '.' + (cent < 10 ? '0' + cent : cent);
}

function createApp(options) {
  options = options || {};
  const storage = options.storage || new FakeStorage(options.storageData);
  const alerts = [];
  const confirms = [];
  const downloads = [];
  let confirmResult = true;
  let clock = options.now == null ? T0 : options.now;
  let lastBlob = null;

  const elements = new Map();

  class FakeClassList {
    constructor(el) {
      this.el = el;
      this.set = new Set();
    }
    add() {
      for (const c of arguments) this.set.add(c);
      this.sync();
    }
    remove() {
      for (const c of arguments) this.set.delete(c);
      this.sync();
    }
    toggle(c, force) {
      const on = force === undefined ? !this.set.has(c) : !!force;
      if (on) this.set.add(c); else this.set.delete(c);
      this.sync();
      return on;
    }
    contains(c) {
      return this.set.has(c);
    }
    sync() {
      this.el.className = Array.from(this.set).join(' ');
    }
  }

  class FakeDate extends Date {
    constructor() {
      if (arguments.length === 0) super(clock);
      else super(...arguments);
    }
    static now() {
      return clock;
    }
  }

  class FakeElement {
    constructor(id, tag) {
      this.id = id || '';
      this.tagName = String(tag || 'div').toUpperCase();
      this.value = '';
      this.textContent = '';
      this._innerHTML = '';
      this.hidden = false;
      this.disabled = false;
      this.className = '';
      this.required = false;
      this.open = false;
      this.files = null;
      this.attributes = {};
      this.listeners = {};
      this.children = [];
      this.classList = new FakeClassList(this);
      this.tBodies = String(tag || 'div').toLowerCase() === 'tbody'
        ? [] : [new FakeElementBody(id + '-tbody')];
      this.scrollIntoView = function () {};
    }
    set innerHTML(v) { this._innerHTML = String(v); }
    get innerHTML() { return this._innerHTML; }
    addEventListener(type, fn) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(fn);
    }
    dispatch(type, event) {
      event = event || {};
      if (!event.target) event.target = this;
      if (!event.preventDefault) event.preventDefault = function () {};
      const list = (this.listeners[type] || []).slice();
      for (const fn of list) fn.call(this, event);
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name] : null;
    }
    removeAttribute(name) { delete this.attributes[name]; }
    appendChild(child) { this.children.push(child); return child; }
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      return child;
    }
    closest(selector) {
      const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector || '');
      if (!m) return null;
      const v = this.getAttribute(m[1]);
      if (v == null) return null;
      if (m[2] != null && v !== m[2]) return null;
      return this;
    }
    click() {
      if (this.tagName === 'A') {
        downloads.push({
          filename: this.download || '',
          content: lastBlob ? lastBlob.parts.join('') : ''
        });
        return;
      }
      this.dispatch('click', { target: this });
    }
    showModal() { this.open = true; }
    close() {
      this.open = false;
      this.dispatch('close', { target: this });
    }
    getContext() { return null; }
  }

  class FakeElementBody extends FakeElement {
    constructor(id) { super(id, 'tbody'); }
  }

  class FakeBlob {
    constructor(parts, opts) {
      this.parts = (parts || []).map(String);
      this.type = opts && opts.type;
    }
  }

  class FakeFileReader {
    readAsText(file) {
      this.result = file && file._text != null ? file._text : '';
      if (this.onload) this.onload({ target: this });
    }
  }

  const document = {
    readyState: 'complete',
    body: new FakeElement('body', 'body'),
    getElementById(id) {
      if (!elements.has(id)) {
        const tag = TABLE_IDS.has(id) ? 'table' : (id === 'sessionDialog' ? 'dialog' : 'div');
        elements.set(id, new FakeElement(id, tag));
      }
      return elements.get(id);
    },
    createElement(tag) { return new FakeElement('', tag); },
    querySelector(sel) {
      if (sel === 'main') return document.getElementById('main');
      return null;
    },
    addEventListener() {}
  };

  const defaults = {
    catQty: '1',
    manQty: '1',
    manType: 'GAME_GIFT',
    dateFilter: 'all',
    staffFilter: '',
    histStaffFilter: ''
  };
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (Object.prototype.hasOwnProperty.call(defaults, id)) el.value = defaults[id];
  }
  // Simulate a browser restoring form control values before scripts run.
  if (options.elementValues) {
    for (const id of Object.keys(options.elementValues)) {
      document.getElementById(id).value = String(options.elementValues[id]);
    }
  }
  const dlg = document.getElementById('sessionDialog');
  dlg.open = false;

  const sandbox = {
    console,
    Intl,
    JSON,
    Math,
    Date: FakeDate,
    localStorage: storage,
    document,
    alert(msg) { alerts.push(String(msg)); },
    confirm(msg) {
      confirms.push(String(msg));
      return confirmResult;
    },
    Blob: FakeBlob,
    FileReader: FakeFileReader,
    setTimeout(fn) { if (typeof fn === 'function') fn(); return 0; },
    URL: {
      createObjectURL(blob) { lastBlob = blob; return 'blob:test-' + downloads.length; },
      revokeObjectURL() {}
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(CATALOG_SRC, sandbox, { filename: 'catalog.js' });
  vm.runInContext(APP_SRC, sandbox, { filename: 'app.js' });

  const el = (id) => document.getElementById(id);
  const setValue = (id, value) => {
    const node = el(id);
    node.value = String(value);
    node.dispatch('input', { target: node });
  };
  const setSelect = (id, value) => {
    const node = el(id);
    node.value = String(value);
    node.dispatch('change', { target: node });
  };
  const submit = (id) => el(id).dispatch('submit', { target: el(id) });
  const clickDelegated = (containerId, attr, value) => {
    const target = new FakeElement('target', 'button');
    target.setAttribute(attr, value);
    el(containerId).dispatch('click', { target });
  };
  const sales = () => JSON.parse(storage.getItem(STORE_KEY) || '[]');
  const sessions = () => JSON.parse(storage.getItem(SESSION_KEY) || '[]');

  const app = {
    storage,
    alerts,
    confirms,
    downloads,
    el,
    setValue,
    setSelect,
    submit,
    clickDelegated,
    sales,
    sessions,
    CATALOG: sandbox.CATALOG,
    setConfirm(v) { confirmResult = !!v; },
    setNow(v) { clock = v; },
    getNow() { return clock; },
    startSession(staff) {
      setValue('sessionStaff', staff);
      el('startSessionBtn').dispatch('click', { target: el('startSessionBtn') });
    },
    addCatalog(staff, slug, qty) {
      setValue('catStaff', staff);
      el('catProduct').value = slug;
      el('catProduct').dispatch('change', { target: el('catProduct') });
      setValue('catQty', qty == null ? 1 : qty);
      submit('catalogForm');
    },
    addManual(staff, saleType, desc, robux, qty) {
      setSelect('manType', saleType);
      setValue('manStaff', staff);
      setValue('manDesc', desc);
      setValue('manRobux', robux);
      setValue('manQty', qty == null ? 1 : qty);
      submit('manualForm');
    },
    addTip(staff, amount, note) {
      setValue('tipStaff', staff);
      setValue('tipAmount', amount);
      setValue('tipNote', note || '');
      submit('tipForm');
    },
    finishFromPanel(id) {
      clickDelegated('sessionCard', 'data-finish-session', id);
    },
    viewSession(id) {
      clickDelegated('sessionCard', 'data-view-session', id);
    },
    viewSessionFromHistory(id) {
      clickDelegated('historyTable', 'data-view-session', id);
    },
    reload() {
      return createApp({ storage, now: clock });
    }
  };
  return app;
}

function historyHtml(app) {
  return app.el('historyTable').tBodies[0].innerHTML;
}

function countMatches(text, re) {
  const m = String(text).match(re);
  return m ? m.length : 0;
}

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS  ' + name);
  } catch (err) {
    failed += 1;
    failures.push({ name, err });
    console.log('FAIL  ' + name);
    console.log('      ' + (err && err.message ? err.message : String(err)));
  }
}

function legacySale(extra) {
  return Object.assign({
    id: 'legacy1',
    ts: LEGACY_TS,
    staff: 'Legacy Staff',
    type: 'catalog',
    gameDesc: 'Legacy Game',
    product: 'Legacy Product',
    robux: 100,
    qty: 1,
    grossC: 4500,
    baseC: 4000,
    commC: 500,
    netC: 4000
  }, extra || {});
}

function makeSale(id, ts, staff, sessionId) {
  const sale = {
    id,
    ts,
    staff,
    type: 'catalog',
    gameDesc: 'Game ' + id,
    product: 'Product ' + id,
    robux: 100,
    qty: 1,
    grossC: 4500,
    baseC: 4000,
    commC: 500,
    netC: 4000
  };
  if (sessionId) sale.sessionId = sessionId;
  return sale;
}

/* ------------------------------------------------------------------ */
/* 1. Legacy history is shown under its real date and never rewritten. */
/* ------------------------------------------------------------------ */

test('legacy sales keep original timestamp, date group, and storage bytes', () => {
  const sale = legacySale();
  const raw = JSON.stringify([sale]);
  const app = createApp({ storageData: { [STORE_KEY]: raw } });

  assert.strictEqual(app.storage.getItem(STORE_KEY), raw, 'legacy storage must not be rewritten');
  assert.strictEqual(app.sales().length, 1);
  assert.ok(historyHtml(app).includes('Sunday, November 15, 2026'));
  assert.ok(historyHtml(app).includes('Earlier Sales \u2014 Legacy History'));
  assert.ok(historyHtml(app).includes('Legacy Staff'));
  assert.ok(historyHtml(app).includes('Legacy Game'));
  assert.strictEqual(app.el('statCount').textContent, '1');
  assert.strictEqual(app.el('statGross').textContent, fmtPHP(4500));
  assert.strictEqual(app.el('statCommission').textContent, fmtPHP(500));
  assert.strictEqual(app.el('statOwnerEarning').textContent, fmtPHP(500));
  assert.strictEqual(app.el('statNet').textContent, fmtPHP(4000));
});

/* ------------------------------------------------------------------ */
/* 2. Two sessions for the same staff on the same day stay separate.   */
/* ------------------------------------------------------------------ */

test('same staff, same day: separate sessions, correct totals, TIP and owner earning', () => {
  const app = createApp();
  assert.strictEqual(app.CATALOG.length, 156, 'all 156 catalog products must remain available');
  const product = app.CATALOG[0];

  app.startSession('Alice');
  let list = app.sessions();
  assert.strictEqual(list.length, 1);
  const sess1 = list[0];
  assert.strictEqual(sess1.staff, 'Alice');
  assert.strictEqual(sess1.number, 1);
  assert.strictEqual(sess1.status, 'active');
  assert.strictEqual(sess1.endedAt, null);

  app.addCatalog('Alice', product.s, 1);
  app.addTip('Alice', '10.00', 'TIP note');
  app.addManual('Alice', 'VIA_PLUS', 'Top up', 100, 1);

  let sales = app.sales();
  assert.strictEqual(sales.length, 3);
  assert.ok(sales.every((s) => s.sessionId === sess1.id), 'all new sales must join the active session');

  const cat = sales[0];
  assert.strictEqual(cat.grossC, product.p);
  assert.strictEqual(cat.baseC, product.r * 40);
  assert.strictEqual(cat.commC, product.r * 5);
  assert.strictEqual(cat.netC, product.p - product.r * 5);

  const tip = sales[1];
  assert.strictEqual(tip.type, 'TIP');
  assert.strictEqual(tip.grossC, 1000);
  assert.strictEqual(tip.baseC, 0);
  assert.strictEqual(tip.commC, 1000);
  assert.strictEqual(tip.netC, 0);
  assert.strictEqual(tip.sessionId, sess1.id);

  const via = sales[2];
  assert.strictEqual(via.saleType, 'VIA_PLUS');
  assert.strictEqual(via.grossC, 7500);
  assert.strictEqual(via.baseC, 7000);
  assert.strictEqual(via.commC, 500);
  assert.strictEqual(via.netC, 7000);

  assert.ok(app.el('activeSessionPanel').innerHTML.includes('Session #1'));
  assert.ok(app.el('activeSessionPanel').innerHTML.includes('Alice'));

  app.finishFromPanel(sess1.id);
  list = app.sessions();
  assert.strictEqual(list[0].status, 'finished');
  assert.strictEqual(typeof list[0].endedAt, 'number');
  assert.ok(list[0].endedAt >= list[0].startedAt);
  assert.strictEqual(app.el('sessionDialog').open, true, 'finish must show final totals');
  assert.ok(app.el('sessionDialogMeta').innerHTML.includes('Alice'));
  assert.ok(app.el('sessionDialogMeta').innerHTML.includes('#1'));
  assert.ok(app.el('sessionDialogTitle').textContent.includes('Session #1'));

  const totalGross = product.p + 1000 + 7500;
  const totalBase = product.r * 40 + 0 + 7000;
  const totalComm = product.r * 5 + 1000 + 500;
  const totalMargin = (product.p - product.r * 40 - product.r * 5) + 0 + 0;
  const totalNet = (product.p - product.r * 5) + 0 + 7000;
  const totalRobux = product.r + 0 + 100;
  const totalsHtml = app.el('sessionDialogTotals').innerHTML;
  for (const expected of [
    fmtPHP(totalGross), fmtPHP(totalBase), fmtPHP(totalComm),
    fmtPHP(totalComm), fmtPHP(totalMargin), fmtPHP(totalNet)
  ]) {
    assert.ok(totalsHtml.includes(expected), 'missing session total ' + expected);
  }
  assert.ok(totalsHtml.includes(String(totalRobux)));
  const detailRows = app.el('sessionSalesTable').tBodies[0].innerHTML.split('</tr>');
  const tipRow = detailRows.find((row) => row.includes('>TIP<'));
  assert.ok(tipRow, 'TIP row must appear in session details');
  assert.ok(tipRow.includes(fmtPHP(0)), 'TIP owner earning / extra margin must remain zero');
  assert.strictEqual(countMatches(app.el('sessionSalesTable').tBodies[0].innerHTML, /<tr class="sale-row">/g), 3);

  // A sale added after finishing must not join the completed session.
  app.addTip('Alice', '5.00', 'After finish');
  sales = app.sales();
  assert.strictEqual(sales[sales.length - 1].sessionId, undefined);
  assert.strictEqual(app.el('sessionHint').textContent.includes('already has an active'), false);

  // A new calculation gets a brand-new session and number.
  app.startSession('Alice');
  list = app.sessions();
  assert.strictEqual(list.length, 2);
  const sess2 = list.find((s) => s.status === 'active');
  assert.ok(sess2);
  assert.notStrictEqual(sess2.id, sess1.id);
  assert.strictEqual(sess2.number, 2);

  app.addCatalog('Alice', app.CATALOG[1].s, 2);
  sales = app.sales();
  assert.strictEqual(sales[sales.length - 1].sessionId, sess2.id);
  assert.strictEqual(sales[sales.length - 1].qty, 2);

  app.finishFromPanel(sess2.id);
  assert.strictEqual(app.sessions().filter((s) => s.status === 'finished').length, 2);

  const html = historyHtml(app);
  assert.strictEqual(countMatches(html, /tr class="date-head"/g), 1, 'same-day sessions share one date group');
  assert.ok(html.includes('Session #1'));
  assert.ok(html.includes('Session #2'));
  assert.strictEqual(countMatches(html, /Session #1/g), 1);
  assert.strictEqual(countMatches(html, /Session #2/g), 1);

  app.viewSession(sess1.id);
  assert.strictEqual(countMatches(app.el('sessionSalesTable').tBodies[0].innerHTML, /<tr class="sale-row">/g), 3);
  assert.strictEqual(app.el('sessionDialog').open, true);
});

/* ------------------------------------------------------------------ */
/* 3. Different staff same date, different dates, and history filters. */
/* ------------------------------------------------------------------ */

test('different staff on one date and different dates group correctly; filters work', () => {
  const app = createApp();

  app.startSession('Alice');
  const aliceSess1 = app.sessions()[0];
  app.addCatalog('Alice', app.CATALOG[0].s, 1);
  app.finishFromPanel(aliceSess1.id);

  app.startSession('Bob');
  const bobSess = app.sessions().find((s) => s.staff === 'Bob');
  app.addTip('Bob', '7.50', 'Bob tip');
  app.finishFromPanel(bobSess.id);

  let sales = app.sales();
  const aliceSales = sales.filter((s) => s.staff === 'Alice');
  const bobSales = sales.filter((s) => s.staff === 'Bob');
  assert.strictEqual(aliceSales.length, 1);
  assert.strictEqual(bobSales.length, 1);
  assert.strictEqual(aliceSales[0].sessionId, aliceSess1.id);
  assert.strictEqual(bobSales[0].sessionId, bobSess.id);
  assert.notStrictEqual(aliceSales[0].sessionId, bobSales[0].sessionId);

  let html = historyHtml(app);
  assert.strictEqual(countMatches(html, /tr class="date-head"/g), 1);
  assert.ok(html.includes('Monday, November 16, 2026'));
  assert.ok(html.includes('Alice'));
  assert.ok(html.includes('Bob'));

  app.setNow(T1);
  app.startSession('Alice');
  const aliceSess2 = app.sessions().find((s) => s.status === 'active');
  app.addManual('Alice', 'GAME_GIFT', 'Next day', 200, 1);
  app.finishFromPanel(aliceSess2.id);
  assert.strictEqual(app.sessions().length, 3);

  html = historyHtml(app);
  const nov17 = html.indexOf('Tuesday, November 17, 2026');
  const nov16 = html.indexOf('Monday, November 16, 2026');
  assert.ok(nov17 !== -1 && nov16 !== -1);
  assert.ok(nov17 < nov16, 'newest date group must come first');

  app.setSelect('dateFilter', 'today');
  html = historyHtml(app);
  assert.ok(html.includes('Tuesday, November 17, 2026'));
  assert.ok(!html.includes('Monday, November 16, 2026'));
  assert.strictEqual(app.el('dailyTotals').hidden, false);
  assert.ok(app.el('dailyTotalsTitle').textContent.includes('Today'));
  assert.strictEqual(app.el('dailyCount').textContent, '1');
  assert.strictEqual(app.el('dailyGross').textContent, fmtPHP(9000));
  assert.strictEqual(app.el('dailyCommission').textContent, fmtPHP(1000));
  assert.strictEqual(app.el('dailyNet').textContent, fmtPHP(8000));

  app.setSelect('dateFilter', 'yesterday');
  html = historyHtml(app);
  assert.ok(html.includes('Monday, November 16, 2026'));
  assert.ok(!html.includes('Tuesday, November 17, 2026'));
  assert.ok(app.el('dailyTotalsTitle').textContent.includes('Yesterday'));
  assert.strictEqual(app.el('dailyCount').textContent, '2');

  app.setSelect('dateFilter', 'custom');
  app.setValue('customDate', '2026-11-17');
  html = historyHtml(app);
  assert.ok(html.includes('Tuesday, November 17, 2026'));
  assert.ok(!html.includes('Monday, November 16, 2026'));
  assert.strictEqual(app.el('dailyCount').textContent, '1');

  app.setSelect('dateFilter', 'all');
  assert.strictEqual(app.el('dailyTotals').hidden, true);
  assert.strictEqual(countMatches(historyHtml(app), /tr class="date-head"/g), 2);

  app.setSelect('histStaffFilter', 'Bob');
  assert.strictEqual(app.el('staffFilter').value, 'Bob', 'staff filters stay in sync');
  assert.ok(app.el('sessionTable').tBodies[0].innerHTML.includes('Bob'));
  assert.ok(!app.el('sessionTable').tBodies[0].innerHTML.includes('Alice'));
  html = historyHtml(app);
  assert.ok(html.includes('Bob'));
  assert.ok(!html.includes('Alice'));

  app.setSelect('histStaffFilter', '');
  assert.strictEqual(app.el('staffFilter').value, '');
});

/* ------------------------------------------------------------------ */
/* 4. Backup/restore: new format, legacy format, and invalid files.    */
/* ------------------------------------------------------------------ */

test('JSON backup includes sessions; restore preserves associations; invalid files rejected', () => {
  const legacy = legacySale();
  const app = createApp({ storageData: { [STORE_KEY]: JSON.stringify([legacy]) } });

  app.startSession('Alice');
  const sess = app.sessions()[0];
  app.addCatalog('Alice', app.CATALOG[0].s, 1);
  app.finishFromPanel(sess.id);

  app.el('backupBtn').dispatch('click', { target: app.el('backupBtn') });
  assert.strictEqual(app.downloads.length, 1);
  const backupText = app.downloads[0].content;
  const backup = JSON.parse(backupText);
  assert.strictEqual(backup.format, 'jazon-sales-backup');
  assert.strictEqual(backup.version, 2);
  assert.strictEqual(backup.timeZone, 'Asia/Manila');
  assert.strictEqual(backup.sales.length, 2);
  assert.strictEqual(backup.sessions.length, 1);
  const backedUpSale = backup.sales.find((s) => s.staff === 'Alice');
  assert.strictEqual(backedUpSale.sessionId, sess.id);
  assert.strictEqual(backup.sessions[0].status, 'finished');
  assert.ok(app.downloads[0].filename.startsWith('jazon-sales-backup-'));

  const restored = createApp();
  restored.el('restoreFile').files = [{ _text: backupText }];
  restored.el('restoreFile').dispatch('change', { target: restored.el('restoreFile') });
  assert.strictEqual(restored.sales().length, 2);
  assert.strictEqual(restored.sessions().length, 1);
  assert.strictEqual(restored.sales().find((s) => s.staff === 'Alice').sessionId, sess.id);
  assert.ok(restored.alerts.some((m) => m.includes('Backup restored')));

  // Legacy array backup is accepted and keeps existing session metadata.
  const beforeSessions = restored.sessions();
  restored.el('restoreFile').files = [{ _text: JSON.stringify([legacy]) }];
  restored.el('restoreFile').dispatch('change', { target: restored.el('restoreFile') });
  assert.strictEqual(restored.sales().length, 1);
  assert.deepStrictEqual(restored.sales()[0], legacy);
  assert.strictEqual(restored.sessions().length, beforeSessions.length);
  assert.ok(restored.confirms.some((m) => m.includes('legacy sales backup')));

  // Invalid object and invalid JSON are both rejected without changing data.
  const salesBefore = restored.storage.getItem(STORE_KEY);
  const sessionsBefore = restored.storage.getItem(SESSION_KEY);
  for (const bad of ['not json', JSON.stringify({ sales: [{ bad: true }], sessions: [] }),
    JSON.stringify({ sales: [], sessions: [{ id: 'x' }] })]) {
    restored.el('restoreFile').files = [{ _text: bad }];
    restored.el('restoreFile').dispatch('change', { target: restored.el('restoreFile') });
    assert.strictEqual(restored.storage.getItem(STORE_KEY), salesBefore);
    assert.strictEqual(restored.storage.getItem(SESSION_KEY), sessionsBefore);
  }
  assert.ok(restored.alerts.filter((m) => m.includes('not a valid sales backup')).length >= 3);
});

test('legacy sales restore never overwrites unreadable session metadata', () => {
  const badSessions = '{not valid json';
  const app = createApp({
    storageData: {
      [STORE_KEY]: JSON.stringify([legacySale()]),
      [SESSION_KEY]: badSessions
    }
  });
  assert.strictEqual(app.el('storageWarning').hidden, false);
  assert.ok(app.el('storageWarningText').textContent.includes(SESSION_KEY));

  const replacement = legacySale({ id: 'legacy2' });
  app.el('restoreFile').files = [{ _text: JSON.stringify([replacement]) }];
  app.el('restoreFile').dispatch('change', { target: app.el('restoreFile') });

  assert.strictEqual(app.storage.getItem(SESSION_KEY), badSessions, 'unreadable session data stays untouched');
  assert.deepStrictEqual(app.sales(), [replacement]);
  assert.strictEqual(app.el('storageWarning').hidden, false);
});

test('automatic last-backup restore keeps legacy sales restorable', () => {
  const legacy = legacySale();
  const app = createApp({ storageData: { [STORE_KEY]: JSON.stringify([legacy]) } });
  app.startSession('Alice');
  const sess = app.sessions()[0];
  app.addTip('Alice', '3.00', 'tip');
  app.finishFromPanel(sess.id);

  // A previous valid sale save creates the automatic snapshot.
  app.addTip('Alice', '4.00', 'tip 2');
  assert.ok(app.storage.getItem(BACKUP_KEY), 'automatic sales backup should exist');

  app.el('restoreLastBtn').dispatch('click', { target: app.el('restoreLastBtn') });
  assert.ok(app.alerts.some((m) => m.includes('Last backup restored')));
  assert.strictEqual(app.sales().length, 2);
  assert.ok(app.sales().some((s) => s.id === legacy.id));
});

/* ------------------------------------------------------------------ */
/* 5. CSV export keeps old columns and adds session ID/date.           */
/* ------------------------------------------------------------------ */

test('CSV export preserves old fields, appends session columns, and exports one session', () => {
  const app = createApp();
  app.startSession('Alice');
  const sess1 = app.sessions()[0];
  app.addCatalog('Alice', app.CATALOG[0].s, 1);
  app.addTip('Alice', '2.50', 'session tip');
  app.finishFromPanel(sess1.id);

  app.addTip('Alice', '1.00', 'unassigned tip');

  app.el('exportBtn').dispatch('click', { target: app.el('exportBtn') });
  assert.strictEqual(app.downloads.length, 1);
  const csv = app.downloads[0].content.replace(/^\ufeff/, '');
  const lines = csv.split('\r\n');
  const header = lines[0].split(',');
  assert.deepStrictEqual(header.slice(0, 13), [
    'Time', 'Staff', 'Type', 'Game / Description', 'Product', 'Robux', 'Qty',
    'Gross Sale', 'Business Base', 'Commission', 'Owner Earning', 'Extra Margin', 'Business Net'
  ]);
  assert.deepStrictEqual(header.slice(13), ['Session ID', 'Session Date']);
  assert.strictEqual(lines.length, 4, 'header + three sales');

  const sessionRow = lines.find((l) => l.includes(sess1.id));
  assert.ok(sessionRow);
  assert.strictEqual(sessionRow.split(',')[14], '2026-11-16');

  const unassignedRow = lines.find((l) => l.includes('unassigned tip'));
  const unassigned = unassignedRow.split(',');
  assert.strictEqual(unassigned[13], '');
  assert.strictEqual(unassigned[14], '');

  app.viewSession(sess1.id);
  app.el('sessionExportBtn').dispatch('click', { target: app.el('sessionExportBtn') });
  assert.strictEqual(app.downloads.length, 2);
  assert.ok(app.downloads[1].filename.startsWith('jazon-session-'));
  const sessionCsv = app.downloads[1].content.replace(/^\ufeff/, '');
  const sessionLines = sessionCsv.split('\r\n');
  assert.strictEqual(sessionLines.length, 3, 'header + exactly two session sales');
  assert.strictEqual(sessionLines.filter((l) => l.includes(sess1.id)).length, 2);
  assert.ok(!sessionCsv.includes('unassigned tip'));
});

/* ------------------------------------------------------------------ */
/* 6. Refresh / reopen persistence.                                    */
/* ------------------------------------------------------------------ */

test('session and active-session state survive a reload', () => {
  const app = createApp();
  app.startSession('Alice');
  const sess = app.sessions()[0];
  app.addCatalog('Alice', app.CATALOG[0].s, 1);

  const reopened = app.reload();
  const sessions = reopened.sessions();
  assert.strictEqual(sessions.length, 1);
  assert.strictEqual(sessions[0].id, sess.id);
  assert.strictEqual(sessions[0].status, 'active');
  assert.strictEqual(reopened.sales()[0].sessionId, sess.id);
  assert.ok(reopened.el('activeSessionPanel').innerHTML.includes('Active Calculation'));
  assert.ok(reopened.el('activeSessionPanel').innerHTML.includes('Alice'));
  assert.ok(historyHtml(reopened).includes('Session #1'));

  reopened.finishFromPanel(sess.id);
  const reopenedAgain = reopened.reload();
  assert.strictEqual(reopenedAgain.sessions()[0].status, 'finished');
  assert.ok(reopenedAgain.el('activeSessionPanel').hidden);
  assert.strictEqual(reopenedAgain.sales()[0].sessionId, sess.id);
  assert.ok(historyHtml(reopenedAgain).includes('Session #1'));
});

/* ------------------------------------------------------------------ */
/* 7. Static mobile-layout safeguards.                                 */
/* ------------------------------------------------------------------ */

test('mobile layout safeguards exist for new sections', () => {
  const refs = new Set(Array.from(APP_SRC.matchAll(/\$\('([^']+)'\)/g), (m) => m[1]));
  const missing = Array.from(refs).filter((id) => !IDS.includes(id));
  assert.deepStrictEqual(missing, [], 'every element id used by app.js must exist in index.html');
  assert.ok(/<meta name="viewport"/.test(HTML));
  assert.ok(HTML.includes('class="table-wrap"'));
  assert.ok(HTML.includes('id="sessionDialog"'));
  assert.ok(HTML.includes('id="historyTable"'));
  assert.ok(/@media \(max-width:640px\)[\s\S]*\.session-start\{grid-template-columns:1fr\}/.test(CSS));
  assert.ok(/@media \(max-width:640px\)[\s\S]*\.daily-grid\{grid-template-columns:repeat\(2/.test(CSS));
  assert.ok(/@media \(max-width:640px\)[\s\S]*\.session-dialog\{width:100vw/.test(CSS));
  assert.ok(/@media \(max-width:1080px\)[\s\S]*\.session-meta/.test(CSS));
});

/* ------------------------------------------------------------------ */
/* 8. Visible filter state is honored on load (browser-restored value).*/
/* ------------------------------------------------------------------ */

test('a restored Today selection filters history without a change event', () => {
  const today = Date.UTC(2026, 10, 16, 2, 0, 0); // 2026-11-16 10:00 Manila
  const oct30 = Date.UTC(2026, 9, 30, 2, 0, 0);  // 2026-10-30 10:00 Manila
  const sess = {
    id: 'sess-today', staff: 'Alice', number: 1,
    startedAt: Date.UTC(2026, 10, 16, 1, 0, 0),
    endedAt: Date.UTC(2026, 10, 16, 3, 0, 0),
    status: 'finished'
  };
  const storageData = {
    [STORE_KEY]: JSON.stringify([
      makeSale('oct30', oct30, 'Legacy Staff'),
      makeSale('today', today, 'Alice', sess.id)
    ]),
    [SESSION_KEY]: JSON.stringify([sess])
  };

  const all = createApp({ storageData });
  assert.strictEqual(countMatches(historyHtml(all), /tr class="date-head"/g), 2);

  // The browser can restore the <select> to "Today" before app.js runs,
  // without dispatching "change". State must adopt that visible value.
  const restored = createApp({ storageData, now: today, elementValues: { dateFilter: 'today' } });
  assert.strictEqual(restored.el('dateFilter').value, 'today');
  const html = historyHtml(restored);
  assert.ok(html.includes('Monday, November 16, 2026'));
  assert.ok(!html.includes('Friday, October 30, 2026'), 'older dates must not be shown');
  assert.strictEqual(countMatches(html, /tr class="sale-row"/g), 1);
  assert.strictEqual(restored.el('historyEmpty').hidden, true);
  assert.strictEqual(restored.el('dailyTotals').hidden, false);
  assert.ok(restored.el('dailyTotalsTitle').textContent.includes('Today'));
  assert.strictEqual(restored.el('dailyCount').textContent, '1');
});

/* ------------------------------------------------------------------ */
/* 9. Empty state: no fallback to older sales.                         */
/* ------------------------------------------------------------------ */

test('empty date result shows the required message and no older sales', () => {
  const oct30 = Date.UTC(2026, 9, 30, 2, 0, 0);
  const app = createApp({
    storageData: { [STORE_KEY]: JSON.stringify([makeSale('oct30', oct30, 'Legacy Staff')]) },
    elementValues: { dateFilter: 'today' }
  });

  assert.strictEqual(app.el('historyEmpty').hidden, false);
  assert.strictEqual(app.el('historyEmpty').textContent, 'No sales found for the selected date.');
  const html = historyHtml(app);
  assert.ok(!html.includes('October 30'), 'older sales must not be rendered as a fallback');
  assert.strictEqual(countMatches(html, /tr class="date-head"/g), 0);
  assert.strictEqual(app.el('dailyTotals').hidden, false);
  assert.strictEqual(app.el('dailyCount').textContent, '0');
  assert.strictEqual(app.el('dailyGross').textContent, fmtPHP(0));
  assert.strictEqual(app.el('statGross').textContent, fmtPHP(4500), 'all-time totals stay lifetime');

  app.setSelect('dateFilter', 'all');
  assert.ok(historyHtml(app).includes('Friday, October 30, 2026'));
  assert.strictEqual(app.el('historyEmpty').hidden, true);
});

/* ------------------------------------------------------------------ */
/* 10. Date + staff filters combine across legacy and session sales.   */
/* ------------------------------------------------------------------ */

test('custom date and staff filters combine for legacy and session sales', () => {
  const nov16 = Date.UTC(2026, 10, 16, 2, 0, 0);
  const oct30 = Date.UTC(2026, 9, 30, 2, 0, 0);
  const nov15 = Date.UTC(2026, 10, 15, 2, 0, 0);
  const session = (id, staff, ts) => ({
    id, staff, number: 1, startedAt: ts - 3600000, endedAt: ts + 3600000, status: 'finished'
  });
  const storageData = {
    [STORE_KEY]: JSON.stringify([
      makeSale('a-oct30', oct30, 'Alice'),
      makeSale('a-nov16', nov16, 'Alice', 'sess-a'),
      makeSale('b-nov16', nov16, 'Bob', 'sess-b'),
      makeSale('b-nov15', nov15, 'Bob', 'sess-c')
    ]),
    [SESSION_KEY]: JSON.stringify([
      session('sess-a', 'Alice', nov16),
      session('sess-b', 'Bob', nov16),
      session('sess-c', 'Bob', nov15)
    ])
  };
  const app = createApp({ storageData });

  app.setSelect('dateFilter', 'custom');
  app.setValue('customDate', '2026-10-30');
  app.setSelect('histStaffFilter', 'Alice');
  let html = historyHtml(app);
  assert.ok(html.includes('Earlier Sales \u2014 Legacy History'));
  assert.ok(html.includes('Game a-oct30'));
  assert.ok(!html.includes('Game a-nov16'));
  assert.strictEqual(countMatches(html, /tr class="sale-row"/g), 1);

  app.setSelect('histStaffFilter', 'Bob');
  assert.strictEqual(app.el('historyEmpty').hidden, false);
  assert.strictEqual(app.el('historyEmpty').textContent, 'No sales found for the selected date.');
  assert.strictEqual(countMatches(historyHtml(app), /tr class="sale-row"/g), 0);

  app.setSelect('dateFilter', 'today');
  app.setSelect('histStaffFilter', 'Bob');
  html = historyHtml(app);
  assert.ok(html.includes('Game b-nov16'));
  assert.ok(!html.includes('Game b-nov15'));

  app.setSelect('histStaffFilter', 'Alice');
  html = historyHtml(app);
  assert.ok(html.includes('Game a-nov16'));
  assert.ok(!html.includes('Game a-oct30'));

  app.setSelect('dateFilter', 'all');
  html = historyHtml(app);
  assert.ok(html.includes('Game a-oct30'));
  assert.ok(html.includes('Game a-nov16'));
  assert.ok(!html.includes('Game b-nov16'));
});

/* ------------------------------------------------------------------ */
/* 11. Asia/Manila midnight boundary.                                  */
/* ------------------------------------------------------------------ */

test('date filters use Asia/Manila across the midnight boundary', () => {
  const lateNov16 = Date.UTC(2026, 10, 16, 15, 59, 0); // 23:59 Manila
  const earlyNov17 = Date.UTC(2026, 10, 16, 16, 0, 0);  // 00:00 Manila
  const nowNov17 = Date.UTC(2026, 10, 17, 2, 0, 0);     // 10:00 Manila
  const app = createApp({
    storageData: {
      [STORE_KEY]: JSON.stringify([
        makeSale('late', lateNov16, 'Alice'),
        makeSale('early', earlyNov17, 'Bob')
      ])
    },
    now: nowNov17
  });

  assert.ok(historyHtml(app).includes('Monday, November 16, 2026'));
  assert.ok(historyHtml(app).includes('Tuesday, November 17, 2026'));

  app.setSelect('dateFilter', 'today');
  let html = historyHtml(app);
  assert.ok(html.includes('Game early'));
  assert.ok(!html.includes('Game late'));

  app.setSelect('dateFilter', 'yesterday');
  html = historyHtml(app);
  assert.ok(html.includes('Game late'));
  assert.ok(!html.includes('Game early'));

  app.setSelect('dateFilter', 'custom');
  app.setValue('customDate', '2026-11-16');
  html = historyHtml(app);
  assert.ok(html.includes('Game late'));
  assert.ok(!html.includes('Game early'));

  // Clearing the custom date must never fall back to All Dates.
  app.setValue('customDate', '');
  html = historyHtml(app);
  assert.ok(!html.includes('Game late'), 'custom with no date must not show other dates');
});

/* ------------------------------------------------------------------ */

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('');
  for (const f of failures) {
    console.log('FAILURE: ' + f.name);
    if (f.err && f.err.stack) console.log(f.err.stack);
  }
  process.exit(1);
}
