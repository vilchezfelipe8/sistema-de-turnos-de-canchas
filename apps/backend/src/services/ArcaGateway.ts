import { ArcaSoapClient } from './ArcaSoapClient';
import type { ArcaEnvironment } from '../utils/arcaConfig';

export type ArcaGatewayAuth = {
  token: string;
  sign: string;
  cuit: string;
};

// Input for FECAESolicitar (§43 — ArcaAuthorizeVoucherInput)
export type ArcaVoucherRequest = {
  environment: ArcaEnvironment;
  auth: ArcaGatewayAuth;
  pointOfSale: number;
  comprobanteTipo: number;
  voucherNumber: number;
  concept: 1 | 2 | 3;
  issuedAt: string;          // YYYYMMDD
  serviceDateFrom?: string;  // YYYYMMDD — required for concept 2 and 3 (§55.7)
  serviceDateTo?: string;    // YYYYMMDD
  paymentDueDate?: string;   // YYYYMMDD
  receiver: {
    docType: number;
    docNumber: string;
    ivaConditionArcaId: number; // required by RG 4291 v4.3 (§55.5)
  };
  amounts: {
    netTaxed: string;
    vatAmount: string;
    exemptAmount: string;
    otherTaxesAmount: string; // mapped to ImpTotConc (no gravados)
    totalAmount: string;
  };
  ivaBreakdown?: Array<{ Id: number; BaseImp: number; Importe: number }>;
  associatedVoucher?: {
    pointOfSale: number;
    voucherType: number;
    voucherNumber: number;
  };
};

// Raw response from WSFEv1 (§43 — ArcaRawAuthorizationResponse)
export type ArcaRawAuthorizationResponse = {
  rawResult: unknown;
  environment: ArcaEnvironment;
  observedAt: string;
};

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export class ArcaGateway {
  private readonly soapClient = new ArcaSoapClient();

  async getLastAuthorizedNumber(params: {
    environment: ArcaEnvironment;
    auth: ArcaGatewayAuth;
    pointOfSale: number;
    comprobanteTipo: number;
  }): Promise<number> {
    const xml = this.buildLastAuthorizedXml(params.auth, params.pointOfSale, params.comprobanteTipo);
    const result = await this.soapClient.feCompUltimoAutorizado(params.environment, xml);
    const raw = Number(result?.CbteNro ?? 0);
    return Number.isFinite(raw) ? raw : 0;
  }

  async authorizeVoucher(req: ArcaVoucherRequest): Promise<ArcaRawAuthorizationResponse> {
    const xml = this.buildAuthorizationXml(req);
    const rawResult = await this.soapClient.feCAESolicitar(req.environment, xml);
    return {
      rawResult,
      environment: req.environment,
      observedAt: new Date().toISOString()
    };
  }

  // --- private XML builders ---

  private buildLastAuthorizedXml(
    auth: ArcaGatewayAuth,
    pointOfSale: number,
    comprobanteTipo: number
  ): string {
    return (
      `<FECompUltimoAutorizado xmlns="http://ar.gov.afip.dif.FEV1/">` +
      `<Auth>` +
      `<Token>${escapeXml(auth.token)}</Token>` +
      `<Sign>${escapeXml(auth.sign)}</Sign>` +
      `<Cuit>${escapeXml(auth.cuit)}</Cuit>` +
      `</Auth>` +
      `<PtoVta>${pointOfSale}</PtoVta>` +
      `<CbteTipo>${comprobanteTipo}</CbteTipo>` +
      `</FECompUltimoAutorizado>`
    );
  }

  private buildAuthorizationXml(req: ArcaVoucherRequest): string {
    const serviceDatesBlock =
      req.serviceDateFrom && req.serviceDateTo && req.paymentDueDate
        ? `<FchServDesde>${req.serviceDateFrom}</FchServDesde>` +
          `<FchServHasta>${req.serviceDateTo}</FchServHasta>` +
          `<FchVtoPago>${req.paymentDueDate}</FchVtoPago>`
        : '';

    const ivaBlock =
      req.ivaBreakdown && req.ivaBreakdown.length > 0
        ? `<Iva>` +
          req.ivaBreakdown
            .map(
              (item) =>
                `<AlicIva>` +
                `<Id>${item.Id}</Id>` +
                `<BaseImp>${Number(item.BaseImp).toFixed(2)}</BaseImp>` +
                `<Importe>${Number(item.Importe).toFixed(2)}</Importe>` +
                `</AlicIva>`
            )
            .join('') +
          `</Iva>`
        : '';

    const associatedBlock = req.associatedVoucher
      ? `<CbtesAsoc>` +
        `<CbteAsoc>` +
        `<Tipo>${req.associatedVoucher.voucherType}</Tipo>` +
        `<PtoVta>${req.associatedVoucher.pointOfSale}</PtoVta>` +
        `<Nro>${req.associatedVoucher.voucherNumber}</Nro>` +
        `</CbteAsoc>` +
        `</CbtesAsoc>`
      : '';

    return (
      `<FECAESolicitar xmlns="http://ar.gov.afip.dif.FEV1/">` +
      `<Auth>` +
      `<Token>${escapeXml(req.auth.token)}</Token>` +
      `<Sign>${escapeXml(req.auth.sign)}</Sign>` +
      `<Cuit>${escapeXml(req.auth.cuit)}</Cuit>` +
      `</Auth>` +
      `<FeCAEReq>` +
      `<FeCabReq>` +
      `<CantReg>1</CantReg>` +
      `<PtoVta>${req.pointOfSale}</PtoVta>` +
      `<CbteTipo>${req.comprobanteTipo}</CbteTipo>` +
      `</FeCabReq>` +
      `<FeDetReq>` +
      `<FECAEDetRequest>` +
      `<Concepto>${req.concept}</Concepto>` +
      `<DocTipo>${req.receiver.docType}</DocTipo>` +
      `<DocNro>${escapeXml(req.receiver.docNumber || '0')}</DocNro>` +
      `<CbteDesde>${req.voucherNumber}</CbteDesde>` +
      `<CbteHasta>${req.voucherNumber}</CbteHasta>` +
      `<CbteFch>${req.issuedAt}</CbteFch>` +
      `<ImpTotal>${Number(req.amounts.totalAmount).toFixed(2)}</ImpTotal>` +
      `<ImpTotConc>${Number(req.amounts.otherTaxesAmount).toFixed(2)}</ImpTotConc>` +
      `<ImpNeto>${Number(req.amounts.netTaxed).toFixed(2)}</ImpNeto>` +
      `<ImpOpEx>${Number(req.amounts.exemptAmount).toFixed(2)}</ImpOpEx>` +
      `<ImpIVA>${Number(req.amounts.vatAmount).toFixed(2)}</ImpIVA>` +
      `<ImpTrib>0.00</ImpTrib>` +
      `<MonId>PES</MonId>` +
      `<MonCotiz>1.00</MonCotiz>` +
      serviceDatesBlock +
      `<CondicionIVAReceptorId>${req.receiver.ivaConditionArcaId}</CondicionIVAReceptorId>` +
      ivaBlock +
      associatedBlock +
      `</FECAEDetRequest>` +
      `</FeDetReq>` +
      `</FeCAEReq>` +
      `</FECAESolicitar>`
    );
  }
}
