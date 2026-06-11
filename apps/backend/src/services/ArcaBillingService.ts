import forge from 'node-forge';
import { createHash } from 'crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { Prisma } from '@prisma/client';
import { decryptIntegrationSecret } from '../utils/integrationSecrets';
import { arcaConfig, ArcaEnvironment } from '../utils/arcaConfig';
import { ArcaSoapClient } from './ArcaSoapClient';

// Tipos locales — reemplazar con enums de dominio en PR3 (ArcaAuthService + ArcaGateway)
type BillingEnvironment = ArcaEnvironment;
type ReceiverDocumentType = 'CUIT' | 'CUIL' | 'DNI' | 'PASSPORT' | 'OTHER';
type InvoiceDocumentType =
  | 'INVOICE_A' | 'DEBIT_NOTE_A' | 'CREDIT_NOTE_A' | 'RECEIPT_A'
  | 'INVOICE_B' | 'DEBIT_NOTE_B' | 'CREDIT_NOTE_B' | 'RECEIPT_B'
  | 'INVOICE_C' | 'DEBIT_NOTE_C' | 'CREDIT_NOTE_C' | 'RECEIPT_C';

const TRA_TIME_SKEW_MS = 5 * 60 * 1000;
const AUTH_CACHE_SKEW_MS = 60 * 1000;

const DOC_TYPE_BY_RECEIVER: Record<ReceiverDocumentType, number> = {
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  PASSPORT: 94,
  OTHER: 99
};

const CBTE_TYPE_BY_DOCUMENT: Record<InvoiceDocumentType, number> = {
  INVOICE_A: 1,
  DEBIT_NOTE_A: 2,
  CREDIT_NOTE_A: 3,
  RECEIPT_A: 4,
  INVOICE_B: 6,
  DEBIT_NOTE_B: 7,
  CREDIT_NOTE_B: 8,
  RECEIPT_B: 9,
  INVOICE_C: 11,
  DEBIT_NOTE_C: 12,
  CREDIT_NOTE_C: 13,
  RECEIPT_C: 15
};

const DEFAULT_DOC_TYPE = 99;

const toNumber = (value: unknown) => Number(value || 0);

const formatAfipDate = (date: Date) =>
  formatInTimeZone(date, 'America/Argentina/Buenos_Aires', 'yyyyMMdd');

