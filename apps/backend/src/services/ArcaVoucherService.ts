import { formatInTimeZone } from 'date-fns-tz';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { ArcaAuthService } from './ArcaAuthService';
import { ArcaGateway, type ArcaVoucherRequest } from './ArcaGateway';
import { parseArcaResponse, type FiscalAuthorizationResult } from '../utils/arcaResponseParser';
import { getSuggestedAction } from '../utils/arcaErrorCatalog';
import { getIvaAlicuotaId } from '../utils/arcaCodes';

const TZ = 'America/Argentina/Buenos_Aires';

const formatAfipDate = (date: Date): string =>
  formatInTimeZone(date, TZ, 'yyyyMMdd');

const round2 = (n: number) => Math.round(n * 100) / 100;

// §55.3 — build grouped IVA breakdown from fiscalCalculationSnapshot items
const extractIvaBreakdown = (
  snapshot: unknown
): Array<{ Id: number; BaseImp: number; Importe: number }> | undefined => {
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  const snap = snapshot as any;
  if (!Array.isArray(snap.items)) return undefined;

  const byId = new Map<number, { base: number; importe: number }>();

  for (const item of snap.items) {
    const rate = Number(item?.input?.vatRate ?? 0);
    const base = Number(item?.taxableBase ?? 0);
    const vat = Number(item?.vatAmount ?? 0);
    if (rate <= 0 || vat <= 0) continue;

    const alicuotaId = getIvaAlicuotaId(rate);
    if (!alicuotaId) continue;

    const prev = byId.get(alicuotaId) ?? { base: 0, importe: 0 };
    byId.set(alicuotaId, {
      base: round2(prev.base + base),
      importe: round2(prev.importe + vat)
    });
  }

  if (byId.size === 0) return undefined;
  return Array.from(byId.entries()).map(([Id, { base, importe }]) => ({
    Id,
    BaseImp: base,
    Importe: importe
  }));
};

const TERMINAL_STATUSES = new Set([
  'APPROVED',
  'APPROVED_WITH_OBSERVATIONS',
  'REJECTED',
  'CANCELLED'
]);

// Load Factura with all relations needed for emission
const loadFactura = (id: string) =>
  prisma.factura.findUnique({
    where: { id },
    include: {
      configuracionFiscal: true,
      comprobanteAsociado: {
        select: {
          puntoDeVenta: true,
          comprobanteTipo: true,
          numeroComprobante: true
        }
      }
    }
  });

type FacturaWithRelations = NonNullable<Awaited<ReturnType<typeof loadFactura>>>;

// §18 — validate all local preconditions before calling ARCA
const validateForEmission = (factura: FacturaWithRelations): string | null => {
  const { configuracionFiscal: config } = factura;

  if (!config.activo || !config.facturacionHabilitada) {
    return 'ConfiguracionFiscal inactiva o facturacion deshabilitada';
  }

  if (config.vencimientoCertificado && config.vencimientoCertificado < new Date()) {
    return `Certificado vencido el ${config.vencimientoCertificado.toISOString().slice(0, 10)}`;
  }

  if (!factura.puntoDeVenta) {
    return 'Punto de venta no asignado en la factura';
  }

  if (!factura.comprobanteTipo) {
    return 'Tipo de comprobante no asignado';
  }

  if (!factura.concepto) {
    return 'Concepto no asignado';
  }

  if (factura.receptorDocTipo == null || !factura.receptorDocNumero) {
    return 'Datos del receptor incompletos (docTipo y docNumero requeridos)';
  }

  if (factura.receptorCondicionIvaArcaId == null) {
    return 'CondicionIVAReceptorId no asignado (requerido por RG 4291 v4.3, §55.5)';
  }

  if (Number(factura.importeTotal) < 0) {
    return 'Importe total no puede ser negativo';
  }

  if (
    (factura.concepto === 2 || factura.concepto === 3) &&
    (!factura.fechaServicioDesde || !factura.fechaServicioHasta || !factura.fechaVencimientoPago)
  ) {
    return 'Fechas de servicio requeridas para concepto 2 o 3 (§55.7)';
  }

  if (factura.kind === 'CREDIT_NOTE' && !factura.comprobanteAsociadoId) {
    return 'Comprobante asociado requerido para nota de credito';
  }

  if (factura.kind === 'CREDIT_NOTE' && factura.comprobanteAsociado) {
    const assoc = factura.comprobanteAsociado;
    if (!assoc.puntoDeVenta || !assoc.comprobanteTipo || !assoc.numeroComprobante) {
      return 'Comprobante asociado incompleto (puntoDeVenta, comprobanteTipo y numeroComprobante requeridos)';
    }
  }

  return null;
};

