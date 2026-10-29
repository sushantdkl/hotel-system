import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('admin order deletion is blocked without erasing order or bill history', async () => {
  const route = await source('app/api/admin/orders/[id]/route.js');
  const deleteHandler = route.slice(route.indexOf('export async function DELETE'));

  assert.match(deleteHandler, /cannot be permanently deleted/i);
  assert.match(deleteHandler, /status:\s*409/);
  assert.doesNotMatch(deleteHandler, /DELETE FROM\s+(orders|bills|order_items|kots|bill_payments|bill_audit)/i);
});

test('bill actions reject deletion and direct users to an audited correction', async () => {
  const route = await source('app/api/admin/bills/[id]/route.js');

  assert.match(route, /Bills are financial records and cannot be deleted/i);
  assert.match(route, /Void or refund the bill with a reason instead/i);
});

test('order cancellation entry points require an operator-entered reason', async () => {
  const collectionRoute = await source('app/api/restaurant/orders/route.js');
  const detailRoute = await source('app/api/restaurant/orders/[id]/route.js');
  const adminRoute = await source('app/api/admin/orders/[id]/route.js');

  assert.match(collectionRoute, /A cancel reason is required/i);
  assert.doesNotMatch(collectionRoute, /No reason provided/i);
  assert.match(detailRoute, /A cancel reason is required/i);
  assert.doesNotMatch(detailRoute, /Cancelled by (user|staff)/i);
  assert.match(adminRoute, /A reason is required/i);
});
