import { prisma } from '../prisma';

export type LocationRecord = {
  id: number;
  city: string;
  province: string;
  country: string;
};

export class LocationRepository {
  async findAll(): Promise<LocationRecord[]> {
    return await prisma.location.findMany({
      orderBy: [{ country: 'asc' }, { province: 'asc' }, { city: 'asc' }]
    });
  }
}
