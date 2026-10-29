const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const numberAtLeastZero = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const truthySetting = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
};

function parseBands(value) {
  let rows = value;
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows); } catch { rows = []; }
  }
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row, index) => ({
      id: String(row?.id || `band-${index + 1}`),
      maxKm: numberAtLeastZero(row?.maxKm ?? row?.max_km, NaN),
      fee: numberAtLeastZero(row?.fee, NaN),
    }))
    .filter((row) => Number.isFinite(row.maxKm) && row.maxKm > 0 && Number.isFinite(row.fee))
    .sort((a, b) => a.maxKm - b.maxKm)
    .map((row, index, sorted) => ({
      ...row,
      minKm: index === 0 ? 0 : sorted[index - 1].maxKm,
      label: index === 0 ? `Up to ${row.maxKm} km` : `${sorted[index - 1].maxKm}–${row.maxKm} km`,
    }));
}

export function parseDeliveryPricing(settings = {}) {
  const requestedMode = String(settings.delivery_pricing_mode || settings.mode || 'fixed').toLowerCase();
  const mode = ['fixed', 'distance_bands', 'per_km'].includes(requestedMode) ? requestedMode : 'fixed';
  return {
    enabled: truthySetting(settings.delivery_pricing_enabled ?? settings.enabled, false),
    mode,
    fixedFee: numberAtLeastZero(settings.delivery_fixed_fee ?? settings.fixedFee),
    bands: parseBands(settings.delivery_distance_bands ?? settings.bands),
    perKmRate: numberAtLeastZero(settings.delivery_per_km_rate ?? settings.perKmRate),
    minimumFee: numberAtLeastZero(settings.delivery_minimum_fee ?? settings.minimumFee),
    maxDistanceKm: numberAtLeastZero(settings.delivery_max_distance_km ?? settings.maxDistanceKm),
  };
}

export function publicDeliveryPricing(settings = {}) {
  const config = parseDeliveryPricing(settings);
  return {
    enabled: config.enabled,
    mode: config.mode,
    fixedFee: config.fixedFee,
    bands: config.bands.map(({ id, minKm, maxKm, fee, label }) => ({ id, minKm, maxKm, fee, label })),
    perKmRate: config.perKmRate,
    minimumFee: config.minimumFee,
    maxDistanceKm: config.maxDistanceKm,
  };
}

export function calculateDeliveryPricing(settings = {}, { orderType, bandId, distanceKm } = {}) {
  const config = parseDeliveryPricing(settings);
  if (String(orderType || '').toLowerCase() !== 'delivery' || !config.enabled) {
    return { fee: 0, label: '', distanceKm: null };
  }

  if (config.mode === 'fixed') {
    return { fee: round2(config.fixedFee), label: 'Fixed delivery fee', distanceKm: null };
  }

  if (config.mode === 'distance_bands') {
    const band = config.bands.find((row) => row.id === String(bandId || ''));
    if (!band) {
      const error = new Error('Please choose your delivery distance range.');
      error.field = 'delivery_range';
      error.status = 400;
      throw error;
    }
    return { fee: round2(band.fee), label: band.label, distanceKm: band.maxKm };
  }

  const distance = Number(distanceKm);
  if (!Number.isFinite(distance) || distance <= 0) {
    const error = new Error('Please enter the delivery distance in kilometres.');
    error.field = 'delivery_distance_km';
    error.status = 400;
    throw error;
  }
  if (config.maxDistanceKm > 0 && distance > config.maxDistanceKm) {
    const error = new Error(`Delivery is available up to ${config.maxDistanceKm} km.`);
    error.field = 'delivery_distance_km';
    error.status = 400;
    throw error;
  }
  return {
    fee: round2(Math.max(config.minimumFee, distance * config.perKmRate)),
    label: `${round2(distance)} km delivery`,
    distanceKm: round2(distance),
  };
}

export async function loadDeliveryPricing(db) {
  try {
    const rows = await db.all(
      `SELECT setting_key, setting_value FROM system_settings
       WHERE setting_key LIKE 'delivery_%'`
    );
    const settings = {};
    for (const row of rows || []) settings[row.setting_key] = row.setting_value;
    return publicDeliveryPricing(settings);
  } catch {
    return publicDeliveryPricing({});
  }
}
