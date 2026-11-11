import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { sendAppError, zodValidationAppError } from '../errors';
import { ArcaOutboxPublisher } from '../services/ArcaOutboxPublisher';
import { OUTBOX_TYPES } from '../services/OutboxService';
import { FiscalPolicyService } from '../services/FiscalPolicyService';
import { FiscalCalculationService } from '../services/FiscalCalculationService';
import { ARCA_CONDICION_IVA_RECEPTOR_ID, ARCA_DOC_TIPO } from '../utils/arcaCodes';
import { Prisma } from '@prisma/client';

const PAGE_SIZE = 30;
const DEFAULT_VAT_RATE = 21;
// RG 5824/2026 — importe mínimo para identificar CF
const CF_IDENTIFICATION_THRESHOLD = 10_000_000;

const listFacturasSchema = z.object({
  status: z.string().optional(),
  accountId: z.string().optional(),
  facturaId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1)
});

const listIncidentsSchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED', 'ALL']).default('OPEN'),
  page: z.coerce.number().int().min(1).default(1)
});

const RETRYABLE_STATUSES = new Set(['PENDING', 'TECHNICAL_ERROR']);

const CONDICION_TO_IVA_ID: Record<string, number> = {
  CONSUMIDOR_FINAL: ARCA_CONDICION_IVA_RECEPTOR_ID.CONSUMIDOR_FINAL,
  RESPONSABLE_INSCRIPTO: ARCA_CONDICION_IVA_RECEPTOR_ID.RESPONSABLE_INSCRIPTO,
  MONOTRIBUTO: ARCA_CONDICION_IVA_RECEPTOR_ID.MONOTRIBUTO,
  EXENTO: ARCA_CONDICION_IVA_RECEPTOR_ID.EXENTO,
};

const manualEmitSchema = z.object({
  receptorCondicionFiscal: z
    .enum(['CONSUMIDOR_FINAL', 'RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'])
    .default('CONSUMIDOR_FINAL'),
  receptorNombre: z.string().max(200).optional(),
  receptorCuit: z
    .string()
    .regex(/^\d{11}$/, 'El CUIT debe tener exactamente 11 dígitos')
    .optional(),
  receptorDni: z
    .string()
    .regex(/^\d{7,8}$/, 'El DNI debe tener 7 u 8 dígitos')
    .optional(),
  // §55.7 — requeridos para concepto 2 (servicios) y 3 (mixto)
  fechaServicioDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD').optional(),
  fechaServicioHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD').optional(),
  fechaVencimientoPago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD').optional(),
});

const publisher = new ArcaOutboxPublisher();

export class FiscalBandejaController {
  // GET /:slug/admin/fiscal-bandeja/facturas
  listFacturas = async (req: Request, res: Response) => {
    try {
      const clubId = (req as any).clubId as number;
      const parsed = listFacturasSchema.safeParse(req.query);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error));

      const { status, accountId, facturaId, page } = parsed.data;
      const skip = (page - 1) * PAGE_SIZE;

      const where: any = { clubId };
      if (status) where.status = status;
      if (accountId) where.accountId = accountId;
      if (facturaId) where.id = facturaId;

