import { test, expect } from '@playwright/test';

const ADMIN_USER = process.env.E2E_ADMIN_USER || 'admin';
const ADMIN_PIN = process.env.E2E_ADMIN_PIN || '1234';

async function loginAsAdmin(page) {
  await page.goto('/login');
  await page.fill('#admin-username', ADMIN_USER);
  await page.fill('#admin-pin', ADMIN_PIN);
  await page.getByRole('button', { name: /^Sign in$/i }).click();
  await expect(page).toHaveURL(/\/admin\/pos/, { timeout: 15_000 });
}

test.describe('Single-admin counter POS', () => {
  test('admin can sign in and lands on the counter (New Sale)', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByRole('heading', { name: /Point of Sale/i })).toBeVisible();
  });

  test('counter shows the imported menu with prices', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText('Americano').first()).toBeVisible();
    await expect(page.getByText(/Rs\.?\s?120/).first()).toBeVisible();
  });

  test('variant item is present with its base price', async ({ page }) => {
    await loginAsAdmin(page);
    // Search narrows the grid; Mutton Shadeko is a variant item (Boiled 300 / Fried 320).
    await page.fill('input[placeholder="Search menu…"]', 'Mutton Shadeko');
    await expect(page.getByText('Mutton Shadeko').first()).toBeVisible();
    await expect(page.getByText(/Rs\.?\s?300/).first()).toBeVisible();
  });

  test('key admin pages have no horizontal overflow on mobile', async ({ page }) => {
    await loginAsAdmin(page);
    const routes = [
      '/admin/pos', '/admin/dashboard', '/admin/orders', '/admin/products',
      '/admin/inventory', '/admin/reports', '/admin/general-ledger',
      '/admin/chart-of-accounts', '/admin/expenses', '/admin/settings',
    ];
    for (const route of routes) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      expect(overflow, `horizontal overflow on ${route}`).toBe(false);
    }
  });

  test('wrong password is rejected', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#admin-username', ADMIN_USER);
    await page.fill('#admin-pin', 'definitely-wrong-pw');
    await page.getByRole('button', { name: /^Sign in$/i }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
