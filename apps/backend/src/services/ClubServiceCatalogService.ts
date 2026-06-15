import { prisma } from '../prisma';
import { ErrorCodes, badRequest } from '../errors';

type CreateServiceInput = {
  code: string;
  name: string;
  description?: string;
  price: number;
};

type UpdateServiceInput = {
  code?: string;
  name?: string;
  description?: string | null;
  price?: number;
  isActive?: boolean;
};

const normalizeCode = (raw: string) =>
  String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');

export class ClubServiceCatalogService {
  async listByClub(clubId: number, includeInactive = false) {
    return prisma.clubServiceCatalog.findMany({
      where: {
        clubId,
        ...(includeInactive ? {} : { isActive: true })
      },
      orderBy: [{ name: 'asc' }]
    });
  }

  async create(clubId: number, input: CreateServiceInput) {
    const code = normalizeCode(input.code);
    const name = String(input.name || '').trim();
    const price = Number(input.price);

    if (!code) throw badRequest('Código de servicio inválido', ErrorCodes.INVALID_INPUT);
    if (!name) throw badRequest('Nombre de servicio inválido', ErrorCodes.INVALID_INPUT);
    if (!Number.isFinite(price) || price <= 0) throw badRequest('Precio inválido', ErrorCodes.INVALID_INPUT);

    return prisma.clubServiceCatalog.create({
      data: {
        clubId,
        code,
        name,
        description: input.description ? String(input.description).trim() : null,
        price
      }
    });
  }

  async update(clubId: number, id: number, input: UpdateServiceInput) {
    const existing = await prisma.clubServiceCatalog.findFirst({
      where: { id, clubId }
    });
    if (!existing) return null;

    const nextData: any = {};

    if (input.code !== undefined) {
      const nextCode = normalizeCode(input.code);
      if (!nextCode) throw badRequest('Código de servicio inválido', ErrorCodes.INVALID_INPUT);
      nextData.code = nextCode;
    }
    if (input.name !== undefined) {
      const nextName = String(input.name || '').trim();
      if (!nextName) throw badRequest('Nombre de servicio inválido', ErrorCodes.INVALID_INPUT);
      nextData.name = nextName;
    }
    if (input.description !== undefined) {
      const description = input.description == null ? null : String(input.description).trim();
      nextData.description = description || null;
    }
    if (input.price !== undefined) {
      const nextPrice = Number(input.price);
      if (!Number.isFinite(nextPrice) || nextPrice <= 0) throw badRequest('Precio inválido', ErrorCodes.INVALID_INPUT);
      nextData.price = nextPrice;
    }
    if (input.isActive !== undefined) {
      nextData.isActive = Boolean(input.isActive);
    }

    return prisma.clubServiceCatalog.update({
      where: { id },
      data: nextData
    });
  }

  async delete(clubId: number, id: number) {
    const existing = await prisma.clubServiceCatalog.findFirst({
      where: { id, clubId }
    });
    if (!existing) return null;
    return prisma.clubServiceCatalog.update({
      where: { id },
      data: { isActive: false }
    });
  }
}
