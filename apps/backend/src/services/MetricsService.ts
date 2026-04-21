import { NextFunction, Request, Response } from 'express';
import client from 'prom-client';

class MetricsService {
  private readonly registry = new client.Registry();
  private readonly httpRequestDuration = new client.Histogram({
    name: 'app_http_request_duration_ms',
    help: 'Duración de requests HTTP en milisegundos',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [this.registry]
  });

  private readonly outboxProcessed = new client.Counter({
    name: 'app_outbox_messages_total',
    help: 'Mensajes de outbox procesados por resultado',
    labelNames: ['type', 'result'] as const,
    registers: [this.registry]
  });

  private readonly paymentsCreated = new client.Counter({
    name: 'app_payments_created_total',
    help: 'Pagos creados',
    labelNames: ['source', 'method'] as const,
    registers: [this.registry]
  });

  private readonly schedulerRuns = new client.Counter({
    name: 'app_scheduler_runs_total',
    help: 'Ejecuciones del scheduler por resultado',
    labelNames: ['job', 'result'] as const,
    registers: [this.registry]
  });

  constructor() {
    this.registry.setDefaultLabels({
      service: 'backend'
    });
    client.collectDefaultMetrics({ register: this.registry });
  }

  middleware = (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      this.httpRequestDuration.observe(
        {
          method: req.method,
          route: req.route?.path || req.path || 'unknown',
          status_code: String(res.statusCode)
        },
        elapsedMs
      );
    });

    next();
  };

  async render() {
    return this.registry.metrics();
  }

  getContentType() {
    return this.registry.contentType;
  }

  recordOutbox(type: string, result: 'sent' | 'failed') {
    this.outboxProcessed.inc({ type, result });
  }

  recordPayment(source: string, method: string) {
    this.paymentsCreated.inc({ source, method });
  }

  recordSchedulerRun(job: string, result: 'success' | 'error' | 'skipped') {
    this.schedulerRuns.inc({ job, result });
  }
}

export const metricsService = new MetricsService();
