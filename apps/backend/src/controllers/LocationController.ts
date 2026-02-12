import { Request, Response } from 'express';
import { LocationService } from '../services/LocationService';

export class LocationController {
  constructor(private locationService: LocationService) {}

  getAllLocations = async (_req: Request, res: Response) => {
    try {
      const locations = await this.locationService.getAllLocations();
      res.json(locations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}
