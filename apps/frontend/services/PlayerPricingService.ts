import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';
import { throwApiErrorFromResponse } from '../utils/apiError';

const apiBase = () => `${getApiUrl()}/api`;

export type ClubPricingMode = 'PER_COURT' | 'PER_PLAYER';
export type MemberPriceValidation = 'NOT_MEMBER' | 'SELF' | 'ACCEPTED' | 'STAFF_VALIDATED' | 'PENDING';

export type ActivityFormat = {
  id: string;
  activityTypeId: number;
  activityName?: string;
  name: string;
  playerCount: number;
  // Duración fija del turno en esta modalidad (null = la de la actividad)
  durationMinutes?: number | null;
  // Si el turno completo no entra en un hueco, permite reservar 1 h al mismo precio por jugador
  allowShortInGaps?: boolean;
  sortOrder?: number;
  isActive?: boolean;
};

export type PlayerPriceTable = {
  formats: Array<{ id: string; name: string; playerCount: number; isActive: boolean; activityTypeId: number; activityName: string }>;
  categories: Array<{ id: string; name: string; isActive: boolean }>;
  prices: Array<{ activityFormatId: string; memberCategoryId: string | null; pricePerPlayer: number }>;
};

// Lugar de una reserva con precio por jugador (vista del admin).
export type AdminPlayerSlot = {
  slotIndex: number;
  participantId: string | null;
  clientId: string | null;
  userId: number | null;
  displayName: string | null;
  isEmpty: boolean;
  memberPriceValidation: MemberPriceValidation;
  pricingMemberCategoryId: string | null;
  pricingMemberCategoryName: string | null;
  memberPricePending: boolean;
  shareListAmount: number;
  shareAmount: number;
  accountItemId: string | null;
  paidAmount: number;
  isFrozen: boolean;
};

export type AdminBookingSlots = {
  perPlayer: boolean;
  activityFormat: { id: string; name: string } | null;
  playerCount: number | null;
  memberBenefitAmount?: number;
  slots: AdminPlayerSlot[];
};

// Lugar visto por un jugador: su categoría solo la ve él mismo (P13).
export type PlayerSlotView = {
  slotIndex: number;
  isEmpty: boolean;
  isMine: boolean;
  displayName: string | null;
  shareAmount: number;
  paid: boolean;
  memberCategoryName: string | null;
  memberPricePending: boolean;
};

const request = async <T>(path: string, init: RequestInit, fallback: string, auth = true): Promise<T> => {
  const url = `${apiBase()}${path}`;
  const options = { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } };
  const res = auth ? await fetchWithAuth(url, options) : await fetch(url, options);
  if (!res.ok) await throwApiErrorFromResponse(res, fallback);
  return res.json();
};

export const PlayerPricingService = {
  getSettings: (slug: string) =>
    request<{ pricingMode: ClubPricingMode; onlineCheckoutEnabled: boolean }>(
      `/clubs/${slug}/admin/pricing-settings`,
      { method: 'GET' },
      'No se pudo obtener la configuración de precios.'
    ),

  updateSettings: (slug: string, body: { pricingMode?: ClubPricingMode; onlineCheckoutEnabled?: boolean }) =>
    request<{ pricingMode: ClubPricingMode; onlineCheckoutEnabled: boolean }>(
      `/clubs/${slug}/admin/pricing-settings`,
      { method: 'PUT', body: JSON.stringify(body) },
      'No se pudo actualizar la configuración de precios.'
    ),

  listFormats: (slug: string) =>
    request<ActivityFormat[]>(`/clubs/${slug}/admin/activity-formats`, { method: 'GET' }, 'No se pudieron cargar las modalidades.'),

  createFormat: (slug: string, body: { activityTypeId: number; name: string; playerCount: number; durationMinutes?: number | null; sortOrder?: number }) =>
    request<ActivityFormat>(
      `/clubs/${slug}/admin/activity-formats`,
      { method: 'POST', body: JSON.stringify(body) },
      'No se pudo crear la modalidad.'
    ),

  updateFormat: (slug: string, formatId: string, body: { name?: string; playerCount?: number; durationMinutes?: number | null; allowShortInGaps?: boolean; isActive?: boolean; sortOrder?: number }) =>
    request<ActivityFormat>(
      `/clubs/${slug}/admin/activity-formats/${formatId}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      'No se pudo actualizar la modalidad.'
    ),

  getPriceTable: (slug: string) =>
    request<PlayerPriceTable>(`/clubs/${slug}/admin/player-prices`, { method: 'GET' }, 'No se pudo cargar la tabla de precios.'),

  savePriceTable: (
    slug: string,
    prices: Array<{ activityFormatId: string; memberCategoryId: string | null; pricePerPlayer: number | null }>
  ) =>
    request<PlayerPriceTable>(
      `/clubs/${slug}/admin/player-prices`,
      { method: 'PUT', body: JSON.stringify({ prices }) },
      'No se pudieron guardar los precios.'
    ),

  // Público (app del jugador)
  getPublicFormats: (slug: string) =>
    request<{ pricingMode: ClubPricingMode; onlineCheckoutEnabled: boolean; formats: ActivityFormat[] }>(
      `/clubs/slug/${encodeURIComponent(slug)}/activity-formats`,
      { method: 'GET' },
      'No se pudieron cargar las modalidades.',
      false
    ),

  // Reserva (admin)
  getBookingSlots: (bookingId: number | string) =>
    request<AdminBookingSlots>(`/bookings/${bookingId}/player-slots`, { method: 'GET' }, 'No se pudieron cargar los lugares.'),

  validateMember: (bookingId: number | string, slotIndex: number) =>
    request<{ slots: AdminPlayerSlot[] }>(
      `/bookings/${bookingId}/player-slots/${slotIndex}/validate-member`,
      { method: 'POST', body: '{}' },
      'No se pudo validar al socio.'
    ),

  reprice: (bookingId: number | string) =>
    request<{ slots: AdminPlayerSlot[] }>(`/bookings/${bookingId}/reprice`, { method: 'POST', body: '{}' }, 'No se pudo recalcular el precio.'),

  // Reserva (jugador)
  getMyBookingSlots: (bookingId: number | string) =>
    request<{ perPlayer: boolean; activityFormat: { id: string; name: string } | null; playerCount: number | null; slots: PlayerSlotView[] }>(
      `/me/bookings/${bookingId}/player-slots`,
      { method: 'GET' },
      'No se pudieron cargar los jugadores de la reserva.'
    )
};
