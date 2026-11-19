import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';
import { throwApiErrorFromResponse } from '../utils/apiError';

const apiBase = () => `${getApiUrl()}/api`;

export type TurnWindow = { weekdays: number[]; open: string; close: string };

export type TurnSchedule = {
  activityTypeId: number;
  name: string;
  slotMinutes: number;
  capacity: number;
  windows: TurnWindow[];
  bookAheadDays: number;
  requiresTurn: boolean;
  earlyEntryMinutes: number;
  isActive: boolean;
};

export type TurnScheduleInput = Omit<TurnSchedule, 'activityTypeId'>;

export type TurnSlot = {
  startsAt: string;
  endsAt: string;
  time: string;
  booked: number;
  available: number;
  isPast: boolean;
  myTurnId: string | null;
};

export type TurnDay = {
  activityTypeId: number;
  name: string;
  date: string;
  capacity: number;
  access: { allowed: boolean; code: string; message: string; timesPerWeek: number | null } | null;
  week: { used: number; limit: number } | null;
  slots: TurnSlot[];
};

export type AdminTurnSlot = TurnSlot & {
  people: Array<{ turnId: string; clientId: string; name: string; checkedInAt: string | null }>;
};

export type AdminTurnDay = Omit<TurnDay, 'slots'> & { slots: AdminTurnSlot[] };

export type PublicTurnActivity = {
  activityTypeId: number;
  name: string;
  slotMinutes: number;
  capacity: number;
  requiresTurn: boolean;
  days: string[];
};

export type MyTurn = {
  id: string;
  activityTypeId: number;
  activityName: string;
  startsAt: string;
  endsAt: string;
  date: string;
  time: string;
  endTime: string;
  started: boolean;
};

