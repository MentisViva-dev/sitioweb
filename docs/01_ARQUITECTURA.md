# Arquitectura — MentisViva en Cloudflare

## Vista general

```
                            ┌──────────────────────┐
                            │   Usuario (Chrome)    │
                            └──────────┬───────────┘
                                       │ HTTPS
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │  Cloudflare Edge (300+ data centers)    │
                  │  ├─ DNS resolution                      │
                  │  ├─ DDoS / WAF / Bot Mgmt               │
                  │  ├─ TLS 1.3 termination                 │
                  │  └─ HTTP/3                               │
                  └─────────────────────────────────────────┘
                                       │
                  ┌────────────────────┼────────────────────┐
                  │                    │                    │
                  ▼                    ▼                    ▼
        ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
        │ Cloudflare      │  │ Worker Router   │  │ Cloudflare R2   │
        │ Pages (estático)│  │ (single entry)  │  │ (imágenes)      │
        │                 │  │                 │  │                 │
        │ index.html      │  │ /api/* routes   │  │ assets/uploads/ │
        │ editorial.html  │  │ to subworkers   │  │ portadas/       │
        │ centro.html     │  │                 │  │                 │
        │ fundacion.html  │  └────────┬────────┘  └─────────────────┘
        │ recursos.html   │           │
        │ tracking.html   │           │ service bindings
        │ terminos.html   │           │
        │ encuesta.html   │           ▼
        │ cuenta.html*    │  ┌─────────────────────────────────────┐
        │ unidos.html*    │  │  Workers especializados (1 por      │
        │ catalogo.html   │  │  dominio de negocio)                │
        │ privacidad.html │  ├─────────────────────────────────────┤
        │ /css/*, /js/*   │  │  auth-worker     /api/auth/*        │
        └─────────────────┘  │  pay-worker      /api/pay/*         │
        * estos consumen     │  shipping-worker /api/shipping/*    │
          API via fetch      │  profile-worker  /api/profile/*     │
                             │  admin-worker    /api/admin/*       │
                             │  forms-worker    /api/forms/*       │
                             │  cron-worker     scheduled triggers │
                             └────────────┬────────────────────────┘
                                          │
                ┌─────────────────────────┼─────────────────────────┐
                │                         │                         │
                ▼                         ▼                         ▼
       ┌────────────────┐       ┌────────────────┐        ┌────────────────┐
       │  Cloudflare D1  │       │  Cloudflare KV  │        │ Cloudflare     │
       │  (SQLite)       │       │  (cache/sess)  │        │ Queues         │
       │                 │       │                 │        │                │
       │  mv_users       │       │  rate-limits    │        │ q-charges      │
       │  mv_orders      │       │  recaptcha-cache│        │ q-emails       │
       │  mv_sessions    │       │  flow-cache     │        │ q-webhooks     │
       │  mv_*           │       │                 │        │                │
       └────────────────┘       └────────────────┘        └────────────────┘
                                                                  │
                                                                  │ outbound
                                                                  ▼
                                                       ┌────────────────────┐
                                                       │ Servicios externos │
                                                       │ ┌───────────────┐  │
                                                       │ │ Flow.cl API   │  │
                                                       │ │ Shipit API    │  │
                                                       │ │ Resend (email)│  │
                                                       │ │ reCAPTCHA v3  │  │
                                                       │ │ Google Maps   │  │
                                                       │ └───────────────┘  │
                                                       └────────────────────┘
```

## Decisiones arquitectónicas

### 1. ¿Por qué un Worker Router central?

Cloudflare permite un solo Worker por hostname/route. Para tener **separación lógica** entre auth/pay/shipping/etc. usamos:

- 1 Worker `router` que recibe TODOS los requests `/api/*`.
- Internamente delega a sub-Workers vía **service bindings** (sin hop de red, latencia 0).
- Cada sub-Worker es código independiente, testeable, deployable por separado.

