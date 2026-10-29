import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adDisplayToIso, bsDisplayToIso, isoToAdDisplay, isoToBsDisplay,
  maskAdInput, maskBsInput,
} from '@/lib/date-input-model.js';

test('BS input displays the canonical AD value without changing its contract', () => {
  assert.equal(isoToBsDisplay('2026-09-02'), '2083-05-17 BS');
  assert.equal(bsDisplayToIso('2083-05-17 BS'), '2026-09-02');
  assert.equal(bsDisplayToIso('2083-05-17'), '2026-09-02');
});

test('BS input rejects impossible days at a month boundary', () => {
  assert.equal(bsDisplayToIso('2083-05-31 BS'), '2026-09-16');
  assert.equal(bsDisplayToIso('2083-05-32 BS'), null);
});

test('AD mode preserves the existing dd/mm/yyyy behaviour', () => {
  assert.equal(isoToAdDisplay('2026-09-02'), '02/09/2026');
  assert.equal(adDisplayToIso('02/09/2026'), '2026-09-02');
  assert.equal(adDisplayToIso('31/02/2026'), null);
});

test('date masks accept compact keyboard entry', () => {
  assert.equal(maskBsInput('20830517'), '2083-05-17');
  assert.equal(maskAdInput('02092026'), '02/09/2026');
});
