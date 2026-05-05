# MentisViva E2E Smoke Tests

Lightweight Playwright smoke tests that hit **production** (`https://mentisviva.cl`) directly.
They are **non-mutating** — no logins, no form submissions — so they're safe to run any time.

## What they cover

| File | Page | Checks |
|------|------|--------|
| `e2e/home.spec.ts` | `/` | Hero + nav render, no console errors, no horizontal scroll on mobile |
| `e2e/editorial.spec.ts` | `/editorial.html` | Catalog renders 7+ books, modal opens on click + closes with Esc |
| `e2e/catalogo.spec.ts` | `/editorial.html` | Filter buttons work, prev/next arrows clickable |
| `e2e/contact-form.spec.ts` | `/centro.html` | Form renders all fields, fields accept input (no submit) |
| `e2e/responsive.spec.ts` | `/`, `/editorial.html`, `/centro.html` | No horizontal overflow at 360 / 768 / 1280 px |

## Setup (first time)

```bash
cd tests
npm install
npm run install-browsers   # downloads chromium for Playwright
```

## Run

```bash
# default — runs all projects (chromium + mobile-chromium)
npm test

# desktop chromium only (faster)
npm run test:chromium

# headed (see the browser)
npm run test:headed

# interactive UI mode
npm run test:ui

# open the last HTML report
npm run report
```

## Targeting a different environment

```bash
E2E_BASE_URL=https://staging.mentisviva.cl npm test
```

## Notes

- **No CI integration on purpose.** These are manual smoke tests; run them
  before/after a deploy. Adding a workflow that runs them on every push would
  be noisy and slow given they hit production.
- Tests deliberately do **not** click "submit" on the contact form — that would
  spam the contacto@mentisviva.cl inbox.
- Tests deliberately do **not** log in or hit `/api/admin/*` — those are covered
  by the backend's vitest suite in `deploy/cloudflare-fullstack/`.
- Console-error filtering ignores recaptcha / google fonts / sentry noise.
