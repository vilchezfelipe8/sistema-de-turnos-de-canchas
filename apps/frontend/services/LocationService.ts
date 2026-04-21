import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

export interface Location {
  id: number;
  city: string;
  province: string;
  country: string;
}

export class LocationService {
  static async getAllLocations(): Promise<Location[]> {
    const response = await fetch(`${apiBase()}/locations`);
    if (!response.ok) {
      throw new Error('Error al obtener las ubicaciones');
    }
    return response.json();
  }
}
