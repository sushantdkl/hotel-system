/**
 * Assert-based check for lib/units.js. No test framework on purpose.
 *   node scripts/check-units.mjs
 */

import assert from 'node:assert/strict';
import {
  UNITS,
  normalizeUnit,
  normalizeUnitOrKeep,
  conversionFactor,
  findUnit,
  unitsByFamily,
  unitLabel,
} from '../lib/units.js';

/* ------------------------------------------------------- normalization */

// The spelling drift the owner actually hit.
for (const spelling of ['kg', 'Kg', 'KG', 'kgs', 'kilo', 'Kilos', 'kilogram', 'Kilograms', 'kg.', ' kg ']) {
  assert.equal(normalizeUnit(spelling), 'kg', `"${spelling}" should normalize to kg`);
}
for (const spelling of ['g', 'G', 'gm', 'gms', 'gram', 'Grams', 'gramme']) {
  assert.equal(normalizeUnit(spelling), 'g', `"${spelling}" should normalize to g`);
}
for (const spelling of ['l', 'L', 'ltr', 'litre', 'Liters', 'lt']) {
  assert.equal(normalizeUnit(spelling), 'l', `"${spelling}" should normalize to l`);
}
for (const spelling of ['ml', 'ML', 'milliliter', 'Millilitres', 'cc']) {
  assert.equal(normalizeUnit(spelling), 'ml', `"${spelling}" should normalize to ml`);
}
for (const spelling of ['pcs', 'pc', 'piece', 'Pieces', 'each', 'nos']) {
  assert.equal(normalizeUnit(spelling), 'pcs', `"${spelling}" should normalize to pcs`);
}
assert.equal(normalizeUnit('dozen'), 'dozen');
assert.equal(normalizeUnit('Packets'), 'packet');
assert.equal(normalizeUnit('BOXES'), 'box');

// Unrecognised input must return null, never a guess.
for (const junk of ['box_24', 'handful', '', null, undefined, 'zorkmid', '  ']) {
  assert.equal(normalizeUnit(junk), null, `"${junk}" must not be normalized`);
}

// ...and the non-destructive wrapper keeps it.
assert.equal(normalizeUnitOrKeep('box_24'), 'box_24');
assert.equal(normalizeUnitOrKeep('  Kilos '), 'kg');
assert.equal(normalizeUnitOrKeep(''), '');
assert.equal(normalizeUnitOrKeep(null), '');

/* --------------------------------------------------- factor derivation */

assert.equal(conversionFactor('kg', 'g'), 1000, 'kg -> g');
assert.equal(conversionFactor('g', 'kg'), 0.001, 'g -> kg');
assert.equal(conversionFactor('l', 'ml'), 1000, 'l -> ml');
assert.equal(conversionFactor('ml', 'l'), 0.001, 'ml -> l');
assert.equal(conversionFactor('dozen', 'pcs'), 12, 'dozen -> pcs');
assert.equal(conversionFactor('kg', 'mg'), 1000000, 'kg -> mg');
assert.equal(conversionFactor('gallon', 'ml'), 3785.411784, 'gallon -> ml');
assert.equal(conversionFactor('lb', 'g'), 453.59237, 'lb -> g');
assert.equal(conversionFactor('Kilos', 'Grams'), 1000, 'derivation goes through normalization');

// Same unit is always 1, including the non-derivable ones.
assert.equal(conversionFactor('kg', 'kg'), 1);
assert.equal(conversionFactor('box', 'boxes'), 1);

/* ------------------------------------- the non-derivable cases (null) */

assert.equal(conversionFactor('kg', 'pcs'), null, 'weight -> count is not derivable');
assert.equal(conversionFactor('l', 'g'), null, 'volume -> weight is not derivable');
assert.equal(conversionFactor('box', 'pcs'), null, 'a box has no fixed piece count');
assert.equal(conversionFactor('packet', 'g'), null, 'a packet has no fixed weight');
assert.equal(conversionFactor('crate', 'pcs'), null);
assert.equal(conversionFactor('box_24', 'pcs'), null, 'custom units fall back to manual entry');
assert.equal(conversionFactor('kg', 'box_24'), null);
assert.equal(conversionFactor('', 'g'), null);
assert.equal(conversionFactor(null, null), null);

/* ------------------------------------------------------------ catalogue */

// Required coverage from the spec.
for (const key of ['kg', 'g', 'mg', 'lb', 'oz', 'l', 'ml', 'gallon', 'pcs', 'packet', 'box',
  'dozen', 'bottle', 'can', 'jar', 'bag', 'crate', 'tray', 'bunch', 'sachet', 'tin', 'carton']) {
  assert.ok(findUnit(key), `catalogue is missing "${key}"`);
  assert.equal(findUnit(key).key, key);
}

// No alias may resolve to two different units, or the picker silently lies.
const claimed = new Map();
for (const unit of UNITS) {
  for (const token of [unit.key, unit.abbr.toLowerCase(), unit.label.toLowerCase(), ...unit.aliases]) {
    const prior = claimed.get(token);
    assert.ok(!prior || prior === unit.key, `alias "${token}" is claimed by both ${prior} and ${unit.key}`);
    claimed.set(token, unit.key);
  }
}

// Every unit belongs to a family the picker renders.
const grouped = unitsByFamily();
assert.equal(grouped.reduce((n, g) => n + g.units.length, 0), UNITS.length, 'every unit must land in a family group');

assert.equal(unitLabel('kilograms'), 'kg');
assert.equal(unitLabel('box_24'), 'box_24', 'unknown units display as typed');

console.log(`✓ units catalogue holds (${UNITS.length} units, ${claimed.size} spellings)`);
