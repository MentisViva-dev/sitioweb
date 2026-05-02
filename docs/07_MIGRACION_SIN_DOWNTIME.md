# Migración sin downtime

Estrategia: **strangler fig pattern** — Cloudflare convive con V2Networks hasta el cutover final.

## Estados de transición

```
T0 (hoy):        V2Networks 100% del tráfico.
T1 (semana 1):   Cloudflare Workers en staging (api-staging.mentisviva.cl). V2Networks sigue 100%.
T2 (semana 2):   Cloudflare API en producción (api.mentisviva.cl). Frontend V2Networks llama API CF.
T3 (semana 3):   Cloudflare Pages reemplaza frontend público (mentisviva.cl). V2Networks sólo /cuenta.html y /unidos.html.
T4 (semana 4):   Cloudflare 100%. V2Networks apagado.
```

## Migración de datos MySQL → D1

1. Exportar dump MySQL desde V2Networks: `mysqldump -u user -p mentisvi_editorial > backup.sql`.
2. Convertir a SQLite con script `scripts/migrate_mysql_to_d1.mjs` (TODO: generar este script).
3. Importar a D1: `wrangler d1 execute mentisviva --file=mysql_export.sql --remote`.

## Rollback en cada fase

| Fase | Cómo revertir |
|---|---|
| T1→T0 | No hay nada que revertir (staging aislado). |
| T2→T1 | Cambiar registro DNS de api.mentisviva.cl a V2Networks. TTL bajo (300s) acelera. |
| T3→T2 | Cambiar A record de mentisviva.cl a V2Networks. |
| T4→T3 | Re-encender V2Networks (mantener 30 días post-cutover). |

## Checklist pre-cutover

- [ ] Datos en D1 verificados (count usuarios, órdenes, etc.).
- [ ] Endpoints de Workers responden 200 en api-staging.
- [ ] Flow callback funcionando con sandbox.
- [ ] Email Resend enviando.
- [ ] Cron monthly_cutoff probado en staging.
- [ ] Backups de MySQL guardados externamente.
