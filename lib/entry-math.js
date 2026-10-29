/**
 * The arithmetic behind the "type it in the unit you're holding" entry fields.
 *
 * Kept out of the .jsx components so it can be asserted in plain node
 * (scripts/check-entry-math.mjs) — it is the money path, and a silent factor
 * slip here is exactly the double-conversion bug this feature risks.
 *
 * Nothing in this file fetches. Converting here AND sending `units:'purchase'`
 * to the API would convert twice, so each caller must do exactly one of the
 * two; see the header of each modal for which it picked.
 */

/** Trim float dust from a conversion without pretending to more precision. */
export function round(n, places = 4) {
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(places));
}

function positiveFactor(factor) {
  const f = Number(factor);
  return Number.isFinite(f) && f > 0 ? f : 1;
}

/**
 * Consumption units for `{ amount, unit }`, where `unit` is the literal string
 * 'purchase' or 'consumption' (which end of the item the number was typed in).
 */
export function toConsumptionAmount(entry, factor) {
  const amount = Number(entry?.amount);
  if (!Number.isFinite(amount) || String(entry?.amount ?? '').trim() === '') return NaN;
  return entry?.unit === 'purchase' ? amount * positiveFactor(factor) : amount;
}

/** True when a purchase/consumption toggle is worth showing at all. */
export function hasTwoUnits({ purchaseUnit, consumptionUnit, factor }) {
  return (
    Boolean(purchaseUnit) &&
    Boolean(consumptionUnit) &&
    purchaseUnit !== consumptionUnit &&
    Number(factor) > 0 &&
    Number(factor) !== 1
  );
}

export const blankCost = (basis = 'per_purchase_unit') => ({ basis, amount: '' });

/**
 * All three views of the same money, from whichever end was typed.
 *
 * @param value    { basis: 'per_purchase_unit' | 'total', amount }
 * @param quantity quantity in PURCHASE units that a total would apply to
 * @param factor   consumption units inside 1 purchase unit
 * @returns { perPurchaseUnit, total, perConsumptionUnit } — null where unknown
 */
export function deriveCost(value, quantity, factor) {
  const amount = Number(value?.amount);
  const qty = Number(quantity);
  const empty = { perPurchaseUnit: null, total: null, perConsumptionUnit: null };
  if (!Number.isFinite(amount) || String(value?.amount ?? '').trim() === '') return empty;

  let perPurchaseUnit;
  let total;
  if (value.basis === 'total') {
    total = amount;
    // A total with no quantity can't become a rate — return null instead of
    // dividing by zero and storing Infinity as a cost.
    perPurchaseUnit = Number.isFinite(qty) && qty > 0 ? amount / qty : null;
  } else {
    perPurchaseUnit = amount;
    total = Number.isFinite(qty) && qty > 0 ? amount * qty : null;
  }

  return {
    perPurchaseUnit,
    total,
    perConsumptionUnit: perPurchaseUnit === null ? null : perPurchaseUnit / positiveFactor(factor),
  };
}