**Ventaja:** mantenibilidad de microservicios sin overhead de red.

**Alternativa descartada:** un Worker monolítico de 5000 líneas → difícil de testear, lock con cualquier deploy.

### 2. ¿Por qué D1 (no MySQL externo)?

A 200-30k usuarios D1 alcanza con holgura (5GB free, 5M reads/día free, 100k writes/día free). Hyperdrive (proxy a MySQL externo) cuesta $5/mes y agrega latencia.

**Trade-off:** D1 es SQLite, no tiene `SELECT … FOR UPDATE`. Resolvemos idempotencia con UNIQUE constraints + `INSERT OR IGNORE` (patrón explicado en `09_CORRELACION_AUDITORIA.md`).

### 3. ¿Por qué Workers Paid ($5/mes) y no Free?

- Free tier limita 10ms CPU per request → cron del cutoff no cabe.
- Paid da 30s CPU, Queues, Durable Objects.
- A 200-20k usuarios el plan paid es más que suficiente.

### 4. ¿Por qué KV para sesiones?

- Sesiones leen >>> escriben (lees en cada request, escribes solo al login).
- KV optimiza ese patrón (lectura <1ms en edge).
- TTL nativo (auto-expira a 30 días sin código).
- Free tier 100k reads/día sobra para 200-1000 usuarios activos.

A escala mayor evaluar **Durable Objects** para sesiones con state real.

### 5. ¿Por qué Queues para cron del cutoff?

Workers Cron Trigger ejecuta UNA vez. Tiene 30s wall time max.

Procesar 200 cobros = 200 llamadas Flow secuenciales. Si cada una toma 200-500ms, son 40-100s. **No cabe en una invocación.**

**Solución:** Cron Trigger encola 200 mensajes en `q-charges`. Cloudflare procesa los mensajes con consumer Workers (cada uno procesa 1 usuario). Paralelismo configurable, retry automático con backoff.

### 6. ¿Por qué Resend para email?

Cloudflare no tiene email outbound. Opciones:

| Provider | Free | Setup |
|---|---|---|
| **Resend** ⭐ | 3.000/mes | DKIM auto, API moderna |
| AWS SES | $0.10/1000 | Setup DNS complejo |
| MailChannels | $15/mes (cambió a paid) | Antes free, hoy paid |
| SendGrid | 100/día | API antigua |

Resend es lo más simple para 200-1000 usuarios.

## Workers — responsabilidad por dominio

### `router-worker` (entrypoint)
- Recibe TODOS los `https://api.mentisviva.cl/*`.
- Parse de path → delega vía service binding.
- CORS handling.
- Logging básico.
- Health check `/api/health`.

