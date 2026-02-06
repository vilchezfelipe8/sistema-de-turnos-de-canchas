import { getToken } from './AuthService';
import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const API_URL = getApiUrl();

export class ClubAdminService {
  /**
   * Obtener el schedule del admin para un club específico
   */
  static async getAdminSchedule(clubSlug: string, date: string) {
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${API_URL}/api/clubs/${clubSlug}/admin/schedule?date=${date}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
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
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${API_URL}/api/clubs/${clubSlug}/admin/courts`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
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
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${API_URL}/api/clubs/${clubSlug}/admin/courts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${API_URL}/api/clubs/${clubSlug}/admin/courts/${courtId}/suspend`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
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
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${API_URL}/api/clubs/${clubSlug}/admin/courts/${courtId}/reactivate`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
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
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${API_URL}/api/clubs/${clubSlug}/admin/info`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
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
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${API_URL}/api/clubs/${clubSlug}/admin/info`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
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
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${API_URL}/api/clubs/${clubSlug}/admin/bookings/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${API_URL}/api/clubs/${clubSlug}/admin/bookings/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${API_URL}/api/clubs/${clubSlug}/admin/bookings/fixed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${API_URL}/api/clubs/${clubSlug}/admin/bookings/fixed/${fixedBookingId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al cancelar reserva fija');
    }
    return res.json();
  }

  static async getProducts(slug: string) {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${API_URL}/api/clubs/${slug}/admin/products`, {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error('Error al cargar productos');
    return res.json();
  }

  static async createProduct(slug: string, data: any) {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${API_URL}/api/clubs/${slug}/admin/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error al crear producto');
    return res.json();
  }

  static async updateProduct(slug: string, id: number, data: any) {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${API_URL}/api/clubs/${slug}/admin/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error al actualizar producto');
    return res.json();
  }

  static async deleteProduct(slug: string, id: number) {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${API_URL}/api/clubs/${slug}/admin/products/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Error al eliminar producto');
    return res.json();
  }

  static async getBookingItems(bookingId: number) {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${API_URL}/api/bookings/${bookingId}/items`);
    if (!res.ok) throw new Error('Error al cargar consumos');
    return res.json();
  }

  static async addItemToBooking(bookingId: number, productId: number, quantity: number) {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${API_URL}/api/bookings/${bookingId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, quantity })
    });
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Error al agregar producto');
    }
    return res.json();
  }

  static async removeItemFromBooking(itemId: number) {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${API_URL}/api/bookings/items/${itemId}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Error al eliminar consumo');
    return res.json();
  }

  static async updateBookingPaymentStatus(bookingId: number, status: 'PAID' | 'DEBT') {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${API_URL}/api/bookings/${bookingId}/payment-status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentStatus: status })
    });
    if (!res.ok) throw new Error('Error al actualizar el estado del pago');
    return res.json();
  }

  /** Lista de deudores: sin slug usa el club del token (admin unificado). */
  static async getDebtors(slug?: string) {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${API_URL}/api/bookings/debtors/list`);
    if (!res.ok) throw new Error('Error cargando deudores');
    return res.json();
  }

  static async markAsPaid(bookingIds: number[]) {
    if (!getToken()) throw new Error('No autenticado');
    const promises = bookingIds.map(id =>
      fetchWithAuth(`${API_URL}/api/bookings/${id}/payment-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentStatus: 'PAID' })
      })
    );
    await Promise.all(promises);
    return true;
  }

  static async getClients(slug: string) {
    if (!getToken()) throw new Error('No autenticado');
    const response = await fetchWithAuth(`${API_URL}/api/clubs/${slug}/admin/clients-list`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error('Error al obtener lista de clientes');
    return response.json();
  }
}

