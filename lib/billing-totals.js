/**
 * Bill totals from dynamic settings (VAT + service charge).
 */

export function toPercent(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve an optional service / extra / custom charge into the two things a
 * bill stores: an amount, and the percent it came from (null when it was
 * keyed in as rupees).
 *
 * The charge is chosen per bill at checkout — some tables get a service
 * charge, a packing fee or an event surcharge and others do not — so it cannot
 * live in Settings alone. Settings still supplies the DEFAULT percent; anything
 * chosen on the bill wins.
 *
 * @param {{ enabled?: boolean, mode?: 'percent'|'amount', value?: number|string }} charge
 * @param {number} settingsPercent  the house rate, used when nothing is chosen
 */
export function resolveServiceCharge(charge, settingsPercent = 0) {
  const fallback = { servicePercent: toPercent(settingsPercent, 0), serviceAmount: null };
  if (!charge || charge.enabled === false) return fallback;
  const value = Number(charge.value);
  if (!Number.isFinite(value) || value < 0) return fallback;
  // A deliberate zero is a real answer ("no service charge on this bill"), not
  // a missing one, so it must not fall through to the house rate.
  return charge.mode === 'amount'
    ? { servicePercent: 0, serviceAmount: round2(value) }
    : { servicePercent: value, serviceAmount: null };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {number} subtotal
 * @param {{ discountAmount?: number, discountPercent?: number, vatPercent?: number,
 *   servicePercent?: number, serviceAmount?: number|null, deliveryFee?: number }} opts
 */
export function calculateBillTotals(subtotal, opts = {}) {
  const sub = Math.max(0, Number(subtotal) || 0);
  const discountPercent = toPercent(opts.discountPercent, 0);
  const requestedDiscount =
    opts.discountAmount != null
      ? Math.max(0, Number(opts.discountAmount) || 0)
      : (sub * discountPercent) / 100;
  const discountAmount = Math.min(sub, requestedDiscount);

  const afterDiscount = Math.max(0, sub - discountAmount);
  const vatPercent = toPercent(opts.vatPercent, 0);
  const servicePercent = toPercent(opts.servicePercent, 0);
  const deliveryFee = Math.max(0, Number(opts.deliveryFee) || 0);

  const tax = (afterDiscount * vatPercent) / 100;
  /*
   * A flat rupee charge wins over the percent: it is what the cashier keyed in
   * on this specific bill. `servicePercent` is then reported as 0 so a receipt
   * never prints "Service Charge (150%)" from a Rs 150 charge.
   */
  const flatService = opts.serviceAmount == null ? null : Math.max(0, Number(opts.serviceAmount) || 0);
  const serviceCharge = flatService != null ? flatService : (afterDiscount * servicePercent) / 100;
  // Delivery is a separate, non-taxed charge. The food discount, VAT and
  // service-charge rules therefore cannot accidentally change it.
  const total = afterDiscount + tax + serviceCharge + deliveryFee;

  return {
    subtotal: sub,
    discount: discountAmount,
    afterDiscount,
    tax,
    taxPercent: vatPercent,
    serviceCharge,
    servicePercent: flatService != null ? 0 : servicePercent,
    deliveryFee,
    total,
  };
}

export function parseSettingsRates(settings = {}) {
  return {
    vatPercent: toPercent(
      settings.vat_percentage ?? settings.vatPercent ?? settings.vat,
      0
    ),
    servicePercent: toPercent(
      settings.service_charge_percentage ?? settings.servicePercent ?? settings.service_charge,
      0
    ),
  };
}
