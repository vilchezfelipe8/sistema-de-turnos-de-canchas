import { getToken } from './AuthService';
import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

export type ActivityScheduleMode = 'FIXED' | 'RANGE';

export type ActivityFixedSlot = {
  start: string;
  duration: number;
};

export type ClubActivityType = {
  id: number;
  name: string;
  description?: string;
  defaultDurationMinutes: number;
  scheduleMode: ActivityScheduleMode;
  scheduleOpenTime?: string | null;
  scheduleCloseTime?: string | null;
  scheduleIntervalMinutes?: number | null;
  scheduleDurations?: number[] | null;
  scheduleFixedSlots?: ActivityFixedSlot[] | null;
};

export class ClubAdminService {
  /**
   * Obtener el schedule del admin para un club específico
   */
  static async getAdminSchedule(clubSlug: string, date: string) {
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/schedule?date=${date}`, {
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

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/courts`, {
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

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/courts`, {
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

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/courts/${courtId}/suspend`, {
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

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/courts/${courtId}/reactivate`, {
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

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/info`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al cargar información del club');
    }
    return res.json();
  }

  static async getActivityTypes(clubSlug: string): Promise<ClubActivityType[]> {
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/activity-types`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al cargar actividades');
    }

    return res.json();
  }

  static async updateActivityTypeSchedule(
    clubSlug: string,
    activityTypeId: number,
    payload: {
      scheduleMode: ActivityScheduleMode;
      scheduleOpenTime?: string | null;
      scheduleCloseTime?: string | null;
      scheduleIntervalMinutes?: number | null;
      scheduleDurations?: number[];
      scheduleFixedSlots?: ActivityFixedSlot[];
    }
  ): Promise<ClubActivityType> {
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/activity-types/${activityTypeId}/schedule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al actualizar configuración de actividad');
    }

    return res.json();
  }

  /**
   * Actualizar información del club
   */
  static async updateClubInfo(clubSlug: string, data: any) {
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/info`, {
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
   * Cancelar reserva
   */
  static async cancelBooking(
    clubSlug: string,
    bookingId: number,
    options?: {
      refund?: {
        amount?: number;
        executeNow?: boolean;
        reasonType?: 'FULL' | 'PARTIAL_COMMERCIAL' | 'PARTIAL_SERVICE_FAILURE' | 'PARTIAL_PRICING_ERROR' | 'OTHER';
        executionNotes?: string;
      };
    }
  ) {
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/bookings/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId,
        ...(options?.refund ? { refund: options.refund } : {})
      })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al cancelar reserva');
    }
    return res.json();
  }

  static async confirmBooking(clubSlug: string, bookingId: number) {
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/bookings/${bookingId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al confirmar reserva');
    }
    return res.json();
  }

  static async completeBooking(clubSlug: string, bookingId: number) {
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/bookings/${bookingId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al completar reserva');
    }
    return res.json();
  }

  /**
   * Crear reserva fija
   */
  static async createFixedBooking(clubSlug: string, data: any) {
    if (!getToken()) throw new Error('No autenticado');

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/bookings/fixed`, {
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

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/bookings/fixed/${fixedBookingId}`, {
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
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/products`, {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error('Error al cargar productos');
    return res.json();
  }

  static async createProduct(slug: string, data: any) {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error al crear producto');
    return res.json();
  }

  static async updateProduct(slug: string, id: number, data: any) {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error al actualizar producto');
    return res.json();
  }

  static async deleteProduct(slug: string, id: number) {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/products/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Error al eliminar producto');
    return res.json();
  }

  static async getBookingItems(bookingId: number) {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${apiBase()}/bookings/${bookingId}/items`);
    if (!res.ok) throw new Error('Error al cargar consumos');
    return res.json();
  }

  static async addItemToBooking(
    bookingId: number, 
    productId: number, 
    quantity: number, 
    paymentMethod: 'CASH' | 'TRANSFER'
  ) {
    if (!getToken()) throw new Error('No autenticado');
    
    // La URL está bien...
    const res = await fetchWithAuth(`${apiBase()}/bookings/${bookingId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
          bookingId,  // 👈 ¡FALTABA ESTA LÍNEA! AGREGALA
          productId, 
          quantity,
          paymentMethod 
      })
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Error al agregar producto');
    }
    return res.json();
  }

  static async removeItemFromBooking(itemId: number | string) {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${apiBase()}/bookings/items/${itemId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || 'Error al eliminar consumo');
    }
    return res.json();
  }

  static async getClients(slug: string) {
    if (!getToken()) throw new Error('No autenticado');
    const response = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/clients-list`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error('Error al obtener lista de clientes');
    return response.json();
  }


  static async getDashboardStats(slug: string) {
    if (!getToken()) throw new Error('No autenticado');

    // Ajustá 'apiBase()' según tu configuración, pero suele ser la función que retorna tu URL base
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/stats/dashboard`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Error al cargar métricas');
    }
    
    return res.json();
  }
}
