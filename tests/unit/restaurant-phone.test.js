import test from 'node:test';
import assert from 'node:assert/strict';
import { toE164 } from '../../lib/restaurant-info.js';

test('toE164 turns CMS phone input into dialable international numbers', () => {
  assert.equal(toE164('9858038225'), '+9779858038225');
  assert.equal(toE164('985-8038225'), '+9779858038225');
  assert.equal(toE164('+977 985-8038225'), '+9779858038225');
  assert.equal(toE164('9779858038225'), '+9779858038225');
  assert.equal(toE164('00977 9858038225'), '+9779858038225');
  assert.equal(toE164('083-520000'), '+97783520000');
  assert.equal(toE164('+91 98765 43210'), '+919876543210');
  assert.equal(toE164(''), '');
});
