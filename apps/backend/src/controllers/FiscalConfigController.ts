import { Request, Response } from 'express';
import { z } from 'zod';
import forge from 'node-forge';
import { prisma } from '../prisma';
import { sendAppError, zodValidationAppError } from '../errors';

const FISCAL_CONDITION_VALUES = [
  'RESPONSABLE_INSCRIPTO',
  'MONOTRIBUTO',
  'EXENTO',
  'CONSUMIDOR_FINAL',
  'OTRO'
] as const;

const configBodySchema = z.object({
  facturacionHabilitada: z.boolean().optional(),
  usaHomologacion: z.boolean().optional(),
  activo: z.boolean().optional(),
  modoFacturacion: z.enum(['OBLIGATORIA', 'OPCIONAL', 'DESHABILITADA']).optional(),
  razonSocial: z.string().max(200).nullish(),
  cuit: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().length(11, 'CUIT debe tener 11 dígitos sin guiones'))
    .nullish(),
  condicionIva: z.enum(FISCAL_CONDITION_VALUES).nullish(),
  ingresosBrutos: z.string().max(50).nullish(),
  inicioActividadesAt: z.string().datetime({ message: 'Fecha de inicio inválida' }).nullish(),
  defaultPuntoDeVentaFiscalId: z.string().nullish()
});

const certBodySchema = z.object({
  certificadoPem: z.string().min(10, 'Certificado PEM requerido'),
  clavePrivadaPem: z.string().min(10, 'Clave privada PEM requerida'),
  clavePrivadaPassphrase: z.string().nullish()
});

const puntoDeVentaBodySchema = z.object({
  puntoDeVenta: z.number().int().min(1).max(9999),
  nombre: z.string().max(100).optional()
});

const parseCertMetadata = (pem: string) => {
  try {
    const cert = forge.pki.certificateFromPem(pem);
    const cnAttr = cert.subject.getField('CN');
    return {
      certificadoSerial: cert.serialNumber ?? null,
      certificadoSubject: cnAttr?.value ?? null,
      vencimientoCertificado: cert.validity.notAfter ?? null
    };
  } catch {
    return { certificadoSerial: null, certificadoSubject: null, vencimientoCertificado: null };
  }
};

// Strips PEM fields from the response; adds computed hasCertificate
const sanitizeConfig = (raw: any) => {
  const { certificadoPem, clavePrivadaPem, clavePrivadaPassphrase, defaultPuntoDeVentaFiscal, ...safe } = raw;
  return { ...safe, hasCertificate: !!certificadoPem };
};

export class FiscalConfigController {
  // GET /:slug/admin/fiscal-config
  getConfig = async (req: Request, res: Response) => {
    try {
      const clubId = (req as any).clubId as number;

      const raw = await prisma.configuracionFiscal.findUnique({
        where: { clubId },
        include: {
          puntosDeVentaFiscales: {
            select: { id: true, puntoDeVenta: true, nombre: true, activo: true },
            orderBy: { puntoDeVenta: 'asc' }
          }
        }
      });

      return res.json({ config: raw ? sanitizeConfig(raw) : null });
    } catch (error) {
      return sendAppError(res, error, 'No se pudo cargar la configuración fiscal');
    }
  };

  // PUT /:slug/admin/fiscal-config
  upsertConfig = async (req: Request, res: Response) => {
    try {
      const clubId = (req as any).clubId as number;

      const parsed = configBodySchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));

      const { inicioActividadesAt, defaultPuntoDeVentaFiscalId, ...rest } = parsed.data;

      const updateData: Record<string, unknown> = {
        ...rest,
        ...(inicioActividadesAt !== undefined
          ? { inicioActividadesAt: inicioActividadesAt ? new Date(inicioActividadesAt) : null }
          : {}),
        ...(defaultPuntoDeVentaFiscalId !== undefined
          ? {
              defaultPuntoDeVentaFiscal: defaultPuntoDeVentaFiscalId
                ? { connect: { id: defaultPuntoDeVentaFiscalId } }
                : { disconnect: true }
            }
          : {})
      };

