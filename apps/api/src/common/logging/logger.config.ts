import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';
import { uuidv7 } from 'uuidv7';

const SENSITIVE_KEYS = ['mobile', 'nationalId', 'sheba', 'password', 'currentPassword', 'newPassword', 'token'];

/** Redaction paths: headers + sensitive keys at the first few nesting levels. */
export const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`, `*.*.*.${k}`]),
];

export function loggerParams(level: string, pretty: boolean): Params {
  return {
    pinoHttp: {
      level,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      genReqId: (req: IncomingMessage & { id?: unknown }) => (typeof req.id === 'string' ? req.id : uuidv7()),
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => req.url === '/api/healthz' || req.url === '/api/metrics' },
      serializers: {
        req: (req: { id: unknown; method: unknown; url: unknown }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: unknown }) => ({ statusCode: res.statusCode }),
      },
      ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
    },
  };
}
