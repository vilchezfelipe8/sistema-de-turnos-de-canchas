import { OutboxMessage } from '@prisma/client';
import { prisma } from '../prisma';
import { OUTBOX_TYPES } from './OutboxService';
import { ArcaVoucherService } from './ArcaVoucherService';
import { ArcaAuthService } from './ArcaAuthService';
import { ArcaGateway } from './ArcaGateway';
import { ArcaReceiptService } from './ArcaReceiptService';
import { ArcaOutboxPublisher } from './ArcaOutboxPublisher';
import { getSuggestedAction } from '../utils/arcaErrorCatalog';
import type { FiscalAuthorizationResult } from '../utils/arcaResponseParser';
import { acquireDistributedLock } from '../utils/distributedLock';

// §22 — stop auto-retrying after this many attempts; create manual incident instead
const MAX_ARCA_RETRIES = 5;

// §13 — hold the sequence lock for the entire emission flow (auth + 2 SOAP calls)
const SEQ_LOCK_TTL_MS = 120_000;

// §22 — retry delays: immediate → +1min → +5min → +15min → +60min → manual queue
const ARCA_RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, 3_600_000];

const getRetryDelay = (currentAttempts: number): number =>
  ARCA_RETRY_DELAYS_MS[currentAttempts] ?? ARCA_RETRY_DELAYS_MS[ARCA_RETRY_DELAYS_MS.length - 1];

// Thrown when the outbox worker should reschedule this message
export class ArcaRetryError extends Error {
  readonly delayMs: number;
  constructor(delayMs: number, message: string) {
    super(message);
    this.name = 'ArcaRetryError';
    this.delayMs = delayMs;
  }
}

const NON_RETRYABLE_ACTIONS = new Set([
  'REQUIRE_ADMIN_CONFIGURATION_FIX',
  'REQUIRE_RECEIVER_DATA_FIX',
  'REQUIRE_MANUAL_RECONCILIATION',
  'REQUIRE_ENGINEERING_REVIEW'
]);

export class ArcaWorkerHandler {
  private readonly voucherService = new ArcaVoucherService();
  private readonly authService = new ArcaAuthService();
  private readonly gateway = new ArcaGateway();
  private readonly receiptService = new ArcaReceiptService();
  private readonly publisher = new ArcaOutboxPublisher();

  async handle(message: OutboxMessage): Promise<void> {
    switch (message.type) {
      case OUTBOX_TYPES.ARCA_INVOICE_REQUESTED:
      case OUTBOX_TYPES.ARCA_CREDIT_NOTE_REQUESTED:
      case OUTBOX_TYPES.ARCA_VOUCHER_RETRY_REQUESTED:
        return this.handleVoucherEmission(message);

      case OUTBOX_TYPES.ARCA_AUTH_REFRESH_REQUESTED:
        return this.handleAuthRefresh(message);

      case OUTBOX_TYPES.ARCA_VOUCHER_RENDER_REQUESTED:
        return this.handleVoucherRender(message);

      // No-op: notificaciones de incidentes (futuro)
      case OUTBOX_TYPES.FISCAL_INCIDENT_CREATED:
        return;

      default:
        throw new Error(`ArcaWorkerHandler: tipo no soportado: ${message.type}`);
    }
  }

  // --- voucher emission ---

