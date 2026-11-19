import QRCode from 'qrcode';
import { fromZonedTime } from 'date-fns-tz';
import { prisma } from '../../prisma';
import { ErrorCodes, badRequest, notFound } from '../../errors';
import { localDateKey } from '../MemberService';
import { isDateKey } from '../../domain/subscriptionSchedule';
import { normalizeDni } from '../../utils/dni';
import { ACCESS_FINGERPRINT_PREFIX, fingerprintService } from './FingerprintService';
import { AccessResult, activityAccessService, clubTimeZone, localTimeLabel } from './ActivityAccessService';

/** Prefijo del código QR que el socio muestra desde la app. */
export const ACCESS_QR_PREFIX = 'PQ1:';

export type CheckInResult = {
  allowed: boolean;
  code: string;
  message: string;
  firstName: string | null;
  name: string | null;
  planName: string | null;
  validUntil: string | null;
  turn: { startsAt: string; endsAt: string; label: string } | null;
};

type AccessMethod = 'DNI' | 'QR' | 'FINGERPRINT';

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Ingreso por kiosco o molinete: identifica al socio, valida y deja registro. */
export class AccessCheckInService {
  private parseIdentifier(raw: string): { method: AccessMethod; value: string } | null {
    const text = String(raw || '').trim();
    if (text.toUpperCase().startsWith(ACCESS_FINGERPRINT_PREFIX)) {
      const value = text.slice(ACCESS_FINGERPRINT_PREFIX.length).trim();
      return value ? { method: 'FINGERPRINT', value } : null;
    }
    if (text.toUpperCase().startsWith(ACCESS_QR_PREFIX)) {
      const value = text.slice(ACCESS_QR_PREFIX.length).trim();
      return value ? { method: 'QR', value } : null;
    }
    const dni = normalizeDni(text);
    return dni ? { method: 'DNI', value: dni } : null;
  }

  private async findClients(clubId: number, parsed: { method: AccessMethod; value: string }) {
    if (parsed.method === 'FINGERPRINT') return fingerprintService.clientOf(clubId, parsed.value);
    if (parsed.method === 'QR') {
      return prisma.client.findMany({ where: { clubId, id: parsed.value }, select: { id: true, name: true } });
    }
    return prisma.client.findMany({
      where: { clubId, OR: [{ dni: parsed.value }, { user: { dni: parsed.value } }] },
      select: { id: true, name: true },
      take: 5,
    });
  }

  async checkIn(clubId: number, activityTypeId: number, identifier: string, actorUserId: number | null): Promise<CheckInResult> {
    const schedule = await prisma.activityTurnSchedule.findFirst({ where: { clubId, activityTypeId } });
    if (!schedule) throw notFound('Esta actividad no tiene turnero.', ErrorCodes.ACTIVITY_NOT_FOUND);

    const parsed = this.parseIdentifier(identifier);
    const log = (data: { clientId: string | null; result: 'ALLOWED' | 'DENIED'; code: string; message: string; turnId?: string | null }) =>
      prisma.accessLog.create({
        data: {
          clubId,
          activityTypeId,
          method: parsed?.method ?? 'DNI',
          createdByUserId: actorUserId,
          turnId: data.turnId ?? null,
          clientId: data.clientId,
          result: data.result,
          code: data.code,
          message: data.message,
        },
      });
    const denied = (code: string, message: string): CheckInResult => ({
      allowed: false,
      code,
      message,
      firstName: null,
      name: null,
      planName: null,
      validUntil: null,
      turn: null,
    });

    if (!parsed) {
      const result = denied('INVALID', 'Ingresá tu DNI sin puntos o mostrá tu código.');
      await log({ clientId: null, result: 'DENIED', code: result.code, message: result.message });
      return result;
    }
    const clients = await this.findClients(clubId, parsed);
    if (clients.length === 0) {
      const result = denied(
        'NOT_FOUND',
        parsed.method === 'QR'
          ? 'Este código no es de este club.'
          : parsed.method === 'FINGERPRINT'
            ? 'Esa huella ya no está registrada. Entrá con tu DNI.'
            : 'No encontramos ese DNI. Pedí que te registren.'
      );
      await log({ clientId: null, result: 'DENIED', code: result.code, message: result.message });
      return result;
    }

    // Si el DNI está en más de una ficha, vale la que tenga acceso.
    let chosen: { client: { id: string; name: string }; access: AccessResult } | null = null;
    for (const client of clients) {
      const access = await activityAccessService.check(clubId, client.id, activityTypeId);
      if (!chosen || (access.allowed && !chosen.access.allowed) || (chosen.access.code === 'NO_PLAN' && access.code !== 'NO_PLAN')) {
        chosen = { client, access };
      }
      if (access.allowed) break;
    }
    const { client, access } = chosen!;

    const timeZone = await clubTimeZone(clubId);
    if (access.allowed && access.turn) {
      await prisma.activityTurn.updateMany({ where: { id: access.turn.id, checkedInAt: null }, data: { checkedInAt: new Date() } });
    }
    await log({
      clientId: client.id,
      result: access.allowed ? 'ALLOWED' : 'DENIED',
      code: access.code,
      message: access.message,
      turnId: access.turn?.id ?? null,
    });

    return {
      allowed: access.allowed,
      code: access.code,
      message: access.message,
      firstName: firstNameOf(client.name),
      name: client.name,
      planName: access.plan?.name ?? null,
      validUntil: access.plan?.validUntil ?? null,
      turn: access.turn
        ? {
            startsAt: access.turn.startsAt,
            endsAt: access.turn.endsAt,
            label: `${localTimeLabel(new Date(access.turn.startsAt), timeZone)} a ${localTimeLabel(new Date(access.turn.endsAt), timeZone)}`,
          }
        : null,
    };
  }

  /** Ingresos de un día (hora del club), más nuevos primero. */
  async listDay(clubId: number, dayKey?: string | null) {
    const timeZone = await clubTimeZone(clubId);
    const key = dayKey || localDateKey(new Date(), timeZone);
    if (!isDateKey(key)) throw badRequest('Fecha inválida.', ErrorCodes.INVALID_DATE_TIME);
    const from = fromZonedTime(`${key}T00:00:00`, timeZone);
    const rows = await prisma.accessLog.findMany({
      where: { clubId, createdAt: { gte: from, lt: new Date(from.getTime() + 24 * 3600_000) } },
      include: { client: { select: { id: true, name: true } }, activityType: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return {
      date: key,
      allowed: rows.filter((row) => row.result === 'ALLOWED').length,
      denied: rows.filter((row) => row.result === 'DENIED').length,
      rows: rows.map((row) => ({
        id: row.id,
        time: localTimeLabel(row.createdAt, timeZone),
        createdAt: row.createdAt.toISOString(),
        name: row.client?.name ?? null,
        activityName: row.activityType?.name ?? null,
        method: row.method,
        result: row.result,
        code: row.code,
        message: row.message,
      })),
    };
  }

  /** Código QR personal para entrar (lo muestra la app del socio). */
  async playerCode(clubId: number, userId: number) {
    const client = await prisma.client.findFirst({ where: { clubId, userId }, select: { id: true, name: true } });
    if (!client) return null;
    const code = `${ACCESS_QR_PREFIX}${client.id}`;
    const svg = await QRCode.toString(code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { code, svg, name: client.name };
  }
}

export const accessCheckInService = new AccessCheckInService();
