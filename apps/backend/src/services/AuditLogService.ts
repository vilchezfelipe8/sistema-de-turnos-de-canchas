import { prisma } from '../prisma';
import { Prisma } from '@prisma/client';

type CreateAuditLogInput = {
  clubId: number;
  userId?: number | null;
  entity: string;
  entityId: string;
  action: string;
  payload?: Record<string, any> | null;
};

export class AuditLogService {
  async create(input: CreateAuditLogInput) {
    return prisma.auditLog.create({
      data: {
        clubId: input.clubId,
        userId: input.userId ?? null,
        entity: input.entity,
        entityId: input.entityId,
        action: input.action,
        payload: input.payload ?? Prisma.JsonNull
      }
    });
  }
}
