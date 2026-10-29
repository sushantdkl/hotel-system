import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, toCsv } from '@/lib/csv.js';

test('CSV export is Excel-friendly UTF-8 with CRLF rows', () => {
  const csv = toCsv(['Date', 'Supplier', 'Amount'], [{ Date: '2083-05-27 BS', Supplier: '—', Amount: 'Rs -1,400,000' }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /\r\n/);
  assert.match(csv, /—/);
  assert.match(csv, /"Rs -1,400,000"/);
});

test('CSV parser accepts BOM exports and formula-like text is neutralized', () => {
  const csv = toCsv(['Name', 'Note'], [{ Name: '=2+2', Note: '+cmd' }]);
  const parsed = parseCsv(csv);
  assert.deepEqual(parsed.headers, ['Name', 'Note']);
  assert.equal(parsed.rows[0].Name, "'=2+2");
  assert.equal(parsed.rows[0].Note, "'+cmd");
});
