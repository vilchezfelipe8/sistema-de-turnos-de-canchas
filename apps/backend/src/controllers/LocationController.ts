import { Request, Response } from 'express';
import { sendAppError } from '../errors';
import { LocationService } from '../services/LocationService';

export class LocationController {
  constructor(private locationService: LocationService) {}

  getAllLocations = async (_req: Request, res: Response) => {
    try {
      const locations = await this.locationService.getAllLocations();
      res.json(locations);
    } catch (error: any) {
      return sendAppError(res, error, 'Error al listar ubicaciones');
    }
  };
}
