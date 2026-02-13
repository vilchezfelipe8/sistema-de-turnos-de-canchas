import { getToken } from './AuthService';
import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const API_URL = getApiUrl();

export interface Club {
  id: number;
  slug: string;
  name: string;
  addressLine: string;
  city: string;
  province: string;
  country: string;
  contactInfo: string;
  phone?: string;
  logoUrl?: string;
  clubImageUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  websiteUrl?: string;
  description?: string;
  lightsEnabled?: boolean;
  lightsExtraAmount?: number | null;
  lightsFromHour?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export class ClubService {
  static async getClubById(id: number): Promise<Club> {
    const response = await fetch(`${API_URL}/api/clubs/${id}`);
    if (!response.ok) {
      throw new Error('Error al obtener el club');
    }
    return response.json();
  }

  static async getClubBySlug(slug: string): Promise<Club> {
    const response = await fetch(`${API_URL}/api/clubs/slug/${slug}`);
    if (!response.ok) {
      throw new Error('Error al obtener el club');
    }
    return response.json();
  }

  static async getAllClubs(): Promise<Club[]> {
    const response = await fetch(`${API_URL}/api/clubs`);
    if (!response.ok) {
      throw new Error('Error al obtener los clubes');
    }
    return response.json();
  }

  static async updateClub(id: number, data: Partial<Club>): Promise<Club> {
    if (!getToken()) throw new Error('No autenticado');

    const response = await fetchWithAuth(`${API_URL}/api/clubs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Error al actualizar el club');
    }

    return response.json();
  }

  static async createClub(data: Partial<Club>): Promise<Club> {
    if (!getToken()) throw new Error('No autenticado');

    const response = await fetchWithAuth(`${API_URL}/api/clubs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Error al crear el club');
    }

    return response.json();
  }
}
