import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PRINTER_DEFAULTS, printerSettingsPayload, resolvePrinterSettings, settingEnabled, qtyAfterItem } from '../../lib/printer-settings.js';

test('printer settings cover every supported document and preserve legacy receipt footer', () => {
  const settings = resolvePrinterSettings({ receipt_footer: 'Legacy thanks' });
  assert.equal(settings.bill_footer, 'Legacy thanks');
  assert.equal(settings.statement_paper_size, '80');
  assert.equal(settings.kot_title, 'KITCHEN ORDER TICKET');
  assert.equal(settings.qr_print_size_mm, '110');
  assert.equal(qtyAfterItem(settings.bill_qty_position), true);
  assert.equal(qtyAfterItem('before'), false);
});

test('printer payload persists every template option and serializes switches', () => {
  const payload = printerSettingsPayload({ bill_show_payment: false, kot_show_notes: false });
  assert.deepEqual(Object.keys(payload).sort(), Object.keys(PRINTER_DEFAULTS).sort());
  assert.equal(payload.bill_show_payment, 'false');
  assert.equal(payload.kot_show_notes, 'false');
  assert.equal(settingEnabled(payload.bill_show_payment), false);
});

test('sidebar groups use one-open-at-a-time accordion state', async () => {
  const source = await readFile(new URL('../../components/admin/admin-layout.jsx', import.meta.url), 'utf8');
  assert.match(source, /prev\[label\] \? \{\} : \{ \[label\]: true \}/);
  assert.doesNotMatch(source, /\{ \.\.\.prev, \[label\]: !prev\[label\] \}/);
});