      const [items, total] = await Promise.all([
        prisma.factura.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: PAGE_SIZE,
          select: {
            id: true,
            kind: true,
            status: true,
            originType: true,
            originId: true,
            voucherClass: true,
            comprobanteTipo: true,
            comprobanteDescripcion: true,
            puntoDeVenta: true,
            numeroComprobante: true,
            fechaEmision: true,
            receptorNombre: true,
            receptorDocNumero: true,
            importeTotal: true,
            cae: true,
            caeVencimiento: true,
            mensajeError: true,
            suggestedAction: true,
            intentoActual: true,
            ultimoIntentoAt: true,
            createdAt: true,
            pdfUrl: true,
            qrUrl: true
          }
        }),
        prisma.factura.count({ where })
      ]);

      return res.json({ items, total, page, pageSize: PAGE_SIZE, pages: Math.ceil(total / PAGE_SIZE) });
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los comprobantes');
    }
  };

  // GET /:slug/admin/fiscal-bandeja/facturas/:facturaId
  getFactura = async (req: Request, res: Response) => {
    try {
      const clubId = (req as any).clubId as number;
      const facturaId = String(req.params.facturaId);

      const factura = await prisma.factura.findFirst({
        where: { id: facturaId, clubId },
        include: {
          items: {
            select: {
              id: true,
              description: true,
              quantity: true,
              unitPrice: true,
              vatRate: true,
              totalAmount: true
            }
          }
        }
      });

      if (!factura) return res.status(404).json({ error: 'Comprobante no encontrado.' });

      // Strip PEM-adjacent fields not needed in the frontend
      const { requestPayload, responsePayload, normalizedResult, fiscalCalculationSnapshot, ...safe } = factura as any;
      return res.json({ factura: safe });
    } catch (error) {
      return sendAppError(res, error, 'No se pudo cargar el comprobante');
    }
  };

  // POST /:slug/admin/fiscal-bandeja/facturas/:facturaId/retry
  retryFactura = async (req: Request, res: Response) => {
    try {
      const clubId = (req as any).clubId as number;
      const facturaId = String(req.params.facturaId);

      const factura = await prisma.factura.findFirst({
        where: { id: facturaId, clubId },
        select: { id: true, status: true, kind: true, originType: true, originId: true }
      });
      if (!factura) return res.status(404).json({ error: 'Comprobante no encontrado.' });

      if (!RETRYABLE_STATUSES.has(factura.status)) {
        return res.status(400).json({
          error: `El comprobante no puede reintentarse en estado ${factura.status}.`
        });
      }

      await publisher.publishVoucherRetry({ clubId, facturaId });

      return res.json({ ok: true, message: 'Reintento encolado.' });
    } catch (error) {
      return sendAppError(res, error, 'No se pudo encolar el reintento');
    }
  };

  // GET /:slug/admin/fiscal-bandeja/incidents
  listIncidents = async (req: Request, res: Response) => {
    try {
      const clubId = (req as any).clubId as number;
      const parsed = listIncidentsSchema.safeParse(req.query);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error));

      const { status, page } = parsed.data;
      const skip = (page - 1) * PAGE_SIZE;

      const where: any = { clubId };
      if (status !== 'ALL') where.status = status;

      const [items, total] = await Promise.all([
        prisma.fiscalIncident.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: PAGE_SIZE,
          select: {
            id: true,
            type: true,
            title: true,
            detail: true,
            priority: true,
            status: true,
            facturaId: true,
            createdAt: true,
            resolvedAt: true
          }
        }),
        prisma.fiscalIncident.count({ where })
      ]);

      return res.json({ items, total, page, pageSize: PAGE_SIZE, pages: Math.ceil(total / PAGE_SIZE) });
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar las incidencias');
    }
  };

  // POST /:slug/admin/accounts/:accountId/emit-factura
  manualEmitForAccount = async (req: Request, res: Response) => {
    try {
      const clubId = (req as any).clubId as number;
      const accountId = String(req.params.accountId);

      // 1. Load account with client and items
      const account = await prisma.account.findFirst({
        where: { id: accountId, clubId },
        include: {
          client: { select: { name: true, dni: true } },
          items: { select: { type: true, description: true, quantity: true, unitPrice: true, total: true } }
        }
      });
      if (!account) return res.status(404).json({ error: 'Cuenta no encontrada.' });

      // 2. Check for existing active factura (avoid double billing)
      const activeFactura = await prisma.factura.findFirst({
        where: {
          clubId,
          accountId,
          status: { in: ['PENDING', 'PROCESSING', 'APPROVED', 'APPROVED_WITH_OBSERVATIONS'] }
        },
        select: { id: true, status: true }
      });
      if (activeFactura) {
        return res.status(409).json({
          error: `Ya existe un comprobante en estado ${activeFactura.status} para esta cuenta.`
        });
      }

      // 3. Load fiscal config with PdV
      const config = await prisma.configuracionFiscal.findFirst({
        where: { clubId },
        include: {
          puntosDeVentaFiscales: {
            where: { activo: true },
            orderBy: { puntoDeVenta: 'asc' },
            take: 1
          }
        }
      });
      if (!config || !config.facturacionHabilitada) {
        return res.status(400).json({ error: 'La facturación no está habilitada para este club.' });
      }
      if (config.modoFacturacion === 'DESHABILITADA') {
        return res.status(400).json({ error: 'El modo de facturación está deshabilitado.' });
      }
      if (config.proveedorFiscal !== 'ARCA') {
        return res.status(400).json({ error: 'El proveedor fiscal configurado no es ARCA.' });
      }

      const pdvFiscal = config.defaultPuntoDeVentaFiscalId
        ? await prisma.puntoDeVentaFiscal.findFirst({ where: { id: config.defaultPuntoDeVentaFiscalId, activo: true } })
        : (config.puntosDeVentaFiscales[0] ?? null);
      if (!pdvFiscal) {
        return res.status(400).json({ error: 'No hay punto de venta fiscal activo configurado.' });
      }

      // 5. Parse receptor data from body
      const bodyParsed = manualEmitSchema.safeParse(req.body);
      if (!bodyParsed.success) return sendAppError(res, zodValidationAppError(bodyParsed.error));
      const {
        receptorCondicionFiscal,
        receptorNombre: bodyNombre,
        receptorCuit,
        receptorDni,
        fechaServicioDesde,
        fechaServicioHasta,
        fechaVencimientoPago,
      } = bodyParsed.data;

      // Validate: non-CF conditions require CUIT
      if (receptorCondicionFiscal !== 'CONSUMIDOR_FINAL' && !receptorCuit) {
        return res.status(400).json({
          error: `La condición fiscal ${receptorCondicionFiscal} requiere un CUIT válido.`
        });
      }

      // RG 5824/2026 — CF con importe >= $10M requiere identificación
      if (
        receptorCondicionFiscal === 'CONSUMIDOR_FINAL' &&
        Number(account.totalAmount) >= CF_IDENTIFICATION_THRESHOLD &&
        !receptorDni && !receptorCuit
      ) {
        return res.status(400).json({
          error: `El importe supera $${CF_IDENTIFICATION_THRESHOLD.toLocaleString('es-AR')}. Se requiere DNI o CUIT del receptor (RG 5824/2026).`
        });
      }

      // Resolve docTipo + docNumero
      let receptorDocTipo: number;
      let receptorDocNumero: string;
      if (receptorCondicionFiscal !== 'CONSUMIDOR_FINAL') {
        receptorDocTipo = ARCA_DOC_TIPO.CUIT;
        receptorDocNumero = receptorCuit!;
      } else if (receptorDni) {
        receptorDocTipo = ARCA_DOC_TIPO.DNI;
        receptorDocNumero = receptorDni;
      } else {
        receptorDocTipo = ARCA_DOC_TIPO.CONSUMIDOR_FINAL;
        receptorDocNumero = '0';
      }

      const receptorCondicionIvaArcaId = CONDICION_TO_IVA_ID[receptorCondicionFiscal] ?? ARCA_CONDICION_IVA_RECEPTOR_ID.CONSUMIDOR_FINAL;
      const receptorNombre = (bodyNombre?.trim() || account.client?.name || 'Consumidor Final');

      // 6. Operation kind
      const types = account.items.map((i) => i.type as string);
      const hasProduct = types.includes('PRODUCT');
      const hasService = types.some((t) => t === 'SERVICE' || t === 'BOOKING');
      const operationKind = hasProduct && hasService ? 'MIXED' : hasProduct ? 'PRODUCT' : 'SERVICE';

      // 7. Policy resolution
      const policyService = new FiscalPolicyService();
      const resolution = policyService.resolve({
        clubId,
        provider: config.proveedorFiscal as any,
        fiscalMode: config.modoFacturacion as any,
        issuerFiscalCondition: config.condicionIva,
        receiverFiscalCondition: receptorCondicionFiscal,
        receiverDocType: receptorDocTipo,
        receiverDocNumber: receptorDocNumero,
        operationKind,
        voucherKind: 'INVOICE'
      });
      if (resolution.mode === 'INTERNAL_ONLY') {
        return res.status(400).json({ error: `No se puede emitir comprobante fiscal: ${resolution.reason}` });
      }

      // 8. Amount calculation
      const totalAmount = Number(account.totalAmount);
      const calcService = new FiscalCalculationService();
      const calcItems = account.items.length > 0
        ? account.items.map((item) => ({
            description: item.description,
            quantity: String(item.quantity),
            unitPrice: Number(item.unitPrice).toFixed(2),
            vatRate: String(DEFAULT_VAT_RATE),
            itemType: (item.type === 'PRODUCT' ? 'PRODUCT' : 'SERVICE') as 'PRODUCT' | 'SERVICE',
            priceIncludesVat: true
          }))
        : [{
            description: 'Servicio',
            quantity: '1',
            unitPrice: totalAmount.toFixed(2),
            vatRate: String(DEFAULT_VAT_RATE),
            itemType: 'SERVICE' as const,
            priceIncludesVat: true
          }];
      const calcResult = calcService.calculate({ clubId, currencyCode: 'PES', items: calcItems });

      // 9. Service dates — required for concept 2 (services) or 3 (mixed) per §55.7
      const needsServiceDates = resolution.concept === 2 || resolution.concept === 3;
      const argToday = (() => {
        const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
        d.setHours(0, 0, 0, 0);
        return d;
      })();
      const serviceDateFrom = fechaServicioDesde
        ? new Date(fechaServicioDesde)
        : needsServiceDates ? argToday : null;
      const serviceDateTo = fechaServicioHasta
        ? new Date(fechaServicioHasta)
        : needsServiceDates ? argToday : null;
      const paymentDueDate = fechaVencimientoPago
        ? new Date(fechaVencimientoPago)
        : needsServiceDates ? argToday : null;

      if (serviceDateFrom && serviceDateTo && serviceDateFrom > serviceDateTo) {
        return res.status(400).json({ error: 'La fecha de inicio de servicio no puede ser posterior a la fecha de fin.' });
      }

      // 10. Create factura + enqueue (unique key per attempt — re-emit is allowed after rejection)
      const idempotencyKey = `fiscal:manual:${accountId}:${Date.now()}`;
      const factura = await prisma.$transaction(async (tx) => {
        const newFactura = await tx.factura.create({
          data: {
            clubId,
            configuracionFiscalId: config.id,
            puntoDeVentaFiscalId: pdvFiscal.id,
            kind: 'INVOICE',
            status: 'PENDING',
            originType: 'ACCOUNT',
            originId: accountId,
            idempotencyKey,
            accountId,
            voucherClass: resolution.voucherClass,
            voucherVariant: resolution.voucherVariant,
            comprobanteTipo: resolution.comprobanteTipo,
            comprobanteDescripcion: `Factura ${resolution.voucherClass}`,
            puntoDeVenta: pdvFiscal.puntoDeVenta,
            concepto: resolution.concept,
            fechaEmision: new Date(),
            fechaServicioDesde: serviceDateFrom,
            fechaServicioHasta: serviceDateTo,
            fechaVencimientoPago: paymentDueDate,
            receptorDocTipo,
            receptorDocNumero,
            receptorNombre,
            receptorCondicionIva: receptorCondicionFiscal,
            receptorCondicionIvaArcaId,
            importeNeto: new Prisma.Decimal(calcResult.netTaxed),
            importeIva: new Prisma.Decimal(calcResult.vatAmount),
            importeExento: new Prisma.Decimal(calcResult.exemptAmount),
            importeTotal: new Prisma.Decimal(totalAmount.toFixed(2)),
            fiscalCalculationSnapshot: calcResult.snapshot as any,
            intentoActual: 0
          },
          select: { id: true, status: true }
        });

        await tx.outboxMessage.create({
          data: {
            clubId,
            type: OUTBOX_TYPES.ARCA_INVOICE_REQUESTED,
            payload: { facturaId: newFactura.id },
            dedupeKey: `arca:invoice:${newFactura.id}`,
            aggregateType: 'Factura',
            aggregateId: newFactura.id
          }
        });

        return newFactura;
      });

      return res.status(201).json({ factura });
    } catch (error) {
      return sendAppError(res, error, 'No se pudo emitir el comprobante');
    }
  };

  // POST /:slug/admin/fiscal-bandeja/facturas/:facturaId/credit-note
  createCreditNote = async (req: Request, res: Response) => {
    try {
      const clubId = (req as any).clubId as number;
      const facturaId = String(req.params.facturaId);

      // Load original approved factura
      const original = await prisma.factura.findFirst({
        where: { id: facturaId, clubId },
        include: {
          configuracionFiscal: {
            include: {
              puntosDeVentaFiscales: {
                where: { activo: true },
                orderBy: { puntoDeVenta: 'asc' },
                take: 1
              }
            }
          },
          items: true
        }
      });

      if (!original) {
        return res.status(404).json({ error: 'Comprobante no encontrado.' });
      }
      if (original.status !== 'APPROVED' && original.status !== 'APPROVED_WITH_OBSERVATIONS') {
        return res.status(400).json({ error: 'Solo se puede emitir una NC sobre un comprobante aprobado.' });
      }
      if (original.kind !== 'INVOICE') {
        return res.status(400).json({ error: 'Solo se pueden anular facturas, no otras NCs.' });
      }

      // Check a NC doesn't already exist for this invoice
      const existingNc = await prisma.factura.findFirst({
        where: { comprobanteAsociadoId: facturaId, kind: 'CREDIT_NOTE', clubId }
      });
      if (existingNc) {
        return res.status(409).json({
          error: `Ya existe una nota de crédito para este comprobante (${existingNc.id}).`
        });
      }

      const config = original.configuracionFiscal;
      if (!config.facturacionHabilitada || config.proveedorFiscal !== 'ARCA') {
        return res.status(400).json({ error: 'La facturación ARCA no está habilitada para este club.' });
      }

      const pdvFiscal = config.defaultPuntoDeVentaFiscalId
        ? await prisma.puntoDeVentaFiscal.findFirst({ where: { id: config.defaultPuntoDeVentaFiscalId, activo: true } })
        : (config.puntosDeVentaFiscales[0] ?? null);
      if (!pdvFiscal) {
        return res.status(400).json({ error: 'No hay punto de venta fiscal activo configurado.' });
      }

      // NC uses same policy as the original — but with voucherKind CREDIT_NOTE to resolve cbteTipo (3/8/13)
      const policyService = new FiscalPolicyService();
      const resolution = policyService.resolve({
        clubId,
        provider: config.proveedorFiscal as any,
        fiscalMode: config.modoFacturacion as any,
        issuerFiscalCondition: config.condicionIva,
        receiverFiscalCondition: original.receptorCondicionIva as any,
        receiverDocType: original.receptorDocTipo!,
        receiverDocNumber: original.receptorDocNumero || '0',
        operationKind: original.concepto === 1 ? 'PRODUCT' : original.concepto === 2 ? 'SERVICE' : 'MIXED',
        voucherKind: 'CREDIT_NOTE'
      });
      if (resolution.mode === 'INTERNAL_ONLY') {
        return res.status(400).json({ error: `No se puede emitir NC: ${resolution.reason}` });
      }

      // Service dates: inherit from original (NC must match original's period)
      const argToday = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
      argToday.setHours(0, 0, 0, 0);
      const needsServiceDates = resolution.concept === 2 || resolution.concept === 3;
      const serviceDateFrom = original.fechaServicioDesde ?? (needsServiceDates ? argToday : null);
      const serviceDateTo = original.fechaServicioHasta ?? (needsServiceDates ? argToday : null);
      const paymentDueDate = original.fechaVencimientoPago ?? (needsServiceDates ? argToday : null);

      const idempotencyKey = `fiscal:nc:${facturaId}:${Date.now()}`;

      const nc = await prisma.$transaction(async (tx) => {
        const newNc = await tx.factura.create({
          data: {
            clubId,
            configuracionFiscalId: config.id,
            puntoDeVentaFiscalId: pdvFiscal.id,
            kind: 'CREDIT_NOTE',
            status: 'PENDING',
            originType: original.originType,
            originId: original.originId,
            idempotencyKey,
            accountId: original.accountId,
            comprobanteAsociadoId: original.id,
            voucherClass: resolution.voucherClass,
            voucherVariant: resolution.voucherVariant,
            comprobanteTipo: resolution.comprobanteTipo,
            comprobanteDescripcion: `Nota de Crédito ${resolution.voucherClass}`,
            puntoDeVenta: pdvFiscal.puntoDeVenta,
            concepto: resolution.concept,
            monedaCodigo: original.monedaCodigo ?? 'PES',
            monedaCotizacion: original.monedaCotizacion ?? new Prisma.Decimal('1.00'),
            fechaEmision: new Date(),
            fechaServicioDesde: serviceDateFrom,
            fechaServicioHasta: serviceDateTo,
            fechaVencimientoPago: paymentDueDate,
            receptorDocTipo: original.receptorDocTipo,
            receptorDocNumero: original.receptorDocNumero,
            receptorNombre: original.receptorNombre,
            receptorCondicionIva: original.receptorCondicionIva,
            receptorCondicionIvaArcaId: original.receptorCondicionIvaArcaId,
            importeNeto: original.importeNeto,
            importeIva: original.importeIva,
            importeExento: original.importeExento,
            importeTotal: original.importeTotal,
            fiscalCalculationSnapshot: original.fiscalCalculationSnapshot ?? Prisma.JsonNull,
            intentoActual: 0
          },
          select: { id: true, status: true }
        });

        await tx.outboxMessage.create({
          data: {
            clubId,
            type: OUTBOX_TYPES.ARCA_CREDIT_NOTE_REQUESTED,
            payload: { facturaId: newNc.id },
            dedupeKey: `arca:credit-note:${newNc.id}`,
            aggregateType: 'Factura',
            aggregateId: newNc.id
          }
        });

        return newNc;
      });

      return res.status(201).json({ factura: nc });
    } catch (error) {
      return sendAppError(res, error, 'No se pudo emitir la nota de crédito');
    }
  };

  // PUT /:slug/admin/fiscal-bandeja/incidents/:incidentId/resolve
  resolveIncident = async (req: Request, res: Response) => {
    try {
      const clubId = (req as any).clubId as number;
      const incidentId = String(req.params.incidentId);

      const incident = await prisma.fiscalIncident.findFirst({ where: { id: incidentId, clubId } });
      if (!incident) return res.status(404).json({ error: 'Incidencia no encontrada.' });
      if (incident.status === 'RESOLVED') return res.status(400).json({ error: 'La incidencia ya está resuelta.' });

      const updated = await prisma.fiscalIncident.update({
        where: { id: incidentId },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
        select: { id: true, status: true, resolvedAt: true }
      });

      return res.json({ incident: updated });
    } catch (error) {
      return sendAppError(res, error, 'No se pudo resolver la incidencia');
    }
  };
}
