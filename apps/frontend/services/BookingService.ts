// ARCHIVO: services/BookingService.ts

import { fetchWithAuth, isAuthSessionInvalidatedError } from '../utils/apiClient';

import { getApiUrl } from '../utils/apiUrl';
import { ClubService } from './ClubService';
import { ClubAdminService, type BookingBillingConfig } from './ClubAdminService';
import { hasAdminAccess, hasOperatorAccess, normalizeSessionUser } from '../utils/session';
import { getOrCreateBookingAccount, getAccountSummary, getAccountById, registerPayment } from './AccountService';
import { parseApiErrorPayload, throwApiErrorFromResponse } from '../utils/apiError';

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

export type BookingBillingConfigPayload = {
  chargeMode: 'INDIVIDUAL' | 'SHARED';
  chargeResponsibleRef?: string;
  assignments: Array<{
    id: string;
    participantRef: string;
    isChargeable: boolean;
    assignedAmount: number;
    participantLinkState?: 'ACTIVE' | 'ARCHIVED_REFERENCE';
  }>;
  metadata?: Record<string, unknown>;
};

export type BookingHistoryEntryDto = {
  id: string;
  bookingId: number;
  clubId: number;
  action: string;
  category: string;
  source: string;
  summary: string;
  occurredAt: string;
  actorUserId: number | null;
  actorLabel: string | null;
  detail: Record<string, unknown> | null;
  previousState: Record<string, unknown> | null;
  nextState: Record<string, unknown> | null;
  bookingParticipantId: string | null;
  paymentId: string | null;
  accountId: string | null;
  metadata: Record<string, unknown> | null;
};

export type PlayerBookingDto = {
  id: string;
  publicCode: string;
  club: {
    id: string;
    name: string;
    slug: string;
    timeZone: string;
  };
  court: {
    name: string;
  };
  activity: {
    name: string;
  } | null;
  startDateTime: string;
  endDateTime: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  myRole: 'OWNER' | 'PARTICIPANT';
  paymentSummary: {
    status: 'NOT_REQUIRED' | 'PENDING' | 'PARTIAL' | 'PAID';
    label: string;
  };
  capabilities: {
    canView: true;
    canCancelBooking: boolean;
    canLeaveBooking: boolean;
    canPay: boolean;
    canInvitePlayers: boolean;
  };
};

export type PlayerBookingParticipantDto = {
  id: string;
  displayName: string;
  status: 'INVITED' | 'JOINED' | 'DECLINED' | 'LEFT' | 'REMOVED';
  role: 'ORGANIZER' | 'PARTICIPANT';
  isMe: boolean;
  invitedEmail?: string | null;
  canManage: boolean;
};

export type AdminBookingParticipantDto = {
  id: string;
  bookingId: number;
  clientId: string | null;
  userId: number | null;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  status: 'INVITED' | 'JOINED' | 'DECLINED' | 'LEFT' | 'REMOVED';
  role: 'ORGANIZER' | 'PARTICIPANT';
  invitedEmail?: string | null;
  invitedName?: string | null;
};

export type PlayerBookingInvitationDto = {
  id: string;
  bookingId: string;
  bookingPublicCode: string;
  club: {
    name: string;
    slug: string;
    timeZone: string;
  };
  court: {
    name: string;
  };
  startDateTime: string;
  endDateTime: string;
  invitedName?: string | null;
  invitedEmail?: string | null;
  status: 'INVITED';
};

export type PlayerBookingCheckoutDto = {
  booking: {
    id: string;
    publicCode: string;
    clubName: string;
    courtName: string;
    startDateTime: string;
    endDateTime: string;
    status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
    myRole: 'OWNER' | 'PARTICIPANT';
  };
  account: {
    id: string;
    status: 'OPEN' | 'CLOSED';
    total: number;
    paid: number;
    pending: number;
    currency: 'ARS';
    items: Array<{
      label: string;
      quantity: number;
      unitPrice: number;
      total: number;
      type: 'COURT' | 'PRODUCT' | 'SERVICE' | 'OTHER';
    }>;
  } | null;
  paymentSummary: {
    status: 'NOT_REQUIRED' | 'PENDING' | 'PARTIAL' | 'PAID' | 'BLOCKED';
    label: string;
  };
  checkout: {
    enabled: boolean;
    reason:
      | 'PROVIDER_NOT_CONFIGURED'
      | 'BOOKING_NOT_PAYABLE'
      | 'NO_PENDING_BALANCE'
      | 'ACCOUNT_MISSING'
      | 'PARTICIPANT_PAYMENTS_NOT_SUPPORTED'
      | 'BOOKING_HAS_REFUNDS'
      | 'UNKNOWN'
      | null;
    futureProvider: 'MERCADO_PAGO' | null;
  };
};

