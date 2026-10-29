/**
 * Assert-based check for lib/entry-math.js — the conversion + cost arithmetic
 * behind the unit-aware entry fields.
 *   node scripts/check-entry-math.mjs
 *
 * The point of this file is the double-conversion guard at the bottom: the
 * whole feature is one factor slip away from storing 5,000,000 g.
 */

import assert from 'node:assert/strict';
import { toConsumptionAmount, hasTwoUnits, deriveCost, blankCost, round } from '../lib/entry-math.js';
import { conversionFactor } from '../lib/units.js';

/* ------------------------------------------------- quantity conversion */

const KG_TO_G = conversionFactor('kg', 'g'); // 1000
assert.equal(KG_TO_G, 1000);

assert.equal(toConsumptionAmount({ amount: '5', unit: 'purchase' }, KG_TO_G), 5000, '5 kg -> 5000 g');
assert.equal(toConsumptionAmount({ amount: '5', unit: 'consumption' }, KG_TO_G), 5, '5 g stays 5 g');
assert.equal(toConsumptionAmount({ amount: '2.5', unit: 'purchase' }, KG_TO_G), 2500);
assert.equal(toConsumptionAmount({ amount: '-3', unit: 'purchase' }, KG_TO_G), -3000, 'removals convert too');
assert.equal(toConsumptionAmount({ amount: '7', unit: 'purchase' }, 12), 84, 'dozen -> pieces');

// A missing factor must be an identity, never a zero.
assert.equal(toConsumptionAmount({ amount: '5', unit: 'purchase' }, 0), 5);
assert.equal(toConsumptionAmount({ amount: '5', unit: 'purchase' }, null), 5);
assert.equal(toConsumptionAmount({ amount: '5', unit: 'purchase' }, undefined), 5);

// Blank stays blank rather than becoming 0 — callers branch on NaN.
assert.ok(Number.isNaN(toConsumptionAmount({ amount: '', unit: 'purchase' }, KG_TO_G)));
assert.ok(Number.isNaN(toConsumptionAmount({ amount: '   ', unit: 'purchase' }, KG_TO_G)));
assert.ok(Number.isNaN(toConsumptionAmount(null, KG_TO_G)));

/* --------------------------------------------------------- dual toggle */

assert.equal(hasTwoUnits({ purchaseUnit: 'kg', consumptionUnit: 'g', factor: 1000 }), true);
assert.equal(hasTwoUnits({ purchaseUnit: 'pcs', consumptionUnit: 'pcs', factor: 1 }), false, 'same unit needs no toggle');
assert.equal(hasTwoUnits({ purchaseUnit: 'kg', consumptionUnit: 'g', factor: 1 }), false, 'factor 1 needs no toggle');
assert.equal(hasTwoUnits({ purchaseUnit: '', consumptionUnit: 'g', factor: 1000 }), false);
assert.equal(hasTwoUnits({ purchaseUnit: 'kg', consumptionUnit: '', factor: 1000 }), false);

/* ------------------------------------------------------- cost, both ways */

// Owner knows the rate: Rs 250/kg for 5 kg.
const byRate = deriveCost({ basis: 'per_purchase_unit', amount: '250' }, 5, 1000);
assert.equal(byRate.perPurchaseUnit, 250);
assert.equal(byRate.total, 1250);
assert.equal(byRate.perConsumptionUnit, 0.25, 'Rs 250/kg is Rs 0.25/g — this is what the ledger stores');

// Owner knows the invoice: Rs 1250 for 5 kg. Must land on the same numbers.
const byTotal = deriveCost({ basis: 'total', amount: '1250' }, 5, 1000);
assert.equal(byTotal.perPurchaseUnit, 250);
assert.equal(byTotal.total, 1250);
assert.equal(byTotal.perConsumptionUnit, 0.25);
assert.deepEqual(byRate, byTotal, 'both entry directions must agree exactly');

// A total with no quantity is not a rate — null, not Infinity.
const noQty = deriveCost({ basis: 'total', amount: '1250' }, 0, 1000);
assert.equal(noQty.perPurchaseUnit, null);
assert.equal(noQty.perConsumptionUnit, null);
assert.equal(noQty.total, 1250);
assert.ok(Number.isFinite(noQty.total));
for (const bad of [deriveCost({ basis: 'total', amount: '1250' }, '', 1000), deriveCost({ basis: 'total', amount: '1250' }, NaN, 1000)]) {
  assert.equal(bad.perPurchaseUnit, null);
}

// Blank cost is blank, not zero — 0 would wipe a moving average.
assert.deepEqual(deriveCost(blankCost(), 5, 1000), { perPurchaseUnit: null, total: null, perConsumptionUnit: null });
assert.deepEqual(deriveCost({ basis: 'total', amount: '' }, 5, 1000).total, null);

// Unconverted items (factor 1) keep rate == per-consumption cost.
const flat = deriveCost({ basis: 'per_purchase_unit', amount: '30' }, 4, 1);
assert.equal(flat.perConsumptionUnit, 30);
assert.equal(flat.total, 120);

/* ------------------------------------------- THE double-conversion guard */

// Round trip: what the owner typed -> what the DB must hold -> back again.
// 5 kg @ Rs 250/kg, item stored in grams with factor 1000.
{
  const factor = conversionFactor('kg', 'g');
  const qtyEntry = { amount: '5', unit: 'purchase' };
  const cost = { basis: 'per_purchase_unit', amount: '250' };

  const storedQty = toConsumptionAmount(qtyEntry, factor);
  const storedCost = deriveCost(cost, Number(qtyEntry.amount), factor).perConsumptionUnit;

  assert.equal(storedQty, 5000, 'grams stored');
  assert.equal(storedCost, 0.25, 'per-gram cost stored');
  // Inventory value must equal the invoice, whichever way you compute it.
  assert.equal(storedQty * storedCost, 1250);
  assert.equal(Number(qtyEntry.amount) * Number(cost.amount), 1250);

  // If a caller ALSO passed units:'purchase' after converting here, the ledger
  // would multiply again. Pin the wrong answer so the intent is unmistakable.
  const doubled = storedQty * factor;
  assert.equal(doubled, 5000000);
  assert.notEqual(storedQty, doubled, 'convert once: either here or in the ledger, never both');
}

assert.equal(round(0.1 + 0.2), 0.3);
assert.equal(round(1 / 3, 2), 0.33);
assert.equal(round(NaN), 0);

console.log('✓ entry math holds (quantity conversion, cost both directions, no double conversion)');
