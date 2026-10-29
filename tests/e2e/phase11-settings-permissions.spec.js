import { test, expect } from '@playwright/test';

// Run against an isolated server (DB_NAME=hotel-foundation-verification.db); it writes a per-user permission.
test.skip(process.env.HOTEL_LIVE_E2E !== '1', 'Requires an isolated hotel test database.');

test('hotel settings live in Settings, no demo mode, per-staff permissions save', async ({ page, request }, testInfo) => {
  test.setTimeout(180000);
  const login = await request.post('/api/auth/login', { data: { username: 'admin', pin: '123456' } });
  const auth = await login.json();
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('pos_token', token);
    localStorage.setItem('pos_user', JSON.stringify(user));
  }, auth);
  await page.route('**/api/admin/reservations/alerts', (route) => route.fulfill({ json: { alerts: [] } }));
  await page.route('**/api/admin/leads/counts', (route) => route.fulfill({ json: { counts: {} } }));
  await page.route('**/api/waiter-requests?**', (route) => route.fulfill({ json: { counts: {} } }));

  await page.goto('/admin/hotel');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(/design preview|demo/i)).toHaveCount(0);

  await page.goto('/admin/settings?tab=hotel');
  await expect(page.getByRole('heading', { name: 'Property details' })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('heading', { name: 'Seasons & rate plans' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('settings-hotel.png'), fullPage: true });

  const headers = { Authorization: `Bearer ${auth.token}` };
  const staff = (await (await request.get('/api/admin/permissions?view=staff', { headers })).json()).staff;
  const person = staff.find((u) => u.role === 'receptionist') || staff.find((u) => u.role === 'waiter') || staff[0];
  await page.goto(`/admin/permissions?user=${person.id}`);
  const row = page.getByRole('radiogroup', { name: 'Reservations & check-in' });
  await row.getByRole('radio', { name: 'Allow' }).click({ timeout: 60000 });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  const saved = await (await request.get(`/api/admin/permissions?userId=${person.id}`, { headers })).json();
  expect(saved.permissions['hotel.front_desk'].override).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('permissions-staff.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  // Reset so reruns start clean.
  await page.getByRole('radiogroup', { name: 'Reservations & check-in' }).getByRole('radio', { name: 'Role default' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
});
