import test from 'node:test';
import assert from 'node:assert/strict';
import { toCents, validateAllocations } from '../../lib/payment-allocations.js';

const customer = { id: 7, name: 'Approved Customer', credit_limit: 2000, current_credit: 250 };
const cash = (amount, tendered = amount) => ({ method: 'cash', amount, cash_tendered: tendered });
const qr = (amount) => ({ method: 'qr', amount, provider: 'Fonepay', reference: 'QR-123' });
const credit = (amount) => ({ method: 'credit', amount, due_date: '2026-09-01' });

for (const [name, rows] of [
  ['full cash', [cash(1000)]],
  ['full QR', [qr(1000)]],
  ['full credit', [credit(1000)]],
  ['cash + QR', [cash(400), qr(600)]],
  ['cash + credit', [cash(400), credit(600)]],
  ['QR + credit', [qr(350), credit(650)]],
  ['cash + QR + credit', [cash(400), qr(350), credit(250)]],
]) {
  test(`accepts ${name}`, () => {
    const result = validateAllocations(rows, 1000, { customer, actorRole: 'admin' });
    assert.equal(result.reduce((sum, row) => sum + row.cents, 0), 100000);
  });
}

test('uses integer cents for decimal amounts', () => {
  assert.equal(toCents(0.1 + 0.2), 30);
  const result = validateAllocations([cash(0.1, 1), qr(0.2)], 0.3, { customer });
  assert.equal(result.reduce((sum, row) => sum + row.cents, 0), 30);
});

test('rejects under-allocation and over-allocation', () => {
  assert.throws(() => validateAllocations([cash(999)], 1000, { customer }), /under by/);
  assert.throws(() => validateAllocations([cash(1001)], 1000, { customer }), /over by/);
});

test('normalizes legacy QR into the single Online method', () => {
  const result = validateAllocations(
    [{ method: 'qr', amount: 1000, provider: 'Fonepay' }],
    1000,
    { customer }
  );
  assert.equal(result[0].method, 'online');
  assert.equal(result[0].provider, null);
  assert.equal(result[0].verified, true);
});

test('rejects credit without an identified customer', () => {
  assert.throws(() => validateAllocations([credit(1000)], 1000), /identified customer/);
});

test('allows credit past its limit — limit is advisory, not a hard cap', () => {
  const overLimit = validateAllocations([credit(1000)], 1000, {
    customer: { ...customer, credit_limit: 1000, current_credit: 250 },
    actorRole: 'admin',
  });
  assert.equal(overLimit[0].method, 'credit');
  const noLimit = validateAllocations([credit(1000)], 1000, {
    customer: { ...customer, credit_limit: 0, current_credit: 0 },
    actorRole: 'cashier',
  });
  assert.equal(noLimit[0].method, 'credit');
  const blankLimit = validateAllocations([credit(500)], 500, {
    customer: { ...customer, credit_limit: null, current_credit: 0 },
    actorRole: 'admin',
  });
  assert.equal(blankLimit[0].method, 'credit');
});

test('cash tendered covers only cash allocation and calculates change from cash', () => {
  assert.throws(() => validateAllocations([cash(400, 399), qr(600)], 1000, { customer }), /Cash tendered/);
  const result = validateAllocations([cash(400, 500), qr(600)], 1000, { customer });
  assert.equal(result.find((row) => row.method === 'cash').change, 100);
});

test('rejects negative, empty and unsupported allocations', () => {
  assert.throws(() => validateAllocations([cash(-1)], 1000, { customer }), /negative/);
  assert.throws(() => validateAllocations([], 1000, { customer }), /at least one/);
  assert.throws(() => validateAllocations([{ method: 'bitcoin', amount: 1000 }], 1000, { customer }), /Cash, Online, Credit or Room/);
});
