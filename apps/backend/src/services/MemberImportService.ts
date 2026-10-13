import { ClubMemberStatus, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { normalizeDni } from '../utils/dni';
import { getPhoneIdentityVariants, normalizeIdentityPhone } from '../utils/phone';
import { normalizeEmail } from '../utils/magicLink';
import { MemberService, type MemberAccountProvisionResult } from './MemberService';

// Importación del padrón de socios (docs/socios-y-precios-diferenciados.md §7).
// Columnas: nombre,apellido,dni,telefono,email,numero_socio,categoria,estado,fecha_alta,al_dia_hasta

export type MemberImportRow = {
  nombre?: string;
  apellido?: string;
  dni?: string;
  telefono?: string;
  email?: string;
  numero_socio?: string;
  categoria?: string;
  estado?: string;
  fecha_alta?: string;
  al_dia_hasta?: string;
};

export type MemberImportRowStatus =
  | 'NEW'                 // cliente + socio nuevos
  | 'EXISTING_UPDATED'    // cliente existente que pasa a socio o socio existente actualizado
  | 'CONFLICT'            // requiere revisión manual; no se escribe nada
  | 'ERROR';              // datos inválidos; no se escribe nada

export type MemberImportRowResult = {
  line: number;
  name: string;
  dni: string | null;
  status: MemberImportRowStatus;
  detail?: string;
  clientId?: string;
  account?: MemberAccountProvisionResult['status'];
  accountDetail?: string;
  warnings: string[];
};

export type MemberImportReport = {
  mode: 'preview' | 'commit';
  clubId: number;
  totalRows: number;
  summary: Record<MemberImportRowStatus, number>;
  accounts: Record<string, number>;
  rows: MemberImportRowResult[];
};

const STATUS_ALIASES: Record<string, ClubMemberStatus> = {
  ACTIVO: 'ACTIVE',
  ACTIVA: 'ACTIVE',
  ACTIVE: 'ACTIVE',
  SUSPENDIDO: 'SUSPENDED',
  SUSPENDIDA: 'SUSPENDED',
  SUSPENDED: 'SUSPENDED',
  BAJA: 'INACTIVE',
  INACTIVO: 'INACTIVE',
  INACTIVA: 'INACTIVE',
  INACTIVE: 'INACTIVE'
};

class RollbackPreview extends Error {
  constructor(public readonly result: MemberImportRowResult) {
    super('preview-rollback');
  }
}

// Acepta AAAA-MM-DD o DD/MM/AAAA.
export function parseImportDate(raw: string | undefined): { value: string | null; invalid: boolean } {
  const text = String(raw || '').trim();
  if (!text) return { value: null, invalid: false };
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) iso = text;
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) iso = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  if (!iso || Number.isNaN(new Date(`${iso}T00:00:00.000Z`).getTime())) return { value: null, invalid: true };
  return { value: iso, invalid: false };
}

// CSV simple con comillas. Detecta separador coma o punto y coma por el encabezado.
export function parseMembersCsv(content: string): MemberImportRow[] {
  const text = content.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const separator = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === separator) {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += char;
  }
  if (field.length || record.length) {
    record.push(field);
    records.push(record);
  }

  const [header, ...rows] = records.filter((r) => r.some((cell) => cell.trim().length > 0));
  if (!header) return [];
  const keys = header.map((h) =>
    h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_')
  );
  return rows.map((cells) => {
    const row: Record<string, string> = {};
    keys.forEach((key, index) => {
      row[key] = String(cells[index] ?? '').trim();
    });
    return row as MemberImportRow;
  });
}

export class MemberImportService {
  private readonly memberService = new MemberService();

