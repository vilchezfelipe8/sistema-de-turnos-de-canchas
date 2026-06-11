import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';
import { parseApiErrorResponse, throwApiErrorFromResponse } from '../utils/apiError';

const apiBase = () => `${getApiUrl()}/api`;

export type ActivityScheduleMode = 'FIXED' | 'RANGE';

export type ActivityFixedSlot = {
  start: string;
  duration: number;
};

export type ActivityRangeWindow = {
  start: string;
  end: string;
};

export type ClubActivityType = {
  id: number;
  name: string;
  description?: string;
  defaultDurationMinutes: number;
  scheduleMode: ActivityScheduleMode;
  scheduleOpenTime?: string | null;
  scheduleCloseTime?: string | null;
  scheduleIntervalMinutes?: number | null;
  scheduleWindows?: ActivityRangeWindow[] | null;
  scheduleDurations?: number[] | null;
  scheduleFixedSlots?: ActivityFixedSlot[] | null;
};

export type ActivityScheduleException = {
  id: number;
  activityTypeId: number;
  localDate: string;
  isClosed: boolean;
  scheduleMode?: ActivityScheduleMode | null;
  scheduleOpenTime?: string | null;
  scheduleCloseTime?: string | null;
  scheduleIntervalMinutes?: number | null;
  scheduleWindows?: ActivityRangeWindow[] | null;
  scheduleDurations?: number[] | null;
  scheduleFixedSlots?: ActivityFixedSlot[] | null;
  createdAt?: string;
  updatedAt?: string;
};

export type BookingBillingConfig = {
  bookingId: number;
  clubId: number;
  chargeMode: 'INDIVIDUAL' | 'SHARED';
  chargeResponsibleRef?: string;
  assignments: Array<{
    id: string;
    participantRef: string;
    isChargeable: boolean;
    assignedAmount: number;
    participantLinkState?: 'ACTIVE' | 'ARCHIVED_REFERENCE';
  }>;
  metadata?: {
    schemaVersion: 1;
    source: 'DEFAULTED' | 'PERSISTED';
    [key: string]: unknown;
  };
  updatedAt: string;
};