const buildVoucherRequest = (
  factura: FacturaWithRelations,
  auth: { token: string; sign: string; cuit: string },
  environment: 'TEST' | 'PRODUCTION',
  voucherNumber: number
): ArcaVoucherRequest => {
  const assoc = factura.comprobanteAsociado;
  const associatedVoucher =
    assoc?.puntoDeVenta && assoc?.comprobanteTipo && assoc?.numeroComprobante
      ? {
          pointOfSale: assoc.puntoDeVenta,
          voucherType: assoc.comprobanteTipo,
          voucherNumber: assoc.numeroComprobante
        }
      : undefined;

  return {
    environment,
    auth,
    pointOfSale: factura.puntoDeVenta!,
    comprobanteTipo: factura.comprobanteTipo!,
    voucherNumber,
    concept: factura.concepto as 1 | 2 | 3,
    issuedAt: formatAfipDate(factura.fechaEmision),
    serviceDateFrom: factura.fechaServicioDesde
      ? formatAfipDate(factura.fechaServicioDesde)
      : undefined,
    serviceDateTo: factura.fechaServicioHasta
      ? formatAfipDate(factura.fechaServicioHasta)
      : undefined,
    paymentDueDate: factura.fechaVencimientoPago
      ? formatAfipDate(factura.fechaVencimientoPago)
      : undefined,
    receiver: {
      docType: factura.receptorDocTipo!,
      docNumber: factura.receptorDocNumero || '0',
      ivaConditionArcaId: factura.receptorCondicionIvaArcaId!
    },
    amounts: {
      netTaxed: factura.importeNeto.toFixed(2),
      vatAmount: factura.importeIva.toFixed(2),
      exemptAmount: factura.importeExento.toFixed(2),
      otherTaxesAmount: '0.00', // ImpTotConc = no gravados; v1 always 0
      totalAmount: factura.importeTotal.toFixed(2)
    },
    ivaBreakdown: extractIvaBreakdown(factura.fiscalCalculationSnapshot),
    associatedVoucher
  };
};

export class ArcaVoucherService {
  private readonly authService = new ArcaAuthService();
  private readonly gateway = new ArcaGateway();

