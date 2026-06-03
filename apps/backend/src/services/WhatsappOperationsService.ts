import { Prisma, PrismaClient } from '@prisma/client';
import { prismaRead } from '../prisma';
import { featureFlags } from '../config/featureFlags';
import { WhatsappV2PreflightService } from './WhatsappV2PreflightService';
import {
  maskPhone,
  sanitizeWhatsappPayload,
  sanitizeWhatsappRawRequest,
  sanitizeWhatsappRawResponse
} from '../utils/whatsappAdminSanitizer';

type DbClient = Prisma.TransactionClient | PrismaClient;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_SUMMARY_WINDOW_DAYS = 7;
const DEFAULT_ACCEPTED_STALE_MINUTES = 30;

export type WhatsappDeliveryListFilters = {
  clubId?: number;
  status?: string;
  eventType?: string;
  recipientRole?: string;
  providerMessageId?: string;
  outboxMessageId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
};

export type WhatsappWebhookEventListFilters = {
  clubId?: number;
  providerMessageId?: string;
  eventType?: string;
  status?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
};

export type WhatsappSummaryFilters = {
  clubId?: number;
  from?: Date;
  to?: Date;
  acceptedStaleMinutes?: number;
};

type WhatsappOperationsDeps = {
  db?: DbClient;
  preflightService?: WhatsappV2PreflightService;
};

const normalizeLimit = (limit?: number) => {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Number(limit), 1), MAX_LIMIT);
};

const buildCreatedAtWhere = (from?: Date, to?: Date) => {
  if (!from && !to) return undefined;

  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {})
  };
};

const buildDeliveryWhere = (filters: WhatsappDeliveryListFilters) => {
  const createdAt = buildCreatedAtWhere(filters.from, filters.to);

  return {
    ...(filters.clubId ? { clubId: filters.clubId } : {}),
    ...(filters.status ? { status: filters.status as any } : {}),
    ...(filters.eventType ? { eventType: filters.eventType as any } : {}),
    ...(filters.recipientRole
      ? { recipientRole: filters.recipientRole as any }
      : {}),
    ...(filters.providerMessageId
      ? { providerMessageId: filters.providerMessageId }
      : {}),
    ...(filters.outboxMessageId ? { outboxMessageId: filters.outboxMessageId } : {}),
    ...(createdAt ? { createdAt } : {})
  };
};

const buildWebhookWhere = (
  filters: WhatsappWebhookEventListFilters,
  clubScopedOrphanProviderMessageIds: string[]
) => {
  const createdAt = buildCreatedAtWhere(filters.from, filters.to);
  const base = {
    ...(filters.providerMessageId
      ? { providerMessageId: filters.providerMessageId }
      : {}),
    ...(filters.eventType ? { eventType: filters.eventType } : {}),
    ...(filters.status ? { status: filters.status as any } : {}),
    ...(createdAt ? { createdAt } : {})
  };

  if (!filters.clubId) {
    return base;
  }

  const orphansClause = clubScopedOrphanProviderMessageIds.length
    ? [
        {
          deliveryId: null,
          providerMessageId: {
            in: clubScopedOrphanProviderMessageIds
          }
        }
      ]
    : [];

  return {
    ...base,
    OR: [
      {
        delivery: {
          is: {
            clubId: filters.clubId
          }
        }
      },
      ...orphansClause
    ]
  };
};

const toCountMap = (
  rows: Array<Record<string, unknown>>,
  key: string
): Record<string, number> => {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const currentKey = String(row[key] ?? 'UNKNOWN');
    const countValue =
      typeof row._count === 'object' &&
      row._count &&
      '_all' in (row._count as Record<string, unknown>)
        ? Number((row._count as Record<string, unknown>)._all || 0)
        : 0;
    acc[currentKey] = countValue;
    return acc;
  }, {});
};

export class WhatsappOperationsService {
  private readonly db: DbClient;
  private readonly preflightService: WhatsappV2PreflightService;

  constructor(deps: WhatsappOperationsDeps = {}) {
    this.db = deps.db ?? prismaRead;
    this.preflightService =
      deps.preflightService ??
      new WhatsappV2PreflightService({ db: this.db });
  }

