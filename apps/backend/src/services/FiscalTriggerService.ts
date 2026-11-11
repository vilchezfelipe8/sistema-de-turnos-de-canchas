import { Prisma } from '@prisma/client';
import { FiscalPolicyService } from './FiscalPolicyService';
import { FiscalCalculationService } from './FiscalCalculationService';
import { OutboxService, OUTBOX_TYPES } from './OutboxService';
import { ARCA_CONDICION_IVA_RECEPTOR_ID, ARCA_DOC_TIPO } from '../utils/arcaCodes';
import { arcaConfig } from '../utils/arcaConfig';

// Sports services in Argentina: 21% VAT included in price
const DEFAULT_VAT_RATE = 21;

const resolveOperationKind = (types: string[]): 'PRODUCT' | 'SERVICE' | 'MIXED' => {
  const hasProduct = types.includes('PRODUCT');
  const hasService = types.some((t) => t === 'SERVICE' || t === 'BOOKING');
  if (hasProduct && hasService) return 'MIXED';
  if (hasProduct) return 'PRODUCT';
  return 'SERVICE';
};

export class FiscalTriggerService {
  private readonly policyService = new FiscalPolicyService();
  private readonly calcService = new FiscalCalculationService();
  private readonly outboxService = new OutboxService();

  async triggerForPayment(
    tx: Prisma.TransactionClient,
    input: {
      clubId: number;
      paymentId: string;
      accountId: string;
      paymentAmount: number;
    }
  ): Promise<void> {
    try {
      await this.run(tx, input);
    } catch (err) {
      // Non-blocking: payment creation must never fail due to fiscal issues
      console.error('[FiscalTriggerService] Error al disparar factura fiscal:', err);
    }
  }

