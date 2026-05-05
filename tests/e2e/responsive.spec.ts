import { test, expect } from '@playwright/test';

/**
 * Responsive smoke tests — page must render without horizontal overflow
 * at common viewport widths.
 */
const VIEWPORTS = [
  { name: '360x800 (small phone)', width: 360, height: 800 },
  { name: '768x1024 (tablet)', width: 768, height: 1024 },
  { name: '1280x800 (laptop)', width: 1280, height: 800 },
];

const PAGES = ['/', '/editorial.html', '/centro.html'];

for (const viewport of VIEWPORTS) {
  test.describe(`Responsive @ ${viewport.name}`, () => {
    for (const path of PAGES) {
      test(`${path} renders without horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const response = await page.goto(path);
        expect(response?.ok(), `${path} should respond 2xx`).toBeTruthy();
        await page.waitForLoadState('domcontentloaded');

        const overflow = await page.evaluate(() => {
          return {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            bodyScrollWidth: document.body.scrollWidth,
          };
        });

        // Allow up to 1px sub-pixel rounding
        const horizontalOverflow = overflow.scrollWidth - overflow.clientWidth;
        expect(
          horizontalOverflow,
          `${path} @ ${viewport.width}px overflows by ${horizontalOverflow}px (scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth})`,
        ).toBeLessThanOrEqual(1);
      });
    }
  });
}
