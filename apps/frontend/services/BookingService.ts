// ARCHIVO: services/BookingService.ts

import { fetchWithAuth, isAuthSessionInvalidatedError } from '../utils/apiClient';

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
  pricingBreakdown?: {
    courtBaseAmount: number;
    lightsExtraAmount: number;
    lightsEnabled: boolean;
    lightsApplies: boolean;
    lightsFromHour: string | null;
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

export const getBookingById = async (bookingId: number) => {
  const res = await fetchWithAuth(`${apiBase()}/bookings/${bookingId}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || error.message || 'No se pudo obtener la reserva');
  }
  const payload = await res.json();
  return payload?.booking ?? payload;
};

// --- 1. CREAR UNA RESERVA ---
export const createBooking = async (
  courtId: number,
  activityId: number,
  date: Date,
  slotTime?: string,
  options?: {
    durationMinutes?: number;
    applyDiscount?: boolean;
    clientId?: string;
    client?: {
      name: string;
      phone?: string;
      phoneCountryCode?: string;
      phoneNumberLocal?: string;
      email?: string;
      dni?: string;
    };
  }
) => {
  const response = await fetchWithAuth(`${apiBase()}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courtId,
      activityId,
      ...(slotTime ? {
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        slotTime
      } : { startDateTime: date.toISOString() }),
      ...(options?.clientId ? { clientId: options.clientId } : {}),
      ...(options?.client ? { client: options.client } : {}),
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
  date?: Date;
  slotTime?: string;
  startDateTime?: Date;
  durationMinutes?: number;
  clientEmail?: string;
  clientPhone?: string;
  clientDni?: string;
  applyDiscount?: boolean;
}) => {
  const response = await fetchWithAuth(`${apiBase()}/bookings/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courtId: input.courtId,
      activityId: input.activityId,
      ...(input.startDateTime
        ? { startDateTime: input.startDateTime.toISOString() }
        : (input.date && input.slotTime
            ? {
                date: `${input.date.getFullYear()}-${String(input.date.getMonth() + 1).padStart(2, '0')}-${String(input.date.getDate()).padStart(2, '0')}`,
                slotTime: input.slotTime
              }
            : {})),
      ...(Number.isFinite(input.durationMinutes) ? { durationMinutes: input.durationMinutes } : {}),
      ...(input.clientEmail ? { clientEmail: input.clientEmail } : {}),
      ...(input.clientPhone ? { clientPhone: input.clientPhone } : {}),
      ...(input.clientDni ? { clientDni: input.clientDni } : {}),
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
    try {
      const res = await fetchWithAuth(`${apiBase()}/bookings/history/${userId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
      });

      if (!res.ok) {
          try {
            const payload = await res.clone().json();
            const code = String(payload?.code || '').trim();
            if (code === 'AUTH_MISSING' || code === 'AUTH_INVALID' || code === 'AUTH_EXPIRED' || code === 'AUTH_REVOKED') {
              return [];
            }
          } catch {
          }
          throw new Error('Error al cargar el historial');
      }
      return res.json();
    } catch (error) {
      if (isAuthSessionInvalidatedError(error)) {
        return [];
      }
      throw error;
    }
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
  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (rawUser) {
    const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
    const adminClubId = Number(parsed?.activeClubId);
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
  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (!rawUser) throw new Error('No se pudo resolver el club activo del administrador.');
  const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
  const adminClubId = Number(parsed?.activeClubId);
  if (!hasAdminAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const club = await ClubService.getClubById(adminClubId);
  return ClubAdminService.confirmBooking(club.slug, bookingId);
};

export const completeBooking = async (bookingId: number) => {
  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (!rawUser) throw new Error('No se pudo resolver el club activo del administrador.');
  const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
  const adminClubId = Number(parsed?.activeClubId);
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
  const account = await getOrCreateBookingAccount(bookingId);
  const summary = await getAccountSummary(account.id);
  const remaining = Number(summary?.remaining || 0);
  const totalRequested = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  if (Math.abs(totalRequested - remaining) > 0.009) {
    throw new Error('La suma de pagos debe coincidir con el saldo pendiente');
  }
  if (payments.some((payment) => payment.method === 'TRANSFER' && !payment.channel)) {
    throw new Error('El canal es obligatorio para pagos por transferencia');
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
  if (method === 'TRANSFER' && !channel) {
    throw new Error('El canal es obligatorio para pagos por transferencia');
  }
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
    },
    pricingBreakdown: summary?.pricingBreakdown
      ? {
          courtBaseAmount: Number(summary.pricingBreakdown.courtBaseAmount || 0),
          lightsExtraAmount: Number(summary.pricingBreakdown.lightsExtraAmount || 0),
          lightsEnabled: Boolean(summary.pricingBreakdown.lightsEnabled),
          lightsApplies: Boolean(summary.pricingBreakdown.lightsApplies),
          lightsFromHour: summary.pricingBreakdown.lightsFromHour
            ? String(summary.pricingBreakdown.lightsFromHour)
            : null
        }
      : undefined
  } satisfies BookingFinancialSummary;
};

// --- 4. OBTENER SCHEDULE COMPLETO DEL DÍA (ADMIN) ---
export const getAdminSchedule = async (date: string) => {
    const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    if (!rawUser) {
      throw new Error('No se pudo resolver el club activo del administrador.');
    }

    const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
    const adminClubId = Number(parsed?.activeClubId);
    if (!hasAdminAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
      throw new Error('No se pudo resolver el club activo del administrador.');
    }

    const club = await ClubService.getClubById(adminClubId);
    return ClubAdminService.getAdminSchedule(club.slug, date);
};

// --- 5. CREAR TURNO FIJO ---
export const createFixedBooking = async (
  courtId: number,
  activityId: number,
  startDateTime: Date,
  options?: {
    userId?: number;
    clientId?: string;
    client?: {
      name: string;
      phone?: string;
      email?: string;
      dni?: string;
    };
    allowOverlappingSeries?: boolean;
    durationMinutes?: number;
  }
) => {
  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (!rawUser) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
  const adminClubId = Number(parsed?.activeClubId);
  if (!hasAdminAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const club = await ClubService.getClubById(adminClubId);
  return ClubAdminService.createFixedBooking(club.slug, {
    courtId,
    activityId,
    startDateTime: startDateTime.toISOString(),
    ...(options?.userId ? { userId: options.userId } : {}),
    ...(options?.clientId ? { clientId: options.clientId } : {}),
    ...(options?.client ? { client: options.client } : {}),
    ...(Number.isFinite(options?.durationMinutes) ? { durationMinutes: Number(options?.durationMinutes) } : {}),
    ...(options?.allowOverlappingSeries ? { allowOverlappingSeries: true } : {})
  });
};

// --- 6. CANCELAR TURNO FIJO (NUEVO - Corregido para usar fetch) ---
export const cancelFixedBooking = async (fixedBookingId: number) => {
  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (!rawUser) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
  const adminClubId = Number(parsed?.activeClubId);
  if (!hasAdminAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const club = await ClubService.getClubById(adminClubId);
  return ClubAdminService.cancelFixedBooking(club.slug, fixedBookingId);
};

export const searchClients = async (slug: string, query: string) => {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/clients-list?q=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || error.message || 'No se pudo buscar clientes');
    }

    const payload = await res.json();
    if (!Array.isArray(payload)) {
      throw new Error('Respuesta inválida: clients-list debe devolver un arreglo');
    }
    return payload;
};
