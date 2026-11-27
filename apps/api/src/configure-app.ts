import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { ClockService } from './common/clock/clock.service';
import { requestContextMiddleware } from './common/context/request-context';
import { mapError } from './common/errors/error-mapping';
import { MetricsService } from './modules/ops/metrics.service';

const JSON_LIMIT = '1mb';
/** Only proxies on loopback / private networks (nginx) may set X-Forwarded-For. */
const TRUSTED_PROXIES = ['loopback', 'linklocal', 'uniquelocal'];

/** Errors raised by Express middleware (e.g. malformed JSON) never reach Nest filters. */
function middlewareErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(err);
  const mapped = mapError(err);
  res.status(mapped.status).json(mapped.body);
}

/**
 * Applies HTTP-level hardening and cross-cutting middleware. Shared by main.ts and tests.
 * The app must be created with `{ bodyParser: false }`.
 */
export function configureApp(app: NestExpressApplication): void {
  const clock = app.get(ClockService);
  const metrics = app.get(MetricsService);

  app.set('trust proxy', TRUSTED_PROXIES);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { defaultSrc: ["'self'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      frameguard: { action: 'deny' },
    }),
  );
  app.use(requestContextMiddleware);
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Server-Time', clock.now().toISOString());
    next();
  });
  app.use(metrics.middleware());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: JSON_LIMIT });
  app.use(middlewareErrorHandler);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
}
