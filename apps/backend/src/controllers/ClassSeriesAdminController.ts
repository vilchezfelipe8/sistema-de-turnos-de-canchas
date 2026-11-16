import { Request, Response } from 'express';
import { z } from 'zod';
import { sendAppError, validationError, zodValidationAppError } from '../errors';
import { ClassSeriesAdminService } from '../services/academy/ClassSeriesAdminService';
import { sanitizeString } from '../utils/sanitize';

const optionalId = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? null : Number(value)),
  z.number().int().positive().nullable()
);

const optionalMoney = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? null : Number(value)),
  z.number().nonnegative().nullable()
);

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() ? sanitizeString(value, max) : null),
    z.string().max(max).nullable()
  );

const seriesBodySchema = z.object({
  teacherId: z.string().trim().min(1).max(120),
  activityTypeId: optionalId.optional(),
  courtId: optionalId.optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startTime: z.string().trim().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.number().int().min(15).max(360),
  capacity: z.number().int().min(1).max(100),
  pricePerStudent: optionalMoney.optional(),
  level: optionalText(120).optional(),
  description: optionalText(1200).optional(),
  startsOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
  ).optional(),
  // true: crear igual, salteando las fechas en las que la cancha está ocupada.
  skipConflicts: z.boolean().optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  requiresApproval: z.boolean().optional(),
});

const memberBodySchema = z.object({
  studentClientId: z.string().trim().min(1).max(120),
  billingResponsibleClientId: z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    z.string().trim().max(120).nullable()
  ).optional(),
  notes: optionalText(500).optional(),
});

export class ClassSeriesAdminController {
  private readonly service = new ClassSeriesAdminService();

  private resolveClubId(req: Request & { clubId?: number }) {
    const clubId = Number(req.clubId);
    if (!Number.isFinite(clubId) || clubId <= 0) {
      throw validationError('Revisá los campos marcados.', { clubId: 'Club inválido.' });
    }
    return clubId;
  }

  private resolveActorUserId(req: Request) {
    const userId = Number((req as any)?.user?.userId || 0);
    if (!Number.isFinite(userId) || userId <= 0) {
      throw validationError('No se pudo resolver el usuario actual.', { user: 'Usuario inválido.' });
    }
    return userId;
  }

  private resolveId(raw: unknown, label: string) {
    const id = String(raw || '').trim();
    if (!id) throw validationError('Revisá los campos marcados.', { id: `${label} inválido.` });
    return id;
  }

  list = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      return res.json(await this.service.list(this.resolveClubId(req)));
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los cursos.');
    }
  };

  getById = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      return res.json(await this.service.getById(this.resolveClubId(req), this.resolveId(req.params.id, 'Curso')));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo obtener el curso.');
    }
  };

  create = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const parsed = seriesBodySchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const { skipConflicts, ...input } = parsed.data;
      const result = await this.service.create(this.resolveClubId(req), this.resolveActorUserId(req), input, { skipConflicts });
      return res.status(201).json(result);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo crear el curso.');
    }
  };

  update = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const parsed = seriesBodySchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const { skipConflicts, ...input } = parsed.data;
      const result = await this.service.update(
        this.resolveClubId(req),
        this.resolveId(req.params.id, 'Curso'),
        this.resolveActorUserId(req),
        input,
        { skipConflicts }
      );
      return res.json(result);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo actualizar el curso.');
    }
  };

  end = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      return res.json(await this.service.end(this.resolveClubId(req), this.resolveId(req.params.id, 'Curso')));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo terminar el curso.');
    }
  };

  addMember = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const parsed = memberBodySchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const result = await this.service.addMember(
        this.resolveClubId(req),
        this.resolveId(req.params.id, 'Curso'),
        this.resolveActorUserId(req),
        parsed.data
      );
      return res.status(201).json(result);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo anotar al alumno.');
    }
  };

  monthPass = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const parsed = z
        .object({ month: z.string().trim().regex(/^\d{4}-\d{2}$/), preview: z.boolean().optional() })
        .safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Elegí el mes.'));
      const result = await this.service.monthPass(
        this.resolveClubId(req),
        this.resolveId(req.params.id, 'Curso'),
        this.resolveId(req.params.memberId, 'Alumno'),
        this.resolveActorUserId(req),
        parsed.data
      );
      return res.status(parsed.data.preview ? 200 : 201).json(result);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo cobrar el mes.');
    }
  };

  listRequests = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      return res.json(await this.service.listRequests(this.resolveClubId(req)));
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los pedidos.');
    }
  };

  approveMember = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const result = await this.service.approveMember(
        this.resolveClubId(req),
        this.resolveId(req.params.id, 'Curso'),
        this.resolveId(req.params.memberId, 'Alumno')
      );
      return res.json(result);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo aceptar el pedido.');
    }
  };

  rejectMember = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const result = await this.service.rejectMember(
        this.resolveClubId(req),
        this.resolveId(req.params.id, 'Curso'),
        this.resolveId(req.params.memberId, 'Alumno')
      );
      return res.json(result);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo rechazar el pedido.');
    }
  };

  removeMember = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const result = await this.service.removeMember(
        this.resolveClubId(req),
        this.resolveId(req.params.id, 'Curso'),
        this.resolveId(req.params.memberId, 'Alumno')
      );
      return res.json(result);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo sacar al alumno del curso.');
    }
  };
}
