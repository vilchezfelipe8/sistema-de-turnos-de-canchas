import { Request, Response } from 'express';
import { sendAppError, validationError } from '../errors';
import { AcademyStudentAdminService } from '../services/academy/AcademyStudentAdminService';

export class AcademyStudentAdminController {
  private readonly service = new AcademyStudentAdminService();

  private resolveClubId(req: Request & { clubId?: number }) {
    const clubId = Number(req.clubId);
    if (!Number.isFinite(clubId) || clubId <= 0) {
      throw validationError('Revisá los campos marcados.', { clubId: 'Club inválido.' });
    }
    return clubId;
  }

  private resolveClientId(raw: unknown) {
    const clientId = String(raw || '').trim();
    if (!clientId) {
      throw validationError('Revisá los campos marcados.', { clientId: 'Alumno inválido.' });
    }
    return clientId;
  }

  list = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const q = String(req.query.q || '').trim() || undefined;
      const rows = await this.service.listByClub(clubId, { q });
      return res.json(rows);
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los alumnos de Academia.');
    }
  };

  getOverview = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const clientId = this.resolveClientId(req.params.clientId);
      const row = await this.service.getOverview(clubId, clientId);
      return res.json(row);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo cargar el resumen académico del alumno.');
    }
  };
}