### `auth-worker`
**Endpoints:**
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/verify` (verify email token)
- `POST /api/auth/resend-verification`
- `POST /api/auth/forgot-password`
- `POST /api/auth/get-reset-question`
- `POST /api/auth/reset-password`
- `POST /api/auth/change-password` (auth required)
- `POST /api/auth/change-email/request` (auth required)
- `POST /api/auth/change-email/confirm`
- `POST /api/auth/change-security` (auth required)
- `GET /api/auth/check` (verify session)
- `POST /api/auth/logout-all` (auth required)

**Responsabilidades:**
- Hash passwords con `password_hash` equivalente (bcrypt via `node:crypto` o argon2).
- Emisión de cookie HttpOnly + Secure + SameSite=Strict.
- Rate limit por email + IP.
- Verificación reCAPTCHA en register/forgot.

### `pay-worker`
**Endpoints:**
- `POST /api/pay/subscribe` (auth required)
- `POST /api/pay/cancel` (auth required, soporta cancelación diferida)
- `POST /api/pay/undo-cancel` (auth required)
- `POST /api/pay/change-card` (auth required)
- `POST /api/pay/confirm-card-change` (callback de Flow)
- `POST /api/pay/refund` (admin only)
- `POST /api/pay/pause` (auth required)
- `POST /api/pay/resume` (auth required)
- `POST /api/pay/dispute` (auth required, ley 20.009)
- `POST /api/pay/callback` ⚠️ **público, recibe webhook Flow**
- `POST /api/pay/return` (return URL post-pago)

**Responsabilidades:**
- Verificación firma Flow (request y response).
- Idempotencia con `mv_payment_callbacks` UNIQUE.
- Validación de monto contra orden.
- Cancelación diferida si está en ventana locked.

### `shipping-worker`
**Endpoints:**
- `POST /api/shipping/quote` (auth required)
- `POST /api/shipping/save-preference` (auth required, con lock concurrente)
- `GET /api/shipping/preference` (auth required)
- `GET /api/shipping/cutoff-info`
- `POST /api/shipping/track` (auth required)
- `GET /api/shipping/comunas`

**Responsabilidades:**
- Llamadas Shipit con retry y fallback "retiro en editorial".
- Cálculo de cutoff dinámico (10 días hábiles antes del 25).
- Lock optimista vs concurrencia.

### `profile-worker`
**Endpoints:**
- `GET /api/profile/me` (auth)
- `PATCH /api/profile/update` (auth)
- `GET /api/profile/orders` (auth)
- `GET /api/profile/export` (auth) — Ley 21.719 derecho de portabilidad
- `POST /api/profile/request-deletion` (auth) — Ley 21.719 derecho al olvido
- `POST /api/profile/confirm-deletion`

### `admin-worker`
**Endpoints:**
- `POST /api/admin/login`
- `POST /api/admin/save` — actualizar `content.json`
- `POST /api/admin/publish`
- `GET /api/admin/subscribers`
- `GET /api/admin/subscribers/export.xlsx`
- `GET /api/admin/forms`
- `GET /api/admin/surveys`
- `POST /api/admin/upload` — upload imágenes a R2
- `GET /api/admin/audit-log`
- `POST /api/admin/refund/:orderId`

### `forms-worker`
**Endpoints:**
- `POST /api/forms/contact`
- `POST /api/forms/survey`
- `POST /api/forms/newsletter`

### `cron-worker` (scheduled)
**Crons:**
- `*/5 * * * *` — `processEmailQueue` (procesa 10 emails de `q-emails`)
- `0 * * * *` — `syncFlowSubscriptions` (reconcilia estados)
- `0 */6 * * *` — `cleanup` (sesiones expiradas, tokens viejos)
- `0 3 * * *` — `dailyTasks` (locks shipping, despierte de pausados, etc.)
- `0 3 * * 0` — `weeklyTasks` (rotar logs, archivar)

**Día del cutoff (calculado dinámicamente):**
- Encola en `q-charges` un mensaje por cada usuario activo.
- Consumer procesa cada mensaje (1 cobro Flow + INSERT order + queue email).

## Flujo crítico: cobro mensual

```
Día 12 (cutoff) 03:00 UTC
        │
        ▼
┌────────────────────┐
│ cron-worker fires  │
│ "monthlyCutoff"    │
└─────────┬──────────┘
          │
          │ SELECT users WHERE plan_status='active'
          ▼
┌────────────────────┐
│ Itera N usuarios   │
│ Encola en q-charges│
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Cloudflare Queue   │
│ (200 mensajes)     │
└─────────┬──────────┘
          │ 10 concurrentes
          ▼
┌────────────────────┐      ┌─────────────┐
│ q-charges consumer │ ──── │ Flow API    │
│ Por mensaje:       │      │ /sub/get    │
│  1. Get sub status │      └─────────────┘
│  2. INSERT order   │
│  3. UPDATE roster  │
│  4. queue email    │
│  5. audit log      │
│ Idempotente.       │
└─────────┬──────────┘
          │
          │ encola email
          ▼
