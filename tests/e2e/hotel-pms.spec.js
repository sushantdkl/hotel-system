import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Isolated database only (creates rooms, stays and postings).
test.skip(process.env.HOTEL_LIVE_E2E !== '1', 'Requires an isolated hotel test database.');

test('PMS pages: front desk command center, room detail, reports, night audit, control center and search', async ({ page, request }, testInfo) => {
  test.setTimeout(240000);
  const login = await request.post('/api/auth/login', { data: { username: 'admin', pin: '123456' } });
  expect(login.ok()).toBeTruthy();
  const auth = await login.json();
  const headers = { Authorization: `Bearer ${auth.token}` };
  const command = async (data) => {
    const response = await request.post('/api/hotel', { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const context = await (await request.get('/api/admin/business-days', { headers })).json();
  if (!context.activeSession) {
    const opened = await request.post('/api/admin/business-days', { headers, data: { opening_cash: 0, opening_note: 'PMS browser test' } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
  }
  const roomId = `P${Date.now().toString(36).slice(-6)}${testInfo.project.name[0]}`;
  await command({ type: 'room', roomId, roomType: 'PMS test', floor: 6, capacity: 3, rate: 3000 });
  const start = (await (await request.get('/api/hotel', { headers })).json()).state.businessDate;
  const end = new Date(Date.parse(start) + 2 * 86400000).toISOString().slice(0, 10);
  const guest = `Pms Guest ${roomId}`;
  const stay = await command({ type: 'book', roomId, guest, start, end, adults: 2, children: 1, bookingType: 'guaranteed', specialRequests: 'Quiet room' });
  await command({ type: 'checkin', id: stay.id });

  await page.addInitScript(({ token, user }) => { localStorage.setItem('pos_token', token); localStorage.setItem('pos_user', JSON.stringify(user)); }, auth);
  await page.route('**/api/admin/reservations/alerts', (route) => route.fulfill({ json: { alerts: [] } }));
  await page.route('**/api/admin/leads/counts', (route) => route.fulfill({ json: { counts: {} } }));
  await page.route('**/api/waiter-requests?**', (route) => route.fulfill({ json: { counts: {} } }));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // Front desk: in-house list -> one-screen room detail with quick actions.
  await page.goto('/admin/hotel');
  await expect(page.getByRole('heading', { name: 'In house' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('row').filter({ hasText: guest }).getByRole('button', { name: 'Room' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Occupancy');
  await expect(dialog).toContainText('Quiet room');
  await expect(dialog.getByRole('button', { name: 'Move room' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add room' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('room-detail.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();

  // Night audit page posts the night; re-run needs a reason and never duplicates.
  await page.goto('/admin/hotel/night-audit');
  await expect(page.getByRole('heading', { name: /Pre-audit checklist/ })).toBeVisible({ timeout: 30000 });
  if (await page.getByRole('button', { name: 'Run night audit' }).isVisible()) {
    await page.getByRole('button', { name: 'Run night audit' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Run night audit' }).click();
  } else {
    await page.getByPlaceholder('Reason for re-run').fill('Browser test re-run');
    await page.getByRole('button', { name: 'Re-run (no duplicate charges)' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Re-run audit' }).click();
  }
  await expect(page.getByText(/Night audit for .* posted/)).toBeVisible({ timeout: 30000 });
  const state = (await (await request.get('/api/hotel', { headers })).json()).state;
  expect(state.bookings.find((b) => b.id === stay.id).entries.filter((e) => e.sourceType === 'ROOM').length).toBe(1);

  // Hotel reports render from stored records.
  await page.goto('/admin/hotel/reports');
  await expect(page.getByRole('heading', { name: 'Arrivals' })).toBeVisible({ timeout: 30000 });
  await page.getByLabel('Report').selectOption('occupancy');
  await expect(page.getByRole('heading', { name: 'Occupancy, ADR and RevPAR' })).toBeVisible();

  // Combined control center and global search.
  await page.goto('/admin/control-center');
  await expect(page.getByRole('heading', { name: 'Control center' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Hotel today')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('control-center.png'), fullPage: true });
  if ((page.viewportSize()?.width ?? 1280) >= 1024) {
    await page.getByLabel('Global search').fill(guest.slice(0, 12));
    await expect(page.getByRole('option').filter({ hasText: guest }).first()).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  expect(errors).toEqual([]);
});
