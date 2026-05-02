# MentisViva — Cloudflare Full-Stack

Reescritura completa del backend PHP/MySQL a Cloudflare Workers + D1 + R2 + KV + Queues + Pages.

## Estructura

```
cloudflare-fullstack/
├── README.md
├── INSTRUCCIONES_FINALES.md           ← guion paso a paso
├── docs/                              ← documentación arquitectónica
├── migrations/                        ← schema D1 + seed
├── src/
│   ├── lib/                           ← biblioteca compartida
│   ├── workers/                       ← workers por dominio
│   └── types/                         ← tipos TypeScript
├── tests/                             ← tests unitarios
├── .github/workflows/                 ← CI/CD GitHub Actions
├── wrangler.toml                      ← config Cloudflare
├── package.json
└── tsconfig.json
```

## Workers desplegados

- `mentisviva-api` — Worker principal con router + 7 sub-workers (auth, pay, shipping, profile, admin, forms, cron)

## Recursos Cloudflare

| Recurso | Nombre / ID |
|---|---|
| D1 Database | `mentisviva` (`a93215e2-64ad-42f1-8629-d9a6e173c615`) |
| KV `MV_KV` | `5e7c1e001cd84248bf31323afd65118b` |
| KV `MV_KV_RATE_LIMIT` | `164ce74e094e41e98904c9e9315580fa` |
| KV `MV_KV_CACHE` | `1b4d6c74c32a4dd98e57709ede9cb9d5` |
| R2 Bucket | `mentisviva-uploads` |
| Queues | `q-charges`, `q-emails`, `q-webhooks` (+ DLQs) |

## Stack y costos

| Capa | Tecnología | Costo a 200 usuarios |
|---|---|---|
| Frontend público | Cloudflare Pages | $0 |
| API + lógica | Cloudflare Workers (TypeScript) | $5/mes |
| Base de datos | Cloudflare D1 (SQLite) | $0 |
| Storage imágenes | Cloudflare R2 | $0 |
| Cache + sesiones | Cloudflare KV | $0 |
| Colas async | Cloudflare Queues | $0 (incluido) |
| CDN + WAF + DDoS | Cloudflare (free) | $0 |
| Email outbound | Resend | $0 (free 3k/mes) |
| Dominio | mentisviva.cl | ~$1/mes |
| **TOTAL** | | **~$6/mes** |

## Lo que resuelve esta migración

- ✅ 95 hallazgos de seguridad y lógica de la auditoría.
- ✅ DX moderno: `git push` → live en 60s vía GitHub Actions.
- ✅ Latencia <50ms global.
- ✅ 99.99% uptime.
- ✅ Auto-escalado serverless.
- ✅ Cumplimiento legal Chile: Ley 19.496, 19.628, 21.719, 20.009, 21.459.

## Comandos útiles

```bash
# Desarrollo local
npm run dev

# Tests
npm test

# Type check
npm run typecheck

# Deploy producción
npm run deploy

# Logs en vivo
npm run tail

# Aplicar migración a D1
npm run db:migrate

# Console D1 directa
npm run db:console "SELECT COUNT(*) FROM mv_users"
```

## Documentación

- `docs/01_ARQUITECTURA.md` — diagramas y decisiones técnicas.
- `docs/02_PLAN_FASES.md` — cronograma de migración.
- `docs/07_MIGRACION_SIN_DOWNTIME.md` — strangler pattern.
- `docs/08_COSTO_PROYECTADO.md` — costos por escala.
- `docs/09_CORRELACION_AUDITORIA.md` — qué hallazgo se resuelve dónde.
- `docs/10_SETUP_INICIAL.md` — checklist setup.
- `docs/11_RUNBOOK_OPERACIONAL.md` — runbook de incidentes.
- `INSTRUCCIONES_FINALES.md` — guion paso a paso para deploy.

## CI/CD

Los workflows en `.github/workflows/` se ejecutan automáticamente:

- `deploy.yml` — push a `main` → deploy automático a Cloudflare.
- `setup-resources.yml` — manual, crea D1/KV/R2/Queues (ya ejecutado).
- `seed-secrets.yml` — manual, carga secrets a Cloudflare.
- `seed-content.yml` — manual, importa content.json del CMS viejo.

## Licencia

Propiedad de MentisViva — Editorial y Fundación.