┌────────────────────┐
│ q-emails           │
└─────────┬──────────┘
          │ procesa cada 5 min
          ▼
┌────────────────────┐
│ email consumer     │
│  → Resend API      │
└────────────────────┘
```

**Ventajas vs PHP cron actual:**

- Si Flow rate-limita uno, retry automático.
- Si un usuario falla, los otros 199 siguen.
- Observabilidad por mensaje en dashboard Cloudflare.
- Escala a 50.000+ sin tocar código.

## Flujo crítico: callback Flow

```
Flow.cl
   │ POST /api/pay/callback
   ▼
┌──────────────────────────┐
│ pay-worker.callback      │
│  1. Verify HMAC firma    │ ← rechaza si firma inválida (401)
│  2. Get payment status   │ ← /payment/getStatus en Flow
│  3. Verify response sig  │ ← rechaza si Flow miente
│  4. Match order          │ ← parse commerceOrder MV-N
│  5. Verify amount        │ ← compara con mv_orders.monto
│  6. INSERT OR IGNORE     │ ← idempotencia con UNIQUE
│     mv_payment_callbacks │
│  7. UPDATE order paid    │ ← solo si no estaba paid
│  8. UPDATE user verified │
│  9. queue welcome email  │
│ 10. forward to contable  │ ← async via q-webhooks
│ 11. respond 200 OK       │
└──────────────────────────┘
```

**Resuelve estos hallazgos críticos de la auditoría:**
- §1.4 Callback sin firma → ahora verifica.
- §1.4 Monto no validado → ahora compara.
- §1.4 Idempotencia → UNIQUE constraint.
- §1.4 Forward sin retry → q-webhooks con backoff.

## Bindings de Cloudflare

Cada Worker declara qué recursos usa en `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mentisviva"
database_id = "xxx"

[[kv_namespaces]]
binding = "KV"
id = "xxx"

[[r2_buckets]]
binding = "R2"
bucket_name = "mentisviva-uploads"

[[queues.producers]]
binding = "Q_CHARGES"
queue = "q-charges"

[[queues.consumers]]
queue = "q-charges"
max_batch_size = 10
max_concurrency = 5
```

En código TypeScript se accede vía `env.DB`, `env.KV`, `env.R2`, `env.Q_CHARGES`.

Tipos en `src/types/env.ts` para autocompletado.

## Seguridad por construcción

| Hallazgo de auditoría | Solución arquitectónica |
|---|---|
| Secretos en config.php | `wrangler secret put` (cifrado en repo Cloudflare) |
| Token en localStorage | Cookie HttpOnly + Secure emitida por Worker |
| Token en query string | Cookie automática, nunca en URL |
| Callback Flow sin firma | `lib/flow.ts::verifyFlowSignature` obligatorio |
| Idempotencia | UNIQUE en `mv_payment_callbacks` + `INSERT OR IGNORE` |
| Rate limiting solo IP | KV con clave `email+ip` |
| Timing attack login | `crypto.timingSafeEqual` + dummy hash |
| innerHTML XSS | Pages sirve estático, JS solo lee API JSON |
| install.php expuesto | No existe en Workers |
| Logs con datos sensibles | `lib/audit.ts` sanitiza antes de escribir |

## Latencia esperada

| Operación | V2Networks | Cloudflare full-stack |
|---|---|---|
| Carga `editorial.html` | 200-400ms | <50ms (Pages edge) |
| Login | 300-500ms | 50-100ms |
| API `/api/profile/me` | 200-400ms | 30-80ms |
| Callback Flow | varía | 20-60ms |
| Cron del cutoff (200 users) | 30-90s | 30-60s (paralelo) |

## Lecturas siguientes

- `02_PLAN_FASES.md` — orden de implementación.
- `03_INVENTARIO_ENDPOINTS.md` — mapeo PHP → Worker.
- `09_CORRELACION_AUDITORIA.md` — qué hallazgo se resuelve dónde.
