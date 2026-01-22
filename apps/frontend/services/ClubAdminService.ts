const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const getToken = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('token');
  }
  return null;
};

export class ClubAdminService {
  /**
   * Obtener el schedule del admin para un club específico
   */
  static async getAdminSchedule(clubSlug: string, date: string) {
    const token = getToken();
    if (!token) throw new Error('No autenticado');

    const res = await fetch(`${API_URL}/api/clubs/${clubSlug}/admin/schedule?date=${date}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al cargar el schedule');
    }
    return res.json();
  }

  /**
   * Obtener todas las canchas del club
   */
  static async getCourts(clubSlug: string) {
    const token = getToken();
    if (!token) throw new Error('No autenticado');

    const res = await fetch(`${API_URL}/api/clubs/${clubSlug}/admin/courts`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al cargar las canchas');
    }
    return res.json();
  }

  /**
   * Crear cancha en el club
   */
  static async createCourt(clubSlug: string, name: string, surface: string) {
    const token = getToken();
    if (!token) throw new Error('No autenticado');

    const res = await fetch(`${API_URL}/api/clubs/${clubSlug}/admin/courts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name, surface })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al crear cancha');
    }
    return res.json();
  }

  /**
   * Suspender cancha
   */
  static async suspendCourt(clubSlug: string, courtId: number) {
    const token = getToken();
    if (!token) throw new Error('No autenticado');

    const res = await fetch(`${API_URL}/api/clubs/${clubSlug}/admin/courts/${courtId}/suspend`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al suspender cancha');
    }
    return res.json();
  }

  /**
   * Reactivar cancha
   */
  static async reactivateCourt(clubSlug: string, courtId: number) {
    const token = getToken();
    if (!token) throw new Error('No autenticado');

    const res = await fetch(`${API_URL}/api/clubs/${clubSlug}/admin/courts/${courtId}/reactivate`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al reactivar cancha');
    }
    return res.json();
  }

  /**
   * Obtener información del club
   */
  static async getClubInfo(clubSlug: string) {
    const token = getToken();
    if (!token) throw new Error('No autenticado');

    const res = await fetch(`${API_URL}/api/clubs/${clubSlug}/admin/info`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al cargar información del club');
    }
    return res.json();
  }

  /**
   * Actualizar información del club
   */
  static async updateClubInfo(clubSlug: string, data: any) {
    const token = getToken();
    if (!token) throw new Error('No autenticado');

    const res = await fetch(`${API_URL}/api/clubs/${clubSlug}/admin/info`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al actualizar información del club');
    }
    return res.json();
  }

  /**
   * Confirmar reserva
   */
  static async confirmBooking(clubSlug: string, bookingId: number) {
    const token = getToken();
    if (!token) throw new Error('No autenticado');

    const res = await fetch(`${API_URL}/api/clubs/${clubSlug}/admin/bookings/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bookingId })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al confirmar reserva');
    }
    return res.json();
  }

  /**
   * Cancelar reserva
   */
  static async cancelBooking(clubSlug: string, bookingId: number) {
    const token = getToken();
    if (!token) throw new Error('No autenticado');

    const res = await fetch(`${API_URL}/api/clubs/${clubSlug}/admin/bookings/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bookingId })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al cancelar reserva');
    }
    return res.json();
  }

  /**
   * Crear reserva fija
   */
  static async createFixedBooking(clubSlug: string, data: any) {
    const token = getToken();
    if (!token) throw new Error('No autenticado');

    const res = await fetch(`${API_URL}/api/clubs/${clubSlug}/admin/bookings/fixed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al crear reserva fija');
    }
    return res.json();
  }

  /**
   * Cancelar reserva fija
   */
  static async cancelFixedBooking(clubSlug: string, fixedBookingId: number) {
    const token = getToken();
    if (!token) throw new Error('No autenticado');

    const res = await fetch(`${API_URL}/api/clubs/${clubSlug}/admin/bookings/fixed/${fixedBookingId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al cancelar reserva fija');
    }
    return res.json();
  }
}
