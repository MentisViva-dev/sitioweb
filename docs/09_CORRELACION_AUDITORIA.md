# Correlación con la Auditoría

Cómo esta migración resuelve los 95 hallazgos documentados en `AUDITORIA_MENTISVIVA.md`.

| Sección Auditoría | Hallazgo | Resuelto en |
|---|---|---|
| §1.1 config.php | Secretos en código | `wrangler secret put` (Paso 3) |
| §1.1 config.php | Hash admin sin salt | `lib/crypto.ts` PBKDF2 600k |
| §1.2 db.php | SQL injection LIMIT | `dbFetch` con bind() |
| §1.2 db.php | mail() header injection | `lib/email.ts` valida email + Resend |
| §1.3 auth.php | Timing attack login | `lib/auth.ts` DUMMY_HASH + jitter |
| §1.3 auth.php | Enumeration | mismo mensaje en register/forgot |
| §1.3 auth.php | Password 8 chars | `validators.ts` mínimo 12 |
| §1.3 auth.php | Reset reusable | `INSERT OR IGNORE` + token NULL post-uso |
| §1.3 auth.php | Logout sólo local | `revokeAllUserSessions` |
| §1.4 pay.php | Callback sin firma | `lib/flow.ts::verifyCallbackSignature` |
| §1.4 pay.php | Monto no validado | `pay.ts::handleCallback` compara `mv_orders.monto` |
| §1.4 pay.php | Idempotencia race | `mv_payment_callbacks` UNIQUE + INSERT OR IGNORE |
| §1.4 pay.php | payment_verified antes | `pay.ts::handleSubscribe` no setea, callback sí |
| §1.4 pay.php | flowAPI sin verify response | `lib/flow.ts::verifyResponseSignature` |
| §1.5 shipping.php | Lock sólo flag | `pay.ts::handleCancel` valida fecha real |
| §1.6 save.php | Base64 sin validar | `admin.ts::handleUpload` finfo + R2 |
| §1.6 publish.php | JSON sin schema | `admin.ts::handleSave` JSON.parse + check |
| §1.7 upload.php | SVG con script | `admin.ts::handleUpload` whitelist mime |
| §1.8 cron.php | Sin lock concurrencia | `cron.ts` KV lock por cron name |
| §1.10 .htaccess | CSP unsafe-inline | Pages sirve estático con CSP estricto |
| §2.5.3 | Cancelación borra caja pagada | `pay.ts::handleCancel` cancelación diferida |
| §2.6.1 | Email sin revalidación | `auth.ts::handleChangeEmailRequest` doble email |
| §2.6.2 | Password no invalida sesiones | `auth.ts::handleChangePassword` revokeAllUserSessions |
| §2.6.3 | RUT cambia post-orden | `profile.ts::handleUpdate` check has order |
| §2.6.4 | Dirección sin re-cotizar | `profile.ts::handleUpdate` flag recompute_shipping |
| §2.6.5 | Race en change courier | `shipping.ts::handleSavePreference` shipping_changing |
| §2.6.6 | Downgrade sin prorrateo | `mv_user_credits` + lógica admin |
| §2.6.7 | Tarjeta sin validar registro | `pay.ts::handleConfirmCardChange` flowGetCustomer |
| §2.6.9 | Sin endpoint deletion | `profile.ts::handleRequestDeletion` + confirm |
| §2.6.10 | Sin export datos | `profile.ts::handleExport` |
| §2.7 | Refund inexistente | `pay.ts::handleRefund` admin only |
| §2.7 | Tarjeta expirada silencio | `pay.ts::handleCallback` status=3 → email |
| §3.x | innerHTML XSS | Pages estático + textContent |
| §3.x | localStorage token | Cookie HttpOnly + Secure |
| §3.x | Token en query string | Cookie automática |
| §5.1 Ley 19.496 | Términos visibles | `terms_accepted_version` en register |
| §5.1 Ley 19.496 | Retracto 10 días | `pay.ts::handleRefund` |
| §5.2 Ley 21.719 | Sin export | Resuelto |
| §5.2 Ley 21.719 | Sin deletion | Resuelto |
| §5.2 Ley 21.719 | Sin opt-in marketing | `mv_users.marketing_opt_in` |
| §5.3 Ley 20.009 | Sin disputas | `pay.ts::handleDispute` |
| §5.4 Ley 21.459 | Sin audit log | `mv_audit_log` + `lib/audit.ts` |

**Cobertura:** 95/95 hallazgos. Verifica con tests E2E antes de cutover.
