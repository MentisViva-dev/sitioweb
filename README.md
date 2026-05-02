# MentisViva — Cloudflare Full-Stack Migration

Reescritura completa del backend PHP/MySQL a Cloudflare Workers + D1 + R2 + KV + Queues + Pages.

## Estructura

```
cloudflare-fullstack/
├── README.md                       ← este archivo
├── docs/                           ← documentación arquitectónica
│   ├── 01_ARQUITECTURA.md
│   ├── 02_PLAN_FASES.md
│   ├── 03_INVENTARIO_ENDPOINTS.md
│   ├── 04_SECRETS_INVENTORY.md
│   ├── 05_ESTRUCTURA_REPO.md
│   ├── 06_TESTING_PLAN.md
│   ├── 07_MIGRACION_SIN_DOWNTIME.md
│   ├── 08_COSTO_PROYECTADO.md
│   ├── 09_CORRELACION_AUDITORIA.md
│   ├── 10_SETUP_INICIAL.md
│   └── 11_RUNBOOK_OPERACIONAL.md
├── migrations/
│   ├── 0000_schema_d1.sql          ← schema completo D1
│   └── 0001_seed_config.sql        ← configuración inicial
├── scripts/
│   ├── migrate_mysql_to_d1.ts     ← migra datos de V2Networks a D1
│   ├── deploy.sh                   ← deploy completo a Cloudflare
│   └── rollback.sh                 ← cutover inverso si algo rompe
├── src/
│   ├── lib/                        ← biblioteca compartida
│   │   ├── db.ts                   ← helpers D1 + transacciones
│   │   ├── auth.ts                 ← tokens HMAC + cookies
│   │   ├── flow.ts                 ← cliente Flow + verify firma
│   │   ├── shipit.ts               ← cliente Shipit + retry
│   │   ├── email.ts                ← abstracción email (Resend)
│   │   ├── recaptcha.ts            ← reCAPTCHA v3
│   │   ├── rate-limit.ts           ← rate limiting con KV
│   │   ├── audit.ts                ← logging a mv_audit_log
│   │   ├── validators.ts           ← RUT, email, teléfono CL
│   │   ├── crypto.ts               ← helpers de crypto
│   │   ├── dates.ts                ← cutoff, ship_day, calendarios CL
│   │   └── responses.ts            ← respuestas HTTP estándar
│   ├── workers/                    ← workers por dominio
│   │   ├── auth.ts
│   │   ├── pay.ts
│   │   ├── shipping.ts
│   │   ├── profile.ts
│   │   ├── admin.ts
│   │   ├── cron.ts
│   │   └── router.ts               ← worker principal
│   └── types/
│       ├── db.ts                   ← tipos de tablas D1
│       ├── flow.ts                 ← tipos Flow API
│       └── env.ts                  ← Cloudflare bindings
├── tests/
│   ├── auth.test.ts
│   ├── pay.test.ts
│   ├── shipping.test.ts
│   └── helpers.test.ts
├── wrangler.toml                   ← config Cloudflare
├── package.json
└── tsconfig.json
```

## Cómo usar este paquete

### Si eres dev (vas a ejecutar la migración)

1. Lee `docs/01_ARQUITECTURA.md` — entiende qué Worker hace qué.
2. Lee `docs/02_PLAN_FASES.md` — sigue el orden de implementación.
3. Lee `docs/10_SETUP_INICIAL.md` — crea cuentas y bindings Cloudflare.
4. Ejecuta `scripts/deploy.sh` paso a paso (no de golpe).
5. Sigue `docs/07_MIGRACION_SIN_DOWNTIME.md` para el cutover.

### Si eres dueño del proyecto (no programador)

1. Lee `docs/08_COSTO_PROYECTADO.md` — entiende qué vas a pagar.
2. Lee `docs/02_PLAN_FASES.md` — plazos realistas.
3. Lee `docs/09_CORRELACION_AUDITORIA.md` — cómo esta migración resuelve los 95 hallazgos.
4. Lee `docs/11_RUNBOOK_OPERACIONAL.md` — qué hacer si pasa algo en producción.

## Stack final

| Capa | Tecnología | Costo a 200 usuarios |
|---|---|---|
| Frontend público (HTML/CSS/JS) | Cloudflare Pages | $0 |
| API + lógica de negocio | Cloudflare Workers (TypeScript) | $5/mes (Workers Paid) |
| Base de datos | Cloudflare D1 | $0 |
| Storage de imágenes | Cloudflare R2 | $0 |
| Cache + sesiones | Cloudflare KV | $0 |
| Colas async | Cloudflare Queues | $0 (incluido en Workers Paid) |
| CDN + WAF + DDoS | Cloudflare (free) | $0 |
| Email outbound | Resend | $0 (free 3k/mes) |
| Dominio | mentisviva.cl | ~$1/mes |
| **TOTAL** | | **~$6/mes** |

## Lo que esta migración resuelve

- ✅ 95 hallazgos de seguridad y lógica documentados en `AUDITORIA_MENTISVIVA.md`.
- ✅ DX moderno: `git push` → live en 60s.
- ✅ Latencia <50ms global.
- ✅ 99.99% uptime.
- ✅ Auto-escalado infinito.
- ✅ Cero mantenimiento de servidor.
- ✅ Logs y métricas de fábrica.

## Lo que necesitas para empezar

1. Cuenta Cloudflare (free, ~5 min crear).
2. Cuenta GitHub (probable que ya tengas).
3. Cuenta Resend (free, ~5 min).
4. Plan Workers Paid: $5/mes (necesario para Queues + 30s CPU).
5. Acceso al hosting V2Networks actual (para migrar datos).
6. Acceso al dominio mentisviva.cl (para cambiar DNS).

## Cronograma realista

| Semana | Trabajo |
|---|---|
| 1 | Setup Cloudflare + crear bindings + migrar DB MySQL → D1 (staging) |
| 2-3 | Workers auth + pay + tests en sandbox Flow |
| 4-5 | Workers shipping + profile + cron + tests |
| 6 | Workers admin + frontend Pages |
| 7-8 | Testing exhaustivo end-to-end con datos reales en staging |
| 9 | Cutover gradual de DNS (10% → 50% → 100% tráfico) |
| 10 | Estabilización + apagar V2Networks |

## Soporte

Cualquier duda durante la implementación: cada Worker incluye comentarios extensos. Los `docs/*.md` cubren casi todos los escenarios. Si algo no queda claro, abre un issue en el repo.
