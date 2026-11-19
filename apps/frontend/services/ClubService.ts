import { fetchWithAuth, isAuthSessionInvalidatedError } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

export type FixedBookingActivityConfig = {
  fixedBookingDaysAhead: number;
  fixedBookingGenerationFrequencyDays: number;
};

export type FixedBookingSettingsByActivity = Record<string, FixedBookingActivityConfig>;
export type BookingConfirmationMode = 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED';
export type ClubOperationalStatus = 'OPEN' | 'TEMPORARY_CLOSED' | 'PERMANENTLY_CLOSED';

export interface Club {
  id: number;
  slug: string;
  name: string;
  addressLine: string;
  city: string;
  province: string;
  country: string;
  contactInfo: string;
  phone?: string;
  logoUrl?: string;
  clubImageUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  websiteUrl?: string;
  description?: string;
  timeZone?: string;
  lightsEnabled?: boolean;
  lightsExtraAmount?: number | null;
  lightsFromHour?: string | null;
  professorDurationOverrideEnabled?: boolean;
  professorDurationOverrideMinutes?: number;
  fixedBookingSettingsByActivity?: FixedBookingSettingsByActivity | null;
  bookingConfirmationMode?: BookingConfirmationMode;
  bookingDepositPercent?: number | null;
  allowManualConfirmationOverride?: boolean;
  autoCancelPendingBookingsEnabled?: boolean;
  autoCancelPendingBookingsMinutesBefore?: number | null;
  autoCancelPendingBookingsOnlyIfUnpaid?: boolean;
  autoCancelPendingWarningEnabled?: boolean;
  autoCancelPendingWarningMinutesBefore?: number | null;
  enforceCashShiftCloseWithOpenAccounts?: boolean;
  bookingSimpleAdvanceDaysUser?: number;
  bookingSimpleAdvanceDaysAdmin?: number;
  allowAdminSkipSimpleAdvanceLimit?: boolean;
  publicSports?: string[];
  openingDays?: number[] | null;
  closureDates?: string[] | null;
  /** Horario general orientativo (apertura más temprana y cierre más tardío). */
  openingHours?: { openTime: string; closeTime: string } | null;
  clubOperationalStatus?: ClubOperationalStatus;
  temporaryClosureStartDate?: string | null;
  temporaryClosureEndDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type ClubFavorite = {
  id: string;
  clubId: number;
  userId: number;
  createdAt: string;
  club: Club;
};

export type ClubCourse = {
  id: string;
  /** Nombre que puso el club. Sin nombre se muestra la actividad. */
  name: string | null;
  activity: string | null;
  teacher: string | null;
  weekdays: number[];
  weekdaysLabel: string;
  startTime: string;
  durationMinutes: number;
  level: string | null;
  description: string | null;
  pricePerClass: number | null;
  spotsLeft: number;
  requiresApproval: boolean;
  /** Se paga por Mercado Pago al anotarse. */
  requiresPayment: boolean;
  startsOn: string;
  endsOn: string | null;
  /** Todavía no arrancó. */
  startsLater: boolean;
  /** Lo que se paga al anotarse: las clases que quedan del mes que no cubre su plan. */
  signupPrice: {
    month: string;
    monthLabel: string;
    classes: number;
    coveredByPlan: number;
    pricePerClass: number;
    total: number;
  } | null;
  /** Clases del mes que le cubre su plan (con sesión iniciada). */
  planCoverage: { covered: number; classes: number; full: boolean } | null;
  /** Estado del jugador logueado en el curso. AWAITING_PAYMENT: tiene el lugar guardado mientras paga. */
  myStatus: 'PENDING' | 'ACTIVE' | 'AWAITING_PAYMENT' | null;
};

/** Curso del jugador (en cualquiera de sus clubes), con las próximas clases. */
export type MyCourse = {
  id: string;
  status: 'ACTIVE' | 'PENDING' | 'AWAITING_PAYMENT';
  clubName: string;
  clubSlug: string;
  name: string | null;
  activity: string | null;
  teacher: string | null;
  court: string | null;
  weekdaysLabel: string;
  startTime: string;
  durationMinutes: number;
  level: string | null;
  canLeave: boolean;
  nextClasses: string[];
};

/** Plan del jugador ("Mis planes" del perfil). */
export type MyPlan = {
  id: string;
  clubName: string;
  clubSlug: string;
  planName: string;
  optionLabel: string;
  billingType: 'RECURRING' | 'FIXED_TERM' | null;
  /** Comprado desde la app y todavía sin pagar: no habilita nada hasta pagarlo. */
  awaitingPayment?: boolean;
  /** Compra sin pagar: lo que hay que pagar para activarlo (matrícula y primera cuota). */
  purchaseAmount?: number | null;
  planId?: string;
  status: 'ACTIVE' | 'PAST_DUE' | 'PAUSED';
  hasOverdue: boolean;
  beneficiaryName: string | null;
  payerName: string | null;
  isPayerOnly: boolean;
  startDate: string;
  endDate: string | null;
  currentPeriodEnd: string;
  paidThrough: string | null;
  pendingAmount: number;
  nextInstallment: { amount: number; dueDate: string; coversFrom: string; coversTo: string; isOverdue: boolean; payable: boolean } | null;
  pause: { id: string; startDate: string; endDate: string; started: boolean } | null;
  pauseMaxDays: number;
  pauseMaxCount: number;
  pausesUsed: number;
  /** Puede pausarlo solo desde la app. */
  canPause: boolean;
  /** El club cobra online y hay una cuota con saldo. */
  canPayOnline: boolean;
  classes: Array<{ name: string; remaining: number; total: number; expiresAt: string | null }>;
};

/** Plan que el club vende (pestaña Gimnasio). */
export type ClubPlan = {
  id: string;
  name: string;
  description: string | null;
  billingType: 'RECURRING' | 'FIXED_TERM';
  periodMonths: number;
  enrollmentFee: number | null;
  /** "Musculación libre", "8 clases grupales de Funcional por mes". */
  includes: string[];
  options: Array<{ id: string; label: string; installmentsCount: number; installmentPrice: number; totalPrice: number }>;
  /** Se puede comprar desde la app (el club lo habilitó y cobra con Mercado Pago). */
  buyOnline: boolean;
  /** Lo que ya tiene el jugador de este plan. */
  mine: 'ACTIVE' | 'AWAITING_PAYMENT' | null;
};

export type ClubPlansResponse = { canPayOnline: boolean; plans: ClubPlan[] };

export class ClubService {
  static async getClubPlans(slug: string): Promise<ClubPlansResponse> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/slug/${encodeURIComponent(slug)}/plans`);
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudieron cargar los planes');
    }
    return res.json();
  }

  /** Compra el plan: devuelve el link de Mercado Pago (matrícula, si hay, y primera cuota). */
  static async purchaseClubPlan(slug: string, planId: string, optionId: string): Promise<{ subscriptionId: string; initPoint: string; amount: number }> {
    const res = await fetchWithAuth(
      `${apiBase()}/clubs/slug/${encodeURIComponent(slug)}/plans/${encodeURIComponent(planId)}/purchase`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionId, returnTo: 'club' }),
      }
    );
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo comprar el plan');
    }
    return res.json();
  }

  static async getClubById(id: number): Promise<Club> {
    const response = await fetch(`${apiBase()}/clubs/${id}`);
    if (!response.ok) {
      throw new Error('Error al obtener el club');
    }
    return response.json();
  }

  static async getClubBySlug(slug: string): Promise<Club> {
    const response = await fetch(`${apiBase()}/clubs/slug/${slug}`);
    if (!response.ok) {
      throw new Error('Error al obtener el club');
    }
    return response.json();
  }

  static async getAllClubs(): Promise<Club[]> {
    const response = await fetch(`${apiBase()}/clubs`);
    if (!response.ok) {
      throw new Error('Error al obtener los clubes');
    }
    return response.json();
  }

  static async updateClub(id: number, data: Partial<Club>): Promise<Club> {
    const response = await fetchWithAuth(`${apiBase()}/clubs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Error al actualizar el club');
    }

