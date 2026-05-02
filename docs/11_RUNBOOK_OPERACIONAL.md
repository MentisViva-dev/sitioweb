# Runbook Operacional

Qué hacer cuando algo pasa en producción.

## Alertas

| Síntoma | Dónde mirar | Acción |
|---|---|---|
| API responde 500 | dash.cloudflare.com → Workers → Logs | Buscar stack trace, push fix |
| Callback Flow falla | mv_audit_log filtro `payment.callback.*` | Revisar firma, monto |
| Cobros no se procesan | Q_CHARGES en dashboard Queues | Ver mensajes en DLQ |
| Email no llega | Resend dashboard → Emails | Verificar dominio + bounces |
| D1 lento | dash.cloudflare.com → D1 → Performance | Ver queries lentos |

## Comandos útiles (vía GitHub Actions, sin instalar wrangler)

Usa workflow `Run wrangler command` (a crear si quieres):

```bash
# Ver logs en vivo
wrangler tail mentisviva-api

# Query D1
wrangler d1 execute mentisviva --remote --command "SELECT COUNT(*) FROM mv_users"

# Listar secrets
wrangler secret list

# Re-deploy
wrangler deploy
```

## Incidentes comunes

### Pago duplicado reportado
1. Verificar en `mv_payment_callbacks` que solo hay 1 registro por flow_token.
2. Si hay 2: bug. Reportar.
3. Si hay 1: reportar al usuario que el cobro fue único, mostrar mv_orders.

### Usuario no recibe caja del mes
1. Verificar `mv_shipment_roster` para `user_id + shipment_month`.
2. Si `status = 'skipped'`: cancelación a destiempo (revisar §2.5).
3. Si `status = 'queued'`: el cron build_roster no llegó a despacharlo. Marcarlo manualmente.

### Login fallando masivamente
1. Verificar status Cloudflare: status.cloudflare.com.
2. Verificar D1 está respondiendo: `/api/health`.
3. Verificar que `MV_TOKEN_SECRET` no fue rotado sin avisar.

### "Token inválido" en producción tras deploy
1. Si rotaste `MV_TOKEN_SECRET`, todas las sesiones se invalidan. Avisar usuarios.
2. Si no lo rotaste pero pasa: posible conflicto de Worker version. Re-deploy.

## Backups

- D1 hace snapshots diarios automáticos (retención 30 días). Recuperación: dashboard.
- Para backup manual: workflow `Run wrangler command` → `wrangler d1 export mentisviva --output backup.sql`.
- Subir backup a R2 nightly (TODO: cron).

## Rotación de secrets

Cada 6 meses rotar:
- `MV_TOKEN_SECRET` (invalida sesiones — coordinar)
- `MV_FLOW_SECRET` (rotar también en Flow.cl)
- `MV_RECAPTCHA_SECRET` (rotar también en Google)

Cargar nuevo en GitHub Secrets, correr workflow `Seed Cloudflare Secrets`, deploy.
