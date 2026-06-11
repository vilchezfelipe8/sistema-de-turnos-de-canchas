import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { formatInTimeZone } from 'date-fns-tz';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { ArcaQrService } from './ArcaQrService';

const TZ = 'America/Argentina/Buenos_Aires';

// Etiquetas de condición IVA para mostrar en el comprobante
const IVA_LABEL: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  EXENTO: 'Exento',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  MONOTRIBUTO: 'Monotributo',
  NO_CATEGORIZADO: 'No Categorizado'
};

const DOC_TIPO_LABEL: Record<number, string> = {
  80: 'CUIT',
  86: 'CUIL',
  87: 'CDI',
  91: 'C.I. Extranjera',
  94: 'Pasaporte',
  96: 'DNI',
  99: 'Consumidor Final'
};

const formatMoney = (v: unknown): string => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatDate = (d: Date): string =>
  formatInTimeZone(d, TZ, 'dd/MM/yyyy');

const formatCuit = (cuit: string): string => {
  const d = cuit.replace(/\D/g, '');
  if (d.length !== 11) return cuit;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d[10]}`;
};

const padLeft = (n: number, len: number) => String(n).padStart(len, '0');

const getVoucherLetter = (tipoCmp: number): string => {
  if ((tipoCmp >= 1 && tipoCmp <= 5) || (tipoCmp >= 51 && tipoCmp <= 55)) return 'A';
  if (tipoCmp >= 6 && tipoCmp <= 10) return 'B';
  if (tipoCmp >= 11 && tipoCmp <= 15) return 'C';
  return '';
};

// Carga todos los datos necesarios para el comprobante
const loadFacturaForReceipt = (facturaId: string) =>
  prisma.factura.findUnique({
    where: { id: facturaId },
    include: {
      configuracionFiscal: {
        select: {
          razonSocial: true,
          cuit: true,
          condicionIva: true,
          ingresosBrutos: true,
          inicioActividadesAt: true,
          usaHomologacion: true
        }
      },
      club: {
        select: { name: true, addressLine: true, city: true, province: true }
      },
      items: { orderBy: { createdAt: 'asc' } }
    }
  });

type FacturaForReceipt = NonNullable<Awaited<ReturnType<typeof loadFacturaForReceipt>>>;

const buildReceiptHtml = (factura: FacturaForReceipt, qrSvg: string): string => {
  const cfg = factura.configuracionFiscal;
  const club = factura.club;

  const razonSocial = cfg.razonSocial || club.name;
  const cuit = cfg.cuit || '';
  const condicionIva = cfg.condicionIva ? (IVA_LABEL[cfg.condicionIva] ?? cfg.condicionIva) : '';
  const address = [club.addressLine, club.city, club.province].filter(Boolean).join(', ');
  const ingresosBrutos = cfg.ingresosBrutos || '';
  const inicioActividades = cfg.inicioActividadesAt ? formatDate(cfg.inicioActividadesAt) : '';

  const tipoCmp = factura.comprobanteTipo ?? 0;
  const letter = getVoucherLetter(tipoCmp);
  const comprobanteDesc = factura.comprobanteDescripcion || `Factura ${letter}`;
  const ptoVta = padLeft(factura.puntoDeVenta ?? 0, 4);
  const nroCmp = padLeft(factura.numeroComprobante ?? 0, 8);
  const fechaEmision = formatDate(factura.fechaEmision);

  const docTipoLabel = factura.receptorDocTipo
    ? (DOC_TIPO_LABEL[factura.receptorDocTipo] ?? String(factura.receptorDocTipo))
    : '';
  const docNumero = factura.receptorDocNumero || '';
  const receptorNombre = factura.receptorNombre || '';
  const receptorCondicion = factura.receptorCondicionIva
    ? (IVA_LABEL[factura.receptorCondicionIva] ?? factura.receptorCondicionIva)
    : '';

  const itemRows = factura.items.map((item) => `
    <tr>
      <td>${item.description}</td>
      <td class="right">${Number(item.quantity).toFixed(2)}</td>
      <td class="right">$ ${formatMoney(item.unitPrice)}</td>
      <td class="right">${Number(item.vatRate).toFixed(1)}%</td>
      <td class="right">$ ${formatMoney(item.totalAmount)}</td>
    </tr>`).join('');

  const caeVto = factura.caeVencimiento ? formatDate(factura.caeVencimiento) : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${comprobanteDesc} ${ptoVta}-${nroCmp}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:12px;color:#000;max-width:680px;margin:0 auto;padding:24px}
  .header{display:flex;border:2px solid #000;margin-bottom:8px}
  .h-issuer{flex:1;padding:10px 12px;border-right:2px solid #000}
  .h-type{width:110px;padding:10px 8px;text-align:center;border-right:2px solid #000;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .h-type .letter{font-size:48px;font-weight:bold;line-height:1}
  .h-number{flex:1;padding:10px 12px;text-align:right}
  .bold{font-weight:bold}
  .section{border:1px solid #000;padding:8px 12px;margin-bottom:8px;font-size:11px}
  .section-title{font-weight:bold;margin-bottom:4px;font-size:12px}
  .row{display:flex;gap:16px}
  .row .field{flex:1}
  table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px}
  th,td{border:1px solid #000;padding:4px 8px}
  th{background:#f0f0f0;font-size:11px}
  .right{text-align:right}
  .amounts-table{width:260px;margin-left:auto}
  .amounts-table td{border:1px solid #000;padding:3px 8px}
  .amounts-table .label{font-weight:normal}
  .amounts-table .total{font-weight:bold;font-size:13px}
  .footer{display:flex;gap:16px;border:1px solid #000;padding:10px;margin-top:8px;align-items:center}
  .footer .cae-info{flex:1;font-size:11px}
  .footer .qr-box{flex:0 0 auto}
  .footer .qr-box svg{display:block}
  .env-badge{background:#ff9900;color:#000;font-weight:bold;padding:2px 8px;font-size:10px;text-align:center;margin-bottom:8px}
</style>
</head>
<body>
${cfg.usaHomologacion ? '<div class="env-badge">HOMOLOGACIÓN — NO VÁLIDO COMO COMPROBANTE FISCAL</div>' : ''}
<div class="header">
  <div class="h-issuer">
    <div class="bold" style="font-size:14px">${razonSocial}</div>
    <div>CUIT: ${formatCuit(cuit)}</div>
    <div>IVA: ${condicionIva}</div>
    <div>${address}</div>
    ${ingresosBrutos ? `<div>Ing. Brutos: ${ingresosBrutos}</div>` : ''}
    ${inicioActividades ? `<div>Inicio actividades: ${inicioActividades}</div>` : ''}
  </div>
  <div class="h-type">
    <div class="letter">${letter}</div>
    <div style="font-size:10px;margin-top:4px">${comprobanteDesc}</div>
    <div style="font-size:10px">Cód. ${padLeft(tipoCmp, 2)}</div>
  </div>
  <div class="h-number">
    <div>Punto de venta: <span class="bold">${ptoVta}</span></div>
    <div>Comp. Nro: <span class="bold">${nroCmp}</span></div>
    <div>Fecha: <span class="bold">${fechaEmision}</span></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Datos del receptor</div>
  <div class="row">
    <div class="field"><span class="bold">${docTipoLabel}:</span> ${docNumero}</div>
    ${receptorNombre ? `<div class="field"><span class="bold">Nombre/Razón social:</span> ${receptorNombre}</div>` : ''}
    ${receptorCondicion ? `<div class="field"><span class="bold">IVA:</span> ${receptorCondicion}</div>` : ''}
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>Descripción</th>
      <th class="right" style="width:70px">Cantidad</th>
      <th class="right" style="width:90px">Precio unit.</th>
      <th class="right" style="width:60px">IVA</th>
      <th class="right" style="width:90px">Subtotal</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows || '<tr><td colspan="5" style="text-align:center">—</td></tr>'}
  </tbody>
</table>

<table class="amounts-table">
  <tr><td class="label">Neto gravado</td><td class="right">$ ${formatMoney(factura.importeNeto)}</td></tr>
  <tr><td class="label">IVA</td><td class="right">$ ${formatMoney(factura.importeIva)}</td></tr>
  ${Number(factura.importeExento) > 0 ? `<tr><td class="label">Exento</td><td class="right">$ ${formatMoney(factura.importeExento)}</td></tr>` : ''}
  <tr><td class="total">Total</td><td class="right total">$ ${formatMoney(factura.importeTotal)}</td></tr>
</table>

<div class="footer">
  <div class="cae-info">
    <div><span class="bold">CAE:</span> ${factura.cae ?? '—'}</div>
    <div><span class="bold">Vto. CAE:</span> ${caeVto || '—'}</div>
    <div style="margin-top:8px;font-size:10px">Comprobante emitido mediante ARCA — WSFEv1</div>
  </div>
  <div class="qr-box">${qrSvg}</div>
</div>
</body>
</html>`;
};

