import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ErrorCodes, badRequest, conflict, notFound, sendAppError, zodValidationAppError } from '../errors';
import { MemberService } from '../services/MemberService';
import { AccountVerificationService } from '../services/AccountVerificationService';

const dateOnly = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha AAAA-MM-DD');

export class MemberController {
  private readonly memberService = new MemberService();
  private readonly verificationService = new AccountVerificationService();

  private resolveClubId(req: Request) {
    const clubId = Number((req as any).clubId);
    if (!Number.isInteger(clubId) || clubId <= 0) {
      throw badRequest('Club inválido', ErrorCodes.INVALID_INPUT);
    }
    return clubId;
  }

  private resolveActorUserId(req: Request) {
    const actorUserId = Number((req as any).user?.userId || 0);
    return Number.isFinite(actorUserId) && actorUserId > 0 ? actorUserId : null;
  }

  getSettings = async (req: Request, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      return res.json({ membersEnabled: await this.memberService.isMembersEnabled(clubId) });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo obtener la configuración de socios');
    }
  };

  updateSettings = async (req: Request, res: Response) => {
    try {
      const parsed = z.object({ membersEnabled: z.boolean() }).safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const result = await this.memberService.setMembersEnabled(
        this.resolveClubId(req),
        parsed.data.membersEnabled,
        this.resolveActorUserId(req)
      );
      return res.json(result);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo actualizar la configuración de socios');
    }
  };

  listCategories = async (req: Request, res: Response) => {
    try {
      return res.json(await this.memberService.listCategories(this.resolveClubId(req)));
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudieron listar las categorías');
    }
  };

  createCategory = async (req: Request, res: Response) => {
    try {
      const parsed = z.object({
        code: z.string().trim().min(1).max(40),
        name: z.string().trim().min(2).max(80),
        description: z.string().trim().max(300).nullable().optional(),
        sortOrder: z.number().int().optional()
      }).safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const created = await this.memberService.createCategory({
        clubId: this.resolveClubId(req),
        actorUserId: this.resolveActorUserId(req),
        ...parsed.data
      });
      return res.status(201).json(created);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo crear la categoría');
    }
  };

  updateCategory = async (req: Request, res: Response) => {
    try {
      const parsed = z.object({
        name: z.string().trim().min(2).max(80).optional(),
        description: z.string().trim().max(300).nullable().optional(),
        sortOrder: z.number().int().optional(),
        isActive: z.boolean().optional()
      }).safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const updated = await this.memberService.updateCategory({
        clubId: this.resolveClubId(req),
        actorUserId: this.resolveActorUserId(req),
        categoryId: String(req.params.categoryId || ''),
        ...parsed.data
      });
      return res.json(updated);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo actualizar la categoría');
    }
  };

  listMembers = async (req: Request, res: Response) => {
    try {
      const parsed = z.object({
        status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']).optional(),
        categoryId: z.string().trim().min(1).optional(),
        q: z.string().trim().max(120).optional(),
        page: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
        pageSize: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().optional())
      }).safeParse(req.query);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Filtros inválidos.'));
      return res.json(await this.memberService.listMembers({ clubId: this.resolveClubId(req), ...parsed.data }));
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo listar el padrón');
    }
  };

  getClientMember = async (req: Request, res: Response) => {
    try {
      return res.json(await this.memberService.getClientMember(this.resolveClubId(req), String(req.params.clientId || '')));
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo obtener el socio');
    }
  };

  createMember = async (req: Request, res: Response) => {
    try {
      const parsed = z.object({
        categoryId: z.string().trim().min(1),
        memberNumber: z.string().trim().max(40).nullable().optional(),
        joinedAt: dateOnly.nullable().optional(),
        validUntil: dateOnly.nullable().optional(),
        notes: z.string().trim().max(500).nullable().optional(),
        provisionAppAccount: z.boolean().optional()
      }).safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const result = await this.memberService.createMember({
        clubId: this.resolveClubId(req),
        actorUserId: this.resolveActorUserId(req),
        clientId: String(req.params.clientId || ''),
        ...parsed.data
      });
      return res.status(201).json(result);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo dar de alta al socio');
    }
  };

  updateMember = async (req: Request, res: Response) => {
    try {
      const parsed = z.object({
        categoryId: z.string().trim().min(1).optional(),
        memberNumber: z.string().trim().max(40).nullable().optional(),
        joinedAt: dateOnly.nullable().optional(),
        validUntil: dateOnly.nullable().optional(),
        notes: z.string().trim().max(500).nullable().optional()
      }).safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const result = await this.memberService.updateMember({
        clubId: this.resolveClubId(req),
        actorUserId: this.resolveActorUserId(req),
        clientId: String(req.params.clientId || ''),
        ...parsed.data
      });
      return res.json(result);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo actualizar el socio');
    }
  };

  changeMemberStatus = async (req: Request, res: Response) => {
    try {
      const parsed = z.object({
        status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']),
        reason: z.string().trim().max(300).nullable().optional()
      }).safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const result = await this.memberService.changeMemberStatus({
        clubId: this.resolveClubId(req),
        actorUserId: this.resolveActorUserId(req),
        clientId: String(req.params.clientId || ''),
        ...parsed.data
      });
      return res.json(result);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo cambiar el estado del socio');
    }
  };

  getMemberHistory = async (req: Request, res: Response) => {
    try {
      return res.json(await this.memberService.getMemberHistory(this.resolveClubId(req), String(req.params.clientId || '')));
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo obtener el historial del socio');
    }
  };

  provisionAppAccount = async (req: Request, res: Response) => {
    try {
      const result = await this.memberService.provisionMemberAppAccount({
        clubId: this.resolveClubId(req),
        clientId: String(req.params.clientId || ''),
        actorUserId: this.resolveActorUserId(req)
      });
      return res.json(result);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo preparar la cuenta de la app');
    }
  };

  // RN-10: ADMIN o STAFF generan un código para que el socio active su cuenta (o recupere la contraseña).
  // ADMIN_ISSUED devuelve el código para entregarlo en mano; WHATSAPP lo reenvía al teléfono registrado.
  issueActivationCode = async (req: Request, res: Response) => {
    try {
      const parsed = z.object({ channel: z.enum(['ADMIN_ISSUED', 'WHATSAPP']).default('ADMIN_ISSUED') }).safeParse(req.body || {});
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));

      const clubId = this.resolveClubId(req);
      const client = await prisma.client.findFirst({
        where: { id: String(req.params.clientId || ''), clubId },
        select: { id: true, user: { select: { id: true, accountStatus: true } } }
      });
      if (!client) throw notFound('Cliente no encontrado.', ErrorCodes.CLIENT_NOT_FOUND);
      if (!client.user) {
        throw conflict('El cliente no tiene cuenta de la app. Preparala primero.', ErrorCodes.USER_NOT_FOUND);
      }
      if (client.user.accountStatus === 'DISABLED') {
        throw conflict('La cuenta de la app está deshabilitada.', ErrorCodes.USER_NOT_FOUND);
      }

      const purpose = client.user.accountStatus === 'PENDING_ACTIVATION' ? 'ACTIVATION' : 'PASSWORD_RESET';
      const result = await this.verificationService.issueCode({
        userId: client.user.id,
        purpose,
        channel: parsed.data.channel,
        issuedByUserId: this.resolveActorUserId(req),
        issuedForClubId: clubId
      });
      if (!result.ok) {
        throw conflict(
          result.reason === 'RATE_LIMITED'
            ? 'Se enviaron demasiados códigos en la última hora. Generá uno para entregar en mano.'
            : 'No hay un teléfono válido para enviar el código. Generá uno para entregar en mano.',
          ErrorCodes.INVALID_INPUT
        );
      }

      await prisma.auditLog.create({
        data: {
          clubId,
          userId: this.resolveActorUserId(req),
          entity: 'CLIENT',
          entityId: client.id,
          action: 'MEMBER_ACTIVATION_CODE_ISSUED',
          payload: { channel: parsed.data.channel, purpose, targetUserId: client.user.id }
        }
      });

      return res.json({
        purpose,
        channel: parsed.data.channel,
        expiresAt: result.expiresAt.toISOString(),
        code: result.code ?? null
      });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo generar el código');
    }
  };
}
