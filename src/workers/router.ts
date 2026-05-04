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

    // Public content endpoint — sirve el último content.json publicado por el CMS.
    // El sitio público (mentisviva.cl) hace fetch a esto en vez de al estático Pages,
    // así los cambios desde /unidos llegan inmediatamente sin redeploy.
    if (url.pathname === '/api/content' && request.method === 'GET') {
      return withCors(await adminWorker.handleGetPublicContent(env), env, origin);
    }

    // R2 static asset serving — sirve uploads del CMS desde el bucket R2
    // Patrón: GET /r2/<key> → env.R2.get(key) con cache-control inmutable.
    // Sólo GET/HEAD; resto retorna 405. Sin auth (uploads son públicos por diseño).
    if (url.pathname.startsWith('/r2/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      const key = decodeURIComponent(url.pathname.slice('/r2/'.length));
      if (!key || key.includes('..')) {
        return new Response('Not Found', { status: 404 });
      }
      const obj = await env.R2.get(key);
      if (!obj) {
        return new Response('Not Found', { status: 404 });
      }
      const headers = new Headers();
      // Workers R2 .writeHttpMetadata espera el tipo Headers de @cloudflare/workers-types,
      // que difiere del DOM Headers. Cast a unknown para puentear ambos.
      obj.writeHttpMetadata(headers as unknown as Parameters<typeof obj.writeHttpMetadata>[0]);
      headers.set('etag', obj.httpEtag);
      if (!headers.has('cache-control')) {
        headers.set('cache-control', 'public, max-age=31536000, immutable');
      }
      headers.set('access-control-allow-origin', '*');
      const body = request.method === 'HEAD' ? null : (obj.body as unknown as BodyInit);
      return new Response(body, { headers });
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