    return response.json();
  }

  static async createClub(data: Partial<Club>): Promise<Club> {
    const response = await fetchWithAuth(`${apiBase()}/clubs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Error al crear el club');
    }

    return response.json();
  }

  static async getMyFavorites(): Promise<ClubFavorite[]> {
    try {
      const response = await fetchWithAuth(`${apiBase()}/clubs/favorites/me`, {
        method: 'GET'
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Error al obtener favoritos');
      }
      const payload = await response.json();
      return Array.isArray(payload?.favorites) ? payload.favorites : [];
    } catch (error: any) {
      if (isAuthSessionInvalidatedError(error)) {
        return [];
      }
      const message = String(error?.message || '').toLowerCase();
      if (
        message.includes('findmany') ||
        message.includes('clubfavorite') ||
        message.includes('error al obtener favoritos')
      ) {
        return [];
      }
      throw error;
    }
  }

  static async markFavorite(clubId: number): Promise<{
    favorite: {
      id: string;
      clubId: number;
      userId: number;
      createdAt: string;
    };
  }> {
    const response = await fetchWithAuth(`${apiBase()}/clubs/${clubId}/favorite`, {
      method: 'POST'
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo marcar favorito');
    }
    return response.json();
  }

  static async unmarkFavorite(clubId: number): Promise<{ removed: boolean }> {
    const response = await fetchWithAuth(`${apiBase()}/clubs/${clubId}/favorite`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo quitar favorito');
    }
    return response.json();
  }

  static async getClubCourses(slug: string): Promise<ClubCourse[]> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/slug/${encodeURIComponent(slug)}/courses`);
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudieron cargar los cursos');
    }
    return res.json();
  }

  /** Link de Mercado Pago para pagar la cuota pendiente del plan. */
  static async payMyPlanInstallment(
    subscriptionId: string,
    returnTo: 'club' | 'perfil' = 'perfil'
  ): Promise<{ initPoint: string; amount: number }> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/subscriptions/me/${encodeURIComponent(subscriptionId)}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnTo }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo armar el pago de la cuota');
    }
    return res.json();
  }

  static async pauseMyPlan(subscriptionId: string, body: { startDate?: string | null; endDate: string }): Promise<void> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/subscriptions/me/${encodeURIComponent(subscriptionId)}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo pausar el plan');
    }
  }

  static async endMyPlanPause(subscriptionId: string, pauseId: string): Promise<void> {
    const res = await fetchWithAuth(
      `${apiBase()}/clubs/subscriptions/me/${encodeURIComponent(subscriptionId)}/pauses/${encodeURIComponent(pauseId)}/end`,
      { method: 'POST' }
    );
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo terminar la pausa');
    }
  }

  static async getMyPlans(): Promise<MyPlan[]> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/subscriptions/me`);
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudieron cargar tus planes');
    }
    return res.json();
  }

  static async getMyCourses(): Promise<MyCourse[]> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/courses/me`);
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudieron cargar tus cursos');
    }
    return res.json();
  }

  static async joinClubCourse(
    slug: string,
    id: string
  ): Promise<{ status: 'PENDING' | 'ACTIVE' | 'AWAITING_PAYMENT'; enrolled: number; initPoint: string | null; coveredByPlan?: boolean }> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/slug/${encodeURIComponent(slug)}/courses/${id}/join`, { method: 'POST' });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo anotarte');
    }
    return res.json();
  }

  static async leaveClubCourse(slug: string, id: string): Promise<{ kept: number }> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/slug/${encodeURIComponent(slug)}/courses/${id}/join`, { method: 'DELETE' });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo bajarte del curso');
    }
    return res.json();
  }
}