  private async run(
    tx: Prisma.TransactionClient,
    input: { clubId: number; paymentId: string; accountId: string; paymentAmount: number }
  ): Promise<void> {
    const { clubId, paymentId, accountId, paymentAmount } = input;

    // 1. Load fiscal config with default PdV and active PdVs
    const config = await tx.configuracionFiscal.findFirst({
      where: { clubId },
      include: {
        puntosDeVentaFiscales: {
          where: { activo: true },
          orderBy: { puntoDeVenta: 'asc' },
          take: 1
        }
      }
    });

    // Global kill switch: ARCA_ENABLED=false stops all automatic fiscal processing
    if (!arcaConfig.enabled) return;

    if (!config || !config.facturacionHabilitada) return;
    // OPCIONAL means the operator triggers manually — automatic path only runs for OBLIGATORIA
    if (config.modoFacturacion !== 'OBLIGATORIA') return;
    if (config.proveedorFiscal !== 'ARCA') return;

    // 2. Idempotency: skip if factura already exists for this payment
    const existing = await tx.factura.findFirst({
      where: { clubId, idempotencyKey: `fiscal:payment:${paymentId}` },
      select: { id: true }
    });
    if (existing) return;

    // 3. Resolve punto de venta
    const pdvFiscal = config.defaultPuntoDeVentaFiscalId
      ? await tx.puntoDeVentaFiscal.findFirst({
          where: { id: config.defaultPuntoDeVentaFiscalId, activo: true }
        })
      : (config.puntosDeVentaFiscales[0] ?? null);

    if (!pdvFiscal) {
      console.warn(`[FiscalTriggerService] club ${clubId}: sin punto de venta fiscal activo, omitiendo.`);
      return;
    }

    // 4. Load account with client and items
    const account = await tx.account.findUnique({
      where: { id: accountId },
      include: {
        client: { select: { name: true, dni: true } },
        items: {
          select: { type: true, description: true, quantity: true, unitPrice: true, total: true }
        }
      }
    });
    if (!account) return;

    // 5. Receptor data — v1: always CONSUMIDOR_FINAL
    const client = account.client;
    const receptorNombre = client?.name ?? 'Consumidor Final';
    const rawDni = client?.dni?.replace(/\D/g, '') ?? '';
    const hasDni = rawDni.length >= 7 && rawDni.length <= 8;
    const receptorDocTipo = hasDni ? ARCA_DOC_TIPO.DNI : ARCA_DOC_TIPO.CONSUMIDOR_FINAL;
    const receptorDocNumero = hasDni ? rawDni : '0';
    const receptorCondicionIvaArcaId = ARCA_CONDICION_IVA_RECEPTOR_ID.CONSUMIDOR_FINAL;

    // 6. Operation kind from items
    const operationKind = resolveOperationKind(
      account.items.length > 0 ? account.items.map((i) => i.type as string) : ['SERVICE']
    );

    // 7. Fiscal policy resolution
    const resolution = this.policyService.resolve({
      clubId,
      provider: config.proveedorFiscal as any,
      fiscalMode: config.modoFacturacion as any,
      issuerFiscalCondition: config.condicionIva,
      receiverFiscalCondition: 'CONSUMIDOR_FINAL',
      receiverDocType: receptorDocTipo,
      receiverDocNumber: receptorDocNumero,
      operationKind,
      voucherKind: 'INVOICE'
    });

    if (resolution.mode === 'INTERNAL_ONLY') {
      console.log(`[FiscalTriggerService] pago ${paymentId} — INTERNAL_ONLY: ${resolution.reason}`);
      return;
    }

    // 8. Fiscal amount calculation
    // Pro-rate payment amount across items if partial payment
    const itemsTotal = account.items.reduce((s, i) => s + Number(i.total), 0);
    const ratio = itemsTotal > 0 ? paymentAmount / itemsTotal : 1;

    const calcItems =
      account.items.length > 0
        ? account.items.map((item) => ({
            description: item.description,
            quantity: String(item.quantity),
            unitPrice:
              ratio !== 1
                ? (Number(item.total) * ratio / Math.max(1, item.quantity)).toFixed(2)
                : (Number(item.unitPrice)).toFixed(2),
            vatRate: String(DEFAULT_VAT_RATE),
            itemType: (item.type === 'PRODUCT' ? 'PRODUCT' : 'SERVICE') as 'PRODUCT' | 'SERVICE',
            priceIncludesVat: true
          }))
        : [
            {
              description: 'Servicio',
              quantity: '1',
              unitPrice: paymentAmount.toFixed(2),
              vatRate: String(DEFAULT_VAT_RATE),
              itemType: 'SERVICE' as const,
              priceIncludesVat: true
            }
          ];

    const calcResult = this.calcService.calculate({
      clubId,
      currencyCode: 'PES',
      issuerFiscalCondition: config.condicionIva,
      items: calcItems
    });

    // §55.7 — service dates required for concepto 2 (SERVICE) and 3 (MIXED)
    const argToday = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
    argToday.setHours(0, 0, 0, 0);
    const needsServiceDates = calcResult.concept === 2 || calcResult.concept === 3;

    // 9. Persist Factura record
    const factura = await tx.factura.create({
      data: {
        clubId,
        configuracionFiscalId: config.id,
        puntoDeVentaFiscalId: pdvFiscal.id,
        kind: 'INVOICE',
        status: 'PENDING',
        originType: 'ACCOUNT',
        originId: accountId,
        idempotencyKey: `fiscal:payment:${paymentId}`,
        accountId,
        voucherClass: resolution.voucherClass,
        voucherVariant: resolution.voucherVariant,
        comprobanteTipo: resolution.comprobanteTipo,
        comprobanteDescripcion: `Factura ${resolution.voucherClass}`,
        puntoDeVenta: pdvFiscal.puntoDeVenta,
        concepto: resolution.concept,
        fechaEmision: new Date(),
        ...(needsServiceDates && {
          fechaServicioDesde: argToday,
          fechaServicioHasta: argToday,
          fechaVencimientoPago: argToday
        }),
        receptorDocTipo,
        receptorDocNumero,
        receptorNombre,
        receptorCondicionIva: 'CONSUMIDOR_FINAL',
        receptorCondicionIvaArcaId,
        monedaCodigo: 'PES',
        monedaCotizacion: new Prisma.Decimal('1.00'),
        importeNeto: new Prisma.Decimal(calcResult.netTaxed),
        importeIva: new Prisma.Decimal(calcResult.vatAmount),
        importeExento: new Prisma.Decimal(calcResult.exemptAmount),
        importeTotal: new Prisma.Decimal(paymentAmount.toFixed(2)),
        fiscalCalculationSnapshot: calcResult.snapshot as any,
        intentoActual: 0
      },
      select: { id: true }
    });

    // 10. Enqueue for async processing — dedupeKey per-factura to avoid unique constraint conflicts
    await this.outboxService.enqueue(
      {
        clubId,
        type: OUTBOX_TYPES.ARCA_INVOICE_REQUESTED,
        payload: { facturaId: factura.id },
        dedupeKey: `arca:invoice:${factura.id}`,
        aggregateType: 'Factura',
        aggregateId: factura.id
      },
      tx
    );

    console.log(`[FiscalTriggerService] Factura ${factura.id} creada y encolada para pago ${paymentId}`);
  }
}