export class ArcaReceiptService {
  private readonly qrService = new ArcaQrService();

  async render(facturaId: string): Promise<void> {
    const factura = await loadFacturaForReceipt(facturaId);

    if (!factura) return;
    if (factura.status !== 'APPROVED' && factura.status !== 'APPROVED_WITH_OBSERVATIONS') return;
    if (!factura.cae || !factura.puntoDeVenta || !factura.comprobanteTipo || !factura.numeroComprobante) return;

    const cuit = factura.configuracionFiscal.cuit ?? '';

    // Generar QR
    const qrPayload = this.qrService.buildPayload(factura as any, cuit);
    const qrUrl = this.qrService.buildQrUrl(qrPayload);
    const qrPayloadBase64 = this.qrService.encodePayload(qrPayload);
    const qrSvg = await this.qrService.generateSvg(qrUrl);

    // Generar HTML del comprobante
    const html = buildReceiptHtml(factura, qrSvg);

    // Intentar subir a S3 (no fatal)
    let receiptUrl: string | null = null;
    try {
      receiptUrl = await this.uploadHtml(html, facturaId);
    } catch {
      // No bloquea — el QR siempre se guarda aunque el upload falle
    }

    await prisma.factura.update({
      where: { id: facturaId },
      data: {
        qrPayloadBase64,
        qrUrl,
        ...(receiptUrl ? { pdfUrl: receiptUrl, internalReceiptUrl: receiptUrl } : {})
      }
    });
  }

  private async uploadHtml(html: string, facturaId: string): Promise<string | null> {
    const bucket = process.env.S3_BUCKET?.trim();
    const region = process.env.S3_REGION?.trim();
    const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();

    if (!bucket || !region || !accessKeyId || !secretAccessKey) return null;

    const client = new S3Client({
      region,
      endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      credentials: { accessKeyId, secretAccessKey }
    });

    const key = `fiscal/receipts/${facturaId}.html`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from(html, 'utf-8'),
        ContentType: 'text/html; charset=utf-8',
        CacheControl: 'private, no-store'
      })
    );

    const publicBase = process.env.S3_PUBLIC_BASE_URL?.trim();
    if (publicBase) return `${publicBase.replace(/\/+$/, '')}/${key}`;
    const endpoint = process.env.S3_ENDPOINT?.trim();
    if (endpoint) return `${endpoint.replace(/\/+$/, '')}/${bucket}/${key}`;
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }
}