const buildTraXml = (service: string) => {
  const now = Date.now();
  const generationTime = new Date(now - TRA_TIME_SKEW_MS).toISOString();
  const expirationTime = new Date(now + TRA_TIME_SKEW_MS).toISOString();
  const uniqueId = Math.floor(now / 1000);

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header>` +
    `<uniqueId>${uniqueId}</uniqueId>` +
    `<generationTime>${generationTime}</generationTime>` +
    `<expirationTime>${expirationTime}</expirationTime>` +
    `</header>` +
    `<service>${service}</service>` +
    `</loginTicketRequest>`
  );
};

const inferDocType = (receiverTaxId?: string | null): number => {
  const normalized = String(receiverTaxId || '').replace(/\D/g, '');
  if (normalized.length === 11) return DOC_TYPE_BY_RECEIVER.CUIT;
  if (normalized.length === 8) return DOC_TYPE_BY_RECEIVER.DNI;
  return DEFAULT_DOC_TYPE;
};

const signCms = (traXml: string, certPem: string, keyPem: string) => {
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);
  const p7 = forge.pkcs7.createSignedData();

  p7.content = forge.util.createBuffer(traXml, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      {
        type: forge.pki.oids.contentType,
        value: forge.pki.oids.data
      },
      {
        type: forge.pki.oids.messageDigest
      },
      {
        type: forge.pki.oids.signingTime,
        value: new Date().toISOString()
      }
    ]
  });

  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(der, 'binary').toString('base64');
};

const extractIvaBreakdown = (taxBreakdown: Prisma.JsonValue | null | undefined) => {
  if (!taxBreakdown || typeof taxBreakdown !== 'object') return null;
  const value = taxBreakdown as any;
  if (!Array.isArray(value.iva)) return null;

  const items = value.iva
    .map((entry: any) => ({
      Id: Number(entry.id || 0),
      BaseImp: Number(entry.base || 0),
      Importe: Number(entry.amount || 0)
    }))
    .filter((entry: any) => Number.isFinite(entry.Id) && entry.Id > 0 && entry.BaseImp >= 0);

  return items.length > 0 ? items : null;
};

export type ArcaAuthTicket = {
  token: string;
  sign: string;
  expirationTime: string;
};

export type ArcaInvoiceResult = {
  approved: boolean;
  result: string;
  cae?: string | null;
  caeExpiresAt?: Date | null;
  cbteNumber?: number | null;
  response: any;
  observations?: any;
  errors?: any;
};

export class ArcaBillingService {
  private readonly soapClient = new ArcaSoapClient();
  private readonly authCache = new Map<string, { token: string; sign: string; expiresAt: number }>();

  async getAuthTicket(params: {
    environment: BillingEnvironment;
    certificateEnc: string | null;
    privateKeyEnc: string | null;
  }): Promise<ArcaAuthTicket> {
    if (!params.certificateEnc || !params.privateKeyEnc) {
      throw new Error('Certificado o clave privada faltante');
    }

    const fingerprint = createHash('sha256').update(params.certificateEnc).digest('hex').slice(0, 16);
    const cacheKey = `${params.environment}:${fingerprint}`;
    const cached = this.authCache.get(cacheKey);
    if (cached && cached.expiresAt - Date.now() > AUTH_CACHE_SKEW_MS) {
      return {
        token: cached.token,
        sign: cached.sign,
        expirationTime: new Date(cached.expiresAt).toISOString()
      };
    }

    const certPem = decryptIntegrationSecret(params.certificateEnc);
    const keyPem = decryptIntegrationSecret(params.privateKeyEnc);
    if (!certPem || !keyPem) {
      throw new Error('No se pudo descifrar certificado o clave');
    }

    const traXml = buildTraXml(arcaConfig.wsaaService);
    const cms = signCms(traXml, certPem, keyPem);
    const ticket = await this.soapClient.loginCms(params.environment, cms);

    if (!ticket.token || !ticket.sign) {
      throw new Error('WSAA no devolvio token o sign');
    }

    const expiresAt = Date.parse(ticket.expirationTime || '') || Date.now() + 5 * 60 * 1000;
    if (ticket.token && ticket.sign) {
      this.authCache.set(cacheKey, {
        token: ticket.token,
        sign: ticket.sign,
        expiresAt
      });
    }

    return ticket;
  }

  async issueInvoice(params: {
    environment: BillingEnvironment;
    issuerTaxId: string;
    pointOfSaleNumber: number;
    documentType: InvoiceDocumentType;
    receiverTaxId?: string | null;
    receiverDocType?: ReceiverDocumentType | null;
    totalAmount: number;
    netAmount?: number | null;
    taxAmount?: number | null;
    exemptAmount?: number | null;
    taxBreakdown?: Prisma.JsonValue | null;
    auth: ArcaAuthTicket;
  }): Promise<ArcaInvoiceResult> {
    const cbteTipo = CBTE_TYPE_BY_DOCUMENT[params.documentType];
    const docType = params.receiverDocType
      ? DOC_TYPE_BY_RECEIVER[params.receiverDocType]
      : inferDocType(params.receiverTaxId);
    const docNumber = Number(params.receiverTaxId || 0);

    const last = await this.soapClient.feCompUltimoAutorizado(
      params.environment,
      this.buildFeCompUltimoAutorizadoXml(params.auth, params.issuerTaxId, params.pointOfSaleNumber, cbteTipo)
    );

    const lastNumber = Number(last?.CbteNro || 0);
    const nextNumber = Number.isFinite(lastNumber) ? lastNumber + 1 : 1;

    const netAmount = Number(params.netAmount ?? params.totalAmount);
    const taxAmount = Number(params.taxAmount ?? 0);
    const exemptAmount = Number(params.exemptAmount ?? 0);
    const totalAmount = Number(params.totalAmount);
    const ivaItems = extractIvaBreakdown(params.taxBreakdown);

    const requestXml = this.buildFeCaeSolicitarXml({
      auth: params.auth,
      issuerTaxId: params.issuerTaxId,
      pointOfSaleNumber: params.pointOfSaleNumber,
      cbteTipo,
      cbteNumber: nextNumber,
      docType,
      docNumber,
      totalAmount,
      netAmount,
      taxAmount,
      exemptAmount,
      ivaItems
    });

    const response = await this.soapClient.feCAESolicitar(params.environment, requestXml);
    if (!response) {
      throw new Error('Respuesta ARCA vacia');
    }
    const det = response?.FeDetResp?.FECAEDetResponse || response?.FeDetResp?.FECAEDetResponse?.[0] || response?.FeDetResp?.FECAEDetResponse;

    const result = String(det?.Resultado || response?.FeCabResp?.Resultado || '').trim();
    const cae = det?.CAE ? String(det.CAE).trim() : null;
    const caeVto = det?.CAEFchVto ? String(det.CAEFchVto).trim() : null;
    const caeExpiresAt = caeVto ? this.parseAfipDate(caeVto) : null;

    const approved = result === 'A' && Boolean(cae);

    return {
      approved,
      result,
      cae,
      caeExpiresAt,
      cbteNumber: nextNumber,
      response,
      observations: response?.FeDetResp?.FECAEDetResponse?.Observaciones || null,
      errors: response?.Errors || null
    };
  }

  private buildFeCompUltimoAutorizadoXml(
    auth: ArcaAuthTicket,
    issuerTaxId: string,
    pointOfSaleNumber: number,
    cbteTipo: number
  ) {
    return (
      `<FECompUltimoAutorizado xmlns="http://ar.gov.afip.dif.FEV1/">` +
      `<Auth>` +
      `<Token>${auth.token}</Token>` +
      `<Sign>${auth.sign}</Sign>` +
      `<Cuit>${issuerTaxId}</Cuit>` +
      `</Auth>` +
      `<PtoVta>${pointOfSaleNumber}</PtoVta>` +
      `<CbteTipo>${cbteTipo}</CbteTipo>` +
      `</FECompUltimoAutorizado>`
    );
  }

  private buildFeCaeSolicitarXml(params: {
    auth: ArcaAuthTicket;
    issuerTaxId: string;
    pointOfSaleNumber: number;
    cbteTipo: number;
    cbteNumber: number;
    docType: number;
    docNumber: number;
    totalAmount: number;
    netAmount: number;
    taxAmount: number;
    exemptAmount: number;
    ivaItems: Array<{ Id: number; BaseImp: number; Importe: number }> | null;
  }) {
    const today = formatAfipDate(new Date());
    const ivaBlock = params.ivaItems && params.ivaItems.length > 0
      ? `<Iva>` +
          params.ivaItems
            .map((item) =>
              `<AlicIva>` +
              `<Id>${item.Id}</Id>` +
              `<BaseImp>${item.BaseImp.toFixed(2)}</BaseImp>` +
              `<Importe>${item.Importe.toFixed(2)}</Importe>` +
              `</AlicIva>`
            )
            .join('') +
        `</Iva>`
      : '';

    return (
      `<FECAESolicitar xmlns="http://ar.gov.afip.dif.FEV1/">` +
      `<Auth>` +
      `<Token>${params.auth.token}</Token>` +
      `<Sign>${params.auth.sign}</Sign>` +
      `<Cuit>${params.issuerTaxId}</Cuit>` +
      `</Auth>` +
      `<FeCAEReq>` +
      `<FeCabReq>` +
      `<CantReg>1</CantReg>` +
      `<PtoVta>${params.pointOfSaleNumber}</PtoVta>` +
      `<CbteTipo>${params.cbteTipo}</CbteTipo>` +
      `</FeCabReq>` +
      `<FeDetReq>` +
      `<FECAEDetRequest>` +
      `<Concepto>1</Concepto>` +
      `<DocTipo>${params.docType}</DocTipo>` +
      `<DocNro>${params.docNumber || 0}</DocNro>` +
      `<CbteDesde>${params.cbteNumber}</CbteDesde>` +
      `<CbteHasta>${params.cbteNumber}</CbteHasta>` +
      `<CbteFch>${today}</CbteFch>` +
      `<ImpTotal>${params.totalAmount.toFixed(2)}</ImpTotal>` +
      `<ImpTotConc>0.00</ImpTotConc>` +
      `<ImpNeto>${params.netAmount.toFixed(2)}</ImpNeto>` +
      `<ImpOpEx>${params.exemptAmount.toFixed(2)}</ImpOpEx>` +
      `<ImpIVA>${params.taxAmount.toFixed(2)}</ImpIVA>` +
      `<ImpTrib>0.00</ImpTrib>` +
      `<MonId>PES</MonId>` +
      `<MonCotiz>1.00</MonCotiz>` +
      `${ivaBlock}` +
      `</FECAEDetRequest>` +
      `</FeDetReq>` +
      `</FeCAEReq>` +
      `</FECAESolicitar>`
    );
  }

  private parseAfipDate(value: string) {
    if (!value || value.length !== 8) return null;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    if (!year || !month || !day) return null;
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  }
}
