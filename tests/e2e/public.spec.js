import { test, expect } from '@playwright/test';

test.describe('Public website', () => {
  test('home renders identity, CTAs and contact', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    await page.goto('/');
    await expect(page).toHaveTitle(/Raithane Daure Chulo/i);
    await expect(page.getByText('Raithane Daure Chulo').first()).toBeVisible();

    await expect(page.getByRole('link', { name: /menu/i }).first()).toBeVisible();

    const wa = page.getByRole('link', { name: /WhatsApp/i }).first();
    await expect(wa).toHaveAttribute('href', /wa\.me\/9779849216081/);

    const call = page.locator('a[href^="tel:+9779849216081"]:visible').first();
    await expect(call).toBeVisible();

    expect(errors.filter((e) => !/Failed to load resource|404/.test(e)), `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('menu page shows imported items with prices, search and categories', async ({ page }) => {
    await page.goto('/menu');
    await expect(page).toHaveTitle(/Menu \| Raithane Daure Chulo/i);
    await expect(page.getByText('Americano').first()).toBeVisible();
    await expect(page.getByText(/Rs\.?\s?120/).first()).toBeVisible();
    await expect(page.locator('input[type="search"]')).toBeVisible();
    await expect(page.locator('[role="tab"]').first()).toBeVisible();
  });

  test('menu search filters items', async ({ page }) => {
    await page.goto('/menu');
    await page.fill('input[type="search"]', 'sekuwa');
    await expect(page.getByRole('heading', { name: /Chicken Sekuwa/i })).toBeVisible();
    await expect(page.getByText('Americano')).toHaveCount(0);
  });

  test('menu images with a stored source actually load (real dimensions)', async ({ page }) => {
    await page.goto('/menu');
    // Trigger native lazy-loading across the whole page.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(2000);
    const stats = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('main img')];
      return {
        total: imgs.length,
        loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
        broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
      };
    });
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.loaded).toBeGreaterThan(0);
    expect(stats.broken).toBe(0);
  });

  test('menu images are unique (no photo used twice)', async ({ page }) => {
    await page.goto('/menu');
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); }
    });
    await page.waitForTimeout(1500);
    const srcs = await page.evaluate(() => [...document.querySelectorAll('main article img')].map((i) => i.getAttribute('src')));
    const dupes = srcs.filter((s, i) => srcs.indexOf(s) !== i);
    expect(dupes, `duplicate images: ${[...new Set(dupes)].join(', ')}`).toEqual([]);
  });

  test('ordering: add to cart offers WhatsApp + a place-order form', async ({ page }) => {
    await page.goto('/menu');
    await page.getByRole('button', { name: /^Add / }).first().click();
    await page.getByRole('button', { name: /View cart/i }).click();
    // WhatsApp is generated only after the canonical order has been saved.
    await expect(page.getByRole('button', { name: /Send via WhatsApp/i })).toBeVisible();
    // Form fields present
    await expect(page.getByPlaceholder('Your name *')).toBeVisible();
    await expect(page.getByPlaceholder('Phone number *')).toBeVisible();
    await expect(page.getByRole('button', { name: /Place Order/i })).toBeVisible();
  });

  test('ordering: placing an order succeeds', async ({ page }) => {
    await page.goto('/menu');
    await page.getByRole('button', { name: /^Add / }).first().click();
    await page.getByRole('button', { name: /View cart/i }).click();
    await page.getByPlaceholder('Your name *').fill('Playwright Tester');
    await page.getByPlaceholder('Phone number *').fill('9800000001');
    await page.getByRole('button', { name: /Place Order/i }).click();
    await expect(page.getByText(/Order received/i)).toBeVisible({ timeout: 15_000 });
  });

  test('no legacy Dim Sum / Sundar branding on active public pages', async ({ page }) => {
    for (const path of ['/', '/menu', '/about', '/gallery', '/contact']) {
      await page.goto(path);
      const body = await page.evaluate(() => document.body.innerText);
      expect(body, `legacy branding on ${path}`).not.toMatch(/dim\s*sum\s*puri|sundar|bagaicha/i);
    }
  });

  test('no horizontal overflow on mobile home', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow).toBe(false);
  });

  test('staff routes require login when signed out (full-service mode)', async ({ page }) => {
    for (const route of ['/waiter', '/kitchen', '/cashier']) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test('about, gallery and contact pages load', async ({ page }) => {
    for (const [path, re] of [
      ['/about', /About \| Raithane Daure Chulo/i],
      ['/gallery', /Gallery \| Raithane Daure Chulo/i],
      ['/contact', /Contact & location|Contact &amp; location/i],
    ]) {
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
    }
  });
});