  private async handleVoucherEmission(message: OutboxMessage): Promise<void> {
    const payload = message.payload as { facturaId?: string };
    if (!payload?.facturaId) throw new Error('Payload inválido: falta facturaId');
    const { facturaId } = payload;

    // §22 — max retries exceeded → create incident and stop
    if (message.attempts >= MAX_ARCA_RETRIES) {
      await this.createIncident({
        clubId: message.clubId,
        facturaId,
        type: 'MAX_RETRIES_EXCEEDED',
        title: 'Máximo de reintentos alcanzado',
        detail: `Factura ${facturaId} no pudo autorizarse tras ${message.attempts} intentos. Requiere revisión manual.`,
        priority: 'HIGH'
      });
      return;
    }

    const factura = await prisma.factura.findUnique({
      where: { id: facturaId },
      select: {
        status: true,
        suggestedAction: true,
        puntoDeVenta: true,
        comprobanteTipo: true,
        requestPayload: true,
        configuracionFiscalId: true
      }
    });

    if (!factura) throw new Error(`Factura ${facturaId} no encontrada`);

    // Already terminal — no action needed
    if (
      factura.status === 'APPROVED' ||
      factura.status === 'APPROVED_WITH_OBSERVATIONS' ||
      factura.status === 'CANCELLED'
    ) {
      return;
    }

    // Definitively rejected — create incident if non-retryable
    if (factura.status === 'REJECTED') {
      const action = factura.suggestedAction ?? 'REQUIRE_ENGINEERING_REVIEW';
      if (NON_RETRYABLE_ACTIONS.has(action)) {
        await this.createIncident({
          clubId: message.clubId,
          facturaId,
          configuracionFiscalId: factura.configuracionFiscalId,
          type: action,
          title: `Factura rechazada: ${action}`,
          detail: `Factura ${facturaId} en estado REJECTED con acción ${action}.`,
          priority: action === 'REQUIRE_MANUAL_RECONCILIATION' ? 'HIGH' : 'MEDIUM'
        });
      }
      return;
    }

    // Non-retryable config or data error detected from a prior attempt
    const priorAction = factura.suggestedAction;
    if (priorAction && NON_RETRYABLE_ACTIONS.has(priorAction)) {
      await this.createIncident({
        clubId: message.clubId,
        facturaId,
        configuracionFiscalId: factura.configuracionFiscalId,
        type: priorAction,
        title: `Factura ${facturaId}: ${priorAction}`,
        detail: `Acción requerida detectada en intento previo: ${priorAction}`,
        priority: priorAction === 'REQUIRE_MANUAL_RECONCILIATION' ? 'HIGH' : 'MEDIUM'
      });
      return;
    }

    // §40 — conciliation: check if ARCA already authorized this voucher after a timeout
    if (
      factura.status === 'TECHNICAL_ERROR' &&
      factura.puntoDeVenta &&
      factura.comprobanteTipo &&
      factura.requestPayload
    ) {
      const reconciled = await this.tryConciliate(
        message.clubId,
        facturaId,
        factura.puntoDeVenta,
        factura.comprobanteTipo,
        factura.requestPayload,
        factura.configuracionFiscalId
      );
      if (reconciled) return;
    }

    // §13 — sequence lock: prevents concurrent emission for same pdv+cbteTipo
    const seqLockKey =
      factura.puntoDeVenta && factura.comprobanteTipo
        ? `arca:seq-lock:club:${message.clubId}:pto:${factura.puntoDeVenta}:cbte:${factura.comprobanteTipo}`
        : null;

    const lock = seqLockKey
      ? await acquireDistributedLock(seqLockKey, SEQ_LOCK_TTL_MS)
      : null;

    try {
      const result = await this.voucherService.authorizeVoucher(facturaId);
      await this.interpretResult(result, message, facturaId, factura.configuracionFiscalId);
    } finally {
      await lock?.release();
    }
  }

  private async interpretResult(
    result: FiscalAuthorizationResult,
    message: OutboxMessage,
    facturaId: string,
    configuracionFiscalId: string
  ): Promise<void> {
    if (result.status === 'APPROVED' || result.status === 'APPROVED_WITH_OBSERVATIONS') {
      // Encolar generación de QR + comprobante HTML (no fatal si falla el enqueue)
      try {
        await this.publisher.publishVoucherRender({ clubId: message.clubId, facturaId });
      } catch {
        // Non-fatal — la factura ya está aprobada
      }
      return;
    }

    const action = getSuggestedAction(result);

    if (result.status === 'REJECTED') {
      if (NON_RETRYABLE_ACTIONS.has(action)) {
        await this.createIncident({
          clubId: message.clubId,
          facturaId,
          configuracionFiscalId,
          type: action,
          title: `Factura rechazada: ${action}`,
          detail: result.errors?.map((e) => `[${e.code}] ${e.message}`).join('; '),
          priority: action === 'REQUIRE_MANUAL_RECONCILIATION' ? 'HIGH' : 'MEDIUM'
        });
        return;
      }
      // Edge case: REJECTED but marked RETRY_AUTOMATICALLY (unusual — treat as technical)
      throw new ArcaRetryError(
        getRetryDelay(message.attempts),
        result.errors?.[0]?.message ?? 'Rechazado'
      );
    }

    // TECHNICAL_ERROR
    if (action === 'REFRESH_AUTH_AND_RETRY') {
      // Eagerly invalidate the cached token so next pick-up gets a fresh one
      await this.authService.invalidateAuth(message.clubId);
    }

    throw new ArcaRetryError(
      getRetryDelay(message.attempts),
      result.errors?.[0]?.message ?? 'Error técnico ARCA'
    );
  }

