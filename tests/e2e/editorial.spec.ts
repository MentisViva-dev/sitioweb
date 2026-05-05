import { test, expect } from '@playwright/test';

/**
 * Editorial page smoke tests.
 * Target: /editorial.html
 */
test.describe('Editorial page', () => {
  test('loads, catalog renders with at least 7 books', async ({ page }) => {
    await page.goto('/editorial.html');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#bannerTitle')).toContainText(/Editorial/i);
    await expect(page.locator('#catalogoSection')).toBeVisible();

    // Wait for the catalog carousel to populate
    const carousel = page.locator('#catalogoCarrusel');
    await expect(carousel).toBeVisible();

    // Books are direct children (cards) — must have at least 7
    await expect
      .poll(
        async () => await carousel.locator('> *, .libro-card, [data-libro-id]').count(),
        { timeout: 12_000, message: 'catalog should populate with books' },
      )
      .toBeGreaterThanOrEqual(7);
  });

  test('book modal opens on click and closes with Esc', async ({ page }) => {
    await page.goto('/editorial.html');
    await page.waitForLoadState('networkidle');

    const carousel = page.locator('#catalogoCarrusel');
    await expect(carousel).toBeVisible();

    // Wait for at least one book card
    const firstCard = carousel.locator('> *').first();
    await expect(firstCard).toBeVisible({ timeout: 12_000 });

    // Click the first book — should open modal
    await firstCard.click();

    const modal = page.locator('#catalogoModal');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('aria-hidden', 'false');

    // Esc closes
    await page.keyboard.press('Escape');
    // Modal hides — either aria-hidden=true OR the [hidden] attribute is reapplied
    await expect
      .poll(async () => {
        const ariaHidden = await modal.getAttribute('aria-hidden');
        const isHidden = await modal.evaluate((el) => el.hasAttribute('hidden') || (el as HTMLElement).style.display === 'none');
        return ariaHidden === 'true' || isHidden;
      })
      .toBeTruthy();
  });
});
