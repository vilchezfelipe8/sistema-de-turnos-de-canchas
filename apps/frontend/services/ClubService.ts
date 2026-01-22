const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export interface Club {
  id: number;
  slug: string;
  name: string;
  address: string;
  contactInfo: string;
  phone?: string;
  logoUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  websiteUrl?: string;
  description?: string;
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
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('No autenticado');
    }

    const response = await fetch(`${API_URL}/api/clubs/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Error al actualizar el club');
    }

    return response.json();
  }

  static async createClub(data: Partial<Club>): Promise<Club> {
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('No autenticado');
    }

    const response = await fetch(`${API_URL}/api/clubs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Error al crear el club');
    }

    return response.json();
  }
}