      const raw = await prisma.configuracionFiscal.upsert({
        where: { clubId },
        create: { clubId, proveedorFiscal: 'ARCA', ...updateData },
        update: updateData,
        include: {
          puntosDeVentaFiscales: {
            select: { id: true, puntoDeVenta: true, nombre: true, activo: true },
            orderBy: { puntoDeVenta: 'asc' }
          }
        }
      });

      return res.json({ config: sanitizeConfig(raw) });
    } catch (error) {
      return sendAppError(res, error, 'No se pudo guardar la configuración fiscal');
    }
  };

  // POST /:slug/admin/fiscal-config/certificate
  uploadCertificate = async (req: Request, res: Response) => {
    try {
      const clubId = (req as any).clubId as number;

      const parsed = certBodySchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));

      const config = await prisma.configuracionFiscal.findUnique({ where: { clubId }, select: { id: true } });
      if (!config) {
        return res.status(400).json({ error: 'Primero guardá los datos fiscales básicos antes de subir el certificado.' });
      }

      const { certificadoPem, clavePrivadaPem, clavePrivadaPassphrase } = parsed.data;
      const meta = parseCertMetadata(certificadoPem);

      await prisma.configuracionFiscal.update({
        where: { clubId },
        data: {
          certificadoPem,
          clavePrivadaPem,
          clavePrivadaPassphrase: clavePrivadaPassphrase ?? null,
          ...meta
        }
      });

      return res.json({
        ok: true,
        certificadoSerial: meta.certificadoSerial,
        certificadoSubject: meta.certificadoSubject,
        vencimientoCertificado: meta.vencimientoCertificado?.toISOString() ?? null
      });
    } catch (error) {
      return sendAppError(res, error, 'No se pudo guardar el certificado');
    }
  };

  // POST /:slug/admin/fiscal-config/puntos-de-venta
  createPuntoDeVenta = async (req: Request, res: Response) => {
    try {
      const clubId = (req as any).clubId as number;

      const parsed = puntoDeVentaBodySchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));

      const config = await prisma.configuracionFiscal.findUnique({ where: { clubId }, select: { id: true } });
      if (!config) return res.status(400).json({ error: 'Configuración fiscal no encontrada.' });

      const existing = await prisma.puntoDeVentaFiscal.findFirst({
        where: { configuracionFiscalId: config.id, puntoDeVenta: parsed.data.puntoDeVenta }
      });
      if (existing) {
        return res.status(409).json({ error: `El punto de venta ${parsed.data.puntoDeVenta} ya existe.` });
      }

      const item = await prisma.puntoDeVentaFiscal.create({
        data: {
          clubId,
          configuracionFiscalId: config.id,
          puntoDeVenta: parsed.data.puntoDeVenta,
          nombre: parsed.data.nombre ?? null,
          activo: true
        },
        select: { id: true, puntoDeVenta: true, nombre: true, activo: true }
      });

      return res.status(201).json({ item });
    } catch (error) {
      return sendAppError(res, error, 'No se pudo crear el punto de venta');
    }
  };

  // PUT /:slug/admin/fiscal-config/puntos-de-venta/:pdvId/toggle
  togglePuntoDeVenta = async (req: Request, res: Response) => {
    try {
      const clubId = (req as any).clubId as number;
      const pdvId = String(req.params.pdvId);

      const item = await prisma.puntoDeVentaFiscal.findFirst({ where: { id: pdvId, clubId } });
      if (!item) return res.status(404).json({ error: 'Punto de venta no encontrado.' });

      const updated = await prisma.puntoDeVentaFiscal.update({
        where: { id: pdvId },
        data: { activo: !item.activo },
        select: { id: true, puntoDeVenta: true, nombre: true, activo: true }
      });

      return res.json({ item: updated });
    } catch (error) {
      return sendAppError(res, error, 'No se pudo actualizar el punto de venta');
    }
  };
}
