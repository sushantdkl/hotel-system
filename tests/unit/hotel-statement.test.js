import test from 'node:test';
import assert from 'node:assert/strict';
import { statementHtml } from '../../lib/hotel/statement.js';

test('checkout print document escapes guest/property/description and includes frozen totals', () => {
  const html = statementHtml({ number: 'HS-TEST', property: { name: '<script>unsafe()</script>', currency: 'NPR' }, guest: '<img src=x onerror=unsafe()>', room: '101', reservationId: 'HT-1', arrival: '2026-10-27', plannedDeparture: '2026-10-29', departure: '2026-10-28', entries: [{ service_date: '2026-10-27', description: 'Laundry & towels', kind: 'charge', amount_cents: 11301 }], totals: { net: 10001, tax: 1300, charges: 11301, payments: 11301, balance: 0 } });
  assert.ok(html.includes('&lt;script&gt;unsafe()&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=unsafe()&gt;'));
  assert.ok(html.includes('Laundry &amp; towels'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('113.01'));
  assert.ok(html.includes('NPR 0.00'));
  assert.ok(html.includes('TAX INVOICE'));
  assert.ok(html.includes('ORIGINAL'));
  assert.ok(statementHtml({ number: 'X', property: { name: 'H', currency: 'NPR' }, entries: [], totals: { net: 0, tax: 0, charges: 0, payments: 0, balance: 0 } }, { copy: 'DUPLICATE' }).includes('DUPLICATE'));
});
