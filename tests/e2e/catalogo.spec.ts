import { test, expect } from '@playwright/test';

/**
 * Catalog (filters + carousel) smoke tests.
 * Target: /editorial.html (the catalog section)
 */
test.describe('Catalogo filters and arrows', () => {
  test('filter buttons render and switching updates active state', async ({ page }) => {
    await page.goto('/editorial.html');
    await page.waitForLoadState('networkidle');

    const filtros = page.locator('#catalogoFiltros .catalogo-filtro');
    // Wait for filters to render
    await expect.poll(async () => await filtros.count(), { timeout: 12_000 })
      .toBeGreaterThanOrEqual(2);

    // Look for "Ensayos Psicológicos" — fall back to clicking the second filter
    // if the catalog content has been re-titled.
    let target = filtros.filter({ hasText: /Ensayos/i }).first();
    if ((await target.count()) === 0) {
      target = filtros.nth(1); // first non-"Todos" filter
    }
    await target.click();

    // The clicked filter should now be active (class "active" or aria-selected="true")
    await expect.poll(async () => {
      const cls = await target.getAttribute('class');
      const sel = await target.getAttribute('aria-selected');
      return (cls?.includes('active') ?? false) || sel === 'true';
    }).toBeTruthy();

    // Carousel should still be present (may be empty if category has no books — that's OK)
    await expect(page.locator('#catalogoCarrusel')).toBeVisible();
  });

  test('next/prev arrows are clickable', async ({ page }) => {
    await page.goto('/editorial.html');
    await page.waitForLoadState('networkidle');

    const next = page.locator('#catalogoNext');
    const prev = page.locator('#catalogoPrev');

    await expect(next).toBeVisible();
    await expect(prev).toBeVisible();

    // Clicking shouldn't throw
    await next.click({ force: true });
    await page.waitForTimeout(300);
    await prev.click({ force: true });
  });
});