const request = async <T>(path: string, init: RequestInit, fallback: string): Promise<T> => {
  const res = await fetchWithAuth(`${apiBase()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) await throwApiErrorFromResponse(res, fallback);
  return res.json();
};

const enc = encodeURIComponent;

/** Turnero (ej. Musculación): reservas por franja con cupo. */
export const ActivityTurnService = {
  // Jugador
  listPublic: (slug: string) =>
    request<{ activities: PublicTurnActivity[]; mine: MyTurn[] }>(`/clubs/slug/${enc(slug)}/turns`, { method: 'GET' }, 'No se pudieron cargar los turnos.'),

  daySlots: (slug: string, activityTypeId: number, date: string) =>
    request<TurnDay>(
      `/clubs/slug/${enc(slug)}/turns/${activityTypeId}/slots?date=${enc(date)}`,
      { method: 'GET' },
      'No se pudieron cargar los turnos.'
    ),

  book: (slug: string, activityTypeId: number, startsAt: string) =>
    request<{ id: string; label: string }>(
      `/clubs/slug/${enc(slug)}/turns/${activityTypeId}`,
      { method: 'POST', body: JSON.stringify({ startsAt }) },
      'No se pudo reservar el turno.'
    ),

  cancelMine: (slug: string, turnId: string) =>
    request<{ id: string }>(`/clubs/slug/${enc(slug)}/turns/mine/${enc(turnId)}/cancel`, { method: 'POST' }, 'No se pudo cancelar el turno.'),

  // Admin
  listSchedules: (slug: string) =>
    request<TurnSchedule[]>(`/clubs/${slug}/admin/turn-schedules`, { method: 'GET' }, 'No se pudieron cargar los turneros.'),

  createSchedule: (slug: string, body: TurnScheduleInput) =>
    request<TurnSchedule>(`/clubs/${slug}/admin/turn-schedules`, { method: 'POST', body: JSON.stringify(body) }, 'No se pudo crear el turnero.'),

  updateSchedule: (slug: string, activityTypeId: number, body: TurnScheduleInput) =>
    request<TurnSchedule>(
      `/clubs/${slug}/admin/turn-schedules/${activityTypeId}`,
      { method: 'PUT', body: JSON.stringify(body) },
      'No se pudo guardar el turnero.'
    ),

  adminDay: (slug: string, activityTypeId: number, date: string) =>
    request<AdminTurnDay>(`/clubs/${slug}/admin/turns/${activityTypeId}?date=${enc(date)}`, { method: 'GET' }, 'No se pudieron cargar los turnos.'),

  /** El club anota a un cliente en una franja (valida su plan y el cupo igual que la app). */
  adminBook: (slug: string, activityTypeId: number, startsAt: string, clientId: string) =>
    request<{ id: string }>(
      `/clubs/${slug}/admin/turns/${activityTypeId}`,
      { method: 'POST', body: JSON.stringify({ startsAt, clientId }) },
      'No se pudo anotar el turno.'
    ),

  adminCancel: (slug: string, turnId: string) =>
    request<{ id: string }>(`/clubs/${slug}/admin/turns/item/${enc(turnId)}/cancel`, { method: 'POST' }, 'No se pudo cancelar el turno.'),

  // Ingreso (kiosco)
  checkIn: (slug: string, activityTypeId: number, identifier: string) =>
    request<CheckInResult>(
      `/clubs/${slug}/admin/access/check-in`,
      { method: 'POST', body: JSON.stringify({ activityTypeId, identifier }) },
      'No se pudo validar el ingreso.'
    ),

  accessLogs: (slug: string, date?: string) =>
    request<AccessLogDay>(
      `/clubs/${slug}/admin/access/logs${date ? `?date=${enc(date)}` : ''}`,
      { method: 'GET' },
      'No se pudieron cargar los ingresos.'
    ),

  // Huellas (lector del molinete)
  fingerprintSync: (slug: string) =>
    request<{ count: number; fingerprints: FingerprintTemplate[] }>(`/clubs/${slug}/admin/fingerprints`, { method: 'GET' }, 'No se pudieron cargar las huellas.'),

  fingerprintLookup: (slug: string, dni: string) =>
    request<FingerprintOwner[]>(`/clubs/${slug}/admin/fingerprints/lookup?dni=${enc(dni)}`, { method: 'GET' }, 'No se pudo buscar el cliente.'),

  fingerprintEnroll: (slug: string, body: { clientId: string; template: string; format: string; finger: number | null; consent: boolean }) =>
    request<{ id: string; clientId: string; name: string }>(
      `/clubs/${slug}/admin/fingerprints`,
      { method: 'POST', body: JSON.stringify(body) },
      'No se pudo guardar la huella.'
    ),

  fingerprintRemove: (slug: string, id: string) =>
    request<{ ok: true }>(`/clubs/${slug}/admin/fingerprints/${enc(id)}`, { method: 'DELETE' }, 'No se pudo borrar la huella.'),

  myAccessCode: (slug: string) =>
    request<{ code: string; svg: string; name: string }>(`/clubs/slug/${enc(slug)}/access-code`, { method: 'GET' }, 'No se pudo armar tu código.'),
};

export type FingerprintTemplate = { id: string; clientId: string; format: string; template: string };

export type FingerprintOwner = {
  id: string;
  name: string;
  fingerprints: Array<{ id: string; finger: number | null; createdAt: string }>;
};

export type CheckInResult = {
  allowed: boolean;
  code: string;
  message: string;
  firstName: string | null;
  name: string | null;
  planName: string | null;
  validUntil: string | null;
  turn: { startsAt: string; endsAt: string; label: string } | null;
};

export type AccessLogDay = {
  date: string;
  allowed: number;
  denied: number;
  rows: Array<{
    id: string;
    time: string;
    createdAt: string;
    name: string | null;
    activityName: string | null;
    method: string;
    result: 'ALLOWED' | 'DENIED';
    code: string;
    message: string;
  }>;
};

export const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** "Lun a Vie 07:00–23:00 · Sáb 08:00–14:00" */
export const windowsLabel = (windows: TurnWindow[]) =>
  windows
    .map((row) => {
      const days = [...row.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      const order = days.map((d) => (d + 6) % 7);
      const consecutive = order.length > 2 && order.every((v, i) => i === 0 || v === order[i - 1] + 1);
      const dayLabel =
        days.length === 7
          ? 'Todos los días'
          : consecutive
            ? `${WEEKDAY_SHORT[days[0]]} a ${WEEKDAY_SHORT[days[days.length - 1]]}`
            : days.map((d) => WEEKDAY_SHORT[d]).join(', ');
      return `${dayLabel} ${row.open}–${row.close}`;
    })
    .join(' · ');
