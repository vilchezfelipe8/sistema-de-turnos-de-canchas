import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';
import { throwApiErrorFromResponse } from '../utils/apiError';

// TO_RESOLVE: pendientes cuyo turno ya pasó sin que nadie las confirme ni cancele.
export type BookingListView = 'UPCOMING' | 'PENDING' | 'CANCELLED' | 'PAST' | 'TO_RESOLVE';

export type BookingListItem = {
  id: number;
  displayCode: string | null;
  startDateTime: string;
  endDateTime: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  client: { id: string; name: string; phone: string | null };
  court: { id: number; name: string };
  activity: { id: number; name: string };
  isFixed: boolean;
  createdAt: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  cancelledAt: string | null;
  cancelledByName: string | null;
  autoCancelled: boolean;
  autoCancelReason: string | null;
};

export type BookingListResult = {
  items: BookingListItem[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  counts: { upcoming: number; pending: number; cancelled: number; past: number; toResolve?: number };
  timeZone: string;
};

export type FixedBookingListItem = {
  id: number;
  dayOfWeek: number; // 0 = domingo
  startTimeMinutes: number;
  endTimeMinutes: number;
  startDate: string;
  client: { id: string; name: string; phone: string | null };
  court: { id: number; name: string };
  activity: { id: number; name: string };
  nextBooking: { id: number; startDateTime: string } | null;
  upcomingCount: number;
  upcomingPaidAmount: number;
};

export const listAdminFixedBookings = async (
  slug: string,
  params: { q?: string } = {}
): Promise<{ items: FixedBookingListItem[]; timeZone: string }> => {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  const res = await fetchWithAuth(`${getApiUrl()}/api/clubs/${slug}/admin/bookings/fixed-list?${qs}`);
  if (!res.ok) await throwApiErrorFromResponse(res, 'No se pudieron cargar los turnos fijos');
  return res.json();
};

// Pendiente que ya pasó: "se jugó" (confirma, crea la cuenta y la finaliza) o "no se jugó" (cancela). Sin avisos.
export const resolvePastPendingBooking = async (slug: string, bookingId: number, outcome: 'PLAYED' | 'NOT_PLAYED') => {
  const res = await fetchWithAuth(`${getApiUrl()}/api/clubs/${slug}/admin/bookings/${bookingId}/resolve-past`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome }),
  });
  if (!res.ok) await throwApiErrorFromResponse(res, 'No se pudo resolver la reserva');
  return res.json();
};

export const listAdminBookings = async (
  slug: string,
  params: { view?: BookingListView; q?: string; date?: string; page?: number } = {}
): Promise<BookingListResult> => {
  const qs = new URLSearchParams();
  if (params.view) qs.set('view', params.view);
  if (params.q) qs.set('q', params.q);
  if (params.date) qs.set('date', params.date);
  if (params.page) qs.set('page', String(params.page));
  const res = await fetchWithAuth(`${getApiUrl()}/api/clubs/${slug}/admin/bookings?${qs}`);
  if (!res.ok) await throwApiErrorFromResponse(res, 'No se pudieron cargar las reservas');
  return res.json();
};