  async listDeliveries(filters: WhatsappDeliveryListFilters) {
    const limit = normalizeLimit(filters.limit);
    const rows = await this.db.whatsappDelivery.findMany({
      where: buildDeliveryWhere(filters),
      select: {
        id: true,
        outboxMessageId: true,
        clubId: true,
        eventType: true,
        recipientRole: true,
        recipientPhone: true,
        provider: true,
        status: true,
        senderId: true,
        templateMappingId: true,
        providerMessageId: true,
        errorCode: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: pageRows.map((row) => ({
        id: row.id,
        outboxMessageId: row.outboxMessageId,
        clubId: row.clubId,
        eventType: row.eventType,
        recipientRole: row.recipientRole,
        recipientPhoneMasked: maskPhone(row.recipientPhone),
        provider: row.provider,
        status: row.status,
        senderId: row.senderId,
        templateMappingId: row.templateMappingId,
        providerMessageId: row.providerMessageId,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      })),
      nextCursor: hasMore ? pageRows[pageRows.length - 1]?.id ?? null : null
    };
  }

  async getDeliveryDetail(input: { id: string; clubId?: number }) {
    const row = await this.db.whatsappDelivery.findFirst({
      where: {
        id: input.id,
        ...(input.clubId ? { clubId: input.clubId } : {})
      },
      select: {
        id: true,
        clubId: true,
        outboxMessageId: true,
        senderId: true,
        templateMappingId: true,
        recipientRole: true,
        recipientPhone: true,
        eventType: true,
        provider: true,
        providerMessageId: true,
        providerConversationId: true,
        status: true,
        errorCode: true,
        errorMessage: true,
        rawRequest: true,
        rawResponse: true,
        createdAt: true,
        updatedAt: true,
        outboxMessage: {
          select: {
            id: true,
            type: true,
            aggregateType: true,
            aggregateId: true,
            dedupeKey: true,
            status: true,
            attempts: true,
            processedAt: true,
            lastError: true,
            createdAt: true,
            updatedAt: true
          }
        },
        sender: {
          select: {
            id: true,
            code: true,
            mode: true,
            provider: true,
            displayName: true,
            status: true
          }
        },
        templateMapping: {
          select: {
            id: true,
            templateName: true,
            languageCode: true,
            category: true,
            status: true,
            version: true
          }
        },
        webhookEvents: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            senderId: true,
            deliveryId: true,
            providerMessageId: true,
            providerEventId: true,
            eventType: true,
            status: true,
            processedAt: true,
            createdAt: true,
            rawPayload: true
          }
        }
      }
    });

    if (!row) return null;

    return {
      id: row.id,
      clubId: row.clubId,
      outboxMessageId: row.outboxMessageId,
      senderId: row.senderId,
      templateMappingId: row.templateMappingId,
      recipientRole: row.recipientRole,
      recipientPhoneMasked: maskPhone(row.recipientPhone),
      eventType: row.eventType,
      provider: row.provider,
      providerMessageId: row.providerMessageId,
      providerConversationId: row.providerConversationId,
      status: row.status,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      rawRequest: sanitizeWhatsappRawRequest(row.rawRequest),
      rawResponse: sanitizeWhatsappRawResponse(row.rawResponse),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      outboxMessage: row.outboxMessage,
      sender: row.sender,
      templateMapping: row.templateMapping,
      webhookEvents: row.webhookEvents.map((event) => ({
        id: event.id,
        senderId: event.senderId,
        deliveryId: event.deliveryId,
        providerMessageId: event.providerMessageId,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        status: event.status,
        processedAt: event.processedAt,
        createdAt: event.createdAt,
        orphan: !event.deliveryId,
        rawPayloadSummary: sanitizeWhatsappPayload(event.rawPayload)
      }))
    };
  }