  // --- render (QR + comprobante HTML) ---

  private async handleVoucherRender(message: OutboxMessage): Promise<void> {
    const payload = message.payload as { facturaId?: string };
    if (!payload?.facturaId) throw new Error('Payload inválido: falta facturaId');
    await this.receiptService.render(payload.facturaId);
  }

  // §40 — before retrying a TECHNICAL_ERROR, verify ARCA didn't already authorize the voucher
  private async tryConciliate(
    clubId: number,
    facturaId: string,
    puntoDeVenta: number,
    comprobanteTipo: number,
    requestPayload: unknown,
    configuracionFiscalId: string
  ): Promise<boolean> {
    const req = requestPayload as Record<string, unknown> | null;
    const requestedNumber = typeof req?.voucherNumber === 'number' ? req.voucherNumber : null;
    if (!requestedNumber) return false;

    try {
      const config = await prisma.configuracionFiscal.findUnique({
        where: { id: configuracionFiscalId },
        select: { usaHomologacion: true }
      });
      if (!config) return false;

      const auth = await this.authService.getValidAuth(clubId);
      const environment = config.usaHomologacion ? 'TEST' : 'PRODUCTION';

      const lastAuthorized = await this.gateway.getLastAuthorizedNumber({
        environment,
        auth: { token: auth.token, sign: auth.sign, cuit: auth.cuit },
        pointOfSale: puntoDeVenta,
        comprobanteTipo
      });

      if (lastAuthorized < requestedNumber) return false;

      // ARCA has a number >= what we requested — possible double emission
      await prisma.factura.update({
        where: { id: facturaId },
        data: {
          suggestedAction: 'REQUIRE_MANUAL_RECONCILIATION',
          mensajeError: `§40 Conciliación: ARCA autorizó hasta N° ${lastAuthorized}, se solicitó N° ${requestedNumber}. Verificar si el comprobante fue emitido.`
        }
      });
      await this.createIncident({
        clubId,
        facturaId,
        configuracionFiscalId,
        type: 'REQUIRE_MANUAL_RECONCILIATION',
        title: '§40 Conciliación requerida',
        detail: `ARCA autorizó hasta N° ${lastAuthorized}, se solicitó N° ${requestedNumber}. Posible doble emisión — verificar y reconciliar manualmente.`,
        priority: 'HIGH'
      });
      return true;
    } catch {
      // Conciliation failure is non-fatal — proceed with normal retry
      return false;
    }
  }

  // --- auth refresh ---

  private async handleAuthRefresh(message: OutboxMessage): Promise<void> {
    await this.authService.refreshAuth(message.clubId);
  }

  // --- fiscal incident ---

  private async createIncident(params: {
    clubId: number;
    facturaId?: string;
    configuracionFiscalId?: string;
    type: string;
    title: string;
    detail?: string;
    priority?: string;
  }): Promise<void> {
    try {
      await prisma.fiscalIncident.create({
        data: {
          clubId: params.clubId,
          facturaId: params.facturaId,
          configuracionFiscalId: params.configuracionFiscalId,
          type: params.type,
          title: params.title,
          detail: params.detail,
          priority: params.priority ?? 'MEDIUM',
          status: 'OPEN'
        }
      });
    } catch {
      // Non-fatal — incident creation failure must never block the worker
    }
  }
}
