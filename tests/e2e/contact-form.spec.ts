import { test, expect } from '@playwright/test';

/**
 * Contact form smoke tests on /centro.html.
 * We DON'T submit the form — only verify it renders and is interactive.
 */
test.describe('Centro contact form', () => {
  test('form renders with all required fields', async ({ page }) => {
    await page.goto('/centro.html');
    await page.waitForLoadState('domcontentloaded');

    const form = page.locator('#contactFormCentro');
    await expect(form).toBeVisible();

    // All required fields exist
    await expect(form.locator('input[name="nombre"]')).toBeVisible();
    await expect(form.locator('input[name="email"]')).toBeVisible();
    await expect(form.locator('select[name="tipoConsulta"]')).toBeVisible();
    await expect(form.locator('textarea[name="mensaje"]')).toBeAttached();

    // Submit button exists
    await expect(form.locator('button[type="submit"]')).toBeVisible();
  });

  test('fields accept input (no actual submission)', async ({ page }) => {
    await page.goto('/centro.html');
    await page.waitForLoadState('domcontentloaded');

    const form = page.locator('#contactFormCentro');
    await form.locator('input[name="nombre"]').fill('Test User');
    await form.locator('input[name="email"]').fill('test@example.com');
    await form.locator('select[name="tipoConsulta"]').selectOption({ index: 1 });
    await form.locator('textarea[name="mensaje"]').fill('Test message — not submitted.');

    // Verify values stuck
    await expect(form.locator('input[name="nombre"]')).toHaveValue('Test User');
    await expect(form.locator('input[name="email"]')).toHaveValue('test@example.com');

    // DO NOT click submit — keep prod inbox clean
  });
});
