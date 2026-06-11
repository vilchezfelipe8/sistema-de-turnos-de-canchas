import 'dotenv/config';
import { createApp } from './app';
import { prisma } from './prisma';
import { metricsService } from './services/MetricsService';
import { OutboxWorker } from './services/OutboxWorker';
import { acquireDistributedLock } from './utils/distributedLock';
import { featureFlags } from './config/featureFlags';
import { PendingBookingAutoCancelService } from './services/PendingBookingAutoCancelService';
import { FiscalCertExpiryChecker } from './services/FiscalCertExpiryChecker';
import { BookingService } from './services/BookingService';
import { BookingRepository } from './repositories/BookingRepository';
import { CourtRepository } from './repositories/CourtRepository';
import { UserRepository } from './repositories/UserRepository';
import { ActivityTypeRepository } from './repositories/ActivityTypeRepository';
import { CashRepository } from './repositories/CashRepository';
import { ProductRepository } from './repositories/ProductRepository';

const PORT = Number(process.env.PORT) || 3000;
const BOOKINGS_COMPLETION_INTERVAL_MS = Number(process.env.BOOKINGS_COMPLETION_INTERVAL_MS) || 60_000;
const PENDING_BOOKINGS_AUTOCANCEL_INTERVAL_MS = Number(process.env.PENDING_BOOKINGS_AUTOCANCEL_INTERVAL_MS) || 60_000;
const OUTBOX_PROCESSOR_INTERVAL_MS = Number(process.env.OUTBOX_PROCESSOR_INTERVAL_MS) || 5_000;
const BOOKINGS_COMPLETION_LOCK_TTL_MS = Number(process.env.BOOKINGS_COMPLETION_LOCK_TTL_MS) || 55_000;
const PENDING_BOOKINGS_AUTOCANCEL_LOCK_TTL_MS = Number(process.env.PENDING_BOOKINGS_AUTOCANCEL_LOCK_TTL_MS) || 55_000;
const CERT_EXPIRY_CHECK_INTERVAL_MS = Number(process.env.CERT_EXPIRY_CHECK_INTERVAL_MS) || 3_600_000; // 1 hora
const PROCESS_ROLE = String(process.env.PROCESS_ROLE || 'all').toLowerCase();
const RUN_BOOKING_COMPLETION_JOB = process.env.RUN_BOOKING_COMPLETION_JOB;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (!process.env.JWT_SECRET) {
  console.error('❌ Missing JWT_SECRET in environment.');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL in environment.');
  process.exit(1);
}

if (IS_PRODUCTION) {
  const jwtSecret = String(process.env.JWT_SECRET || '').trim();
  if (!jwtSecret || jwtSecret === 'replace_with_a_strong_jwt_secret') {
    console.error('❌ Invalid JWT_SECRET in production.');
    process.exit(1);
  }

  const frontendUrl = String(process.env.FRONTEND_URL || '').trim();
  if (!frontendUrl) {
    console.error('❌ Missing FRONTEND_URL in production.');
    process.exit(1);
  }

  const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '').trim();
  if (!allowedOrigins) {
    console.error('❌ Missing ALLOWED_ORIGINS in production.');
    process.exit(1);
  }

  const mercadoPagoEnabled = ['1', 'true', 'yes'].includes(String(process.env.MERCADO_PAGO_ENABLED || '').trim().toLowerCase());
  if (mercadoPagoEnabled) {
    const requiredMercadoPagoVars = [
      'MERCADO_PAGO_CLIENT_ID',
      'MERCADO_PAGO_CLIENT_SECRET',
      'MERCADO_PAGO_REDIRECT_URI',
      'MERCADO_PAGO_WEBHOOK_SECRET',
      'INTEGRATION_SECRETS_KEY',
      'APP_BASE_URL'
    ] as const;

    for (const key of requiredMercadoPagoVars) {
      if (!String(process.env[key] || '').trim()) {
        console.error(`❌ Missing ${key} in production while Mercado Pago is enabled.`);
        process.exit(1);
      }
    }
  }
}

const shouldRunApi = () => PROCESS_ROLE === 'all' || PROCESS_ROLE === 'api';
const shouldRunWorker = () => {
  return PROCESS_ROLE === 'all' || PROCESS_ROLE === 'worker';
};
const shouldRunScheduler = () => {
  if (RUN_BOOKING_COMPLETION_JOB != null) {
    return RUN_BOOKING_COMPLETION_JOB === 'true' || RUN_BOOKING_COMPLETION_JOB === '1';
  }
  return PROCESS_ROLE === 'all' || PROCESS_ROLE === 'scheduler';
};

