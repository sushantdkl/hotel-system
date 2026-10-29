import { test, expect } from '@playwright/test';
import { openHotelPage } from './hotel-nav.js';

// Run against an isolated server with DB_NAME=hotel-foundation-verification.db.
// Opt-in prevents this spec from inserting rooms into a user's working DB.
test.skip(process.env.HOTEL_LIVE_E2E !== '1', 'Requires an isolated hotel test database.');

test('live room setup, reservation, reload and check-in use saved records', async ({ page, request }, testInfo) => {
  test.setTimeout(180000);
  const login = await request.post('/api/auth/login', { data: { username: 'admin', pin: '123456' } });
  expect(login.ok()).toBeTruthy();
  const auth = await login.json();
  const orderBadge = await request.get('/api/admin/orders?status=pending&pageSize=100', { headers: { Authorization: `Bearer ${auth.token}` } });
  expect(orderBadge.ok()).toBeTruthy();
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('pos_token', token);
    localStorage.setItem('pos_user', JSON.stringify(user));
  }, auth);
  // Badge calls are unrelated to hotel persistence and need not initialize POS modules.
  await page.route('**/api/admin/reservations/alerts', (route) => route.fulfill({ json: { alerts: [] } }));
  await page.route('**/api/admin/leads/counts', (route) => route.fulfill({ json: { counts: {} } }));
  await page.route('**/api/waiter-requests?**', (route) => route.fulfill({ json: { counts: {} } }));
  // The live hotel opens by default; rooms are created under Rooms & categories.
  await page.goto('/admin/hotel/room-setup');
  const id = `T${Date.now().toString(36).slice(-7)}${testInfo.project.name[0]}`;
  const category = `Test Deluxe ${id}`;
  await page.getByRole('button', { name: 'New category', exact: true }).click({ timeout: 30000 });
  const catDialog = page.getByRole('dialog');
  await catDialog.getByLabel('Category name').fill(category);
  await catDialog.getByLabel('Nightly price before tax (NPR)').fill('5000');
  await catDialog.getByRole('button', { name: 'Add category', exact: true }).click();
  await expect(catDialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Add one room', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Room number').fill(id);
  await dialog.getByLabel('Floor', { exact: true }).fill('4');
  await dialog.getByLabel('Category').selectOption(await dialog.locator('option', { hasText: category }).getAttribute('value'));
  await dialog.getByLabel('Nightly price (NPR)').fill('5500.25');
  await dialog.getByRole('button', { name: 'Add room', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: id })).toContainText(category);
  await openHotelPage(page, 'Reservations');
  await page.getByRole('button', { name: 'New reservation', exact: true }).click();
  const bookDialog = page.getByRole('dialog');
  await bookDialog.getByLabel('Guest name').fill(`Live test ${id}`);
  await bookDialog.getByLabel(new RegExp(`^${id} ·`)).check();
  await bookDialog.getByRole('button', { name: 'Save reservation' }).click();
  await expect(bookDialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Reservation list' }).click();
  await page.getByRole('row').filter({ hasText: `Live test ${id}` }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('dialog')).toContainText('Agreed rate');
  await page.getByRole('button', { name: 'Check in guest', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Reservation list' }).click();
  await expect(page.getByRole('row').filter({ hasText: `Live test ${id}` })).toContainText('In house');
  await page.screenshot({ path: testInfo.outputPath('hotel-live-reservations.png'), fullPage: true });
  await page.goto('/admin/settings?tab=hotel');
  await expect(page.getByRole('heading', { name: 'Property details' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('hotel-live-setup.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
});

test('hotel APIs reject anonymous and restaurant-only staff', async ({ request }) => {
  test.setTimeout(90000);
  const anonymous = await request.get('/api/hotel');
  expect(anonymous.status()).toBe(401);
  const login = await request.post('/api/auth/login', { data: { username: 'john', pin: '1234' } });
  const { token } = await login.json();
  expect(token).toBeTruthy();
  const response = await request.get('/api/hotel', { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(403);
});

test('public home loads without stock-schema or source-map errors', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30000 });
  expect(errors.filter((message) => /is_archived|source.?map|no such column/i.test(message))).toEqual([]);
});
