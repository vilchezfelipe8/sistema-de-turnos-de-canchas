import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import cookieParser from 'cookie-parser';
import QRCode from 'qrcode';

import { requestContextMiddleware } from './middleware/requestContext';
import { baseLogger } from './utils/logger';
import bookingRoutes from './routes/BookingRoutes';
import CourtRoutes from './routes/CourtRoutes';
import ClubRoutes from './routes/ClubRoutes';
import ClubAdminRoutes from './routes/ClubAdminRoutes';
import LocationRoutes from './routes/LocationRoutes';
import authRoutes from './routes/AuthRoutes';
import ClientRoutes from './routes/ClientRoutes';
import HealthRoutes from './routes/HealthRoutes';
import CashRoutes from './routes/CashRoutes';
import CashRegisterRoutes from './routes/CashRegisterRoutes';
import CashShiftRoutes from './routes/CashShiftRoutes';
import AccountRoutes from './routes/AccountRoutes';
import NotificationRoutes from './routes/NotificationRoutes';
import EventRoutes from './routes/EventRoutes';
import AuditLogRoutes from './routes/AuditLogRoutes';
import CourtPriceRuleRoutes from './routes/CourtPriceRuleRoutes';
import PaymentRoutes from './routes/PaymentRoutes';
import ClubReviewRoutes from './routes/ClubReviewRoutes';
import MeRoutes from './routes/MeRoutes';
import IntegrationRoutes from './routes/IntegrationRoutes';
import WebhookRoutes from './routes/WebhookRoutes';

import { errorHandler } from './middleware/ErrorHandler';
import { authMiddleware } from './middleware/AuthMiddleware';
import { csrfProtection } from './middleware/CsrfMiddleware';
import { requireGlobalRole } from './middleware/RoleMiddleware';
import { prisma } from './prisma';
import { metricsService } from './services/MetricsService';
import { RedisService } from './services/RedisService';
import { WhatsappDeliveryService } from './services/WhatsappDeliveryService';
import { authConfig } from './utils/authConfig';

const isProduction = process.env.NODE_ENV === 'production';
const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001'
];

const getAllowedOrigins = () => {
  const fromEnv = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [];
  const frontendOrigin = String(process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  const base = isProduction ? [] : defaultAllowedOrigins;
  const resolved = Array.from(new Set([...base, ...fromEnv, ...(frontendOrigin ? [frontendOrigin] : [])]));
  if (isProduction && resolved.length === 0) {
    throw new Error('CORS misconfigured: set ALLOWED_ORIGINS and/or FRONTEND_URL in production.');
  }
  return resolved;
};

export const createApp = () => {
  const app = express();
  const whatsappDelivery = new WhatsappDeliveryService();
  const allowedOrigins = getAllowedOrigins();
  type RequestWithId = Request & { requestId?: string; id?: string };

  if (authConfig.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  }));

  app.use(requestContextMiddleware);
  app.use(pinoHttp({
    logger: baseLogger,
    serializers: {
      req: (req) => {
        const rawUrl = typeof req.url === 'string' ? req.url : '';
        const [path] = rawUrl.split('?');
        return {
          id: (req as RequestWithId).id,
          method: req.method,
          path
        };
      },
      res: (res) => ({
        statusCode: res.statusCode
      })
    },
    genReqId: (req) => {
      const requestId = (req as RequestWithId).requestId;
      if (requestId) return requestId;
      const headerReqId = req.header('x-request-id');
      if (headerReqId) return headerReqId;
      return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    },
    customSuccessMessage: (req, res) => `${req.method} ${req.path} ${res.statusCode}`,
    customErrorMessage: (req, _res, err) => `Error ${req.method} ${req.path}: ${err?.message}`,
  }));

  app.use(cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        baseLogger.warn({ origin, allowedOrigins }, 'CORS bloqueado');
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Cache-Control',
      'Pragma',
      'Expires',
      'X-CSRF-Token',
      'X-Active-Club-Id',
      'X-Club-Id',
      'Idempotency-Key'
    ]
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
  app.use(cookieParser());
  app.use(csrfProtection);
  app.use(metricsService.middleware);

  app.use('/api/auth', authRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/courts', CourtRoutes);
  app.use('/api/clubs', ClubRoutes);
  app.use('/api/clubs', ClubReviewRoutes);
  app.use('/api/clubs', ClubAdminRoutes);
  app.use('/api/locations', LocationRoutes);
  app.use('/api/health', HealthRoutes);
  app.use('/api/cash', CashRoutes);
  app.use('/api/cash-registers', CashRegisterRoutes);
  app.use('/api/cash-shifts', CashShiftRoutes);
  app.use('/api/accounts', AccountRoutes);
  app.use('/api/notifications', NotificationRoutes);
  app.use('/api/events', EventRoutes);
  app.use('/api/audit-logs', AuditLogRoutes);
  app.use('/api/court-price-rules', CourtPriceRuleRoutes);
  app.use('/api/payments', PaymentRoutes);
  app.use('/api/clients', ClientRoutes);
  app.use('/api/me', MeRoutes);
  app.use('/api', IntegrationRoutes);
  app.use('/api', WebhookRoutes);

  app.get('/', (_req: Request, res: Response) => {
    res.json({ message: 'API Sistema de Turnos' });
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/livez', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/readyz', async (_req: Request, res: Response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      if (RedisService.enabled()) {
        await RedisService.getClient();
      }

      return res.status(200).json({ status: 'ready' });
    } catch (error: unknown) {
      return res.status(503).json({
        status: 'not_ready',
        error: error instanceof Error ? error.message : 'Dependency check failed'
      });
    }
  });

  app.get('/metrics', async (req: Request, res: Response) => {
    const expectedToken = process.env.METRICS_TOKEN?.trim();
    if (!expectedToken) {
      return res.status(503).json({ error: 'Metrics endpoint disabled: METRICS_TOKEN is required' });
    }

    const authHeader = req.header('Authorization');
    if (authHeader !== `Bearer ${expectedToken}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    res.setHeader('Content-Type', metricsService.getContentType());
    res.send(await metricsService.render());
  });

  app.get(
    '/whatsapp/qr',
    authMiddleware,
    requireGlobalRole('ADMIN'),
    async (_req: Request, res: Response) => {
      if (whatsappDelivery.getProvider() !== 'local_browser') {
        return res.status(404).send('<h1>QR no disponible con el provider actual</h1>');
      }

      const status = await whatsappDelivery.getStatus();
      if (status.disabled) {
        return res.status(200).send('<h1>WhatsApp deshabilitado</h1>');
      }

      const qr = await whatsappDelivery.getQr();
      if (!qr) {
        if (status.ready) {
          return res.status(200).send('<h1>WhatsApp conectado</h1>');
        }
        return res
          .status(404)
          .send('<meta http-equiv="refresh" content="5"><h1>Esperando QR...</h1>');
      }

      try {
        const qrSvg = await QRCode.toString(qr, {
          type: 'svg',
          width: 300,
          margin: 2
        });

        res.status(200).send(`
          <html>
          <body style="text-align:center;font-family:sans-serif;">
            <h1>Escaneá el código QR</h1>
            ${qrSvg}
          </body>
          </html>
        `);
      } catch (error) {
        console.error('Error generando QR:', error);
        res.status(500).send('Error generando QR');
      }
    }
  );

  app.get('/whatsapp/status', authMiddleware, requireGlobalRole('ADMIN'), async (_req: Request, res: Response) => {
    res.json(await whatsappDelivery.getStatus());
  });

  app.use(errorHandler);

  return app;
};
