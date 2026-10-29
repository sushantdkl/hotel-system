/**
 * Fresh PostgreSQL seed for production / staging.
 * Usage:
 *   DATABASE_URL=... ADMIN_USERNAME=admin ADMIN_PASSWORD='StrongPass!' node scripts/seed-postgres.mjs
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
  console.error('Set DATABASE_URL=postgresql://user:pass@host:5432/dbname');
  process.exit(1);
}

const username = (process.env.ADMIN_USERNAME || 'admin').trim();
const password = process.env.ADMIN_PASSWORD || '';
const fullName = process.env.ADMIN_FULL_NAME || 'Administrator';
const restaurantName = process.env.RESTAURANT_NAME || 'Raithane Daure Chulo';

if (password.length < 8) {
  console.error('ADMIN_PASSWORD must be at least 8 characters.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

await client.connect();
try {
  const hash = bcrypt.hashSync(password, 12);

  await client.query(
    `INSERT INTO users (username, password_hash, full_name, role, is_active, must_change_password)
     VALUES ($1, $2, $3, 'admin', 1, 1)
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       full_name = EXCLUDED.full_name,
       must_change_password = 1,
       updated_at = CURRENT_TIMESTAMP`,
    [username, hash, fullName]
  );

  const settings = [
    ['restaurant_name', restaurantName],
    ['restaurant_address', process.env.RESTAURANT_ADDRESS || 'Birendranagar, Surkhet, Karnali Province, Nepal'],
    ['restaurant_phone', process.env.RESTAURANT_PHONE || '+977 984-9216081'],
    ['restaurant_email', process.env.RESTAURANT_EMAIL || ''],
    ['vat_percentage', process.env.VAT_PERCENT || '0'],
    ['service_charge_percentage', process.env.SERVICE_PERCENT || '0'],
    ['currency', 'NPR'],
    ['reservation_grace_minutes', '20'],
    ['reservation_dining_minutes', '90'],
    ['reservation_cleaning_minutes', '10'],
    ['reservation_min_lead_minutes', '60'],
  ];

  for (const [key, value] of settings) {
    await client.query(
      `INSERT INTO system_settings (setting_key, setting_value)
       VALUES ($1, $2)
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP`,
      [key, value]
    );
  }

  // Baseline tables T-01 … T-10 if empty
  const tableCount = await client.query(`SELECT COUNT(*)::int AS c FROM tables`);
  if ((tableCount.rows[0]?.c || 0) === 0) {
    for (let i = 1; i <= 10; i++) {
      const num = `T-${String(i).padStart(2, '0')}`;
      const capacity = i <= 4 ? 2 : i <= 7 ? 4 : 6;
      await client.query(
        `INSERT INTO tables (table_number, capacity, status, floor, section, is_active)
         VALUES ($1, $2, 'available', 'Ground', 'Main', 1)`,
        [num, capacity]
      );
    }
  }

  console.log(`✓ Seeded admin user "${username}" (must change password on first login)`);
  console.log('✓ Seeded system settings and default tables (if empty)');
} finally {
  await client.end();
}