  async importRows(input: {
    clubId: number;
    rows: MemberImportRow[];
    mode: 'preview' | 'commit';
    actorUserId: number | null;
  }): Promise<MemberImportReport> {
    await this.memberService.assertMembersEnabled(input.clubId);

    const categories = await prisma.memberCategory.findMany({ where: { clubId: input.clubId, isActive: true } });
    const categoryByKey = new Map<string, string>();
    for (const category of categories) {
      categoryByKey.set(category.code.toUpperCase(), category.id);
      categoryByKey.set(category.name.trim().toUpperCase(), category.id);
    }

    // Duplicados dentro del mismo archivo.
    const dniCount = new Map<string, number>();
    const numberCount = new Map<string, number>();
    for (const row of input.rows) {
      const dni = normalizeDni(row.dni);
      if (dni) dniCount.set(dni, (dniCount.get(dni) || 0) + 1);
      const number = String(row.numero_socio || '').trim().toUpperCase();
      if (number) numberCount.set(number, (numberCount.get(number) || 0) + 1);
    }

    const results: MemberImportRowResult[] = [];
    for (let index = 0; index < input.rows.length; index += 1) {
      const row = input.rows[index];
      const line = index + 2; // línea 1 = encabezado
      const name = `${String(row.nombre || '').trim()} ${String(row.apellido || '').trim()}`.trim();
      const dni = normalizeDni(row.dni);
      const base = { line, name, dni, warnings: [] as string[] };

      const fail = (status: 'ERROR' | 'CONFLICT', detail: string): MemberImportRowResult => ({ ...base, status, detail });

      if (!name) { results.push(fail('ERROR', 'Falta el nombre.')); continue; }
      if (!dni) { results.push(fail('ERROR', 'Falta el DNI o es inválido (es la credencial de ingreso).')); continue; }
      if ((dniCount.get(dni) || 0) > 1) { results.push(fail('CONFLICT', 'El DNI está repetido en el archivo.')); continue; }

      const categoryId = categoryByKey.get(String(row.categoria || '').trim().toUpperCase());
      if (!categoryId) { results.push(fail('ERROR', `Categoría inexistente o inactiva: "${row.categoria || ''}".`)); continue; }

      const statusKey = String(row.estado || 'ACTIVO').trim().toUpperCase();
      const status = STATUS_ALIASES[statusKey];
      if (!status) { results.push(fail('ERROR', `Estado inválido: "${row.estado}". Usar ACTIVO, SUSPENDIDO o BAJA.`)); continue; }

      const memberNumber = String(row.numero_socio || '').trim() || null;
      if (memberNumber && (numberCount.get(memberNumber.toUpperCase()) || 0) > 1) {
        results.push(fail('CONFLICT', 'El número de socio está repetido en el archivo.'));
        continue;
      }

      const joined = parseImportDate(row.fecha_alta);
      const validUntil = parseImportDate(row.al_dia_hasta);
      if (joined.invalid || validUntil.invalid) {
        results.push(fail('ERROR', 'Fecha inválida. Usar AAAA-MM-DD o DD/MM/AAAA.'));
        continue;
      }

      const rawPhone = String(row.telefono || '').trim();
      const phone = rawPhone ? normalizeIdentityPhone(rawPhone) : null;
      if (rawPhone && !phone) {
        results.push(fail('ERROR', `Teléfono inválido: "${rawPhone}".`));
        continue;
      }
      if (!phone) base.warnings.push('Sin teléfono: activará la cuenta con un código del mostrador.');
      const email = String(row.email || '').trim() ? normalizeEmail(String(row.email)) : null;

      try {
        const result = await prisma.$transaction(async (tx) => {
          const rowResult = await this.importOneTx(tx, {
            clubId: input.clubId,
            actorUserId: input.actorUserId,
            base,
            name,
            firstName: String(row.nombre || '').trim(),
            lastName: String(row.apellido || '').trim(),
            dni,
            phone,
            email,
            categoryId,
            status,
            memberNumber,
            joinedAt: joined.value,
            validUntil: validUntil.value
          });
          // En la previsualización se revierte todo; en commit solo si la fila no es aplicable.
          if (input.mode === 'preview' || rowResult.status === 'CONFLICT' || rowResult.status === 'ERROR') {
            throw new RollbackPreview(rowResult);
          }
          return rowResult;
        }, { timeout: 20_000 });
        results.push(result);
      } catch (error) {
        if (error instanceof RollbackPreview) results.push(error.result);
        else results.push(fail('ERROR', (error as Error)?.message || 'Error inesperado.'));
      }
    }

    const summary: Record<MemberImportRowStatus, number> = { NEW: 0, EXISTING_UPDATED: 0, CONFLICT: 0, ERROR: 0 };
    const accounts: Record<string, number> = {};
    for (const result of results) {
      summary[result.status] += 1;
      if (result.account) accounts[result.account] = (accounts[result.account] || 0) + 1;
    }
    return { mode: input.mode, clubId: input.clubId, totalRows: input.rows.length, summary, accounts, rows: results };
  }

