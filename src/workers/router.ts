/**
 * Router Worker — entrypoint de api.mentisviva.cl
 *
 * Recibe TODOS los requests y delega a sub-Workers vía service bindings.
 * Maneja CORS, health, 404, observabilidad básica.
 */

import type { Env, ExecutionContext, ChargeJobPayload, EmailJobPayload, WebhookJobPayload } from '../types/env';
import { jsonOk, withCors, corsPreflightResponse, Errors } from '../lib/responses';
import { dbHealthCheck } from '../lib/db';
import * as authWorker from './auth';
import * as payWorker from './pay';
import * as shippingWorker from './shipping';
import * as profileWorker from './profile';
import * as adminWorker from './admin';
import * as adminShippingWorker from './admin-shipping';
import * as formsWorker from './forms';
import * as cronWorker from './cron';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return corsPreflightResponse(env, origin);
    }

    // Health check (público)
    if (url.pathname === '/api/health') {
      const dbOk = await dbHealthCheck(env.DB);
      return withCors(
        jsonOk({ env: env.ENVIRONMENT, db: dbOk, time: new Date().toISOString() }),
        env, origin,
      );
    }

    // Routing por prefijo de path
    let response: Response;
    try {
      if (url.pathname.startsWith('/api/auth/')) {
        response = await authWorker.handle(request, env, ctx);
      } else if (url.pathname.startsWith('/api/pay/')) {
        response = await payWorker.handle(request, env, ctx);
      } else if (url.pathname.startsWith('/api/shipping/')) {
        response = await shippingWorker.handle(request, env, ctx);
      } else if (url.pathname.startsWith('/api/profile/')) {
        response = await profileWorker.handle(request, env, ctx);
      } else if (url.pathname.startsWith('/api/admin/shipping/')) {
        response = await adminShippingWorker.handle(request, env, ctx);
      } else if (url.pathname.startsWith('/api/admin/')) {
        response = await adminWorker.handle(request, env, ctx);
      } else if (url.pathname.startsWith('/api/forms/')) {
        response = await formsWorker.handle(request, env, ctx);
      } else {
        response = Errors.notFound('Ruta');
      }
    } catch (err) {
      console.error('[router] uncaught', err);
      response = Errors.internal();
    }

    return withCors(response, env, origin);
  },

  /** Cron Triggers — invoca cron-worker. */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    return cronWorker.scheduled(event, env, ctx);
  },

  /** Queues consumer — recibe mensajes de Q_CHARGES, Q_EMAILS, Q_WEBHOOKS. */
  async queue(
    batch: MessageBatch<ChargeJobPayload | EmailJobPayload | WebhookJobPayload>,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    return cronWorker.queueConsumer(batch, env, ctx);
  },
};