export type PlayerBookingCheckoutStartDto = {
  attemptId: string;
  initPoint: string;
  provider: 'MERCADO_PAGO';
};

export const getBookingById = async (bookingId: number) => {
  const res = await fetchWithAuth(`${apiBase()}/bookings/${bookingId}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No se pudo obtener la reserva');
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
    ownerSelection?:
      | {
          kind: 'linked' | 'systemUser';
          userId: number;
          personKey: string;
          searchQuery: string;
        }
      | {
          kind: 'newClient';
          name: string;
          phone?: string;
          phoneCountryCode?: string;
          phoneNumberLocal?: string;
          email?: string;
          dni?: string;
          duplicateResolution?: 'CREATE_NEW';
        };
    client?: {
      name: string;
      phone?: string;
      phoneCountryCode?: string;
      phoneNumberLocal?: string;
      email?: string;
      dni?: string;
      duplicateResolution?: 'CREATE_NEW';
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
      ...(options?.ownerSelection ? { ownerSelection: options.ownerSelection } : {}),
      ...(options?.client ? { client: options.client } : {}),
      ...(Number.isFinite(options?.durationMinutes) ? { durationMinutes: options?.durationMinutes } : {}),
      ...(options?.applyDiscount === undefined ? {} : { applyDiscount: options.applyDiscount })
    }),
  });

  if (!response.ok) {
    await throwApiErrorFromResponse(response, 'Error al reservar');
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
    await throwApiErrorFromResponse(response, 'No se pudo cotizar la reserva');
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
export const getMyBookings = async (_userId?: number): Promise<PlayerBookingDto[]> => {
    try {
      const res = await fetchWithAuth(`${apiBase()}/me/bookings`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
      });

      if (!res.ok) {
          try {
            const payload = await res.clone().json().catch(() => null);
            const parsed = parseApiErrorPayload(payload, '');
            const code = String(parsed?.code || '').trim();
            if (code === 'AUTH_MISSING' || code === 'AUTH_INVALID' || code === 'AUTH_EXPIRED' || code === 'AUTH_REVOKED') {
              return [];
            }
          } catch {
          }
          await throwApiErrorFromResponse(res, 'No pudimos cargar tus reservas.');
      }
      const payload = await res.json();
      return Array.isArray(payload?.items) ? payload.items : [];
    } catch (error) {
      if (isAuthSessionInvalidatedError(error)) {
        return [];
      }
      throw error;
    }
};

export const getBookingParticipants = async (bookingId: number | string): Promise<PlayerBookingParticipantDto[]> => {
  const res = await fetchWithAuth(`${apiBase()}/me/bookings/${bookingId}/participants`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No pudimos cargar los participantes.');
  }

  const payload = await res.json();
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const getAdminBookingParticipants = async (
  bookingId: number | string
): Promise<AdminBookingParticipantDto[]> => {
  const res = await fetchWithAuth(`${apiBase()}/bookings/${bookingId}/participants`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No se pudieron cargar los participantes de la reserva.');
  }
  const payload = await res.json();
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const addAdminBookingParticipant = async (
  bookingId: number | string,
  input: {
    personSelection:
      | { kind: 'clubClient'; clientId: string }
      | { kind: 'linked' | 'systemUser'; userId: number; personKey: string; searchQuery: string }
      | { kind: 'newClient'; name: string; phone?: string; email?: string; dni?: string; forceCreateNew?: boolean };
  }
): Promise<AdminBookingParticipantDto> => {
  const res = await fetchWithAuth(`${apiBase()}/bookings/${bookingId}/participants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No se pudo agregar el participante.');
  }
  const payload = await res.json();
  return payload?.participant as AdminBookingParticipantDto;
};

