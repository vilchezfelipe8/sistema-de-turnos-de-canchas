import { Request, Response } from 'express';
import { z } from 'zod';
import { CashRegisterService } from '../services/CashRegisterService';

export class CashRegisterController {
  private readonly service = new CashRegisterService();

  private resolveClubId(req: Request) {
    const clubId = Number((req as Request & { clubId?: number }).clubId);
    if (!Number.isFinite(clubId) || clubId <= 0) throw new Error('Club inválido');
    return clubId;
  }

  create = async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        name: z.string().trim().min(1),
        location: z.string().trim().optional()
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = this.resolveClubId(req);
      const register = await this.service.create(clubId, parsed.data);
      return res.status(201).json(register);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo crear la caja';
      return res.status(400).json({ error: message });
    }
  };

  list = async (req: Request, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const registers = await this.service.list(clubId);
      return res.json(registers);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudieron listar cajas';
      return res.status(400).json({ error: message });
    }
  };
}
