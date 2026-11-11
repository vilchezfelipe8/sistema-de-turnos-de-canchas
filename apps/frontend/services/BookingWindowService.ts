import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';
import { throwApiErrorFromResponse } from '../utils/apiError';

const apiBase = () => `${getApiUrl()}/api`;

// Ventanas de reserva desde la app (prioridad de socios).

export type BookingWindowTimes = { memberOpensAt: string; publicOpensAt: string };

export type BookingWindowPolicy = {
  enabled: boolean;
  weekdays: BookingWindowTimes;
  // SAME = igual que en la semana · CUSTOM = otros horarios · NO_PRIORITY = todos a la misma hora
  weekendMode: 'SAME' | 'CUSTOM' | 'NO_PRIORITY';
  weekend: BookingWindowTimes;
  daysAhead: number;
  closesAt: string;
};

export type BookingWindowState = 'OPEN' | 'NOT_OPEN_YET' | 'MEMBERS_ONLY' | 'CLOSED_FOR_TODAY';

export type BookingWindowEvaluation =
  | { enabled: false }
  | {
      enabled: true;
      state: BookingWindowState;
      canBookNow: boolean;
      isAuthenticated: boolean;
      isMember: boolean;
      hasMemberPriority: boolean;
      memberPriorityActive: boolean;
      memberOpensAt: string;
      publicOpensAt: string;
      viewerOpensAt: string;
      closesAt: string;
      daysAhead: number;
      allowedDates: string[];
      serverNow: string;
      timeZone: string;
    };

export const BookingWindowService = {
  // Público, con la sesión si existe: qué puede reservar quien mira.
  getPublicWindow: async (slug: string): Promise<BookingWindowEvaluation> => {
    const res = await fetch(`${apiBase()}/clubs/slug/${encodeURIComponent(slug)}/booking-window?t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) await throwApiErrorFromResponse(res, 'No se pudo obtener el horario de reservas.');
    return res.json();
  },

  getPolicy: async (slug: string): Promise<BookingWindowPolicy> => {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/booking-window`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) await throwApiErrorFromResponse(res, 'No se pudo obtener la configuración de ventanas de reserva.');
    return res.json();
  },

  savePolicy: async (slug: string, policy: BookingWindowPolicy): Promise<BookingWindowPolicy> => {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/booking-window`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(policy)
    });
    if (!res.ok) await throwApiErrorFromResponse(res, 'No se pudo guardar la configuración de ventanas de reserva.');
    return res.json();
  }
};
