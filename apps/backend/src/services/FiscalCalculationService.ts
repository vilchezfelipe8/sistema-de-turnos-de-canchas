const CALCULATOR_VERSION = '2.0';

export type CalculateFiscalTotalsInput = {
  clubId: number;
  currencyCode: string;
  // When MONOTRIBUTO or EXENTO, all amounts go to exemptAmount (no IVA discrimination)
  issuerFiscalCondition?: string | null;
  items: Array<{
    code?: string;
    description: string;
    quantity: string;
    unitPrice: string;
    discountAmount?: string;
    vatRate: string;
    itemType: 'PRODUCT' | 'SERVICE';
    priceIncludesVat: boolean;
  }>;
  globalDiscountAmount?: string;
};

export type CalculateFiscalTotalsResult = {
  concept: 1 | 2 | 3;
  netTaxed: string;
  vatAmount: string;
  exemptAmount: string;
  otherTaxesAmount: string;
  totalAmount: string;
  items: Array<{
    taxableBase: string;
    vatAmount: string;
    totalAmount: string;
  }>;
  snapshot: Record<string, unknown>;
};

const toNumber = (value: string | number | undefined) => {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export class FiscalCalculationService {
  calculate(input: CalculateFiscalTotalsInput): CalculateFiscalTotalsResult {
    const globalDiscount = toNumber(input.globalDiscountAmount);

    // Monotributo and Exento issuers cannot discriminate IVA (WSFEv1: ImpNeto=0, ImpIVA=0, ImpExento=ImpTotal)
    const issuer = String(input.issuerFiscalCondition || '').toUpperCase();
    const isExemptIssuer = issuer === 'MONOTRIBUTO' || issuer === 'EXENTO';

    // First pass: gross per item before proportional global discount
    const itemGrosses = input.items.map((item) => {
      const qty = Math.max(1, toNumber(item.quantity));
      return round2(qty * toNumber(item.unitPrice) - toNumber(item.discountAmount));
    });

    const totalGross = round2(itemGrosses.reduce((s, g) => s + g, 0));

    // Second pass: apply proportional global discount per item (§36) then derive net/vat
    let netTaxedSum = 0;
    let vatSum = 0;
    let exemptSum = 0;
    let totalSum = 0;

    type ItemCalc = {
      net: number;
      vat: number;
      exempt: number;
      total: number;
      gross: number;
      perItemDiscount: number;
      proportionalGlobalDiscount: number;
    };

    const itemCalcs: ItemCalc[] = input.items.map((item, i) => {
      const rate = toNumber(item.vatRate) / 100;
      const perItemDiscount = toNumber(item.discountAmount);
      const gross = itemGrosses[i];

      const proportionalGlobalDiscount = totalGross > 0
        ? round2(globalDiscount * (gross / totalGross))
        : 0;

      const adjustedGross = round2(gross - proportionalGlobalDiscount);

      let net = 0;
      let vat = 0;
      let exempt = 0;

      if (isExemptIssuer) {
        // All goes to exempt — Monotributo/Exento cannot discriminate IVA
        exempt = adjustedGross;
      } else if (item.priceIncludesVat && rate > 0) {
        net = round2(adjustedGross / (1 + rate));
        vat = round2(adjustedGross - net);
      } else if (!item.priceIncludesVat && rate > 0) {
        net = adjustedGross;
        vat = round2(net * rate);
      } else {
        net = adjustedGross;
      }

      const total = round2(net + vat + exempt);
      netTaxedSum += net;
      vatSum += vat;
      exemptSum += exempt;
      totalSum += total;

      return { net, vat, exempt, total, gross, perItemDiscount, proportionalGlobalDiscount };
    });

    const concept: 1 | 2 | 3 = input.items.some((it) => it.itemType === 'SERVICE')
      ? input.items.some((it) => it.itemType === 'PRODUCT') ? 3 : 2
      : 1;

    const snapshot: Record<string, unknown> = {
      calculatorVersion: CALCULATOR_VERSION,
      currencyCode: input.currencyCode,
      issuerFiscalCondition: input.issuerFiscalCondition ?? null,
      isExemptIssuer,
      itemCount: input.items.length,
      globalDiscountAmount: globalDiscount.toFixed(2),
      totalGrossBeforeGlobalDiscount: totalGross.toFixed(2),
      items: itemCalcs.map((calc, i) => {
        const item = input.items[i];
        return {
          description: item.description,
          code: item.code ?? null,
          input: {
            quantity: toNumber(item.quantity),
            unitPrice: toNumber(item.unitPrice),
            perItemDiscount: calc.perItemDiscount,
            vatRate: toNumber(item.vatRate),
            priceIncludesVat: item.priceIncludesVat
          },
          proportionalGlobalDiscount: calc.proportionalGlobalDiscount,
          grossBeforeGlobalDiscount: calc.gross,
          taxableBase: calc.net,
          vatAmount: calc.vat,
          exemptAmount: calc.exempt,
          totalAmount: calc.total
        };
      }),
      roundingNote: 'Per-item rounding to 2 decimals; totals are sums of rounded items.'
    };

    return {
      concept,
      netTaxed: round2(netTaxedSum).toFixed(2),
      vatAmount: round2(vatSum).toFixed(2),
      exemptAmount: round2(exemptSum).toFixed(2),
      otherTaxesAmount: '0.00',
      totalAmount: round2(totalSum).toFixed(2),
      items: itemCalcs.map((calc) => ({
        taxableBase: calc.net.toFixed(2),
        vatAmount: calc.vat.toFixed(2),
        totalAmount: calc.total.toFixed(2)
      })),
      snapshot
    };
  }
}