export type DiscountPolicyScope = 'BOOKING' | 'PRODUCT' | 'SERVICE' | 'ALL';
export type DiscountAmountType = 'PERCENT' | 'FIXED';
export type DiscountApplyMode = 'INCLUDE_ONLY' | 'EXCLUDE_LIST';
export type ClubCatalogService = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  price: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminTeacher = {
  id: string;
  clubId: number;
  clientId: string | null;
  userId: number | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  isInternal: boolean;
  isActive: boolean;
  specialties: string[];
  notes: string | null;
  client: {
    id: string;
    name: string;
  } | null;
  user: {
    id: number;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminClassSessionStatus = 'DRAFT' | 'SCHEDULED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export type AdminClassSessionVisibility = 'PUBLIC' | 'PRIVATE';
export type AdminClassSessionType = 'INDIVIDUAL' | 'GROUP';

export type AdminClassSession = {
  id: string;
  clubId: number;
  teacherId: string;
  visibility: AdminClassSessionVisibility;
  classType: AdminClassSessionType;
  activityTypeId: number | null;
  courtId: number | null;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  capacity: number;
  pricePerStudent: number | null;
  status: AdminClassSessionStatus;
  level: string | null;
  description: string | null;
  requiresApproval: boolean;
  requiresPaymentToEnroll: boolean;
  createdByUserId: number;
  metadata: unknown;
  teacher: {
    id: string;
    displayName: string;
    isActive: boolean;
  } | null;
  court: {
    id: number;
    name: string;
  } | null;
  activityType: {
    id: number;
    name: string;
  } | null;
  createdByUser: {
    id: number;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminClassEnrollmentStatus = 'ENROLLED' | 'WAITLISTED' | 'CANCELLED';
export type AdminClassAttendanceStatus =
  | 'PENDING'
  | 'ATTENDED'
  | 'ABSENT'
  | 'NO_SHOW'
  | 'CANCELLED_ON_TIME'
  | 'CANCELLED_LATE';
export type AdminClassPaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'COVERED_BY_CREDIT' | 'REFUNDED';

export type AdminClassEnrollment = {
  id: string;
  clubId: number;
  classSessionId: string;
  studentClientId: string;
  studentUserId: number | null;
  billingResponsibleClientId: string | null;
  snapshotName: string;
  snapshotEmail: string | null;
  snapshotPhone: string | null;
  priceAtEnrollment: number;
  paidAmount: number;
  enrollmentStatus: AdminClassEnrollmentStatus;
  attendanceStatus: AdminClassAttendanceStatus;
  paymentStatus: AdminClassPaymentStatus;
  cancelledAt: string | null;
  attendedAt: string | null;
  notes: string | null;
  createdByUserId: number;
  studentClient: { id: string; name: string } | null;
  studentUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  billingResponsibleClient: { id: string; name: string } | null;
  createdByUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminClassPassStatus = 'ACTIVE' | 'EXPIRED' | 'DEPLETED' | 'CANCELLED';
export type AdminClassCreditUsageReason =
  | 'ATTENDANCE'
  | 'LATE_CANCEL'
  | 'NO_SHOW'
  | 'MANUAL_ADJUSTMENT'
  | 'REFUND_REVERSAL';

export type AdminClassPass = {
  id: string;
  clubId: number;
  ownerClientId: string;
  ownerUserId: number | null;
  beneficiaryClientId: string;
  beneficiaryUserId: number | null;
  packageName: string;
  priceAtPurchase: number | null;
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  expiresAt: string | null;
  activityTypeId: number | null;
  classType: AdminClassSessionType | null;
  teacherId: string | null;
  transferable: boolean;
  status: AdminClassPassStatus;
  purchasedAt: string;
  notes: string | null;
  createdByUserId: number;
  ownerClient: { id: string; name: string } | null;
  beneficiaryClient: { id: string; name: string } | null;
  ownerUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  beneficiaryUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  activityType: { id: number; name: string } | null;
  teacher: { id: string; displayName: string; isActive: boolean } | null;
  createdByUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  createdAt: string;
  updatedAt: string;
  financial: {
    accountId: string | null;
    accountStatus: 'OPEN' | 'CLOSED' | null;
    state: 'NO_ACCOUNT' | 'PENDING' | 'PARTIAL' | 'PAID';
    paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID' | null;
    totalAmount: number | null;
    paidAmount: number | null;
    remainingAmount: number | null;
    blockedReason: string | null;
  };
};

export type AdminClassPassAccount = {
  classPassId: string;
  account: {
    id: string;
    displayCode: string | null;
    clubId: number;
    sourceType: string;
    sourceId: string;
    status: 'OPEN' | 'CLOSED';
    totalAmount: number;
    paidAmount: number;
    createdAt: string;
    closedAt: string | null;
    client: { id: string; name: string; phone: string | null; email: string | null } | null;
  } | null;
  summary: {
    accountId: string;
    itemsTotal: number;
    paymentsTotal: number;
    remaining: number;
    paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
    isBalanced: boolean;
    status: 'OPEN' | 'CLOSED';
  } | null;
  financialStatus: 'NO_ACCOUNT' | 'PENDING' | 'PARTIAL' | 'PAID';
  blockedReason: string | null;
};

export type AdminClassEnrollmentAccount = {
  classEnrollmentId: string;
  account: {
    id: string;
    displayCode: string | null;
    clubId: number;
    sourceType: string;
    sourceId: string;
    status: 'OPEN' | 'CLOSED';
    totalAmount: number;
    paidAmount: number;
    createdAt: string;
    closedAt: string | null;
    client: { id: string; name: string; phone: string | null; email: string | null } | null;
  } | null;
  summary: {
    accountId: string;
    itemsTotal: number;
    paymentsTotal: number;
    remaining: number;
    paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
    isBalanced: boolean;
    status: 'OPEN' | 'CLOSED';
  } | null;
  financialStatus: 'NO_ACCOUNT' | 'PENDING' | 'PARTIAL' | 'PAID';
  blockedReason: string | null;
};

export type AdminClassCreditUsage = {
  id: string;
  clubId: number;
  classPassId: string;
  classEnrollmentId: string;
  creditsUsed: number;
  usedAt: string;
  reason: AdminClassCreditUsageReason;
  notes: string | null;
  createdByUserId: number;
  classPass: {
    id: string;
    packageName: string;
    beneficiaryClientId: string;
    remainingCredits: number;
    status: AdminClassPassStatus | string;
  } | null;
  classEnrollment: {
    id: string;
    studentClientId: string;
    snapshotName: string;
    enrollmentStatus: AdminClassEnrollmentStatus | string;
    paymentStatus: AdminClassPaymentStatus | string;
    classSessionId: string;
  } | null;
  createdByUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminAcademyStudentListItem = {
  client: {
    id: string;
    clubId: number;
    userId: number | null;
    name: string;
    email: string | null;
    phone: string | null;
    linkedUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  };
  summary: {
    upcomingEnrollmentsCount: number;
    pastEnrollmentsCount: number;
    activePassesCount: number;
    ownedPassesCount: number;
    totalRemainingCredits: number;
    totalCreditUsages: number;
    incomingRelationshipsCount: number;
    outgoingRelationshipsCount: number;
  };
  nextClassAt: string | null;
  lastClassAt: string | null;
};

export type AdminAcademyStudentOverview = {
  client: {
    id: string;
    clubId: number;
    userId: number | null;
    name: string;
    email: string | null;
    phone: string | null;
    linkedUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  };
  summary: {
    upcomingEnrollmentsCount: number;
    pastEnrollmentsCount: number;
    activePassesCount: number;
    ownedPassesCount: number;
    totalRemainingCredits: number;
    totalCreditUsages: number;
  };
  billingResponsibles: Array<{ id: string; name: string }>;
  upcomingEnrollments: Array<{
    id: string;
    classSessionId: string;
    snapshotName: string;
    billingResponsibleClientId: string | null;
    priceAtEnrollment: number;
    paidAmount: number;
    enrollmentStatus: AdminClassEnrollmentStatus | string;
    attendanceStatus: AdminClassAttendanceStatus | string;
    paymentStatus: AdminClassPaymentStatus | string;
    cancelledAt: string | null;
    attendedAt: string | null;
    notes: string | null;
    billingResponsibleClient: { id: string; name: string } | null;
    classSession: {
      id: string;
      startsAt: string;
      endsAt: string;
      status: AdminClassSessionStatus | string;
      visibility: AdminClassSessionVisibility | string;
      classType: AdminClassSessionType | string;
      teacher: { id: string; displayName: string; isActive: boolean } | null;
      activityType: { id: number; name: string } | null;
      court: { id: number; name: string } | null;
    };
  }>;
  pastEnrollments: Array<{
    id: string;
    classSessionId: string;
    snapshotName: string;
    billingResponsibleClientId: string | null;
    priceAtEnrollment: number;
    paidAmount: number;
    enrollmentStatus: AdminClassEnrollmentStatus | string;
    attendanceStatus: AdminClassAttendanceStatus | string;
    paymentStatus: AdminClassPaymentStatus | string;
    cancelledAt: string | null;
    attendedAt: string | null;
    notes: string | null;
    billingResponsibleClient: { id: string; name: string } | null;
    classSession: {
      id: string;
      startsAt: string;
      endsAt: string;
      status: AdminClassSessionStatus | string;
      visibility: AdminClassSessionVisibility | string;
      classType: AdminClassSessionType | string;
      teacher: { id: string; displayName: string; isActive: boolean } | null;
      activityType: { id: number; name: string } | null;
      court: { id: number; name: string } | null;
    };
  }>;
  beneficiaryPasses: Array<{
    id: string;
    ownerClientId: string;
    beneficiaryClientId: string;
    packageName: string;
    totalCredits: number;
    usedCredits: number;
    remainingCredits: number;
    expiresAt: string | null;
    classType: AdminClassSessionType | string | null;
    transferable: boolean;
    status: AdminClassPassStatus | string;
    purchasedAt: string;
    notes: string | null;
    ownerClient: { id: string; name: string } | null;
    beneficiaryClient: { id: string; name: string } | null;
    activityType: { id: number; name: string } | null;
    teacher: { id: string; displayName: string; isActive: boolean } | null;
    recentUsages: Array<{
      id: string;
      usedAt: string;
      reason: AdminClassCreditUsageReason | string;
      creditsUsed: number;
      classEnrollmentId: string;
    }>;
  }>;
  ownedPasses: Array<{
    id: string;
    ownerClientId: string;
    beneficiaryClientId: string;
    packageName: string;
    totalCredits: number;
    usedCredits: number;
    remainingCredits: number;
    expiresAt: string | null;
    classType: AdminClassSessionType | string | null;
    transferable: boolean;
    status: AdminClassPassStatus | string;
    purchasedAt: string;
    notes: string | null;
    ownerClient: { id: string; name: string } | null;
    beneficiaryClient: { id: string; name: string } | null;
    activityType: { id: number; name: string } | null;
    teacher: { id: string; displayName: string; isActive: boolean } | null;
    recentUsages: Array<{
      id: string;
      usedAt: string;
      reason: AdminClassCreditUsageReason | string;
      creditsUsed: number;
      classEnrollmentId: string;
    }>;
  }>;
  creditUsages: Array<{
    id: string;
    classPassId: string;
    classEnrollmentId: string;
    creditsUsed: number;
    usedAt: string;
    reason: AdminClassCreditUsageReason | string;
    notes: string | null;
    createdAt: string;
    createdByUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
    classPass: {
      id: string;
      packageName: string;
      beneficiaryClientId: string;
      remainingCredits: number;
      status: AdminClassPassStatus | string;
    } | null;
    classEnrollment: {
      id: string;
      snapshotName: string;
      enrollmentStatus: AdminClassEnrollmentStatus | string;
      attendanceStatus: AdminClassAttendanceStatus | string;
      paymentStatus: AdminClassPaymentStatus | string;
      classSessionId: string;
      classSession: {
        id: string;
        startsAt: string;
        endsAt: string;
        teacher: { id: string; displayName: string; isActive: boolean } | null;
        activityType: { id: number; name: string } | null;
      } | null;
    } | null;
  }>;
  incomingRelationships: Array<{
    id: string;
    relationshipType: string;
    canPayFor: boolean;
    canManageEnrollments: boolean;
    canViewSchedule: boolean;
    canCancelClass: boolean;
    canViewPayments: boolean;
    notes: string | null;
    fromClient: { id: string; name: string } | null;
    toClient: { id: string; name: string } | null;
  }>;
  outgoingRelationships: Array<{
    id: string;
    relationshipType: string;
    canPayFor: boolean;
    canManageEnrollments: boolean;
    canViewSchedule: boolean;
    canCancelClass: boolean;
    canViewPayments: boolean;
    notes: string | null;
    fromClient: { id: string; name: string } | null;
    toClient: { id: string; name: string } | null;
  }>;
};

export type AuditLogUser = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export type AuditLogEntry = {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  payload?: any;
  createdAt: string;
  user?: AuditLogUser | null;
};

export type ClubReviewAdminStatus = 'PUBLISHED' | 'HIDDEN' | 'REPORTED';

export type ClubReviewAdminItem = {
  id: string;
  bookingId: number;
  rating: number;
  comment?: string | null;
  status: ClubReviewAdminStatus;
  createdAt: string;
  updatedAt: string;
  user: {
    id: number;
    name: string;
  };
  booking?: {
    id: number;
    startDateTime?: string | null;
    endDateTime?: string | null;
  } | null;
};

export type ClubReviewAdminPage = {
  items: ClubReviewAdminItem[];
  nextCursor?: string | null;
};

export type ClientDuplicateIncidentStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';
export type ClientDuplicateIncidentSourceType = 'BOOKING' | 'FIXED_BOOKING' | 'CASH' | 'FAVORITE' | 'ADMIN' | 'UNKNOWN';
export type ClientDuplicateIncidentReasonType =
  | 'PHONE'
  | 'EMAIL'
  | 'DNI'
  | 'LINKING_CONFLICT'
  | 'MULTI_SIGNAL_CONFLICT'
  | 'UNKNOWN';

export type ClientDuplicateIncidentCandidate = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  dni?: string | null;
  userId?: number | null;
  isProfessor?: boolean;
};

export type ClientDuplicateIncident = {
  id: string;
  clubId: number;
  userId?: number | null;
  status: ClientDuplicateIncidentStatus;
  reasonType: ClientDuplicateIncidentReasonType | string;
  sourceType: ClientDuplicateIncidentSourceType | string;
  primaryClientId?: string | null;
  candidateClientIds: string[];
  payload?: any;
  resolutionType?: string | null;
  resolutionNotes?: string | null;
  resolvedClientId?: string | null;
  resolvedByUserId?: number | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: number;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    dni?: string | null;
  } | null;
  candidateClients?: ClientDuplicateIncidentCandidate[];
};

export type ClubMembershipRole = 'OWNER' | 'ADMIN' | 'STAFF';

export type ClubMember = {
  id: string;
  clubId: number;
  userId: number;
  role: ClubMembershipRole | string;
  createdAt?: string;
  status: 'ACTIVE' | string;
  user: {
    id: number;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
};

export type AdminClubPaymentIntegration = {
  provider: 'MERCADO_PAGO';
  status: 'CONNECTED' | 'DISCONNECTED' | 'EXPIRED' | 'ERROR';
  connected: boolean;
  publicKey: string | null;
  externalUserId: string | null;
  connectedBy: {
    id: number;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  updatedAt: string;
};

export type AdminClubBillingIntegration = {
  id: string | null;
  environment: 'TEST' | 'PRODUCTION';
  status: 'CONNECTED' | 'DISCONNECTED';
  issuerTaxId: string | null;
  issuerTaxCondition: string | null;
  issuerLegalName: string | null;
  pointOfSaleNumber: number | null;
  createdBy: {
    id: number;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  createdAt: string | null;
  updatedAt: string;
};

export type PersonSearchResult = {
  personKey: string;
  kind: 'linked' | 'clubClient' | 'systemUser' | 'newClientSuggestion';
  clientId: string | null;
  userId: number | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  dni: string | null;
  badges: string[];
  sourceReason?: string;
};

export class ClubAdminService {
  /**
   * Obtener la agenda del administrador para un club específico
   */
  static async getAdminSchedule(clubSlug: string, date: string) {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/schedule?date=${date}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'Error al cargar la agenda');
    }
    return res.json();
  }

  /**
   * Obtener todas las canchas del club
   */
  static async getCourts(clubSlug: string) {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/courts`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al cargar las canchas');
    }
    return res.json();
  }

  /**
   * Crear cancha en el club
   */
  static async createCourt(clubSlug: string, name: string, surface: string) {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/courts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, surface })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al crear cancha');
    }
    return res.json();
  }

  /**
   * Suspender cancha
   */
  static async suspendCourt(clubSlug: string, courtId: number) {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/courts/${courtId}/suspend`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al suspender cancha');
    }
    return res.json();
  }

  /**
   * Reactivar cancha
   */
  static async reactivateCourt(clubSlug: string, courtId: number) {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/courts/${courtId}/reactivate`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al reactivar cancha');
    }
    return res.json();
  }

  /**
   * Obtener información del club
   */
  static async getClubInfo(clubSlug: string) {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/info`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al cargar información del club');
    }
    return res.json();
  }

  static async getActivityTypes(clubSlug: string): Promise<ClubActivityType[]> {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/activity-types`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al cargar actividades');
    }

    return res.json();
  }

  static async updateActivityTypeSchedule(
    clubSlug: string,
    activityTypeId: number,
    payload: {
      scheduleMode: ActivityScheduleMode;
      scheduleOpenTime?: string | null;
      scheduleCloseTime?: string | null;
      scheduleIntervalMinutes?: number | null;
      scheduleWindows?: ActivityRangeWindow[] | null;
      scheduleDurations?: number[];
      scheduleFixedSlots?: ActivityFixedSlot[];
    }
  ): Promise<ClubActivityType> {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/activity-types/${activityTypeId}/schedule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al actualizar configuración de actividad');
    }

    return res.json();
  }

  static async listActivityTypeScheduleExceptions(
    clubSlug: string,
    activityTypeId: number,
    params?: { fromDate?: string; toDate?: string }
  ): Promise<ActivityScheduleException[]> {

    const qs = new URLSearchParams();
    if (params?.fromDate) qs.set('fromDate', params.fromDate);
    if (params?.toDate) qs.set('toDate', params.toDate);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/activity-types/${activityTypeId}/schedule-exceptions${suffix}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al listar excepciones de agenda');
    }

    return res.json();
  }

  static async upsertActivityTypeScheduleException(
    clubSlug: string,
    activityTypeId: number,
    localDate: string,
    payload: {
      isClosed?: boolean;
      scheduleMode?: ActivityScheduleMode;
      scheduleOpenTime?: string | null;
      scheduleCloseTime?: string | null;
      scheduleIntervalMinutes?: number | null;
      scheduleWindows?: ActivityRangeWindow[] | null;
      scheduleDurations?: number[];
      scheduleFixedSlots?: ActivityFixedSlot[];
    }
  ): Promise<ActivityScheduleException> {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/activity-types/${activityTypeId}/schedule-exceptions/${encodeURIComponent(localDate)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al guardar excepción de agenda');
    }

    return res.json();
  }

  static async deleteActivityTypeScheduleException(
    clubSlug: string,
    activityTypeId: number,
    localDate: string
  ): Promise<{ deleted: boolean }> {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/activity-types/${activityTypeId}/schedule-exceptions/${encodeURIComponent(localDate)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al eliminar excepción de agenda');
    }

    return res.json();
  }

  /**
   * Actualizar información del club
   */
  static async updateClubInfo(clubSlug: string, data: any) {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/info`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || error.message || 'Error al actualizar información del club');
    }
    return res.json();
  }

  /**
   * Cancelar reserva
   */
  static async cancelBooking(
    clubSlug: string,
    bookingId: number,
    options?: {
      refund?: {
        amount?: number;
        executeNow?: boolean;
        reasonType?: 'FULL' | 'PARTIAL_COMMERCIAL' | 'PARTIAL_SERVICE_FAILURE' | 'PARTIAL_PRICING_ERROR' | 'OTHER';
        executionNotes?: string;
      };
    }
  ) {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/bookings/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId,
        ...(options?.refund ? { refund: options.refund } : {})
      })
    });

    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'Error al cancelar reserva');
    }
    return res.json();
  }

  static async confirmBooking(clubSlug: string, bookingId: number) {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/bookings/${bookingId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'Error al confirmar reserva');
    }
    return res.json();
  }

  static async completeBooking(clubSlug: string, bookingId: number) {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/bookings/${bookingId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'Error al completar reserva');
    }
    return res.json();
  }

  static async rescheduleBooking(
    clubSlug: string,
    bookingId: number,
    data: {
      courtId: number;
      startDateTime: string;
      durationMinutes?: number;
    }
  ) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/bookings/${bookingId}/reschedule`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'Error al mover reserva');
    }
    return res.json();
  }

  static async getBookingBillingConfig(clubSlug: string, bookingId: number): Promise<BookingBillingConfig> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/bookings/${bookingId}/billing-config`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'Error al obtener configuración de cobro');
    }
    const payload = await res.json();
    return {
      bookingId: Number(payload?.bookingId || bookingId),
      clubId: Number(payload?.clubId || 0),
      chargeMode: payload?.chargeMode === 'SHARED' ? 'SHARED' : 'INDIVIDUAL',
      chargeResponsibleRef: payload?.chargeResponsibleRef ? String(payload.chargeResponsibleRef) : undefined,
      assignments: Array.isArray(payload?.assignments)
        ? payload.assignments.map((assignment: any) => ({
            id: String(assignment?.id || ''),
            participantRef: String(assignment?.participantRef || ''),
            isChargeable: Boolean(assignment?.isChargeable),
            assignedAmount: Number(assignment?.assignedAmount || 0),
            participantLinkState:
              assignment?.participantLinkState === 'ARCHIVED_REFERENCE'
                ? 'ARCHIVED_REFERENCE'
                : 'ACTIVE',
          }))
        : [],
      metadata: payload?.metadata || undefined,
      updatedAt: String(payload?.updatedAt || new Date().toISOString()),
    };
  }

  static async updateBookingBillingConfig(
    clubSlug: string,
    bookingId: number,
    data: {
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
    }
  ): Promise<BookingBillingConfig> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/bookings/${bookingId}/billing-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'Error al guardar configuración de cobro');
    }
    const payload = await res.json();
    return {
      bookingId: Number(payload?.bookingId || bookingId),
      clubId: Number(payload?.clubId || 0),
      chargeMode: payload?.chargeMode === 'SHARED' ? 'SHARED' : 'INDIVIDUAL',
      chargeResponsibleRef: payload?.chargeResponsibleRef ? String(payload.chargeResponsibleRef) : undefined,
      assignments: Array.isArray(payload?.assignments)
        ? payload.assignments.map((assignment: any) => ({
            id: String(assignment?.id || ''),
            participantRef: String(assignment?.participantRef || ''),
            isChargeable: Boolean(assignment?.isChargeable),
            assignedAmount: Number(assignment?.assignedAmount || 0),
            participantLinkState:
              assignment?.participantLinkState === 'ARCHIVED_REFERENCE'
                ? 'ARCHIVED_REFERENCE'
                : 'ACTIVE',
          }))
        : [],
      metadata: payload?.metadata || undefined,
      updatedAt: String(payload?.updatedAt || new Date().toISOString()),
    };
  }

  /**
   * Crear reserva fija
   */
  static async createFixedBooking(clubSlug: string, data: any) {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/bookings/fixed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      const parsed = await parseApiErrorResponse(res, 'Error al crear reserva fija');
      const err = parsed as any;
      err.details = parsed.meta || {};
      throw err;
    }
    return res.json();
  }

  /**
   * Cancelar reserva fija
   */
  static async cancelFixedBooking(
    clubSlug: string,
    fixedBookingId: number,
    data?: {
      scope?: 'THIS_OCCURRENCE' | 'NEXT_OCCURRENCES' | 'ALL_OCCURRENCES';
      occurrenceBookingId?: number;
      previewOnly?: boolean;
    }
  ) {

    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/bookings/fixed/${fixedBookingId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {})
    });

    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'Error al cancelar reserva fija');
    }
    return res.json();
  }

  static async rescheduleFixedBooking(
    clubSlug: string,
    fixedBookingId: number,
    data: {
      scope: 'THIS_OCCURRENCE' | 'NEXT_OCCURRENCES' | 'ALL_OCCURRENCES';
      occurrenceBookingId?: number;
      courtId: number;
      startDateTime: string;
      durationMinutes?: number;
      previewOnly?: boolean;
    }
  ) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${clubSlug}/admin/bookings/fixed/${fixedBookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'Error al editar serie');
    }
    return res.json();
  }

  static async getProducts(slug: string) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/products`, {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error('Error al cargar productos');
    return res.json();
  }

  static async createProduct(slug: string, data: any) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error al crear producto');
    return res.json();
  }

  static async updateProduct(slug: string, id: number, data: any) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error al actualizar producto');
    return res.json();
  }

  static async deleteProduct(slug: string, id: number) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/products/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Error al eliminar producto');
    return res.json();
  }

  static async getServices(slug: string, includeInactive = false): Promise<ClubCatalogService[]> {
    const query = includeInactive ? '?includeInactive=true' : '';
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/services${query}`, {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      const message =
        (typeof error?.error === 'string' && error.error) ||
        (typeof error?.message === 'string' && error.message) ||
        'Error al cargar servicios';
      throw new Error(message);
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  }

  static async createService(slug: string, data: {
    code: string;
    name: string;
    description?: string;
    price: number;
  }) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Error al crear servicio');
    }
    return res.json();
  }

  static async updateService(slug: string, id: number, data: {
    code?: string;
    name?: string;
    description?: string | null;
    price?: number;
    isActive?: boolean;
  }) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/services/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Error al actualizar servicio');
    }
    return res.json();
  }

  static async deleteService(slug: string, id: number) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/services/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Error al eliminar servicio');
    }
    return res.json();
  }

  static async getTeachers(slug: string, includeInactive = true): Promise<AdminTeacher[]> {
    const query = includeInactive ? '?includeInactive=true' : '';
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/teachers${query}`, {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al cargar profesores');
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  }

  static async getTeacher(slug: string, id: string): Promise<AdminTeacher> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/teachers/${id}`, {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al cargar profesor');
    }
    return res.json();
  }

  static async createTeacher(
    slug: string,
    data: {
      displayName: string;
      email?: string | null;
      phone?: string | null;
      isInternal?: boolean;
      specialties?: string[];
      notes?: string | null;
      clientId?: string | null;
      userId?: number | null;
    }
  ): Promise<AdminTeacher> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/teachers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al crear profesor');
    }
    return res.json();
  }

  static async updateTeacher(
    slug: string,
    id: string,
    data: {
      displayName?: string;
      email?: string | null;
      phone?: string | null;
      isInternal?: boolean;
      isActive?: boolean;
      specialties?: string[];
      notes?: string | null;
      clientId?: string | null;
      userId?: number | null;
    }
  ): Promise<AdminTeacher> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/teachers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al actualizar profesor');
    }
    return res.json();
  }

  static async setTeacherActive(slug: string, id: string, isActive: boolean): Promise<AdminTeacher> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/teachers/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive })
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al actualizar estado del profesor');
    }
    return res.json();
  }

  static async getClassSessions(slug: string): Promise<AdminClassSession[]> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-sessions`, {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al cargar clases');
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  }

  static async getClassSession(slug: string, id: string): Promise<AdminClassSession> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-sessions/${id}`, {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al cargar clase');
    }
    return res.json();
  }

  static async createClassSession(
    slug: string,
    data: {
      teacherId: string;
      visibility: AdminClassSessionVisibility;
      classType: AdminClassSessionType;
      activityTypeId?: number | null;
      courtId?: number | null;
      startsAt: string;
      endsAt: string;
      durationMinutes: number;
      capacity: number;
      pricePerStudent?: number | null;
      status?: AdminClassSessionStatus;
      level?: string | null;
      description?: string | null;
      requiresApproval?: boolean;
      requiresPaymentToEnroll?: boolean;
      metadata?: unknown;
    }
  ): Promise<AdminClassSession> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al crear clase');
    }
    return res.json();
  }

  static async updateClassSession(
    slug: string,
    id: string,
    data: {
      teacherId?: string;
      visibility?: AdminClassSessionVisibility;
      classType?: AdminClassSessionType;
      activityTypeId?: number | null;
      courtId?: number | null;
      startsAt?: string;
      endsAt?: string;
      durationMinutes?: number;
      capacity?: number;
      pricePerStudent?: number | null;
      status?: AdminClassSessionStatus;
      level?: string | null;
      description?: string | null;
      requiresApproval?: boolean;
      requiresPaymentToEnroll?: boolean;
      metadata?: unknown;
    }
  ): Promise<AdminClassSession> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-sessions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al actualizar clase');
    }
    return res.json();
  }

  static async setClassSessionStatus(
    slug: string,
    id: string,
    status: AdminClassSessionStatus
  ): Promise<AdminClassSession> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-sessions/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al actualizar estado de la clase');
    }
    return res.json();
  }

  static async getClassEnrollments(slug: string, classSessionId: string): Promise<AdminClassEnrollment[]> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-sessions/${classSessionId}/enrollments`, {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al cargar alumnos de la clase');
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  }

  static async createClassEnrollment(
    slug: string,
    classSessionId: string,
    data: {
      studentClientId: string;
      studentUserId?: number | null;
      billingResponsibleClientId?: string | null;
      enrollmentStatus?: 'ENROLLED' | 'WAITLISTED';
      notes?: string | null;
    }
  ): Promise<AdminClassEnrollment> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-sessions/${classSessionId}/enrollments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al agregar alumno a la clase');
    }
    return res.json();
  }

  static async updateClassEnrollment(
    slug: string,
    classSessionId: string,
    enrollmentId: string,
    data: {
      studentUserId?: number | null;
      billingResponsibleClientId?: string | null;
      notes?: string | null;
    }
  ): Promise<AdminClassEnrollment> {
    const res = await fetchWithAuth(
      `${apiBase()}/clubs/${slug}/admin/class-sessions/${classSessionId}/enrollments/${enrollmentId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }
    );
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al actualizar la inscripción');
    }
    return res.json();
  }

  static async cancelClassEnrollment(
    slug: string,
    classSessionId: string,
    enrollmentId: string,
    options?: { isLate?: boolean }
  ): Promise<AdminClassEnrollment> {
    const res = await fetchWithAuth(
      `${apiBase()}/clubs/${slug}/admin/class-sessions/${classSessionId}/enrollments/${enrollmentId}/cancel`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLate: Boolean(options?.isLate) })
      }
    );
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al cancelar la inscripción');
    }
    return res.json();
  }

  static async setClassEnrollmentAttendance(
    slug: string,
    classSessionId: string,
    enrollmentId: string,
    data: {
      attendanceStatus: AdminClassAttendanceStatus;
      attendedAt?: string | null;
    }
  ): Promise<AdminClassEnrollment> {
    const res = await fetchWithAuth(
      `${apiBase()}/clubs/${slug}/admin/class-sessions/${classSessionId}/enrollments/${enrollmentId}/attendance`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }
    );
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al actualizar la asistencia');
    }
    return res.json();
  }

  static async getClassEnrollmentAccount(
    slug: string,
    enrollmentId: string
  ): Promise<AdminClassEnrollmentAccount> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-enrollments/${enrollmentId}/account`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al cargar la cuenta de la inscripción');
    }
    return res.json();
  }

  static async openClassEnrollmentAccount(
    slug: string,
    enrollmentId: string
  ): Promise<AdminClassEnrollmentAccount> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-enrollments/${enrollmentId}/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al abrir la cuenta de la inscripción');
    }
    return res.json();
  }

  static async getClassPasses(
    slug: string,
    filters?: { beneficiaryClientId?: string; status?: AdminClassPassStatus }
  ): Promise<AdminClassPass[]> {
    const query = new URLSearchParams();
    if (filters?.beneficiaryClientId) query.set('beneficiaryClientId', filters.beneficiaryClientId);
    if (filters?.status) query.set('status', filters.status);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-passes${suffix}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al cargar packs de clases');
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  }

  static async getClassPass(slug: string, classPassId: string): Promise<AdminClassPass> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-passes/${classPassId}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al cargar el pack de clases');
    }
    return res.json();
  }

  static async createClassPass(
    slug: string,
    data: {
      ownerClientId: string;
      ownerUserId?: number | null;
      beneficiaryClientId: string;
      beneficiaryUserId?: number | null;
      packageName: string;
      priceAtPurchase?: number | null;
      totalCredits: number;
      expiresAt?: string | null;
      activityTypeId?: number | null;
      classType?: AdminClassSessionType | null;
      teacherId?: string | null;
      transferable?: boolean;
      notes?: string | null;
    }
  ): Promise<AdminClassPass> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-passes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al crear el pack de clases');
    }
    return res.json();
  }

  static async updateClassPass(
    slug: string,
    classPassId: string,
    data: {
      packageName?: string | null;
      expiresAt?: string | null;
      activityTypeId?: number | null;
      classType?: AdminClassSessionType | null;
      teacherId?: string | null;
      transferable?: boolean;
      notes?: string | null;
    }
  ): Promise<AdminClassPass> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-passes/${classPassId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al actualizar el pack de clases');
    }
    return res.json();
  }

  static async setClassPassStatus(
    slug: string,
    classPassId: string,
    status: 'ACTIVE' | 'CANCELLED'
  ): Promise<AdminClassPass> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-passes/${classPassId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al actualizar el estado del pack');
    }
    return res.json();
  }

  static async getClassPassAccount(slug: string, classPassId: string): Promise<AdminClassPassAccount> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-passes/${classPassId}/account`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al cargar la cuenta del pack');
    }
    return res.json();
  }

  static async openClassPassAccount(slug: string, classPassId: string): Promise<AdminClassPassAccount> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-passes/${classPassId}/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al abrir la cuenta del pack');
    }
    return res.json();
  }

  static async getClassPassUsages(slug: string, classPassId: string): Promise<AdminClassCreditUsage[]> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-passes/${classPassId}/usages`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al cargar consumos del pack');
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  }

  static async getEnrollmentCreditUsages(slug: string, enrollmentId: string): Promise<AdminClassCreditUsage[]> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-enrollments/${enrollmentId}/credit-usages`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al cargar consumos de la inscripción');
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  }

  static async createClassPassUsage(
    slug: string,
    classPassId: string,
    data: {
      classEnrollmentId: string;
      creditsUsed: number;
      reason: AdminClassCreditUsageReason;
      notes?: string | null;
    }
  ): Promise<AdminClassCreditUsage> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/class-passes/${classPassId}/usages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al consumir crédito');
    }
    return res.json();
  }

  static async getAcademyStudents(
    slug: string,
    options?: { q?: string }
  ): Promise<AdminAcademyStudentListItem[]> {
    const query = new URLSearchParams();
    if (options?.q) query.set('q', options.q);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/academy-students${suffix}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al cargar alumnos de Academia');
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  }

  static async getAcademyStudentOverview(
    slug: string,
    clientId: string
  ): Promise<AdminAcademyStudentOverview> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/academy-students/${clientId}/overview`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res, 'Error al cargar el resumen del alumno');
    }
    return res.json();
  }

  static async getBookingItems(bookingId: number) {
    const res = await fetchWithAuth(`${apiBase()}/bookings/${bookingId}/items`);
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || error.message || 'Error al cargar consumos');
    }
    return res.json();
  }

  static async addItemToBooking(
    bookingId: number,
    productId: number,
    quantity: number,
    paymentMethod: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER',
    options?: { applyDiscount?: boolean }
  ) {

    const res = await fetchWithAuth(`${apiBase()}/bookings/${bookingId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId,
        productId,
        quantity,
        paymentMethod,
        ...(options?.applyDiscount === undefined ? {} : { applyDiscount: options.applyDiscount })
      })
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Error al agregar producto');
    }
    return res.json();
  }

  static async quoteBookingItem(
    bookingId: number,
    productId: number,
    quantity: number,
    options?: { applyDiscount?: boolean }
  ) {
    const res = await fetchWithAuth(`${apiBase()}/bookings/${bookingId}/items/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId,
        productId,
        quantity,
        ...(options?.applyDiscount === undefined ? {} : { applyDiscount: options.applyDiscount })
      })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'Error al cotizar producto');
    }
    return res.json();
  }
  static async removeItemFromBooking(itemId: number | string) {
    const res = await fetchWithAuth(`${apiBase()}/bookings/items/${itemId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || 'Error al eliminar consumo');
    }
    return res.json();
  }

  static async getClients(slug: string, query?: string) {
    const q = String(query || '').trim();
    const queryString = q ? `?q=${encodeURIComponent(q)}` : '';
    const response = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/clients-list${queryString}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error('Error al obtener lista de clientes');
    return response.json();
  }

  static async searchParticipants(slug: string, query?: string) {
    const q = String(query || '').trim();
    const queryString = q ? `?q=${encodeURIComponent(q)}` : '';
    const response = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/participants-search${queryString}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error('Error al obtener participantes');
    return response.json();
  }

  static async searchPeople(slug: string, query?: string): Promise<PersonSearchResult[]> {
    const q = String(query || '').trim();
    const queryString = q ? `?q=${encodeURIComponent(q)}` : '';
    const response = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/person-search${queryString}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error('Error al obtener personas');
    return response.json();
  }

  static async listClientDuplicateIncidents(
    slug: string,
    filters?: { status?: ClientDuplicateIncidentStatus; sourceType?: string }
  ): Promise<ClientDuplicateIncident[]> {
    const query = new URLSearchParams();
    if (filters?.status) query.set('status', filters.status);
    if (filters?.sourceType) query.set('sourceType', filters.sourceType);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const response = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/client-duplicate-incidents${suffix}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Error al obtener incidentes de duplicados');
    }
    const data = await response.json();
    return Array.isArray(data?.incidents) ? data.incidents : [];
  }

  static async getClientDuplicateIncident(slug: string, incidentId: string): Promise<ClientDuplicateIncident> {
    const response = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/client-duplicate-incidents/${encodeURIComponent(incidentId)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Error al obtener detalle del incidente');
    }
    const data = await response.json();
    return data.incident;
  }

  static async resolveClientDuplicateIncidentLink(slug: string, incidentId: string, clientId: string) {
    const response = await fetchWithAuth(
      `${apiBase()}/clubs/${slug}/admin/client-duplicate-incidents/${encodeURIComponent(incidentId)}/resolve-link`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId })
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo resolver el incidente');
    }
    const data = await response.json();
    return data.incident;
  }

  static async dismissClientDuplicateIncident(slug: string, incidentId: string, reason?: string) {
    const response = await fetchWithAuth(
      `${apiBase()}/clubs/${slug}/admin/client-duplicate-incidents/${encodeURIComponent(incidentId)}/dismiss`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || '' })
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo descartar el incidente');
    }
    const data = await response.json();
    return data.incident;
  }


  static async getDashboardStats(slug: string) {

    // Ajustá 'apiBase()' según tu configuración, pero suele ser la función que retorna tu URL base
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/stats/dashboard`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Error al cargar métricas');
    }
    
    return res.json();
  }

  static async listDiscountPolicies(slug: string) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/discount-policies`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al listar políticas de descuento');
    }
    return res.json();
  }

  static async createDiscountPolicy(slug: string, body: {
    name: string;
    description?: string;
    scope: DiscountPolicyScope;
    amountType: DiscountAmountType;
    amountValue: number;
    applyMode?: DiscountApplyMode;
    isStackable?: boolean;
    priority?: number;
    isActive?: boolean;
    startsAt?: string;
    endsAt?: string;
    targets?: Array<{
      activityTypeId?: number;
      productId?: number;
      productCategory?: string;
      serviceCode?: string;
    }>;
  }) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/discount-policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al crear política de descuento');
    }
    return res.json();
  }

  static async updateDiscountPolicy(slug: string, policyId: string, body: {
    name?: string;
    description?: string | null;
    scope?: DiscountPolicyScope;
    amountType?: DiscountAmountType;
    amountValue?: number;
    applyMode?: DiscountApplyMode;
    isStackable?: boolean;
    priority?: number;
    isActive?: boolean;
    startsAt?: string | null;
    endsAt?: string | null;
  }) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/discount-policies/${policyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al actualizar política de descuento');
    }
    return res.json();
  }

  static async listClientDiscountAssignments(slug: string, clientId: string) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/clients/${clientId}/discount-assignments`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al listar descuentos del cliente');
    }
    return res.json();
  }

  static async assignDiscountToClient(slug: string, clientId: string, body: {
    policyId: string;
    notes?: string;
    startsAt?: string;
    endsAt?: string;
  }) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/clients/${clientId}/discount-assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al asignar descuento al cliente');
    }
    return res.json();
  }

  static async updateDiscountAssignment(slug: string, assignmentId: string, isActive: boolean) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/discount-assignments/${assignmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive })
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al actualizar asignación');
    }
    return res.json();
  }

  static async deleteDiscountAssignment(slug: string, assignmentId: string) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/discount-assignments/${assignmentId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al eliminar asignación');
    }
    return true;
  }

  static async listClubReviews(slug: string, params?: { take?: number; cursor?: string; status?: ClubReviewAdminStatus }): Promise<ClubReviewAdminPage> {
    const query = new URLSearchParams();
    if (params?.take != null) query.set('take', String(params.take));
    if (params?.cursor) query.set('cursor', params.cursor);
    if (params?.status) query.set('status', params.status);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/reviews${suffix}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al listar reseñas');
    }
    return res.json();
  }

  static async setClubReviewStatus(slug: string, reviewId: string, status: ClubReviewAdminStatus): Promise<ClubReviewAdminItem> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/reviews/${reviewId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al actualizar estado de reseña');
    }
    return res.json();
  }

  static async listAuditLogs(params?: {
    action?: string;
    entity?: string;
    entityId?: string;
    take?: number;
  }): Promise<AuditLogEntry[]> {
    const query = new URLSearchParams();
    if (params?.action) query.set('action', params.action);
    if (params?.entity) query.set('entity', params.entity);
    if (params?.entityId) query.set('entityId', params.entityId);
    if (params?.take != null) query.set('take', String(params.take));

    const url = `${apiBase()}/audit-logs${query.toString() ? `?${query.toString()}` : ''}`;
    const res = await fetchWithAuth(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al listar auditoria');
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  }

  static async listMembers(slug: string): Promise<ClubMember[]> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/members`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudieron cargar los miembros del club.');
    }
    const payload = await res.json();
    return Array.isArray(payload?.items) ? payload.items : [];
  }

  static async inviteMember(slug: string, input: { email: string; role: ClubMembershipRole }) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/members/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo dar acceso al miembro.');
    }
    return res.json();
  }

  static async updateMemberRole(slug: string, membershipId: string, role: ClubMembershipRole) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/members/${encodeURIComponent(membershipId)}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role })
    });
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo actualizar el rol.');
    }
    return res.json();
  }

  static async removeMember(slug: string, membershipId: string) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/members/${encodeURIComponent(membershipId)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo quitar el acceso.');
    }
    return res.json();
  }

  static async listPaymentIntegrations(slug: string): Promise<AdminClubPaymentIntegration[]> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/integrations`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudieron cargar las integraciones del club.');
    }
    const payload = await res.json();
    return Array.isArray(payload?.items) ? payload.items : [];
  }

  static async listBillingIntegrations(slug: string): Promise<AdminClubBillingIntegration[]> {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/integrations/billing`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo cargar la configuración de facturación.');
    }
    const payload = await res.json();
    return Array.isArray(payload?.items) ? payload.items : [];
  }

  static async upsertBillingIntegration(slug: string, input: {
    environment: 'TEST' | 'PRODUCTION';
    issuerTaxId: string;
    issuerTaxCondition: string;
    issuerLegalName: string;
    pointOfSaleNumber: number;
    certificatePem: string;
    privateKeyPem: string;
  }) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/integrations/billing`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo guardar la configuración de facturación.');
    }
    const payload = await res.json();
    return payload?.integration ?? payload;
  }

  static getMercadoPagoConnectUrl(slug: string) {
    return `${apiBase()}/clubs/${slug}/admin/integrations/mercadopago/connect`;
  }

  static async disconnectMercadoPago(slug: string) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/integrations/mercadopago/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo desconectar Mercado Pago.');
    }
    const payload = await res.json();
    return payload?.integration ?? payload;
  }
}
