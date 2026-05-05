import { test, expect } from '@playwright/test';

/**
 * Home page smoke tests.
 * Target: / (index.html)
 */
test.describe('Home page', () => {
  test('loads with hero, nav, no console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    const response = await page.goto('/');
    expect(response?.ok(), 'home page should respond 2xx').toBeTruthy();

    // Hero
    await expect(page.locator('#hero, .landing-hero')).toBeVisible();
    await expect(page.locator('#heroTitle')).toBeVisible();

    // Nav (renders dynamically, give it a moment)
    await expect(page.locator('header.navbar, #navbar')).toBeAttached();

    // Title contains brand
    await expect(page).toHaveTitle(/Mentis ?Viva/i);

    // Filter out third-party noise (Google reCAPTCHA, analytics, font CDN)
    const significantErrors = consoleErrors.filter(
      (e) =>
        !/recaptcha|google|gtag|gtm|fonts\.googleapis|favicon|hotjar|sentry/i.test(e),
    );
    expect(significantErrors, `unexpected console errors: ${significantErrors.join('\n')}`)
      .toEqual([]);
  });

  test('no horizontal scroll on mobile (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    // Allow up to 1px rounding tolerance
    expect(overflow, `body overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
  });
});
