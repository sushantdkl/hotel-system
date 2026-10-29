import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { setCashClosingConfig } from '@/lib/cash-closing-policy.js';

async function ensureSystemSettingsTable(db) {
  // Postgres: table comes from migrations/001_init.sql — never run SQLite DDL.
  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key TEXT UNIQUE NOT NULL,
      setting_value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );
}

async function seedMissingDefaults(db) {
  // Insert missing keys as well as initializing a blank install. This matters
  // when a new setting is added after a restaurant is already in production.

  // Deployment identity fallback — used only when no settings exist yet and
  // license_info has no row. All values remain editable in Settings; nothing
  // here is hard-coded at billing time.
  let restaurantInfo = {
    name: 'Raithane Daure Chulo',
    address: 'Birendranagar-08, Surkhet, Karnali Province, Nepal',
    phone: '+977 984-9216081',
    email: '',
  };
  let ownerName = '';
  try {
    const licenseInfo = await db.get(`
      SELECT restaurant_name, restaurant_address, restaurant_phone, restaurant_email, owner_name
      FROM license_info ORDER BY id DESC LIMIT 1
    `);
    if (licenseInfo) {
      restaurantInfo = {
        name: licenseInfo.restaurant_name || restaurantInfo.name,
        address: licenseInfo.restaurant_address || restaurantInfo.address,
        phone: licenseInfo.restaurant_phone || restaurantInfo.phone,
        email: licenseInfo.restaurant_email || restaurantInfo.email,
      };
      ownerName = licenseInfo.owner_name || '';
    }
  } catch {
    // license_info may be missing; use empty defaults
  }

  const defaults = [
    // Tax/service default to 0% and are editable in Settings — no rate is assumed.
    { key: 'vat_percentage', value: '0' },
    { key: 'service_charge_percentage', value: '0' },
    { key: 'restaurant_name', value: restaurantInfo.name },
    { key: 'restaurant_address', value: restaurantInfo.address },
    { key: 'restaurant_phone', value: restaurantInfo.phone },
    { key: 'restaurant_email', value: restaurantInfo.email },
    { key: 'owner_name', value: ownerName },
    { key: 'vat_number', value: '' },
    { key: 'pan_number', value: '' },
    { key: 'bank_qr_image', value: '' },
    { key: 'esewa_qr_image', value: '' },
    { key: 'delivery_pricing_enabled', value: 'false' },
    { key: 'delivery_pricing_mode', value: 'fixed' },
    { key: 'delivery_fixed_fee', value: '0' },
    { key: 'delivery_distance_bands', value: '[]' },
    { key: 'delivery_per_km_rate', value: '0' },
    { key: 'delivery_minimum_fee', value: '0' },
    { key: 'delivery_max_distance_km', value: '0' },
    { key: 'online_order_minimum_amount', value: '500' },
    { key: 'calendar_system', value: 'BS' },
    { key: 'cashier_expected_cash_schedule_enabled', value: 'true' },
    { key: 'cashier_expected_cash_reveal_time', value: '20:30' },
    { key: 'cashier_cash_count_schedule_enabled', value: 'false' },
    { key: 'cashier_cash_count_time', value: '14:00' },
    { key: 'kot_cancellation_approval_enabled', value: 'false' },
  ];

  for (const setting of defaults) {
    await db.run(
      `
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES (?, ?)
      ON CONFLICT (setting_key) DO NOTHING
    `,
      [setting.key, setting.value]
    );
  }
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier', 'waiter', 'kitchen'] });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureSystemSettingsTable(db);
    await seedMissingDefaults(db);

    const settingsArray = await db.all('SELECT setting_key, setting_value FROM system_settings');

    const settings = {};
    settingsArray.forEach((row) => {
      const key = row.setting_key;
      let value = row.setting_value;

      if (
        key === 'vat_percentage' ||
        key === 'service_charge_percentage' ||
        key === 'delivery_fixed_fee' ||
        key === 'delivery_per_km_rate' ||
        key === 'delivery_minimum_fee' ||
        key === 'delivery_max_distance_km' ||
        key === 'online_order_minimum_amount' ||
        key.startsWith('reservation_')
      ) {
        value = parseFloat(value) || 0;
      }

      settings[key] = value;
    });
    settings.calendar_system = ['AD', 'BS'].includes(String(settings.calendar_system || '').toUpperCase())
      ? String(settings.calendar_system).toUpperCase()
      : 'BS';

    return NextResponse.json({ settings });
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch settings');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'settings.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensureSystemSettingsTable(db);

    if (data.calendar_system != null && !['AD', 'BS'].includes(String(data.calendar_system).toUpperCase())) {
      return NextResponse.json({ error: 'Calendar system must be AD or BS.' }, { status: 400 });
    }
    if (data.cashier_expected_cash_reveal_time != null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(data.cashier_expected_cash_reveal_time))) {
      return NextResponse.json({ error: 'Cashier expected-cash reveal time must be a valid 24-hour time.' }, { status: 400 });
    }
    if (data.cashier_cash_count_time != null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(data.cashier_cash_count_time))) {
      return NextResponse.json({ error: 'Cashier cash-count time must be a valid 24-hour time.' }, { status: 400 });
    }
    const adminOnlyKeys = ['cashier_expected_cash_schedule_enabled', 'cashier_expected_cash_reveal_time', 'cashier_cash_count_schedule_enabled', 'cashier_cash_count_time', 'kot_cancellation_approval_enabled'];
    if (auth.user.role !== 'admin' && adminOnlyKeys.some((key) => key in data)) {
      return NextResponse.json({ error: 'Only an administrator can change protected operational controls.' }, { status: 403 });
    }

    for (const [key, value] of Object.entries(data)) {
      if (value !== null && typeof value === 'object') continue;
      await db.run(
        `
        INSERT INTO system_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (setting_key) DO UPDATE SET
          setting_value = EXCLUDED.setting_value,
          updated_at = CURRENT_TIMESTAMP
      `,
        [key, key === 'calendar_system' ? String(value).toUpperCase() : value == null ? '' : String(value)]
      );
    }

    if ('cashier_expected_cash_schedule_enabled' in data || 'cashier_expected_cash_reveal_time' in data) {
      setCashClosingConfig({
        enabled: data.cashier_expected_cash_schedule_enabled,
        cutoff: data.cashier_expected_cash_reveal_time,
      });
    }

    return NextResponse.json({
      message: 'Settings updated successfully',
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to update settings');
  }
}