export const removeAdminBookingParticipant = async (
  bookingId: number | string,
  participantId: string
) => {
  const res = await fetchWithAuth(`${apiBase()}/bookings/${bookingId}/participants/${participantId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No se pudo remover al participante.');
  }
  return res.json();
};

export const getPlayerBookingCheckout = async (bookingId: number | string): Promise<PlayerBookingCheckoutDto> => {
  const res = await fetchWithAuth(`${apiBase()}/me/bookings/${bookingId}/checkout`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No pudimos cargar el estado de pago.');
  }

  return await res.json() as PlayerBookingCheckoutDto;
};

export const inviteBookingParticipant = async (
  bookingId: number | string,
  input: { email: string; name?: string }
): Promise<PlayerBookingParticipantDto> => {
  const res = await fetchWithAuth(`${apiBase()}/me/bookings/${bookingId}/participants/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(input?.email || '').trim(),
      ...(String(input?.name || '').trim() ? { name: String(input.name).trim() } : {})
    })
  });

  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No pudimos invitar al jugador.');
  }

  const payload = await res.json();
  return payload?.participant as PlayerBookingParticipantDto;
};

export const removeBookingParticipant = async (bookingId: number | string, participantId: string) => {
  const res = await fetchWithAuth(`${apiBase()}/me/bookings/${bookingId}/participants/${participantId}/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No pudimos remover al participante.');
  }

  return res.json();
};

export const createMercadoPagoCheckout = async (
  bookingId: number | string
): Promise<PlayerBookingCheckoutStartDto> => {
  const res = await fetchWithAuth(`${apiBase()}/me/bookings/${bookingId}/checkout/mercadopago`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No pudimos iniciar el pago online.');
  }

  return res.json();
};

export const getMyBookingInvitations = async (): Promise<PlayerBookingInvitationDto[]> => {
  const res = await fetchWithAuth(`${apiBase()}/me/booking-invitations`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No pudimos cargar tus invitaciones.');
  }

  const payload = await res.json();
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const acceptBookingInvitation = async (invitationId: string) => {
  const res = await fetchWithAuth(`${apiBase()}/me/booking-invitations/${invitationId}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No pudimos aceptar la invitación.');
  }

  return res.json();
};

export const declineBookingInvitation = async (invitationId: string) => {
  const res = await fetchWithAuth(`${apiBase()}/me/booking-invitations/${invitationId}/decline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No pudimos rechazar la invitación.');
  }

  return res.json();
};

export const leaveBooking = async (bookingId: number | string) => {
  const res = await fetchWithAuth(`${apiBase()}/me/bookings/${bookingId}/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No pudimos sacarte de la reserva.');
  }

  return res.json();
};

export const getAdminBookingHistory = async (
  bookingId: number
): Promise<BookingHistoryEntryDto[]> => {
  const res = await fetchWithAuth(`${apiBase()}/bookings/${bookingId}/history`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No se pudo cargar el historial de la reserva');
  }

  const payload = await res.json();
  if (!Array.isArray(payload)) return [];
  return payload.map((entry: any) => ({
    id: String(entry?.id || ''),
    bookingId: Number(entry?.bookingId || 0),
    clubId: Number(entry?.clubId || 0),
    action: String(entry?.action || ''),
    category: String(entry?.category || ''),
    source: String(entry?.source || ''),
    summary: String(entry?.summary || ''),
    occurredAt: String(entry?.occurredAt || ''),
    actorUserId: Number.isInteger(Number(entry?.actorUserId || 0)) ? Number(entry.actorUserId) : null,
    actorLabel: typeof entry?.actorLabel === 'string' ? entry.actorLabel : null,
    detail: entry?.detail && typeof entry.detail === 'object' ? entry.detail : null,
    previousState: entry?.previousState && typeof entry.previousState === 'object' ? entry.previousState : null,
    nextState: entry?.nextState && typeof entry.nextState === 'object' ? entry.nextState : null,
    bookingParticipantId: typeof entry?.bookingParticipantId === 'string' ? entry.bookingParticipantId : null,
    paymentId: typeof entry?.paymentId === 'string' ? entry.paymentId : null,
    accountId: typeof entry?.accountId === 'string' ? entry.accountId : null,
    metadata: entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : null,
  }));
};