const bookingService = new BookingService(
  new BookingRepository(),
  new CourtRepository(),
  new UserRepository(),
  new ActivityTypeRepository(),
  new CashRepository(),
  new ProductRepository()
);

const completePastBookings = async () => {
  const lock = await acquireDistributedLock(
    'scheduler:complete-past-bookings',
    BOOKINGS_COMPLETION_LOCK_TTL_MS
  );

  if (process.env.REDIS_URL && !lock) {
    metricsService.recordSchedulerRun('complete_past_bookings', 'skipped');
    return;
  }

  try {
    const now = new Date();
    const result = await bookingService.completeExpiredConfirmedBookings(now, 0);

    if (result.failed.length > 0) {
      console.error('[BOOKING_SCHEDULER] Se detectaron reservas inconsistentes/no completables', {
        failed: result.failed
      });
      metricsService.recordSchedulerRun('complete_past_bookings', 'error');
      return;
    }

    metricsService.recordSchedulerRun('complete_past_bookings', 'success');
  } catch (error) {
    console.error('❌ Error completando turnos:', error);
    metricsService.recordSchedulerRun('complete_past_bookings', 'error');
  } finally {
    await lock?.release();
  }
};

const autoCancelPendingBookingsService = new PendingBookingAutoCancelService();
const processPendingBookingPolicies = async () => {
  const lock = await acquireDistributedLock(
    'scheduler:pending-bookings-auto-cancel',
    PENDING_BOOKINGS_AUTOCANCEL_LOCK_TTL_MS
  );

  if (process.env.REDIS_URL && !lock) {
    metricsService.recordSchedulerRun('pending_bookings_auto_cancel', 'skipped');
    return;
  }

  try {
    await autoCancelPendingBookingsService.processPendingBookingWarnings();
    await autoCancelPendingBookingsService.processPendingBookingAutoCancellations();
    metricsService.recordSchedulerRun('pending_bookings_auto_cancel', 'success');
  } catch (error) {
    console.error('❌ Error procesando políticas de auto-cancelación de pendientes:', error);
    metricsService.recordSchedulerRun('pending_bookings_auto_cancel', 'error');
  } finally {
    await lock?.release();
  }
};

const startApi = () => {
  const app = createApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API listening on port ${PORT}`);
  });
};

const startWorker = () => {
  if (!featureFlags.ENABLE_OUTBOX) {
    console.log('🧰 Worker de outbox deshabilitado (ENABLE_OUTBOX=false)');
    return;
  }

  const outboxWorker = new OutboxWorker();

  setInterval(async () => {
    try {
      await outboxWorker.processPending(25);
    } catch (error) {
      console.error('❌ Error procesando outbox:', error);
    }
  }, OUTBOX_PROCESSOR_INTERVAL_MS);

  console.log('🧰 Worker de outbox iniciado');
};

const fiscalCertExpiryChecker = new FiscalCertExpiryChecker();

const checkFiscalCertExpiry = async () => {
  try {
    await fiscalCertExpiryChecker.run();
    metricsService.recordSchedulerRun('fiscal_cert_expiry_check', 'success');
  } catch (error) {
    console.error('❌ Error chequeando vencimiento de certificados fiscales:', error);
    metricsService.recordSchedulerRun('fiscal_cert_expiry_check', 'error');
  }
};

const startScheduler = async () => {
  await completePastBookings();
  await processPendingBookingPolicies();
  await checkFiscalCertExpiry();

  setInterval(async () => {
    await completePastBookings();
  }, BOOKINGS_COMPLETION_INTERVAL_MS);

  setInterval(async () => {
    await processPendingBookingPolicies();
  }, PENDING_BOOKINGS_AUTOCANCEL_INTERVAL_MS);

  setInterval(async () => {
    await checkFiscalCertExpiry();
  }, CERT_EXPIRY_CHECK_INTERVAL_MS);

  console.log('⏰ Scheduler de reservas iniciado');
};

const startRuntime = async () => {
  try {
    await prisma.$connect();

    const runApi = shouldRunApi();
    const runWorker = shouldRunWorker();
    const runScheduler = shouldRunScheduler();

    if (!runApi && !runWorker && !runScheduler) {
      throw new Error(`PROCESS_ROLE inválido: ${PROCESS_ROLE}`);
    }

    if (runApi) {
      startApi();
    }
    if (runWorker) {
      startWorker();
    }
    if (runScheduler) {
      await startScheduler();
    }
  } catch (error) {
    console.error('❌ Error fatal al iniciar el runtime:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

startRuntime();