  async authorizeVoucher(facturaId: string): Promise<FiscalAuthorizationResult> {
    const factura = await loadFactura(facturaId);
    if (!factura) {
      throw new Error(`Factura ${facturaId} no encontrada`);
    }

    if (TERMINAL_STATUSES.has(factura.status)) {
      throw new Error(
        `Factura ${facturaId} ya esta en estado terminal (${factura.status}) y no puede re-emitirse`
      );
    }

    // Mark as PROCESSING and increment attempt counter
    await prisma.factura.update({
      where: { id: facturaId },
      data: {
        status: 'PROCESSING',
        intentoActual: { increment: 1 },
        ultimoIntentoAt: new Date()
      }
    });

    try {
      // §18 — pre-emission local validation
      const validationError = validateForEmission(factura);
      if (validationError) {
        const result: FiscalAuthorizationResult = {
          status: 'REJECTED',
          errors: [{ code: 'LOCAL_VALIDATION', message: validationError, type: 'FUNCTIONAL' }]
        };
        await prisma.factura.update({
          where: { id: facturaId },
          data: {
            status: 'REJECTED',
            mensajeError: validationError,
            suggestedAction: 'REQUIRE_ADMIN_CONFIGURATION_FIX',
            normalizedResult: result as any
          }
        });
        return result;
      }

      const config = factura.configuracionFiscal;
      const environment: 'TEST' | 'PRODUCTION' = config.usaHomologacion ? 'TEST' : 'PRODUCTION';

      // §7 — get valid auth ticket (Redis → DB → WSAA)
      const auth = await this.authService.getValidAuth(factura.clubId);

      // §13, §17 paso 4 — correlatividad: get last authorized number
      const lastNumber = await this.gateway.getLastAuthorizedNumber({
        environment,
        auth: { token: auth.token, sign: auth.sign, cuit: auth.cuit },
        pointOfSale: factura.puntoDeVenta!,
        comprobanteTipo: factura.comprobanteTipo!
      });
      const voucherNumber = lastNumber + 1;

      // Build SOAP request
      const request = buildVoucherRequest(
        factura,
        { token: auth.token, sign: auth.sign, cuit: auth.cuit },
        environment,
        voucherNumber
      );

      // §8 — sanitize auth tokens before persisting for audit
      const requestForLog = {
        ...request,
        auth: { cuit: auth.cuit, token: '[REDACTED]', sign: '[REDACTED]' }
      };

      // §17 paso 5 — emit
      const rawResponse = await this.gateway.authorizeVoucher(request);

      // §43 — parse and interpret response
      const result = parseArcaResponse(rawResponse.rawResult);
      const suggestedAction = getSuggestedAction(result);

      const baseUpdate = {
        requestPayload: requestForLog as any,
        responsePayload: rawResponse.rawResult as any,
        normalizedResult: result as any,
        resultadoArca: result.arcaResult ?? null,
        suggestedAction,
        ultimoIntentoAt: new Date()
      };

      if (result.status === 'APPROVED' || result.status === 'APPROVED_WITH_OBSERVATIONS') {
        await prisma.factura.update({
          where: { id: facturaId },
          data: {
            ...baseUpdate,
            status: result.status,
            numeroComprobante: voucherNumber,
            cae: result.cae ?? null,
            caeVencimiento: result.caeDueDate ? new Date(result.caeDueDate) : null,
            observacionesArca: result.observations ? (result.observations as any) : Prisma.DbNull,
            erroresArca: Prisma.DbNull,
            mensajeError: null
          }
        });
      } else {
        const errorMessage =
          result.errors?.map((e) => `[${e.code}] ${e.message}`).join('; ') ?? null;
        await prisma.factura.update({
          where: { id: facturaId },
          data: {
            ...baseUpdate,
            status: result.status,
            erroresArca: (result.errors ?? null) as any,
            mensajeError: errorMessage
          }
        });
      }

      return result;
    } catch (error) {
      // Any uncaught exception (network, auth failure, etc.) → TECHNICAL_ERROR + retryable
      const message =
        error instanceof Error ? error.message : 'Error tecnico desconocido';
      await prisma.factura.update({
        where: { id: facturaId },
        data: {
          status: 'TECHNICAL_ERROR',
          mensajeError: message,
          suggestedAction: 'RETRY_AUTOMATICALLY',
          ultimoIntentoAt: new Date()
        }
      });
      return {
        status: 'TECHNICAL_ERROR',
        errors: [{ code: 'EXCEPTION', message, type: 'TECHNICAL' }]
      };
    }
  }

  async retryVoucher(facturaId: string): Promise<FiscalAuthorizationResult> {
    const factura = await prisma.factura.findUnique({
      where: { id: facturaId },
      select: { status: true }
    });
    if (!factura) {
      throw new Error(`Factura ${facturaId} no encontrada`);
    }
    if (factura.status !== 'TECHNICAL_ERROR') {
      throw new Error(
        `Factura ${facturaId} no es reintentable (estado actual: ${factura.status})`
      );
    }
    return this.authorizeVoucher(facturaId);
  }
}