// --- 3. CANCELAR UNA RESERVA ---
export const cancelBooking = async (
  bookingId: number | string,
  options?: {
    refund?: {
      amount?: number;
      executeNow?: boolean;
      reasonType?: 'FULL' | 'PARTIAL_COMMERCIAL' | 'PARTIAL_SERVICE_FAILURE' | 'PARTIAL_PRICING_ERROR' | 'OTHER';
      executionNotes?: string;
    };
  }
) => {
  const safeBookingId = typeof bookingId === 'string' ? Number(bookingId) : bookingId;
  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (rawUser) {
    const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
    const adminClubId = Number(parsed?.activeClubId);
    if (hasOperatorAccess(parsed) && Number.isFinite(adminClubId) && adminClubId > 0) {
      const club = await ClubService.getClubById(adminClubId);
      return await ClubAdminService.cancelBooking(club.slug, safeBookingId, options);
    }
  }

  const publicRes = await fetchWithAuth(`${apiBase()}/me/bookings/${bookingId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!publicRes.ok) {
    await throwApiErrorFromResponse(publicRes, 'No se pudo cancelar la reserva.');
  }
  return publicRes.json();
};

export const confirmBooking = async (bookingId: number) => {
  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (!rawUser) throw new Error('No se pudo resolver el club activo del administrador.');
  const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
  const adminClubId = Number(parsed?.activeClubId);
  if (!hasOperatorAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
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
  if (!hasOperatorAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const club = await ClubService.getClubById(adminClubId);
  return ClubAdminService.completeBooking(club.slug, bookingId);
};

export const changeBookingClient = async (
  bookingId: number,
  input: {
    newClientId?: string;
    newClient?: {
      name: string;
      phone?: string;
      email?: string;
      dni?: string;
      duplicateResolution?: 'CREATE_NEW';
    };
    ownerSelection?: {
      kind: 'linked' | 'systemUser' | 'newClient';
      userId?: number;
      personKey?: string;
      searchQuery?: string;
      name?: string;
      phone?: string;
      email?: string;
      dni?: string;
      duplicateResolution?: 'CREATE_NEW';
    };
    reason?: string;
  }
) => {
  const payload: Record<string, unknown> = {
    ...(String(input?.newClientId || '').trim() ? { newClientId: String(input?.newClientId || '').trim() } : {}),
    ...(input?.newClient ? { newClient: input.newClient } : {}),
    ...(input?.ownerSelection ? { ownerSelection: input.ownerSelection } : {}),
    ...(String(input?.reason || '').trim() ? { reason: String(input.reason).trim() } : {}),
  };
  const res = await fetchWithAuth(`${apiBase()}/bookings/${bookingId}/client`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No se pudo cambiar el titular.');
  }

  return res.json();
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
  allocations?: Array<{ accountItemId: string; amount: number }>,
  payer?: {
    participantRef?: string;
    participantName?: string;
  },
  covered?: {
    participantRef?: string;
    participantName?: string;
  }
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
    payerParticipantRef: payer?.participantRef,
    payerParticipantName: payer?.participantName,
    coveredParticipantRef: covered?.participantRef,
    coveredParticipantName: covered?.participantName,
    allocations
  });
};

export const getBookingFinancialSummary = async (bookingId: number) => {
  const res = await fetchWithAuth(`${apiBase()}/bookings/${bookingId}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    await throwApiErrorFromResponse(res, 'No se pudo obtener el resumen financiero de la reserva');
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
    if (!hasOperatorAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
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
    everyDays?: number;
    repetitions?: number;
    previewConflictsOnly?: boolean;
  }
) => {
  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (!rawUser) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
  const adminClubId = Number(parsed?.activeClubId);
  if (!hasOperatorAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const normalizedClientId = typeof options?.clientId === 'string' ? options.clientId.trim() : '';
  const safeClientId =
    normalizedClientId.length > 0 && !['undefined', 'null', 'nan'].includes(normalizedClientId.toLowerCase())
      ? normalizedClientId
      : '';

  const club = await ClubService.getClubById(adminClubId);
  return ClubAdminService.createFixedBooking(club.slug, {
    courtId,
    activityId,
    startDateTime: startDateTime.toISOString(),
    ...(options?.userId ? { userId: options.userId } : {}),
    ...(safeClientId ? { clientId: safeClientId } : {}),
    ...(options?.client ? { client: options.client } : {}),
    ...(Number.isFinite(options?.durationMinutes) ? { durationMinutes: Number(options?.durationMinutes) } : {}),
    ...(Number.isFinite(options?.everyDays) ? { everyDays: Number(options?.everyDays) } : {}),
    ...(Number.isFinite(options?.repetitions) ? { repetitions: Number(options?.repetitions) } : {}),
    ...(options?.previewConflictsOnly ? { previewConflictsOnly: true } : {}),
    ...(options?.allowOverlappingSeries ? { allowOverlappingSeries: true } : {})
  });
};

// --- 6. CANCELAR TURNO FIJO (NUEVO - Corregido para usar fetch) ---
export const cancelFixedBooking = async (
  fixedBookingId: number,
  options?: {
    scope?: 'THIS_OCCURRENCE' | 'NEXT_OCCURRENCES' | 'ALL_OCCURRENCES';
    occurrenceBookingId?: number;
    previewOnly?: boolean;
  }
) => {
  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (!rawUser) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
  const adminClubId = Number(parsed?.activeClubId);
  if (!hasOperatorAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const club = await ClubService.getClubById(adminClubId);
  return ClubAdminService.cancelFixedBooking(club.slug, fixedBookingId, {
    ...(options?.scope ? { scope: options.scope } : {}),
    ...(Number.isFinite(options?.occurrenceBookingId) ? { occurrenceBookingId: Number(options?.occurrenceBookingId) } : {}),
    ...(options?.previewOnly ? { previewOnly: true } : {}),
  });
};

export const rescheduleFixedBooking = async (
  fixedBookingId: number,
  input: {
    scope: 'THIS_OCCURRENCE' | 'NEXT_OCCURRENCES' | 'ALL_OCCURRENCES';
    occurrenceBookingId?: number;
    courtId: number;
    startDateTime: Date;
    durationMinutes?: number;
    previewOnly?: boolean;
  }
) => {
  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (!rawUser) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
  const adminClubId = Number(parsed?.activeClubId);
  if (!hasOperatorAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }

  const club = await ClubService.getClubById(adminClubId);
  return ClubAdminService.rescheduleFixedBooking(club.slug, fixedBookingId, {
    scope: input.scope,
    ...(Number.isFinite(input.occurrenceBookingId) ? { occurrenceBookingId: Number(input.occurrenceBookingId) } : {}),
    courtId: Number(input.courtId),
    startDateTime: input.startDateTime.toISOString(),
    ...(Number.isFinite(input.durationMinutes) ? { durationMinutes: Number(input.durationMinutes) } : {}),
    ...(input.previewOnly ? { previewOnly: true } : {}),
  });
};

export const getBookingBillingConfig = async (bookingId: number): Promise<BookingBillingConfig> => {
  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (!rawUser) throw new Error('No se pudo resolver el club activo del administrador.');
  const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
  const adminClubId = Number(parsed?.activeClubId);
  if (!hasAdminAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }
  const club = await ClubService.getClubById(adminClubId);
  return ClubAdminService.getBookingBillingConfig(club.slug, bookingId);
};

export const updateBookingBillingConfig = async (
  bookingId: number,
  payload: BookingBillingConfigPayload
): Promise<BookingBillingConfig> => {
  const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
  if (!rawUser) throw new Error('No se pudo resolver el club activo del administrador.');
  const parsed = normalizeSessionUser(JSON.parse(rawUser || '{}'));
  const adminClubId = Number(parsed?.activeClubId);
  if (!hasAdminAccess(parsed) || !Number.isFinite(adminClubId) || adminClubId <= 0) {
    throw new Error('No se pudo resolver el club activo del administrador.');
  }
  const club = await ClubService.getClubById(adminClubId);
  return ClubAdminService.updateBookingBillingConfig(club.slug, bookingId, payload);
};

export const searchClients = async (slug: string, query: string) => {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/clients-list?q=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
        await throwApiErrorFromResponse(res, 'No se pudo buscar clientes');
    }

    const payload = await res.json();
    if (!Array.isArray(payload)) {
      throw new Error('Respuesta inválida: clients-list debe devolver un arreglo');
    }
    return payload;
};
