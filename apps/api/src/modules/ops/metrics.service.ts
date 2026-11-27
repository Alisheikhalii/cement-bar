import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  private readonly httpDuration: Histogram<'method' | 'route' | 'status'>;

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'cb_' });
    this.httpDuration = new Histogram({
      name: 'cb_http_request_duration_seconds',
      help: 'HTTP request duration',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
  }

  /** Express middleware recording request latency by matched route (low cardinality). */
  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      const end = this.httpDuration.startTimer();
      res.on('finish', () => {
        const route = (req.route as { path?: string } | undefined)?.path ?? 'unmatched';
        end({ method: req.method, route: `${req.baseUrl}${route}`, status: String(res.statusCode) });
      });
      next();
    };
  }
}
