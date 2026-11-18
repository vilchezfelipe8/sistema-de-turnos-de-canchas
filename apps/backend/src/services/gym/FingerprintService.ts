import { prisma } from '../../prisma';
import { ErrorCodes, badRequest, notFound, validationError } from '../../errors';
import { normalizeDni } from '../../utils/dni';

/** Prefijo que manda el kiosco cuando el lector reconoció una huella. */
export const ACCESS_FINGERPRINT_PREFIX = 'FP:';

export const FINGERPRINT_FORMATS = ['ZKFINGER10', 'SIMULATED'] as const;
export type FingerprintFormat = (typeof FINGERPRINT_FORMATS)[number];

const MAX_PER_CLIENT = 2;
const MAX_TEMPLATE_CHARS = 8192;

export type EnrollInput = {
  clientId: string;
  template: string;
  format: FingerprintFormat;
  finger: number | null;
  consent: boolean;
};

/** Huellas para entrar por el lector: alta con consentimiento, baja y lista para el agente. */
export class FingerprintService {
  /** Plantillas del club para que el agente del molinete compare localmente. */
  async listForSync(clubId: number) {
    const rows = await prisma.clientFingerprint.findMany({
      where: { clubId },
      select: { id: true, clientId: true, format: true, template: true },
      orderBy: { createdAt: 'asc' },
    });
    return { count: rows.length, fingerprints: rows };
  }

  /** Busca por DNI para registrar huella: devuelve las fichas y cuántas huellas tiene cada una. */
  async lookup(clubId: number, rawDni: string) {
    const dni = normalizeDni(rawDni);
    if (!dni) throw validationError('Revisá los campos marcados.', { dni: 'Ingresá un DNI válido.' });
    const clients = await prisma.client.findMany({
      where: { clubId, OR: [{ dni }, { user: { dni } }] },
      select: { id: true, name: true, fingerprints: { select: { id: true, finger: true, createdAt: true }, orderBy: { createdAt: 'asc' } } },
      take: 5,
    });
    return clients.map((client) => ({
      id: client.id,
      name: client.name,
      fingerprints: client.fingerprints.map((row) => ({ id: row.id, finger: row.finger, createdAt: row.createdAt.toISOString() })),
    }));
  }

  async enroll(clubId: number, input: EnrollInput, actorUserId: number | null) {
    if (!input.consent) {
      throw validationError('Falta el consentimiento.', { consent: 'El socio tiene que aceptar que se guarde su huella.' });
    }
    const template = String(input.template || '').trim();
    if (!template || template.length > MAX_TEMPLATE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(template)) {
      throw badRequest('La huella leída no es válida. Probá de nuevo.', ErrorCodes.VALIDATION_ERROR);
    }
    const client = await prisma.client.findFirst({ where: { id: input.clientId, clubId }, select: { id: true, name: true } });
    if (!client) throw notFound('Cliente no encontrado.', ErrorCodes.CLIENT_NOT_FOUND);

    return prisma.$transaction(async (tx) => {
      // Mismo dedo: reemplaza. Si ya tiene el máximo, hay que borrar una antes.
      if (input.finger !== null) {
        await tx.clientFingerprint.deleteMany({ where: { clubId, clientId: client.id, finger: input.finger } });
      }
      const count = await tx.clientFingerprint.count({ where: { clubId, clientId: client.id } });
      if (count >= MAX_PER_CLIENT) {
        throw badRequest(`${client.name} ya tiene ${MAX_PER_CLIENT} huellas. Borrá una para registrar otra.`, ErrorCodes.VALIDATION_ERROR);
      }
      const row = await tx.clientFingerprint.create({
        data: {
          clubId,
          clientId: client.id,
          finger: input.finger,
          format: input.format,
          template,
          consentAt: new Date(),
          createdByUserId: actorUserId,
        },
        select: { id: true, clientId: true, finger: true, createdAt: true },
      });
      return { ...row, createdAt: row.createdAt.toISOString(), name: client.name };
    });
  }

  async remove(clubId: number, id: string) {
    const result = await prisma.clientFingerprint.deleteMany({ where: { clubId, id } });
    if (result.count === 0) throw notFound('Huella no encontrada.', ErrorCodes.NOT_FOUND);
    return { ok: true };
  }

  /** Cliente dueño de una huella reconocida por el lector. */
  async clientOf(clubId: number, fingerprintId: string) {
    const row = await prisma.clientFingerprint.findFirst({
      where: { clubId, id: fingerprintId },
      select: { client: { select: { id: true, name: true } } },
    });
    return row ? [row.client] : [];
  }
}

export const fingerprintService = new FingerprintService();
