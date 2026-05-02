# Plan de Fases

| Fase | Duración | Riesgo | Reversible |
|---|---|---|---|
| 1. Setup Cloudflare | 1 día | Bajo | Sí (no toca prod aún) |
| 2. Deploy Workers en staging | 2 días | Bajo | Sí |
| 3. Migración datos MySQL → D1 | 1 día | Medio | Sí (D1 separado) |
| 4. Testing Flow sandbox | 3 días | Medio | Sí |
| 5. Pages frontend en preview | 1 día | Bajo | Sí |
| 6. Cutover api.mentisviva.cl | 1 día | Alto | Sí (revertir DNS) |
| 7. Cutover mentisviva.cl | 1 día | Alto | Sí (revertir DNS) |
| 8. Estabilización + apagar V2Networks | 1 sem | Medio | Parcial |

**Total realista:** 2-3 semanas calendar.

Sigue el orden de `INSTRUCCIONES_FINALES.md` exactamente. No saltes pasos.
