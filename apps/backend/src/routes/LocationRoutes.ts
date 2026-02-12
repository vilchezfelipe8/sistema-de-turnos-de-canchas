import { Router } from 'express';
import { LocationRepository } from '../repositories/LocationRepository';
import { LocationService } from '../services/LocationService';
import { LocationController } from '../controllers/LocationController';

const router = Router();

const locationRepository = new LocationRepository();
const locationService = new LocationService(locationRepository);
const locationController = new LocationController(locationService);

router.get('/', locationController.getAllLocations);

export default router;
