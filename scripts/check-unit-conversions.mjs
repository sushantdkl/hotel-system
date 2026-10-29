/**
 * Self-check for resolveConversionFactor. Run: node scripts/check-unit-conversions.mjs
 * Pure logic, no DB. Fails loudly if the reciprocal/fallback rules break.
 */
import assert from 'node:assert/strict';
import { resolveConversionFactor } from '../lib/unit-conversions.js';

const list = [{ from_unit: 'box', to_unit: 'bottle', factor: 24 }];

// same unit
assert.equal(resolveConversionFactor('kg', 'kg', list), 1);
// custom direct
assert.equal(resolveConversionFactor('box', 'bottle', list), 24);
// custom reciprocal (rounded to kill float noise, like the catalogue)
assert.ok(Math.abs(resolveConversionFactor('bottle', 'box', list) - 1 / 24) < 1e-9);
// catalogue fallback (physics) still works
assert.equal(resolveConversionFactor('kg', 'g', list), 1000);
// unknowable pack with no custom row -> null (never assume 1)
assert.equal(resolveConversionFactor('crate', 'pcs', list), null);
// custom wins over catalogue-null, spelling-insensitive
assert.equal(resolveConversionFactor('Box', 'Bottle', list), 24);

console.log('✓ unit-conversion resolver checks pass');
