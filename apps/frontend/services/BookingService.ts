// ARCHIVO: services/BookingService.ts

// Si tienes el AuthService en otra carpeta, ajusta esta línea "../services/AuthService"
// Si no lo encuentras, puedes borrar el import y usar localStorage.getItem('token') directo.
import { getToken } from './AuthService'; 

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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// --- 1. CREAR UNA RESERVA ---
export const createBooking = async (courtId: number, activityId: number, date: Date) => {
  const token = getToken();
  const guestId = token ? undefined : getOrCreateGuestId();

  const headers: any = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_URL}/api/bookings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      courtId,
      activityId,
      startDateTime: date.toISOString(), // Enviamos fecha ISO, el back resta las 3hs
      ...(guestId ? { guestIdentifier: guestId } : {})
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
    const token = getToken();
    if (!token) throw new Error("Debes iniciar sesión.");

    const res = await fetch(`${API_URL}/api/bookings/history/${userId}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });

    if (!res.ok) {
        throw new Error('Error al cargar el historial');
    }
    return res.json();
};

// --- 3. CANCELAR UNA RESERVA ---
export const cancelBooking = async (bookingId: number) => {
    const token = getToken();
    if (!token) throw new Error("Debes iniciar sesión.");

    const res = await fetch(`${API_URL}/api/bookings/cancel`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ bookingId })
    });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'No se pudo cancelar el turno');
    }
    return res.json();
};

// --- 4. OBTENER SCHEDULE COMPLETO DEL DÍA (ADMIN) ---
export const getAdminSchedule = async (date: string) => {
    const token = getToken();
    if (!token) throw new Error("Debes iniciar sesión como administrador.");

    const res = await fetch(`${API_URL}/api/bookings/admin/schedule?date=${date}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Error al cargar el schedule');
    }
    return res.json();
};