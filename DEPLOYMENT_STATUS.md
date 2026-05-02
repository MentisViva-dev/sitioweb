# 🎉 Estado del Deploy — MentisViva en Cloudflare

**Fecha:** 2026-05-02
**Status:** ✅ EN PRODUCCIÓN

## URL actual del API

**`https://mentisviva-api.mentisviva-api.workers.dev`**

Endpoints verificados:
- ✅ `GET /api/health` → `{"ok":true, "db":true}`
- ✅ `GET /api/auth/check` → `{"logged_in":false}`
- ✅ `GET /api/shipping/comunas` → 38 comunas chilenas
- ✅ `GET /api/shipping/cutoff-info` → cálculo dinámico cutoff funcionando

## Recursos creados

| Recurso | ID / Nombre |
|---|---|
| Worker | `mentisviva-api` |
| D1 Database | `mentisviva` (`a93215e2-64ad-42f1-8629-d9a6e173c615`) |
| KV `MV_KV` | `5e7c1e001cd84248bf31323afd65118b` |
| KV `MV_KV_RATE_LIMIT` | `164ce74e094e41e98904c9e9315580fa` |
| KV `MV_KV_CACHE` | `1b4d6c74c32a4dd98e57709ede9cb9d5` |
| R2 Bucket | `mentisviva-uploads` |
| Queues | `q-charges`, `q-emails`, `q-webhooks` (+ DLQs) |
| Cron Triggers | 5 schedules activos |
| Secrets | 9 secrets cargados |

## Repositorio Git

**`https://github.com/MentisViva-dev/sitioweb`**

Branch: `main` — último commit con todo el código.

## Lo que falta hacer (opcional / futuro)

### 🟡 Fase 2 — Custom domain api.mentisviva.cl

Para tener tu propio dominio en lugar del `.workers.dev`:

1. En tu registrador (donde compraste mentisviva.cl), cambia los nameservers a los que te dé Cloudflare.
2. https://dash.cloudflare.com → "Add a Site" → `mentisviva.cl` → Free plan.
3. Importar todos los registros DNS actuales (Cloudflare lo hace automático).
4. Una vez activo, ve a tu Worker → Settings → Triggers → Custom Domains → "api.mentisviva.cl".

**Tiempo:** 1-24h (propagación DNS) + 5 min de configuración.

### 🟡 Fase 3 — Frontend en Cloudflare Pages

1. dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git.
2. Conectar repo `MentisViva-dev/sitioweb`.
3. Build: déjalo vacío (estático).
4. Deploy.

Esto te da `mentisviva.cl` servido desde edge global.

### 🟢 Fase 4 — GitHub Secrets para deploy automático

Para que cada `git push` despliegue automático:

1. Ve a: https://github.com/MentisViva-dev/sitioweb/settings/secrets/actions
2. New repository secret:
   - `CLOUDFLARE_API_TOKEN` → tu token Cloudflare
   - `CLOUDFLARE_ACCOUNT_ID` → `181a71f5927b646cd246af58a129a953`

A partir de ese momento, cada commit a `main` deploya automático via `.github/workflows/deploy.yml`.

## ⚠️ Acción urgente: rotar credenciales expuestas

Los secrets actuales (Flow API, reCAPTCHA, Shipit) estaban en el repo viejo y deben rotarse:

- [ ] **Flow.cl** → dashboard → Configuración API → regenerar API Key + Secret. Actualizar con `wrangler secret put MV_FLOW_API_KEY` y `wrangler secret put MV_FLOW_SECRET`.
- [ ] **reCAPTCHA** → google.com/recaptcha/admin → reset secret. Actualizar con `wrangler secret put MV_RECAPTCHA_SECRET`.
- [ ] **Shipit** → panel admin → regenerar token. Actualizar con `wrangler secret put MV_SHIPIT_TOKEN`.

## ⚠️ Acción urgente: borrar secrets-temporales.txt

```powershell
Remove-Item "$env:USERPROFILE\Desktop\secrets-temporales.txt"
```

O simplemente bórralo desde el explorador.

## ⚠️ Acción urgente: revocar tokens "temporales"

- **GitHub Token** (`MentisViva Push Local`): https://github.com/settings/tokens → delete.
- **Cloudflare Token** (`MentisViva Full`): https://dash.cloudflare.com/profile/api-tokens → roll/delete.

⚠️ **Si revocas el Cloudflare token AHORA**, no podrás hacer nuevos deploys hasta crear uno nuevo. Si planeas seguir trabajando con esto, mejor:
- Mantenlo activo si vas a hacer cambios.
- Cárgalo a GitHub Secrets (Fase 4) y borra el local.
- Rota cuando ya no lo necesites.

## Comandos útiles para mantenimiento

```bash
cd "deploy/cloudflare-fullstack"
export CLOUDFLARE_API_TOKEN="tu-token"
export CLOUDFLARE_ACCOUNT_ID="181a71f5927b646cd246af58a129a953"

# Logs en vivo
npx wrangler tail

# Ver datos D1
npx wrangler d1 execute mentisviva --remote --command "SELECT COUNT(*) FROM mv_users"

# Re-deploy
npx wrangler deploy

# Cargar nuevo secret
echo "valor" | npx wrangler secret put NOMBRE_SECRET

# Listar secrets actuales
npx wrangler secret list
```

## Costo mensual estimado

| Concepto | A 200 usuarios | A 5k usuarios | A 20k usuarios |
|---|---|---|---|
| Workers Paid | $5 | $5 | $8 |
| D1 + KV + R2 + Queues | $0 | $0 | $5 |
| Resend | $0 (free 3k/mes) | $20 | $20 |
| Dominio | ~$1 | ~$1 | ~$1 |
| **TOTAL** | **~$6/mes** | **~$26/mes** | **~$34/mes** |
