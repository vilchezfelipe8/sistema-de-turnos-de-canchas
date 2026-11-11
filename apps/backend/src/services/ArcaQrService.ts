import QRCode from 'qrcode';
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/Argentina/Buenos_Aires';
const QR_BASE_URL = 'https://www.arca.gob.ar/fe/qr/';

// RG 4291 §6 — payload del QR reglamentario
export type ArcaQrPayload = {
  ver: 1;
  fecha: string;       // YYYY-MM-DD
  cuit: string;        // CUIT emisor sin guiones
  ptoVta: number;
  tipoCmp: number;
  nroCmp: number;
  importe: number;
  moneda: string;      // "PES"
  ctz: number;
  tipoDocRec: number;
  nroDocRec: number;   // 0 para consumidor final
  tipoCodAut: 'E';     // E = CAE
  codAut: string;
};

type FacturaForQr = {
  fechaEmision: Date;
  puntoDeVenta: number;
  comprobanteTipo: number;
  numeroComprobante: number;
  importeTotal: { toNumber(): number } | number | string;
  monedaCodigo: string;
  monedaCotizacion: { toNumber(): number } | number | string;
  receptorDocTipo: number;
  receptorDocNumero: string | null;
  cae: string;
};

const coerceNumber = (v: { toNumber(): number } | number | string): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return v.toNumber();
};

export class ArcaQrService {
  buildPayload(factura: FacturaForQr, cuit: string): ArcaQrPayload {
    return {
      ver: 1,
      fecha: formatInTimeZone(factura.fechaEmision, TZ, 'yyyy-MM-dd'),
      cuit: cuit.replace(/\D/g, ''),
      ptoVta: factura.puntoDeVenta,
      tipoCmp: factura.comprobanteTipo,
      nroCmp: factura.numeroComprobante,
      importe: Math.round(coerceNumber(factura.importeTotal) * 100) / 100,
      moneda: factura.monedaCodigo || 'PES',
      ctz: Math.round(coerceNumber(factura.monedaCotizacion) * 10000) / 10000,
      tipoDocRec: factura.receptorDocTipo,
      nroDocRec: factura.receptorDocNumero
        ? parseInt(factura.receptorDocNumero, 10) || 0
        : 0,
      tipoCodAut: 'E',
      codAut: factura.cae
    };
  }

  encodePayload(payload: ArcaQrPayload): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  buildQrUrl(payload: ArcaQrPayload): string {
    return `${QR_BASE_URL}?p=${this.encodePayload(payload)}`;
  }

  async generateSvg(url: string): Promise<string> {
    return QRCode.toString(url, {
      type: 'svg',
      width: 140,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' }
    });
  }
}
