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
import { ClubService } from './ClubService';
import { ClubAdminService } from './ClubAdminService';
import { hasAdminAccess, normalizeSessionUser } from '../utils/session';
import { getOrCreateBookingAccount, getAccountSummary, getAccountById, registerPayment } from './AccountService';

const apiBase = () => `${getApiUrl()}/api`;

export type BookingFinancialSummary = {
  courtTotal: number;
  itemsTotal: number;
  total: number;
  paid: number;
  remaining: number;
  depositRequiredAmount: number;
  depositCovered: boolean;
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  confirmationMode: 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED';
  requiredToConfirm: number;
  remainingToConfirm: number;
  isPendingByInsufficientPayment: boolean;
  autoCancelStatus: {
    enabled: boolean;
    minutesBefore: number | null;
    onlyIfUnpaid: boolean;
    blockedByPayment: boolean;
    eligibleNow: boolean;
    autoCancelAt: string | null;
    label: string;
  };
};

export type BookingQuote = {
  listPrice: number;
  finalPrice: number;
  discountAmount: number;
  hasDiscount: boolean;
  appliedPolicies: Array<{
    policyId: string;
    policyName: string;
    discountAmount: number;
  }>;
};

// --- 1. CREAR UNA RESERVA ---
export const createBooking = async (
  courtId: number,
  activityId: number,
  date: Date,
  slotTime?: string,
  userId?: number,
  // Aceptamos 'dni' también en el tipo para evitar errores de TS
  guestInfo?: { name?: string; email?: string; phone?: string; guestDni?: string; dni?: string },
  options?: {
    asGuest?: boolean;
    guestIdentifier?: string;
    isProfessor?: boolean;
    professorOverrideReason?: string;
    durationMinutes?: number;
    applyDiscount?: boolean;
  }
) => {
  const token = getToken();
  const guestId = token ? undefined : getOrCreateGuestId();
  const guestIdentifier = options?.guestIdentifier ?? guestId;

  // Truco: unificamos el valor del DNI venga como venga
  const dniValue = guestInfo?.guestDni || guestInfo?.dni;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetchWithAuth(`${apiBase()}/bookings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      courtId,
      activityId,
      ...(slotTime ? {
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        slotTime
      } : { startDateTime: date.toISOString() }),
      ...(guestIdentifier ? { guestIdentifier } : {}),
      ...(guestInfo?.name ? { guestName: guestInfo.name } : {}),
      ...(guestInfo?.email ? { guestEmail: guestInfo.email } : {}),
      ...(guestInfo?.phone ? { guestPhone: guestInfo.phone } : {}),
      
      ...(dniValue ? { guestDni: dniValue } : {}),

      ...(options?.asGuest ? { asGuest: true } : {}),
      ...(options?.isProfessor ? { isProfessor: true } : {}),
      ...(options?.professorOverrideReason ? { professorOverrideReason: options.professorOverrideReason } : {}),
      ...(Number.isFinite(options?.durationMinutes) ? { durationMinutes: options?.durationMinutes } : {}),
      ...(options?.applyDiscount === undefined ? {} : { applyDiscount: options.applyDiscount })
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    const err: any = new Error(errorData.error || errorData.message || 'Error al reservar');
    err.details = errorData;
    throw err;
  }

  return response.json();
};

export const getBookingQuote = async (input: {
  courtId: number;
  activityId: number;
  date: Date;
  slotTime: string;
  durationMinutes?: number;
  guestEmail?: string;
  guestPhone?: string;
  guestDni?: string;
  applyDiscount?: boolean;
}) => {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetchWithAuth(`${apiBase()}/bookings/quote`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      courtId: input.courtId,
      activityId: input.activityId,
      date: `${input.date.getFullYear()}-${String(input.date.getMonth() + 1).padStart(2, '0')}-${String(input.date.getDate()).padStart(2, '0')}`,
      slotTime: input.slotTime,
      ...(Number.isFinite(input.durationMinutes) ? { durationMinutes: input.durationMinutes } : {}),
      ...(input.guestEmail ? { guestEmail: input.guestEmail } : {}),
      ...(input.guestPhone ? { guestPhone: input.guestPhone } : {}),
      ...(input.guestDni ? { guestDni: input.guestDni } : {}),
      ...(input.applyDiscount === undefined ? {} : { applyDiscount: input.applyDiscount })
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || 'No se pudo cotizar la reserva');
  }

  const payload = await response.json();
  return {
    listPrice: Number(payload?.listPrice || 0),
    finalPrice: Number(payload?.finalPrice || 0),
    discountAmount: Number(payload?.discountAmount || 0),
    hasDiscount: Boolean(payload?.hasDiscount),
    appliedPolicies: Array.isArray(payload?.appliedPolicies)
      ? payload.appliedPolicies.map((policy: any) => ({
          policyId: String(policy.policyId || ''),
          policyName: String(policy.policyName || ''),
          discountAmount: Number(policy.discountAmount || 0)
        }))
      : []
  } satisfies BookingQuote;
};

// --- 2. OBTENER MIS RESERVAS (HISTORIAL) ---
export const getMyBookings = async (userId: number) => {
    if (!getToken()) throw new Error("Debes iniciar sesión.");

    const res = await fetchWithAuth(`${apiBase()}/bookings/history/${userId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
        throw new Error('Error al cargar el historial');
    }
    return res.json();
};

// --- 3. CANCELAR UNA RESERVA ---
export const cancelBooking = async (
  bookingId: number,
  options?: {
    refund?: {
      amount?: number;
      executeNow?: boolean;
      reasonType?: 'FULL' | 'PARTIAL_COMMERCIAL' | 'PARTIAL_SERVICE_FAILURE' | 'PARTIAL_PRICING_ERROR' | 'OTHER';
      executionNotes?: string;
    };
  }
) => {
    if (!getToken()) throw new Error("Debes iniciar sesión.");

  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (rawUser) {
    const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
    const adminClubId = Number(parsed?.activeClubId || parsed?.clubId || parsed?.club?.id);
    if (hasAdminAccess(parsed) && Number.isFinite(adminClubId) && adminClubId > 0) {
      const club = await ClubService.getClubById(adminClubId);
      return await ClubAdminService.cancelBooking(club.slug, bookingId, options);
    }
  }

  const res = await fetchWithAuth(`${apiBase()}/bookings/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bookingId,
      ...(options?.refund ? { refund: options.refund } : {})
    })
  });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'No se pudo cancelar el turno');
    }
    return res.json();
};

export const confirmBooking = async (bookingId: number) => {
  if (!getToken()) throw new Error('Debes iniciar sesión como administrador.');
  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (!rawUser) throw new Error('No se pudo resolver el club activo del administrador.');
  const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
  const adminClubId = Number(parsed?.activeClubId || parsed?.clubId || parsed?.club?.id);
  if (!hasAdminAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const club = await ClubService.getClubById(adminClubId);
  return ClubAdminService.confirmBooking(club.slug, bookingId);
};

export const completeBooking = async (bookingId: number) => {
  if (!getToken()) throw new Error('Debes iniciar sesión como administrador.');
  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (!rawUser) throw new Error('No se pudo resolver el club activo del administrador.');
  const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
  const adminClubId = Number(parsed?.activeClubId || parsed?.clubId || parsed?.club?.id);
  if (!hasAdminAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const club = await ClubService.getClubById(adminClubId);
  return ClubAdminService.completeBooking(club.slug, bookingId);
};

export const splitBookingPayment = async (
  bookingId: number,
  payments: Array<{ method: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER'; channel?: 'BANK_ACCOUNT' | 'VIRTUAL_WALLET'; amount: number }>
) => {
  if (!getToken()) throw new Error('Debes iniciar sesión como administrador.');

  const account = await getOrCreateBookingAccount(bookingId);
  const summary = await getAccountSummary(account.id);
  const remaining = Number(summary?.remaining || 0);
  const totalRequested = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  if (Math.abs(totalRequested - remaining) > 0.009) {
    throw new Error('La suma de pagos debe coincidir con el saldo pendiente');
  }

  const results = [];
  for (const payment of payments) {
    results.push(await registerPayment({
      accountId: account.id,
      amount: Number(payment.amount),
      method: payment.method,
      channel: payment.channel
    }));
  }

  return results;
};

export const registerBookingPartialPayment = async (
  bookingId: number,
  amount: number,
  method: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER',
  channel?: 'BANK_ACCOUNT' | 'VIRTUAL_WALLET',
  allocations?: Array<{ accountItemId: string; amount: number }>
) => {
  if (!getToken()) throw new Error('Debes iniciar sesión como administrador.');
  const account = await getOrCreateBookingAccount(bookingId);
  return registerPayment({
    accountId: account.id,
    amount,
    method,
    channel,
    allocations
  });
};

export const getBookingFinancialSummary = async (bookingId: number) => {
  if (!getToken()) throw new Error('Debes iniciar sesión como administrador.');
  const res = await fetchWithAuth(`${apiBase()}/bookings/${bookingId}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || error.message || 'No se pudo obtener el resumen financiero de la reserva');
  }

  const payload = await res.json();

  const summary = payload?.financialSummary || {};
  return {
    courtTotal: Number(summary.courtTotal || 0),
    itemsTotal: Number(summary.itemsTotal || 0),
    total: Number(summary.total || 0),
    paid: Number(summary.paid || 0),
    remaining: Number(summary.remaining || 0),
    depositRequiredAmount: Number(summary.depositRequiredAmount || 0),
    depositCovered: Boolean(summary.depositCovered),
    paymentStatus: String(summary.paymentStatus || 'UNPAID') as BookingFinancialSummary['paymentStatus'],
    confirmationMode: String(summary.confirmationMode || 'MANUAL') as BookingFinancialSummary['confirmationMode'],
    requiredToConfirm: Number(summary.requiredToConfirm || 0),
    remainingToConfirm: Number(summary.remainingToConfirm || 0),
    isPendingByInsufficientPayment: Boolean(summary.isPendingByInsufficientPayment),
    autoCancelStatus: {
      enabled: Boolean(summary.autoCancelStatus?.enabled),
      minutesBefore:
        summary.autoCancelStatus?.minutesBefore == null
          ? null
          : Number(summary.autoCancelStatus.minutesBefore),
      onlyIfUnpaid: Boolean(summary.autoCancelStatus?.onlyIfUnpaid),
      blockedByPayment: Boolean(summary.autoCancelStatus?.blockedByPayment),
      eligibleNow: Boolean(summary.autoCancelStatus?.eligibleNow),
      autoCancelAt: summary.autoCancelStatus?.autoCancelAt || null,
      label: String(summary.autoCancelStatus?.label || 'No aplica')
    }
  } satisfies BookingFinancialSummary;
};

