// ARCHIVO: services/BookingService.ts

// Si tienes el AuthService en otra carpeta, ajusta esta línea "../services/AuthService"
// Si no lo encuentras, puedes borrar el import y usar localStorage.getItem('token') directo.
import { getToken } from './AuthService';
import { fetchWithAuth } from '../utils/apiClient';

const GUEST_KEY = 'guestId';
function getOrCreateGuestId() {
  try {
    const existing = localStorage.getItem(GUEST_KEY);
    if (existing) return existing;
    const id = (typeof crypto !== 'undefined' && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : `guest_${Math.random().toString(36).slice(2,10)}`;
    localStorage.setItem(GUEST_KEY, id);
    return id;
  } catch (e) {
    return `guest_${Math.random().toString(36).slice(2,10)}`;
  }
}

import { getApiUrl } from '../utils/apiUrl';

const API_URL = getApiUrl();

// --- 1. CREAR UNA RESERVA ---
export const createBooking = async (
  courtId: number,
  activityId: number,
  date: Date,
  userId?: number,
  // 👇 Aceptamos 'dni' también en el tipo para evitar errores de TS
  guestInfo?: { name?: string; email?: string; phone?: string; guestDni?: string; dni?: string },
  options?: { asGuest?: boolean; guestIdentifier?: string; isProfessor?: boolean; durationMinutes?: number }
) => {
  const token = getToken();
  const guestId = token ? undefined : getOrCreateGuestId();
  const guestIdentifier = options?.guestIdentifier ?? guestId;

  // 👇 Truco: Unificamos el valor del DNI venga como venga
  const dniValue = guestInfo?.guestDni || guestInfo?.dni;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetchWithAuth(`${API_URL}/bookings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      courtId,
      activityId,
      startDateTime: date.toISOString(),
      ...(guestIdentifier ? { guestIdentifier } : {}),
      ...(guestInfo?.name ? { guestName: guestInfo.name } : {}),
      ...(guestInfo?.email ? { guestEmail: guestInfo.email } : {}),
      ...(guestInfo?.phone ? { guestPhone: guestInfo.phone } : {}),
      
      // 👇 ENVÍO ROBUSTO DEL DNI (Lo mandamos con ambos nombres por seguridad)
      ...(dniValue ? { guestDni: dniValue, dni: dniValue } : {}),

      ...(options?.asGuest ? { asGuest: true } : {}),
        ...(options?.isProfessor ? { isProfessor: true } : {}),
        ...(Number.isFinite(options?.durationMinutes) ? { durationMinutes: options?.durationMinutes } : {}),
      
      // El ID del usuario si corresponde
      ...(userId ? { userId } : {}) 
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || errorData.message || 'Error al reservar');
  }

  return response.json();
};

// --- 2. OBTENER MIS RESERVAS (HISTORIAL) ---
export const getMyBookings = async (userId: number) => {
    if (!getToken()) throw new Error("Debes iniciar sesión.");

    const res = await fetchWithAuth(`${API_URL}/bookings/history/${userId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
        throw new Error('Error al cargar el historial');
    }
    return res.json();
};

// --- 3. CANCELAR UNA RESERVA ---
export const cancelBooking = async (bookingId: number) => {
    if (!getToken()) throw new Error("Debes iniciar sesión.");

    const res = await fetchWithAuth(`${API_URL}/bookings/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId })
    });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'No se pudo cancelar el turno');
    }
    return res.json();
};

export const confirmBooking = async (bookingId: number) => {
    if (!getToken()) throw new Error("Debes iniciar sesión como administrador.");

    const res = await fetchWithAuth(`${API_URL}/bookings/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId })
    });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || error.message || 'No se pudo confirmar el turno');
    }
    return res.json();
};

// --- 4. OBTENER SCHEDULE COMPLETO DEL DÍA (ADMIN) ---
export const getAdminSchedule = async (date: string) => {
    if (!getToken()) throw new Error("Debes iniciar sesión como administrador.");

    const res = await fetchWithAuth(`${API_URL}/bookings/admin/schedule?date=${date}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Error al cargar el schedule');
    }
    return res.json();
};

// --- 5. CREAR TURNO FIJO ---
export const createFixedBooking = async (
  userId: number | undefined,
  courtId: number,
  activityId: number,
  startDateTime: Date,
  guestName?: string,
  guestPhone?: string,
  guestDni?: string, // <--- Recibimos el dato (Argumento #7)
  isProfessor?: boolean
) => {
  const token = getToken();
  // Validamos token si es necesario, o dejamos que el backend decida
  if (!token) throw new Error("Debes iniciar sesión como administrador.");

  const res = await fetchWithAuth(`${API_URL}/bookings/fixed`, {
    method: 'POST',
    headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
        courtId,
        activityId,
        startDateTime: startDateTime.toISOString(),
        
        // Si hay ID de usuario (cliente registrado)
        ...(userId ? { userId } : {}),
        
        // Si es invitado (cliente manual)
        ...(guestName ? { guestName } : {}),
        ...(guestPhone ? { guestPhone } : {}),
        
        // 👇👇👇 AQUÍ ESTABA EL PROBLEMA 👇👇👇
        // Ahora lo enviamos con ambos nombres por seguridad
        ...(guestDni ? { guestDni } : {}),
        ...(isProfessor ? { isProfessor: true } : {})
    })
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || error.message || 'Error al crear turno fijo');
  }
  return res.json();
};

// --- 6. CANCELAR TURNO FIJO (NUEVO - Corregido para usar fetch) ---
export const cancelFixedBooking = async (fixedBookingId: number) => {
  if (!getToken()) throw new Error("Debes iniciar sesión como administrador.");

  const res = await fetchWithAuth(`${API_URL}/bookings/fixed/${fixedBookingId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Error al cancelar turno fijo');
  }
  return res.json();
};

export const searchClients = async (slug: string, query: string) => {
    if (!getToken()) throw new Error("Debes iniciar sesión.");

    const res = await fetchWithAuth(`${API_URL}/clubs/${slug}/admin/clients-list?q=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
        return [];
    }

    return res.json();
};

