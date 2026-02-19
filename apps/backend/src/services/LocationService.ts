import { LocationRepository, LocationRecord } from '../repositories/LocationRepository';

export class LocationService {
  constructor(private locationRepo: LocationRepository) {}

  async getAllLocations(): Promise<LocationRecord[]> {
    return await this.locationRepo.findAll();
  }
}
