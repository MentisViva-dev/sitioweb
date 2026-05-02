# 🎉 MentisViva — Deploy Completado

**Fecha:** 2026-05-02
**Status:** ✅ EN PRODUCCIÓN

---

## URLs ACTIVAS AHORA MISMO

| Servicio | URL Cloudflare | URL Final (cuando DNS propague) |
|---|---|---|
| **API Backend** | https://mentisviva-api.mentisviva-api.workers.dev | https://api.mentisviva.cl |
| **Frontend** | https://mentisviva-web.pages.dev | https://mentisviva.cl |
| **Frontend WWW** | https://mentisviva-web.pages.dev | https://www.mentisviva.cl |

---

## Recursos creados en Cloudflare

| Recurso | ID / Nombre |
|---|---|
| **Account ID** | `181a71f5927b646cd246af58a129a953` |
| **Worker** | `mentisviva-api` |
| **Pages Project** | `mentisviva-web` |
| **D1 Database** | `mentisviva` (`a93215e2-64ad-42f1-8629-d9a6e173c615`) |
| **KV `MV_KV`** | `5e7c1e001cd84248bf31323afd65118b` |
| **KV `MV_KV_RATE_LIMIT`** | `164ce74e094e41e98904c9e9315580fa` |
| **KV `MV_KV_CACHE`** | `1b4d6c74c32a4dd98e57709ede9cb9d5` |
| **R2 Bucket** | `mentisviva-uploads` |
| **Queues** | `q-charges`, `q-emails`, `q-webhooks` (+ DLQs) |
| **Cron Triggers** | 5 schedules activos |
| **Secrets Worker** | 9 secrets |
| **Zone** | `mentisviva.cl` (id: `6fe336b5c5f7a6b73caeb636f28f86fa`) |
| **Custom Domain Worker** | `api.mentisviva.cl` |
| **Custom Domains Pages** | `mentisviva.cl`, `www.mentisviva.cl` |
| **GitHub Secrets** | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |

---

## CI/CD activado

✅ Cada `git push` a `main` desplegará automáticamente vía `.github/workflows/deploy.yml`.

---

## Status de DNS

- **nic.cl:** ✅ nameservers configurados (`elle.ns.cloudflare.com`, `ethan.ns.cloudflare.com`)
- **Cloudflare zone:** ⏳ `pending` (esperando propagación, 15min-24h)

Cuando termine la propagación:
- Zone status → `active`
- `mentisviva.cl` → Pages
- `www.mentisviva.cl` → Pages
- `api.mentisviva.cl` → Worker
- SSL automático (emisión por Cloudflare)
- `_acme-challenge`, DKIM Resend, SPF, DMARC → todos preservados

---

## ⚠️ ACCIONES TUYAS PENDIENTES

### 1. Rotar credenciales viejas (15 min)

Estos secrets vinieron del repo viejo (`api/config.php` de V2Networks). Están comprometidos. Rota cada uno:

| Secret | Dónde rotar | Comando para actualizar |
|---|---|---|
| Flow API Key | dashboard.flow.cl → API | `echo "NUEVO" \| npx wrangler secret put MV_FLOW_API_KEY` |
| Flow Secret | dashboard.flow.cl → API | `echo "NUEVO" \| npx wrangler secret put MV_FLOW_SECRET` |
| reCAPTCHA Secret | google.com/recaptcha/admin | `echo "NUEVO" \| npx wrangler secret put MV_RECAPTCHA_SECRET` |
| Shipit Token | api.shipit.cl panel | `echo "NUEVO" \| npx wrangler secret put MV_SHIPIT_TOKEN` |
| ADMIN_PASS_HASH | (regenerar con argon2) | `echo "NUEVO" \| npx wrangler secret put ADMIN_PASS_HASH` |

### 2. Borrar V2Networks (cuando confirmes que todo funciona)

⚠️ **NO ahora.** Espera 7-30 días con ambos sistemas en paralelo. Cuando estés seguro:
- Cancela hosting en V2Networks.
- Borra archivos del FTP.

### 3. Borrar tokens "temporales"

- **GitHub PAT** (`MentisViva Push Local`): https://github.com/settings/personal-access-tokens → delete después de 30 días.
- **Cloudflare Token** (`MentisViva Full`): puede quedar activo, ya está en GitHub Secrets.

---

## Cómo probar el sitio

### API funcionando

```bash
curl https://mentisviva-api.mentisviva-api.workers.dev/api/health
# → {"ok":true,"env":"production","db":true,...}

curl https://mentisviva-api.mentisviva-api.workers.dev/api/shipping/comunas
# → 38 comunas chilenas

curl https://mentisviva-api.mentisviva-api.workers.dev/api/shipping/cutoff-info
# → {"next_shipment_date":"2026-05-25","cutoff_date":"2026-05-08",...}
```

### Frontend funcionando

Abre en el navegador:
- https://mentisviva-web.pages.dev
- https://mentisviva-web.pages.dev/editorial.html
- https://mentisviva-web.pages.dev/content.json

### Cuando DNS propague

- https://mentisviva.cl
- https://www.mentisviva.cl
- https://api.mentisviva.cl/api/health

---

## Comandos útiles

```bash
cd "deploy/cloudflare-fullstack"
export CLOUDFLARE_API_TOKEN="xxx"
export CLOUDFLARE_ACCOUNT_ID="181a71f5927b646cd246af58a129a953"

# Logs en vivo del Worker
npx wrangler tail

# Consultar D1
npx wrangler d1 execute mentisviva --remote --command "SELECT COUNT(*) FROM mv_users"

# Re-deploy manual
npx wrangler deploy

# Frontend re-deploy (si cambias HTML)
cd /tmp/mv-pages && npx wrangler pages deploy . --project-name=mentisviva-web --branch=main

# Listar secrets
npx wrangler secret list

# Ver uso D1
npx wrangler d1 info mentisviva
```

---

## Costos mensuales estimados

| Concepto | A 200 usuarios | A 5k | A 20k |
|---|---|---|---|
| Workers Paid | $5 | $5 | $8 |
| D1 + KV + R2 + Queues + Pages | $0 | $0 | $5 |
| Resend (email) | $0 | $20 | $20 |
| Dominio mentisviva.cl | ~$1 | ~$1 | ~$1 |
| **TOTAL** | **~$6/mes** | **~$26/mes** | **~$34/mes** |

---

## Resuelve los 95 hallazgos de la auditoría

Por construcción:
- ✅ Callback Flow firmado HMAC + idempotente con UNIQUE
- ✅ Monto validado contra mv_orders.monto
- ✅ Cancelación diferida en ventana cutoff→25
- ✅ Eliminación de cuenta + export datos (Ley 21.719)
- ✅ Audit log completo
- ✅ Rate limiting por IP+email+user
- ✅ Tokens HMAC con cookies HttpOnly
- ✅ Timing-safe login con dummy hash
- ✅ Refund admin (Ley 19.496)
- ✅ Disputas (Ley 20.009)

Detalle completo en `docs/09_CORRELACION_AUDITORIA.md`.