  async listWebhookEvents(filters: WhatsappWebhookEventListFilters) {
    const limit = normalizeLimit(filters.limit);
    const clubScopedOrphanProviderMessageIds = filters.clubId
      ? Array.from(
          new Set(
            (
              await this.db.whatsappDelivery.findMany({
                where: {
                  clubId: filters.clubId,
                  providerMessageId: { not: null }
                },
                select: {
                  providerMessageId: true
                }
              })
            )
              .map((row) => row.providerMessageId)
              .filter((value): value is string => Boolean(value))
          )
        )
      : [];

    const rows = await this.db.whatsappWebhookEvent.findMany({
      where: buildWebhookWhere(filters, clubScopedOrphanProviderMessageIds),
      select: {
        id: true,
        senderId: true,
        deliveryId: true,
        providerMessageId: true,
        providerEventId: true,
        eventType: true,
        status: true,
        processedAt: true,
        createdAt: true,
        rawPayload: true
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: pageRows.map((row) => ({
        id: row.id,
        senderId: row.senderId,
        deliveryId: row.deliveryId,
        providerMessageId: row.providerMessageId,
        providerEventId: row.providerEventId,
        eventType: row.eventType,
        status: row.status,
        processedAt: row.processedAt,
        createdAt: row.createdAt,
        orphan: !row.deliveryId,
        rawPayloadSummary: sanitizeWhatsappPayload(row.rawPayload)
      })),
      nextCursor: hasMore ? pageRows[pageRows.length - 1]?.id ?? null : null
    };
  }

  async getSummary(filters: WhatsappSummaryFilters) {
    const to = filters.to ?? new Date();
    const from =
      filters.from ??
      new Date(
        to.getTime() - DEFAULT_SUMMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000
      );
    const last24hFrom = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    const acceptedStaleMinutes =
      filters.acceptedStaleMinutes ?? DEFAULT_ACCEPTED_STALE_MINUTES;
    const acceptedStaleBefore = new Date(
      Date.now() - acceptedStaleMinutes * 60 * 1000
    );
    const deliveryWindowWhere = {
      ...(filters.clubId ? { clubId: filters.clubId } : {}),
      createdAt: {
        gte: from,
        lte: to
      }
    };

    const [deliveries24h, deliveries7d, byStatus, byRole, byEventType, errors] =
      await Promise.all([
        this.db.whatsappDelivery.count({
          where: {
            ...(filters.clubId ? { clubId: filters.clubId } : {}),
            createdAt: {
              gte: last24hFrom,
              lte: to
            }
          }
        }),
        this.db.whatsappDelivery.count({
          where: deliveryWindowWhere
        }),
        this.db.whatsappDelivery.groupBy({
          by: ['status'],
          where: deliveryWindowWhere,
          _count: { _all: true }
        }),
        this.db.whatsappDelivery.groupBy({
          by: ['recipientRole'],
          where: deliveryWindowWhere,
          _count: { _all: true }
        }),
        this.db.whatsappDelivery.groupBy({
          by: ['eventType'],
          where: deliveryWindowWhere,
          _count: { _all: true }
        }),
        this.db.whatsappDelivery.groupBy({
          by: ['errorCode'],
          where: {
            ...deliveryWindowWhere,
            errorCode: {
              not: null
            }
          },
          _count: { _all: true }
        })
      ]);

    const orphanWebhookCount = filters.clubId
      ? await this.db.whatsappWebhookEvent.count({
          where: {
            deliveryId: null,
            providerMessageId: {
              in: (
                await this.db.whatsappDelivery.findMany({
                  where: {
                    clubId: filters.clubId,
                    providerMessageId: { not: null }
                  },
                  select: { providerMessageId: true }
                })
              )
                .map((row) => row.providerMessageId)
                .filter((value): value is string => Boolean(value))
            },
            createdAt: {
              gte: from,
              lte: to
            }
          }
        })
      : await this.db.whatsappWebhookEvent.count({
          where: {
            deliveryId: null,
            createdAt: {
              gte: from,
              lte: to
            }
          }
        });

    const acceptedWithoutWebhookCount = await this.db.whatsappDelivery.count({
      where: {
        ...(filters.clubId ? { clubId: filters.clubId } : {}),
        status: 'ACCEPTED',
        updatedAt: {
          lt: acceptedStaleBefore
        },
        webhookEvents: {
          none: {}
        }
      }
    });

    return {
      window: {
        from,
        to
      },
      totals: {
        last24h: deliveries24h,
        last7d: deliveries7d
      },
      countsByStatus: toCountMap(byStatus as any[], 'status'),
      countsByRecipientRole: toCountMap(byRole as any[], 'recipientRole'),
      countsByEventType: toCountMap(byEventType as any[], 'eventType'),
      topErrors: (errors as any[])
        .map((row) => ({
          errorCode: String(row.errorCode ?? 'UNKNOWN'),
          count: Number(row._count?._all ?? 0)
        }))
        .sort((a, b) => b.count - a.count),
      orphanWebhookCount,
      acceptedWithoutWebhookCount,
      acceptedStaleMinutes
    };
  }

  async getPreflight() {
    const result = await this.preflightService.run();

    return {
      ...result,
      flags: {
        ENABLE_WHATSAPP_SEND_V2: featureFlags.ENABLE_WHATSAPP_SEND_V2,
        ENABLE_WHATSAPP_CLOUD_API: featureFlags.ENABLE_WHATSAPP_CLOUD_API,
        ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2:
          featureFlags.ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2,
        ENABLE_WHATSAPP_STAFF_EVENTS_V2:
          featureFlags.ENABLE_WHATSAPP_STAFF_EVENTS_V2,
        ENABLE_WHATSAPP_WEBHOOK_PROCESSOR:
          featureFlags.ENABLE_WHATSAPP_WEBHOOK_PROCESSOR,
        ENABLE_WHATSAPP_V2_DRY_RUN: featureFlags.ENABLE_WHATSAPP_V2_DRY_RUN
      }
    };
  }
}
