# 🎯 INSTRUCCIONES FINALES — MentisViva en Cloudflare

> **Este documento es tu guion.** Síguelo paso a paso. Cada paso tiene clicks
> exactos. Si algo no funciona, vuelve al paso anterior.
>
> **Tiempo total estimado:** 60-90 minutos (todo desde el navegador, sin instalar nada).

---

## 📋 Antes de empezar: lo que necesitas tener listo

Tendrás todo si entras a estas 3 URLs y cargan tu cuenta:

- [ ] https://github.com/MentisViva-dev/sitioweb (tu repo)
- [ ] https://dash.cloudflare.com (tu Cloudflare con Gmail)
- [ ] https://resend.com (cuenta — la creas gratis en el Paso 0)

---

## Paso 0 — Crear cuenta en Resend (5 min)

Resend = servicio de email outbound (Cloudflare no tiene email).

1. Abrir https://resend.com → click **"Sign up"**.
2. Login con Google (la misma cuenta Gmail).
3. En el dashboard, click **"API Keys"** → **"Create API Key"**.
4. Name: `MentisViva Production`. Permission: `Sending access`. Domain: `All domains`.
5. **Copia el API key** (empieza con `re_...`). **Guárdalo** (Bitwarden / archivo seguro).
6. Click **"Domains"** → **"Add Domain"** → ingresa `mentisviva.cl`.
7. Resend te mostrará registros DNS (TXT + MX). Cópialos en un archivo. **Los configurarás en Cloudflare en el Paso 4.**

✅ Tienes: Resend API Key + registros DNS para verificar dominio.

---

## Paso 1 — Crear recursos en Cloudflare (10 min, todo dashboard web)

Abrir https://dash.cloudflare.com y crear los siguientes recursos. Para cada uno **anota el ID** que te muestra (lo necesitarás en el Paso 5).

### 1.1 D1 Database

