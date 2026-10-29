import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateBillTotals } from '../../lib/billing-totals.js';
import { calculateDeliveryPricing, parseDeliveryPricing } from '../../lib/delivery-pricing.js';

test('fixed delivery fee applies only to delivery orders', () => {
  const settings = { delivery_pricing_enabled: 'true', delivery_pricing_mode: 'fixed', delivery_fixed_fee: '120' };
  assert.deepEqual(calculateDeliveryPricing(settings, { orderType: 'delivery' }), {
    fee: 120, label: 'Fixed delivery fee', distanceKm: null,
  });
  assert.equal(calculateDeliveryPricing(settings, { orderType: 'takeaway' }).fee, 0);
});

test('distance bands are sorted and selected by stable id', () => {
  const settings = {
    delivery_pricing_enabled: true,
    delivery_pricing_mode: 'distance_bands',
    delivery_distance_bands: JSON.stringify([
      { id: 'far', maxKm: 8, fee: 220 },
      { id: 'near', maxKm: 3, fee: 90 },
    ]),
  };
  const config = parseDeliveryPricing(settings);
  assert.deepEqual(config.bands.map((row) => row.label), ['Up to 3 km', '3–8 km']);
  assert.equal(calculateDeliveryPricing(settings, { orderType: 'delivery', bandId: 'far' }).fee, 220);
  assert.throws(
    () => calculateDeliveryPricing(settings, { orderType: 'delivery' }),
    (error) => error.status === 400 && error.field === 'delivery_range'
  );
});

test('per-km pricing honors minimum fee and maximum distance', () => {
  const settings = {
    enabled: true,
    mode: 'per_km',
    perKmRate: 25,
    minimumFee: 100,
    maxDistanceKm: 10,
  };
  assert.equal(calculateDeliveryPricing(settings, { orderType: 'delivery', distanceKm: 2 }).fee, 100);
  assert.equal(calculateDeliveryPricing(settings, { orderType: 'delivery', distanceKm: 6 }).fee, 150);
  assert.throws(() => calculateDeliveryPricing(settings, { orderType: 'delivery', distanceKm: 11 }), /up to 10 km/);
});

test('bill totals add delivery after discounted food taxes and service', () => {
  const totals = calculateBillTotals(1000, {
    discountAmount: 100,
    vatPercent: 13,
    servicePercent: 10,
    deliveryFee: 120,
  });
  assert.equal(totals.tax, 117);
  assert.equal(totals.serviceCharge, 90);
  assert.equal(totals.deliveryFee, 120);
  assert.equal(totals.total, 1227);
});

