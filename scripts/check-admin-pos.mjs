/**
 * End-to-end integration check for the Admin single-operator table → KOT → bill
 * workflow. Drives the real HTTP API against a running dev server (SQLite dev DB
 * auto-seeds admin/123456).
 *
 *   1. npm run dev        (port 3002, SQLite)
 *   2. node scripts/check-admin-pos.mjs
 *
 * Env: POS_BASE (default http://localhost:3002), POS_ADMIN / POS_PIN.
 */
import assert from 'node:assert/strict';

const BASE = process.env.POS_BASE || 'http://localhost:3002';
const ADMIN = process.env.POS_ADMIN || 'admin';
const PIN = process.env.POS_PIN || '123456';

let TOKEN = '';
const uid = () => `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

let passed = 0;
const ok = (name) => { passed += 1; console.log(`  \u2713 ${name}`); };

async function main() {
  console.log(`Admin POS integration check → ${BASE}`);

  // --- login ---
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN, pin: PIN }),
  }).then((r) => r.json());
  assert.ok(login.token, 'admin login should return a token');
  TOKEN = login.token;
  assert.equal(login.user.role, 'admin');
  ok('admin authenticates');

  // --- menu ---
  const menu = (await call('/api/restaurant/menu')).data.items || [];
  assert.ok(menu.length >= 2, 'menu should have items');
  const itemA = menu[0];
  const itemB = menu[1];
  ok(`menu loaded (${menu.length} items)`);

  // --- table board ---
  const board = (await call('/api/admin/pos/tables')).data.tables || [];
  assert.ok(board.length > 0, 'table board should return tables');
  const freeTable = board.find((t) => t.status === 'available' && !t.current_order_id);
  assert.ok(freeTable, 'need at least one available table');
  ok(`table board (${board.length} tables)`);

  // --- open available table ---
  const opened = await call('/api/admin/pos/orders', { method: 'POST', body: { table_id: freeTable.id } });
  assert.equal(opened.status, 201);
  const orderId = opened.data.order_id;
  assert.ok(orderId, 'opening a table creates an order');
  ok(`opened table ${freeTable.table_number} → order ${orderId}`);

  // --- re-open same table returns SAME active order (no duplicate) ---
  const reopen = await call('/api/admin/pos/orders', { method: 'POST', body: { table_id: freeTable.id } });
  assert.equal(reopen.data.order_id, orderId, 'occupied table must resume the same order');
  assert.equal(reopen.data.resumed, true);
  ok('occupied table resumes single active order (no duplicate)');

  // --- add items (2x A, 1x B) ---
  await call(`/api/admin/pos/orders/${orderId}/items`, { method: 'POST', body: { items: [{ menu_item_id: itemA.id, quantity: 2 }] } });
  let ws = (await call(`/api/admin/pos/orders/${orderId}/items`, { method: 'POST', body: { items: [{ menu_item_id: itemB.id, quantity: 1 }] } })).data.workspace;
  assert.equal(ws.unsent_count, 3, 'three unsent units');
  ok('added items as unsent draft');

  // --- billing blocked while unsent ---
  const blocked = await call(`/api/admin/pos/orders/${orderId}/bill`, { method: 'POST', body: {} });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'unsent_items');
  ok('billing blocked while unsent items remain');

  // --- save & print KOT (idempotent) ---
  const key1 = uid();
  const kot1 = await call(`/api/admin/pos/orders/${orderId}/kot`, { method: 'POST', body: { idempotency_key: key1 } });
  assert.equal(kot1.status, 201);
  assert.equal(kot1.data.kot.sequence, 1);
  assert.equal(kot1.data.kot.kot_type, 'new');
  assert.equal(kot1.data.kot.items.length, 2, 'KOT-1 has both lines');
  const kot1Id = kot1.data.kot.kot_id;
  ok(`KOT-1 issued (seq 1, ${kot1.data.kot.items.length} lines)`);

  // --- double-click same key → idempotent, no new KOT ---
  const kot1Dup = await call(`/api/admin/pos/orders/${orderId}/kot`, { method: 'POST', body: { idempotency_key: key1 } });
  assert.equal(kot1Dup.data.idempotent, true);
  assert.equal(kot1Dup.data.kot.kot_id, kot1Id, 'duplicate key returns same KOT');
  assert.equal(kot1Dup.data.workspace.kot_count, 1, 'still exactly one KOT');
  ok('double-submit KOT is idempotent (no duplicate)');

  // --- no unsent items now → issuing again with fresh key fails (never zero-item KOT) ---
  const emptyKot = await call(`/api/admin/pos/orders/${orderId}/kot`, { method: 'POST', body: { idempotency_key: uid() } });
  assert.equal(emptyKot.status, 409);
  assert.equal(emptyKot.data.code, 'no_unsent_items');
  ok('never creates a zero-item KOT');

  // --- add more → additional KOT contains ONLY new items ---
  await call(`/api/admin/pos/orders/${orderId}/items`, { method: 'POST', body: { items: [{ menu_item_id: itemA.id, quantity: 1 }] } });
  const kot2 = await call(`/api/admin/pos/orders/${orderId}/kot`, { method: 'POST', body: { idempotency_key: uid() } });
  assert.equal(kot2.data.kot.sequence, 2);
  assert.equal(kot2.data.kot.kot_type, 'additional');
  assert.equal(kot2.data.kot.items.length, 1, 'additional KOT has ONLY the new line');
  assert.equal(Number(kot2.data.kot.items[0].quantity), 1);
  ok('additional KOT contains only new quantities');

  // --- reprint historical KOT: no new KOT, reprint_count++ ---
  const beforeReprint = (await call(`/api/admin/pos/orders/${orderId}`)).data.workspace.kots.length;
  const reprint = await call(`/api/admin/pos/kots/${kot1Id}/reprint`, { method: 'POST' });
  assert.equal(reprint.data.kot.kot_id, kot1Id);
  assert.ok(Number(reprint.data.kot.reprint_count) >= 1, 'reprint_count increments');
  const afterReprint = (await call(`/api/admin/pos/orders/${orderId}`)).data.workspace.kots.length;
  assert.equal(afterReprint, beforeReprint, 'reprint must NOT create a new KOT');
  ok('reprint uses historical snapshot, creates no new KOT');

  // --- cancel a sent item with reason (before prep → stock returned) ---
  ws = (await call(`/api/admin/pos/orders/${orderId}`)).data.workspace;
  const sentLine = ws.items.find((i) => Number(i.sent_quantity) > 0);
  const cancel = await call(`/api/admin/pos/orders/${orderId}/cancel-item`, {
    method: 'POST', body: { order_item_id: sentLine.order_item_id, reason: 'test cancel', prepared: false },
  });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.data.cancellation_kot.kot_type, 'cancellation');
  ok('sent item cancelled with reason → cancellation KOT written');

  // --- reason required ---
  const noReason = await call(`/api/admin/pos/orders/${orderId}/cancel-item`, {
    method: 'POST', body: { order_item_id: sentLine.order_item_id, reason: '' },
  });
  assert.equal(noReason.status, 400);
  ok('cancellation requires a reason');

  // --- proceed to billing (no unsent) ---
  const proforma = await call(`/api/admin/pos/orders/${orderId}/bill`, { method: 'POST', body: {} });
  assert.equal(proforma.status, 200);
  const totals = proforma.data.proforma.totals;
  // Bill combines the still-valid items from BOTH KOTs, excluding cancelled qty.
  const liveSubtotal = proforma.data.proforma.items.reduce((s, i) => s + Number(i.subtotal), 0);
  assert.ok(Math.abs(totals.subtotal - liveSubtotal) < 0.01, 'server subtotal == sum of live items');
  ok(`multi-KOT reconciled to one bill (subtotal Rs.${totals.subtotal.toFixed(2)})`);

  // --- pay full cash (idempotent) ---
  const payKey = uid();
  const pay = await call(`/api/admin/pos/orders/${orderId}/pay`, {
    method: 'POST',
    body: { idempotency_key: payKey, allocations: [{ method: 'cash', amount: totals.total, cash_tendered: totals.total }] },
  });
  assert.equal(pay.status, 200, `pay should succeed: ${JSON.stringify(pay.data)}`);
  assert.equal(pay.data.payment_status, 'paid');
  assert.ok(pay.data.bill_number, 'a bill number is returned');
  ok(`full cash payment settled (bill ${pay.data.bill_number})`);

  // --- duplicate payment is idempotent ---
  const payDup = await call(`/api/admin/pos/orders/${orderId}/pay`, {
    method: 'POST',
    body: { idempotency_key: payKey, allocations: [{ method: 'cash', amount: totals.total, cash_tendered: totals.total }] },
  });
  assert.equal(payDup.data.idempotent, true, 'duplicate payment must be idempotent');
  assert.equal(payDup.data.bill_number, pay.data.bill_number);
  ok('duplicate payment confirmation does not double-charge');

  // --- table released after completion ---
  const boardAfter = (await call('/api/admin/pos/tables')).data.tables || [];
  const releasedTable = boardAfter.find((t) => t.id === freeTable.id);
  assert.equal(releasedTable.status, 'available', 'table released after payment');
  assert.equal(releasedTable.current_order_id, null);
  ok('table released after completion');

  console.log(`\nAll ${passed} Admin POS checks passed.`);
}

main().catch((e) => {
  console.error(`\n\u2717 FAILED: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