// --- 4. OBTENER SCHEDULE COMPLETO DEL DÍA (ADMIN) ---
export const getAdminSchedule = async (date: string) => {
    if (!getToken()) throw new Error('Debes iniciar sesión como administrador.');

    const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    if (!rawUser) {
      throw new Error('No se pudo resolver el club activo del administrador.');
    }

    const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
    const adminClubId = Number(parsed?.activeClubId || parsed?.clubId || parsed?.club?.id);
    if (!hasAdminAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
      throw new Error('No se pudo resolver el club activo del administrador.');
    }

    const club = await ClubService.getClubById(adminClubId);
    return ClubAdminService.getAdminSchedule(club.slug, date);
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
  isProfessor?: boolean,
  professorOverrideReason?: string,
  options?: {
    allowOverlappingSeries?: boolean;
  }
) => {
  if (!getToken()) throw new Error('Debes iniciar sesión como administrador.');

  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (!rawUser) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
  const adminClubId = Number(parsed?.activeClubId || parsed?.clubId || parsed?.club?.id);
  if (!hasAdminAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const club = await ClubService.getClubById(adminClubId);
  return ClubAdminService.createFixedBooking(club.slug, {
    courtId,
    activityId,
    startDateTime: startDateTime.toISOString(),
    ...(userId ? { userId } : {}),
    ...(guestName ? { guestName } : {}),
    ...(guestPhone ? { guestPhone } : {}),
    ...(guestDni ? { guestDni } : {}),
    ...(isProfessor ? { isProfessor: true } : {}),
    ...(professorOverrideReason ? { professorOverrideReason } : {}),
    ...(options?.allowOverlappingSeries ? { allowOverlappingSeries: true } : {})
  });
};

// --- 6. CANCELAR TURNO FIJO (NUEVO - Corregido para usar fetch) ---
export const cancelFixedBooking = async (fixedBookingId: number) => {
  if (!getToken()) throw new Error('Debes iniciar sesión como administrador.');

  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (!rawUser) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
  const adminClubId = Number(parsed?.activeClubId || parsed?.clubId || parsed?.club?.id);
  if (!hasAdminAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const club = await ClubService.getClubById(adminClubId);
  return ClubAdminService.cancelFixedBooking(club.slug, fixedBookingId);
};

export const searchClients = async (slug: string, query: string) => {
    if (!getToken()) throw new Error("Debes iniciar sesión.");

    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/clients-list?q=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
        return [];
    }

    return res.json();
};