  private async importOneTx(
    tx: Prisma.TransactionClient,
    input: {
      clubId: number;
      actorUserId: number | null;
      base: { line: number; name: string; dni: string | null; warnings: string[] };
      name: string;
      firstName: string;
      lastName: string;
      dni: string;
      phone: string | null;
      email: string | null;
      categoryId: string;
      status: ClubMemberStatus;
      memberNumber: string | null;
      joinedAt: string | null;
      validUntil: string | null;
    }
  ): Promise<MemberImportRowResult> {
    const { base } = input;

    // Ficha existente del club: DNI → teléfono → email. Más de una coincidencia = conflicto.
    let candidates = await tx.client.findMany({ where: { clubId: input.clubId, dni: input.dni } });
    if (!candidates.length && input.phone) {
      candidates = await tx.client.findMany({
        where: { clubId: input.clubId, phone: { in: getPhoneIdentityVariants(input.phone) } }
      });
    }
    if (!candidates.length && input.email) {
      candidates = await tx.client.findMany({ where: { clubId: input.clubId, email: input.email } });
    }
    if (candidates.length > 1) {
      return { ...base, status: 'CONFLICT', detail: 'Coincide con más de una ficha del club. Unificalas antes de importar.' };
    }

    let client = candidates[0] ?? null;
    if (client) {
      const clientDni = normalizeDni(client.dni);
      if (clientDni && clientDni !== input.dni) {
        return { ...base, status: 'CONFLICT', clientId: client.id, detail: `La ficha encontrada tiene otro DNI (${clientDni}).` };
      }
      client = await tx.client.update({
        where: { id: client.id },
        data: {
          dni: input.dni,
          phone: client.phone || input.phone,
          email: client.email || input.email
        }
      });
    } else {
      client = await tx.client.create({
        data: { clubId: input.clubId, name: input.name, dni: input.dni, phone: input.phone, email: input.email }
      });
    }

    if (input.memberNumber) {
      const numberOwner = await tx.clubMember.findFirst({
        where: { clubId: input.clubId, memberNumber: input.memberNumber, NOT: { clientId: client.id } },
        select: { id: true }
      });
      if (numberOwner) {
        return { ...base, status: 'CONFLICT', clientId: client.id, detail: 'El número de socio ya pertenece a otro socio.' };
      }
    }

    const existingMember = await tx.clubMember.findUnique({ where: { clientId: client.id } });
    const joinedAt = new Date(`${input.joinedAt || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const validUntil = input.validUntil ? new Date(`${input.validUntil}T00:00:00.000Z`) : null;

    if (existingMember) {
      await tx.clubMember.update({
        where: { id: existingMember.id },
        data: {
          categoryId: input.categoryId,
          memberNumber: input.memberNumber ?? existingMember.memberNumber,
          status: input.status,
          validUntil,
          ...(input.joinedAt ? { joinedAt } : {}),
          updatedByUserId: input.actorUserId
        }
      });
      await tx.clubMemberHistory.create({
        data: {
          clubMemberId: existingMember.id,
          clubId: input.clubId,
          action: 'UPDATED',
          fromStatus: existingMember.status,
          toStatus: input.status,
          fromCategoryId: existingMember.categoryId,
          toCategoryId: input.categoryId,
          reason: 'Importación de padrón',
          changedByUserId: input.actorUserId
        }
      });
    } else {
      const member = await tx.clubMember.create({
        data: {
          clubId: input.clubId,
          clientId: client.id,
          categoryId: input.categoryId,
          memberNumber: input.memberNumber,
          status: input.status,
          joinedAt,
          validUntil,
          statusReason: input.status === 'ACTIVE' ? null : 'Importación de padrón',
          createdByUserId: input.actorUserId,
          updatedByUserId: input.actorUserId
        }
      });
      await tx.clubMemberHistory.create({
        data: {
          clubMemberId: member.id,
          clubId: input.clubId,
          action: 'CREATED',
          toStatus: input.status,
          toCategoryId: input.categoryId,
          reason: 'Importación de padrón',
          changedByUserId: input.actorUserId
        }
      });
    }

    const account = await this.memberService.provisionMemberAppAccountTx(tx, {
      clubId: input.clubId,
      clientId: client.id,
      actorUserId: input.actorUserId,
      firstName: input.firstName || undefined,
      lastName: input.lastName || undefined
    });

    // Una cuenta en conflicto no bloquea el alta en el padrón: el socio queda cargado y la cuenta se revisa a mano.
    return {
      ...base,
      status: existingMember || candidates.length ? 'EXISTING_UPDATED' : 'NEW',
      clientId: client.id,
      account: account.status,
      accountDetail: account.status === 'CONFLICT' ? account.detail : undefined
    };
  }
}