1. Sidebar → **Workers & Pages** → tab **D1 SQL Database** → **Create**.
2. Database name: `mentisviva`. Location: **Western North America (WNAM)** o el más cercano.
3. Click **Create**.
4. **Copia el Database ID** (formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

### 1.2 KV Namespaces (3 espacios)

1. Sidebar → **Workers & Pages** → tab **KV** → **Create a namespace**.
2. Crea estos 3, uno por uno. **Copia el ID de cada uno**:
   - `MV_KV`
   - `MV_KV_RATE_LIMIT`
   - `MV_KV_CACHE`

### 1.3 R2 Bucket

1. Sidebar → **R2** → **Create bucket**.
2. Bucket name: `mentisviva-uploads`. Location: **Automatic** (o el más cercano).
3. Click **Create**.

### 1.4 Queues (3 colas + 3 dead-letter)

1. Sidebar → **Workers & Pages** → tab **Queues** → **Create queue**.
2. Crea estas 6, una por una:
   - `q-charges`
   - `q-emails`
   - `q-webhooks`
   - `q-charges-dlq`
   - `q-emails-dlq`
   - `q-webhooks-dlq`

### 1.5 API Token (si aún no lo tienes guardado)

1. Click en tu avatar (arriba derecha) → **My Profile** → **API Tokens**.
2. Si ya tienes uno guardado, salta este sub-paso.
3. Si no: **Create Token** → plantilla **"Edit Cloudflare Workers"** → **Continue** → **Create Token**.
4. **Copia el token** (empieza con caracteres aleatorios). **Guárdalo seguro.**

✅ Tienes: 1 D1 ID, 3 KV IDs, 1 R2 bucket, 6 Queues, 1 API Token.

---

## Paso 2 — Generar 3 secrets (2 min, en el navegador)

Necesitas 3 valores aleatorios largos para tu sistema. Generarlos así:

1. Abre una nueva pestaña → https://www.random.org/strings/
2. Configurar:
   - Number of strings: **3**
   - Length: **64**
   - Allowed characters: solo **Numeric digits (0-9)** y **Lowercase letters (a-z)**
   - Click **Get Strings**.
3. **Copia los 3 strings**. Guárdalos en un archivo temporal etiquetados como:
   ```
   MV_TOKEN_SECRET = primer string
   MV_CRON_SECRET = segundo string (úsalo cortado a 32 chars)
   MV_FORWARD_SECRET = tercer string
   ```

✅ Tienes: 3 secrets aleatorios.

---

## Paso 3 — Cargar TODOS los secrets en GitHub (10 min)

GitHub Secrets es donde guardas todas las credenciales sin que nadie las vea.

1. Abre: **https://github.com/MentisViva-dev/sitioweb/settings/secrets/actions**

2. Click **"New repository secret"** y crea uno por uno (10 secrets en total):

   | Secret name | Valor (de dónde sacarlo) |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | Token Cloudflare (Paso 1.5) |
   | `CLOUDFLARE_ACCOUNT_ID` | `181a71f5927b646cd246af58a129a953` |
   | `MV_TOKEN_SECRET` | Primer string del Paso 2 |
   | `MV_CRON_SECRET` | Segundo string del Paso 2 |
   | `MV_FORWARD_SECRET` | Tercer string del Paso 2 |
   | `MV_RESEND_KEY` | API Key de Resend (Paso 0) |
   | `MV_FLOW_API_KEY` | Tu API Key de Flow.cl |
   | `MV_FLOW_SECRET` | Tu Secret de Flow.cl |
   | `MV_RECAPTCHA_SECRET` | Secret de reCAPTCHA v3 (mismo que ya usabas) |
   | `MV_SHIPIT_TOKEN` | Token de Shipit |
   | `MV_SHIPIT_EMAIL` | `contacto@mentisviva.cl` |

3. Verifica que aparezcan los 11 secrets en la lista.

> **Si no recuerdas algunos** (Flow API Key, Shipit, reCAPTCHA): los puedes encontrar en el archivo `api/config.php` actual de V2Networks. **Recomiendo rotar todos esos secrets ahora** desde sus respectivos dashboards porque están en el repo viejo.

✅ Tienes: 11 secrets cargados en GitHub.

---

## Paso 4 — Configurar DNS en Cloudflare (5 min)

Esto activa Cloudflare delante de tu dominio.

1. https://dash.cloudflare.com → click en **mentisviva.cl** (si ya está agregado).
   - Si NO está: click **"Add a Site"** → ingresa `mentisviva.cl` → Free plan → Continue.
   - Cloudflare te mostrará 2 nameservers (algo como `xxx.ns.cloudflare.com`).
   - **Copia esos nameservers** y configúralos en tu registrador de dominio (donde compraste mentisviva.cl). Toma 1-24 horas en propagar.

2. Una vez activo, ve a **DNS → Records** y verifica que existan los registros tipo A apuntando a V2Networks (los actuales).

3. Agrega los registros TXT/MX de Resend (del Paso 0):
   - Click **Add record** → tipo **TXT** → nombre y valor según te dio Resend.
   - Repite para cada registro.

4. Vuelve a https://resend.com/domains → **Verify** tu dominio.

✅ Tienes: DNS apuntando a Cloudflare + dominio verificado en Resend.

---

## Paso 5 — Subir el código al repo (15 min)

Aquí copias todos los archivos que generé al repo, sin instalar git.

1. Descarga la carpeta `deploy/cloudflare-fullstack/` que está en tu PC. Ten lista la ruta:
   ```
   D:\Users\alvaro.rodriguezl\Desktop\Pagina Web MentisViva\deploy\cloudflare-fullstack\
   ```

2. Abre **https://github.dev/MentisViva-dev/sitioweb** (cambia .com por .dev).

3. En el panel izquierdo, **arrastra todo el contenido** de la carpeta cloudflare-fullstack:
   - `.github/`
   - `docs/`
   - `migrations/`
   - `src/`
   - `tests/` (puede estar vacío inicialmente)
   - `package.json`, `tsconfig.json`, `wrangler.toml`, `README.md`, `INSTRUCCIONES_FINALES.md`

4. **Edita `wrangler.toml`** y reemplaza los placeholders con los IDs del Paso 1:
   - `REEMPLAZAR_D1_DATABASE_ID` → tu ID D1
   - `REEMPLAZAR_KV_NAMESPACE_ID` → ID de `MV_KV`
   - `REEMPLAZAR_KV_RATE_LIMIT_ID` → ID de `MV_KV_RATE_LIMIT`
   - `REEMPLAZAR_KV_CACHE_ID` → ID de `MV_KV_CACHE`
   - `REEMPLAZAR_RECAPTCHA_SITE_KEY` → tu site key reCAPTCHA público

5. En el panel izquierdo, click en el icono de **rama** (Source Control). Te muestra todos los cambios.

6. Escribe mensaje: `feat: initial Cloudflare full-stack migration`.

7. Click **"Commit & Push"** (botón azul). Se sube a tu repo.

✅ Tienes: código en GitHub.

---

## Paso 6 — Deploy automático (5 min)

Tu push activa GitHub Actions automáticamente.

1. Abre: **https://github.com/MentisViva-dev/sitioweb/actions**

2. Verás un workflow "Deploy to Cloudflare" corriendo (puntito amarillo).

3. Espera 2-3 minutos. Si todo va bien, queda en verde ✅.

4. **Si queda en rojo ❌**, click el workflow → ve el error. Los más comunes:
   - "D1 database not found" → revisa que `database_id` en `wrangler.toml` sea correcto.
   - "Authentication failed" → revisa que `CLOUDFLARE_API_TOKEN` sea válido (no expirado).
   - "Module not found" → puede ser un import que falta. Avisarme.

5. Cuando esté verde, ejecuta también el workflow **"Seed Cloudflare Secrets"**:
   - Click **Actions** → **"Seed Cloudflare Secrets"** (en la sidebar) → **"Run workflow"** → selecciona `production` → **Run**.
   - Espera 2 min. Verifica que quede en verde.

✅ Tienes: Workers desplegados + secrets cargados.

---

## Paso 7 — Conectar el Worker al dominio (5 min)

1. https://dash.cloudflare.com → tu cuenta → **Workers & Pages** → click en **mentisviva-api** (el Worker que se acaba de crear).

2. Click **Settings** → **Triggers** → **Custom Domains** → **Add Custom Domain**.

3. Domain: `api.mentisviva.cl` → Click **Add Custom Domain**.

4. Cloudflare crea automáticamente el registro CNAME en tu DNS.

5. Espera 30 segundos. Tu API ya responde en `https://api.mentisviva.cl/api/health`.

✅ Tienes: API en producción.

---

## Paso 8 — Importar el contenido del CMS (5 min)

1. En github.dev, abre la carpeta `scripts/`.

2. Crea archivo `initial_content.json` y pega el contenido del archivo `data/content.json` actual de V2Networks.

3. Commit & Push.

4. En GitHub Actions, corre el workflow **"Seed initial content.json"** manualmente.

5. Verifica en `https://api.mentisviva.cl/api/admin/content` (necesitas login admin).

✅ Tienes: contenido del CMS migrado.

---

## Paso 9 — Frontend en Cloudflare Pages (15 min)

Esto es opcional al inicio. Tu sitio sigue funcionando en V2Networks. Cuando quieras migrar el frontend también:

1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.

2. Conecta tu repo `MentisViva-dev/sitioweb`.

3. Project name: `mentisviva-web`. Branch: `main`.

4. Build settings: déjalas vacías (es estático puro).

5. Output directory: déjalo vacío o `/`.

6. Click **Save and Deploy**.

7. Cuando termine, click **Custom Domains** → agrega `mentisviva.cl` y `www.mentisviva.cl`.

8. Cloudflare reconfigura DNS. En 1-2 minutos tu frontend está en Pages.

✅ Tienes: frontend en Cloudflare Pages.

---

## Paso 10 — Cutover de DNS gradual (mientras dura la migración)

**No apagues V2Networks de inmediato.** Migra de a poco:

1. Mantén V2Networks activo como fallback.
2. Apunta `api.mentisviva.cl` → Cloudflare Workers.
3. Apunta `mentisviva.cl` → Cloudflare Pages cuando estés seguro.
4. Prueba todo el flujo (registro, login, suscripción, callback Flow).
5. Cuando lleves 1 semana sin problemas → apaga V2Networks.

---

## ✅ Verificación final

Estos endpoints deben responder:

```
https://api.mentisviva.cl/api/health             → { ok: true, db: true }
https://mentisviva.cl/                           → tu landing
https://mentisviva.cl/editorial.html             → editorial
https://mentisviva.cl/cuenta.html                → cuenta usuario
https://api.mentisviva.cl/api/auth/check         → { ok: true, logged_in: false } sin cookie
```

---

## 🆘 Si algo sale mal

| Síntoma | Solución |
|---|---|
| Workflow falla en "D1 database not found" | Verificar que `database_id` en wrangler.toml sea el correcto |
| API devuelve 500 | Ver logs: `https://dash.cloudflare.com/.../workers/services/view/mentisviva-api/production/logs` |
| Email no llega | Verificar dominio Resend (Paso 0) y registros TXT/MX |
| Callback Flow rechazado | Verificar `MV_FLOW_SECRET` cargado correctamente |
| Frontend Pages no carga | Verificar que el repo tenga `index.html` en raíz |

---

## 📞 Si te bloqueas

1. Ve a la pestaña **Issues** de tu repo y crea una con el error que ves.
2. Pega screenshots del log de GitHub Actions.
3. Pega URLs específicas que fallan.

**Felicitaciones**: cuando termines tendrás MentisViva 100% en Cloudflare con auto-deploy en cada push, callback Flow blindado, idempotencia, GDPR/Ley 21.719 implementado, y el costo total será ~$5/mes.
