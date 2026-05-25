import type { GetServerSideProps } from 'next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, UserPlus, Users, XCircle } from 'lucide-react';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import {
  AdminAppModal,
  AdminDataTable,
  AdminDrawer,
  AdminDrawerSection,
  type AdminDataTableColumn,
  AdminFeedbackBanner,
  AdminFilterToolbar,
  AdminInlineError,
  MetricCard,
  AdminPanel,
  AdminSegmentedControl,
} from '../../components/admin/ui';
import {
  ClubAdminService,
  type AdminClassAttendanceStatus,
  type AdminClassCreditUsage,
  type AdminClassCreditUsageReason,
  type AdminClassEnrollment,
  type AdminClassEnrollmentStatus,
  type AdminClassPass,
  type AdminClassPaymentStatus,
  type AdminClassSession,
  type AdminClassSessionStatus,
  type AdminClassSessionType,
  type AdminClassSessionVisibility,
  type AdminTeacher,
  type ClubActivityType,
  type PersonSearchResult,
} from '../../services/ClubAdminService';
import { getApiFieldErrors, normalizeApiError } from '../../utils/apiError';
import { showAdminToast } from '../../utils/adminToast';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';

type ClassStatusFilter = 'all' | 'active' | 'completed' | 'cancelled';
type EnrollmentFilter = 'active' | 'all' | 'cancelled';

type CourtOption = {
  id: number;
  name: string;
};

type ClassFormState = {
  teacherId: string;
  visibility: AdminClassSessionVisibility;
  classType: AdminClassSessionType;
  activityTypeId: string;
  courtId: string;
  startsAt: string;
  endsAt: string;
  capacity: string;
  pricePerStudent: string;
  status: AdminClassSessionStatus;
  level: string;
  description: string;
  requiresApproval: boolean;
  requiresPaymentToEnroll: boolean;
};

type EnrollmentPersonOption = PersonSearchResult & {
  disabledReason?: string;
};

type EnrollmentFormState = {
  selectedStudent: EnrollmentPersonOption | null;
  studentQuery: string;
  selectedStudentUser: EnrollmentPersonOption | null;
  studentUserQuery: string;
  selectedResponsible: EnrollmentPersonOption | null;
  responsibleQuery: string;
  attendanceStatus: AdminClassAttendanceStatus;
  initialAttendanceStatus: AdminClassAttendanceStatus;
  notes: string;
};

type ClassPassFormState = {
  packageName: string;
  totalCredits: string;
  expiresAt: string;
  ownerClientId: string;
  ownerClientName: string;
  beneficiaryClientId: string;
  beneficiaryClientName: string;
  restrictToActivity: boolean;
  restrictToClassType: boolean;
  restrictToTeacher: boolean;
  transferable: boolean;
  notes: string;
};

const CLASS_STATUS_OPTIONS: Array<{ value: AdminClassSessionStatus; label: string }> = [
  { value: 'DRAFT', label: 'Borrador' },
  { value: 'SCHEDULED', label: 'Programada' },
  { value: 'CONFIRMED', label: 'Confirmada' },
  { value: 'COMPLETED', label: 'Completada' },
  { value: 'CANCELLED', label: 'Cancelada' },
];

const nowRounded = () => {
  const date = new Date();
  date.setSeconds(0, 0);
  const minutes = date.getMinutes();
  if (minutes === 0) return date;
  date.setMinutes(minutes + (30 - (minutes % 30 || 30)));
  return date;
};

const addMinutes = (date: Date, minutes: number) => {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
};

const toLocalDateTimeInputValue = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
};

const localInputToIso = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
};

const buildEmptyClassForm = (): ClassFormState => {
  const start = nowRounded();
  const end = addMinutes(start, 60);
  return {
    teacherId: '',
    visibility: 'PRIVATE',
    classType: 'INDIVIDUAL',
    activityTypeId: '',
    courtId: '',
    startsAt: toLocalDateTimeInputValue(start),
    endsAt: toLocalDateTimeInputValue(end),
    capacity: '1',
    pricePerStudent: '',
    status: 'SCHEDULED',
    level: '',
    description: '',
    requiresApproval: false,
    requiresPaymentToEnroll: false,
  };
};

const buildEmptyEnrollmentForm = (): EnrollmentFormState => ({
  selectedStudent: null,
  studentQuery: '',
  selectedStudentUser: null,
  studentUserQuery: '',
  selectedResponsible: null,
  responsibleQuery: '',
  attendanceStatus: 'PENDING',
  initialAttendanceStatus: 'PENDING',
  notes: '',
});

const buildDefaultClassPassForm = ({
  enrollment,
  selectedClass,
}: {
  enrollment: AdminClassEnrollment;
  selectedClass: AdminClassSession;
}): ClassPassFormState => {
  const ownerClientId = enrollment.billingResponsibleClientId || enrollment.studentClientId;
  const ownerClientName =
    enrollment.billingResponsibleClient?.name ||
    enrollment.studentClient?.name ||
    enrollment.snapshotName ||
    'Cliente del club';
  const beneficiaryClientName =
    enrollment.studentClient?.name || enrollment.snapshotName || 'Alumno';

  return {
    packageName: 'Pack 4 clases',
    totalCredits: '4',
    expiresAt: '',
    ownerClientId,
    ownerClientName,
    beneficiaryClientId: enrollment.studentClientId,
    beneficiaryClientName,
    restrictToActivity: Boolean(selectedClass.activityTypeId),
    restrictToClassType: Boolean(selectedClass.classType),
    restrictToTeacher: Boolean(selectedClass.teacherId),
    transferable: false,
    notes: '',
  };
};

const ACTIVE_ATTENDANCE_OPTIONS: Array<{ value: AdminClassAttendanceStatus; label: string }> = [
  { value: 'PENDING', label: 'Pendiente' },
  { value: 'ATTENDED', label: 'Asistió' },
  { value: 'ABSENT', label: 'Ausente' },
  { value: 'NO_SHOW', label: 'No show' },
];

const CANCELLED_ATTENDANCE_OPTIONS: Array<{ value: AdminClassAttendanceStatus; label: string }> = [
  { value: 'CANCELLED_ON_TIME', label: 'Canceló a tiempo' },
  { value: 'CANCELLED_LATE', label: 'Canceló tarde' },
];

const formatDateRange = (startsAt: string, endsAt: string) => {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '-';

  const day = start.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const startTime = start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const endTime = end.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${startTime} - ${endTime}`;
};

const formatDateTime = (value: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatCurrency = (value: number | null) => {
  if (value == null) return 'Sin precio';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
};

const normalizeOptionalText = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const parseOptionalPositiveNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return Number.NaN;
  return parsed;
};

const drawerSectionCardClass = 'rounded-2xl border border-p-border bg-p-surface-2 p-4';
const fieldInputClass =
  'h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text shadow-p-card outline-none transition focus:border-p-accent focus:ring-2 focus:ring-lima-300/30';
const helperCardClass = 'rounded-xl border border-p-border bg-p-surface p-3 text-[13px] text-p-text-secondary';

const durationFromForm = (form: ClassFormState) => {
  const start = new Date(form.startsAt);
  const end = new Date(form.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.round((end.getTime() - start.getTime()) / 60000);
};

const statusLabel = (status: AdminClassSessionStatus) => {
  switch (status) {
    case 'DRAFT':
      return 'Borrador';
    case 'SCHEDULED':
      return 'Programada';
    case 'CONFIRMED':
      return 'Confirmada';
    case 'COMPLETED':
      return 'Completada';
    case 'CANCELLED':
      return 'Cancelada';
    default:
      return status;
  }
};

const visibilityLabel = (visibility: AdminClassSessionVisibility) =>
  visibility === 'PUBLIC' ? 'Pública' : 'Privada';

const classTypeLabel = (classType: AdminClassSessionType) =>
  classType === 'GROUP' ? 'Grupal' : 'Individual';

const enrollmentStatusLabel = (status: AdminClassEnrollmentStatus) => {
  switch (status) {
    case 'ENROLLED':
      return 'Inscripto';
    case 'WAITLISTED':
      return 'En espera';
    case 'CANCELLED':
      return 'Cancelado';
    default:
      return status;
  }
};

const attendanceStatusLabel = (status: AdminClassAttendanceStatus) => {
  switch (status) {
    case 'PENDING':
      return 'Pendiente';
    case 'ATTENDED':
      return 'Asistió';
    case 'ABSENT':
      return 'Ausente';
    case 'NO_SHOW':
      return 'No show';
    case 'CANCELLED_ON_TIME':
      return 'Canceló a tiempo';
    case 'CANCELLED_LATE':
      return 'Canceló tarde';
    default:
      return status;
  }
};

const paymentStatusLabel = (status: AdminClassPaymentStatus) => {
  switch (status) {
    case 'UNPAID':
      return 'Impago';
    case 'PARTIAL':
      return 'Pago parcial';
    case 'PAID':
      return 'Pagado';
    case 'COVERED_BY_CREDIT':
      return 'Cubierto por crédito';
    case 'REFUNDED':
      return 'Reintegrado';
    default:
      return status;
  }
};

const classPassStatusLabel = (status: AdminClassPass['status'] | string) => {
  switch (status) {
    case 'ACTIVE':
      return 'Activo';
    case 'EXPIRED':
      return 'Vencido';
    case 'DEPLETED':
      return 'Sin saldo';
    case 'CANCELLED':
      return 'Cancelado';
    default:
      return status;
  }
};

const creditUsageReasonLabel = (reason: AdminClassCreditUsageReason) => {
  switch (reason) {
    case 'ATTENDANCE':
      return 'Asistencia';
    case 'LATE_CANCEL':
      return 'Cancelación tardía';
    case 'NO_SHOW':
      return 'No show';
    case 'MANUAL_ADJUSTMENT':
      return 'Ajuste manual';
    case 'REFUND_REVERSAL':
      return 'Reversión';
    default:
      return reason;
  }
};

const resolveCreditUsageReason = (
  attendanceStatus: AdminClassAttendanceStatus
): AdminClassCreditUsageReason => {
  switch (attendanceStatus) {
    case 'ATTENDED':
      return 'ATTENDANCE';
    case 'NO_SHOW':
      return 'NO_SHOW';
    case 'CANCELLED_LATE':
      return 'LATE_CANCEL';
    default:
      return 'MANUAL_ADJUSTMENT';
  }
};

const effectiveClassPassStatus = (classPass: AdminClassPass): AdminClassPass['status'] => {
  if (classPass.status === 'CANCELLED') return 'CANCELLED';
  if (classPass.remainingCredits <= 0 || classPass.status === 'DEPLETED') return 'DEPLETED';
  if (classPass.expiresAt) {
    const expiresAt = new Date(classPass.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
      return 'EXPIRED';
    }
  }
  return 'ACTIVE';
};

const statusToneClasses = (status: AdminClassSessionStatus) => {
  switch (status) {
    case 'CONFIRMED':
      return 'border-p-positive bg-p-positive-bg text-p-positive';
    case 'COMPLETED':
      return 'border-p-accent bg-p-surface-2 text-p-accent';
    case 'CANCELLED':
      return 'border-p-error bg-p-error-bg text-[var(--error-fg)]';
    case 'DRAFT':
      return 'border-p-border bg-p-surface-2 text-p-text-muted';
    case 'SCHEDULED':
    default:
      return 'border-p-border-strong bg-p-surface text-p-text';
  }
};

const enrollmentToneClasses = (status: AdminClassEnrollmentStatus) => {
  switch (status) {
    case 'ENROLLED':
      return 'border-p-positive bg-p-positive-bg text-p-positive';
    case 'WAITLISTED':
      return 'border-p-border-strong bg-p-surface text-p-text';
    case 'CANCELLED':
    default:
      return 'border-p-error bg-p-error-bg text-[var(--error-fg)]';
  }
};

const classPassToneClasses = (status: AdminClassPass['status']) => {
  switch (status) {
    case 'ACTIVE':
      return 'border-p-positive bg-p-positive-bg text-p-positive';
    case 'DEPLETED':
      return 'border-p-border bg-p-surface-2 text-p-text-muted';
    case 'EXPIRED':
      return 'border-p-border-strong bg-p-surface text-p-text-secondary';
    case 'CANCELLED':
    default:
      return 'border-p-error bg-p-error-bg text-[var(--error-fg)]';
  }
};

type ClassPassAvailability = {
  usable: boolean;
  effectiveStatus: AdminClassPass['status'];
  disabledReason: string | null;
  reason: AdminClassCreditUsageReason;
};

const resolveClassPassAvailability = ({
  classPass,
  enrollment,
  selectedClass,
  hasUsage,
}: {
  classPass: AdminClassPass;
  enrollment: AdminClassEnrollment;
  selectedClass: AdminClassSession;
  hasUsage: boolean;
}): ClassPassAvailability => {
  const reason = resolveCreditUsageReason(enrollment.attendanceStatus);
  const effectiveStatus = effectiveClassPassStatus(classPass);

  if (hasUsage) {
    return {
      usable: false,
      effectiveStatus,
      reason,
      disabledReason: 'Ese pack ya se consumió para esta inscripción.',
    };
  }

  if (['COVERED_BY_CREDIT', 'PAID', 'REFUNDED'].includes(enrollment.paymentStatus)) {
    return {
      usable: false,
      effectiveStatus,
      reason,
      disabledReason: 'El estado de pago actual ya no admite cubrir esta inscripción con crédito.',
    };
  }

  if (effectiveStatus !== 'ACTIVE') {
    return {
      usable: false,
      effectiveStatus,
      reason,
      disabledReason: 'El pack no está disponible para consumir créditos.',
    };
  }

  if (classPass.remainingCredits < 1) {
    return {
      usable: false,
      effectiveStatus,
      reason,
      disabledReason: 'El pack no tiene saldo suficiente.',
    };
  }

  if (enrollment.enrollmentStatus === 'CANCELLED' && !['LATE_CANCEL', 'NO_SHOW'].includes(reason)) {
    return {
      usable: false,
      effectiveStatus,
      reason,
      disabledReason: 'Las inscripciones canceladas solo admiten crédito por cancelación tardía o no show.',
    };
  }

  if (!classPass.transferable && classPass.beneficiaryClientId !== enrollment.studentClientId) {
    return {
      usable: false,
      effectiveStatus,
      reason,
      disabledReason: 'Este pack solo aplica al beneficiario configurado.',
    };
  }

  if (classPass.activityTypeId && classPass.activityTypeId !== selectedClass.activityTypeId) {
    return {
      usable: false,
      effectiveStatus,
      reason,
      disabledReason: 'La actividad de la clase no coincide con la del pack.',
    };
  }

  if (classPass.classType && classPass.classType !== selectedClass.classType) {
    return {
      usable: false,
      effectiveStatus,
      reason,
      disabledReason: 'El formato de la clase no coincide con el pack.',
    };
  }

  if (classPass.teacherId && classPass.teacherId !== selectedClass.teacherId) {
    return {
      usable: false,
      effectiveStatus,
      reason,
      disabledReason: 'El pack está restringido a otro profesor.',
    };
  }

  return {
    usable: true,
    effectiveStatus,
    reason,
    disabledReason: null,
  };
};

const buildClassPassRestrictionList = (classPass: AdminClassPass) => {
  const items: string[] = [];
  if (classPass.activityType?.name) items.push(`Actividad: ${classPass.activityType.name}`);
  if (classPass.classType) items.push(`Formato: ${classTypeLabel(classPass.classType)}`);
  if (classPass.teacher?.displayName) items.push(`Profesor: ${classPass.teacher.displayName}`);
  if (classPass.expiresAt) items.push(`Vence: ${formatDateTime(classPass.expiresAt)}`);
  if (classPass.transferable) items.push('Transferible dentro del club');
  return items;
};

const personSecondaryLine = (row: { email?: string | null; phone?: string | null; dni?: string | null }) =>
  String(row.phone || '').trim() || String(row.email || '').trim() || String(row.dni || '').trim() || 'Sin datos extra';

const personBadges = (row: { badges?: string[] | null }) =>
  Array.isArray(row.badges) ? row.badges.filter(Boolean).map(String) : [];

const buildStudentCandidate = (row: PersonSearchResult): EnrollmentPersonOption => {
  if (row.kind === 'newClientSuggestion') {
    return {
      ...row,
      disabledReason: 'La creación de clientes desde clases todavía no está disponible. Usá Clientes.',
    };
  }
  if (!row.clientId) {
    return {
      ...row,
      disabledReason: 'Para inscribir necesitás un cliente del club asociado a la persona elegida.',
    };
  }
  return row;
};

const buildResponsibleCandidate = (row: PersonSearchResult): EnrollmentPersonOption => {
  if (row.kind === 'newClientSuggestion') {
    return {
      ...row,
      disabledReason: 'Primero creá el responsable como cliente del club desde Clientes.',
    };
  }
  if (!row.clientId) {
    return {
      ...row,
      disabledReason: 'El responsable de pago debe existir como cliente del club.',
    };
  }
  return row;
};

const buildStudentUserCandidate = (
  row: PersonSearchResult,
  studentClientId: string | null
): EnrollmentPersonOption => {
  if (row.kind === 'newClientSuggestion') {
    return {
      ...row,
      disabledReason: 'No se puede usar una sugerencia nueva como usuario del alumno. Resolvé esa identidad desde Clientes.',
    };
  }
  if (!row.userId) {
    return {
      ...row,
      disabledReason: 'La persona elegida no tiene usuario de app.',
    };
  }
  if (studentClientId && row.clientId && row.clientId !== studentClientId) {
    return {
      ...row,
      disabledReason: 'Ese usuario ya está asociado a otro cliente del club.',
    };
  }
  return row;
};

const buildStudentOptionFromEnrollment = (enrollment: AdminClassEnrollment): EnrollmentPersonOption => ({
  personKey: `student-client-${enrollment.studentClientId}`,
  kind: enrollment.studentUserId ? 'linked' : 'clubClient',
  clientId: enrollment.studentClientId,
  userId: enrollment.studentUserId,
  displayName: enrollment.snapshotName,
  email: enrollment.snapshotEmail,
  phone: enrollment.snapshotPhone,
  dni: null,
  badges: enrollment.studentUserId ? ['Cliente del club', 'Usuario Pique'] : ['Cliente del club'],
});

const buildResponsibleOptionFromEnrollment = (
  enrollment: AdminClassEnrollment
): EnrollmentPersonOption | null => {
  if (!enrollment.billingResponsibleClient) return null;
  return {
    personKey: `responsible-client-${enrollment.billingResponsibleClient.id}`,
    kind: 'clubClient',
    clientId: enrollment.billingResponsibleClient.id,
    userId: null,
    displayName: enrollment.billingResponsibleClient.name,
    email: null,
    phone: null,
    dni: null,
    badges: ['Cliente del club'],
  };
};

const buildStudentUserOptionFromEnrollment = (
  enrollment: AdminClassEnrollment
): EnrollmentPersonOption | null => {
  if (!enrollment.studentUser) return null;
  return {
    personKey: `student-user-${enrollment.studentUser.id}`,
    kind: enrollment.studentClientId ? 'linked' : 'systemUser',
    clientId: enrollment.studentClientId || null,
    userId: enrollment.studentUser.id,
    displayName:
      [enrollment.studentUser.firstName, enrollment.studentUser.lastName].filter(Boolean).join(' ').trim() ||
      enrollment.studentUser.email,
    email: enrollment.studentUser.email,
    phone: null,
    dni: null,
    badges: enrollment.studentClientId ? ['Usuario Pique', 'Cliente del club'] : ['Usuario Pique'],
  };
};

const enrollmentActiveCount = (rows: AdminClassEnrollment[]) =>
  rows.filter((row) => row.enrollmentStatus === 'ENROLLED').length;

const enrollmentWaitlistCount = (rows: AdminClassEnrollment[]) =>
  rows.filter((row) => row.enrollmentStatus === 'WAITLISTED').length;

const enrollmentCancelledCount = (rows: AdminClassEnrollment[]) =>
  rows.filter((row) => row.enrollmentStatus === 'CANCELLED').length;

const translateEnrollmentError = (error: unknown, fallback: string) => {
  const normalized = normalizeApiError(error, fallback);
  switch (normalized.code) {
    case 'CLASS_SESSION_ENROLLMENT_CONFLICT':
      return 'Este alumno ya está inscripto en la clase.';
    case 'CLASS_SESSION_CAPACITY_EXCEEDED':
      return 'La clase ya no tiene cupo disponible.';
    case 'CLIENT_LINK_CONFLICT':
      return 'La identidad elegida para el alumno entra en conflicto con un vínculo existente. Revisá cliente y usuario.';
    case 'FORBIDDEN':
      return 'La persona seleccionada no pertenece a este club.';
    case 'CLIENT_NOT_FOUND':
      return 'El alumno o responsable seleccionado ya no pertenece a este club.';
    case 'USER_NOT_FOUND':
      return 'El usuario seleccionado ya no está disponible.';
    case 'INVALID_INPUT':
      return extractErrorMessage(normalized, 'La asistencia elegida no es válida para esta inscripción.');
    default:
      return extractErrorMessage(normalized, fallback);
  }
};

const translateClassPassError = (error: unknown, fallback: string) => {
  const normalized = normalizeApiError(error, fallback);
  switch (normalized.code) {
    case 'CLASS_PASS_INSUFFICIENT_CREDITS':
      return 'El pack ya no tiene saldo suficiente.';
    case 'CLASS_PASS_INVALID_STATUS':
      return 'El pack ya no está disponible para consumir créditos.';
    case 'CLASS_PASS_ENROLLMENT_MISMATCH':
      return 'Ese pack no aplica a esta clase o a este alumno.';
    case 'CLASS_CREDIT_USAGE_CONFLICT':
      return 'Ese crédito ya fue consumido o cambió mientras lo estabas registrando.';
    case 'CLASS_PASS_NOT_FOUND':
      return 'El pack elegido ya no está disponible.';
    case 'INVALID_INPUT':
      return extractErrorMessage(normalized, 'No se pudo consumir el crédito de la tarjetita.');
    default:
      return extractErrorMessage(normalized, fallback);
  }
};

const translateCreateClassPassError = (error: unknown, fallback: string) => {
  const normalized = normalizeApiError(error, fallback);
  switch (normalized.code) {
    case 'CLIENT_NOT_FOUND':
      return 'El titular o beneficiario seleccionado ya no pertenece a este club.';
    case 'USER_NOT_FOUND':
      return 'La referencia de usuario del pack ya no está disponible.';
    case 'FORBIDDEN':
      return 'No se pudo asignar el pack con los datos actuales del club.';
    case 'INVALID_INPUT':
      return extractErrorMessage(normalized, 'Revisá los datos del pack antes de guardarlo.');
    default:
      return extractErrorMessage(normalized, fallback);
  }
};

function usePersonSearchResults(
  clubSlug: string,
  query: string,
  transform: (row: PersonSearchResult) => EnrollmentPersonOption
) {
  const [results, setResults] = useState<EnrollmentPersonOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const safeQuery = String(query || '').trim();
    if (!clubSlug || safeQuery.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        const rows = await ClubAdminService.searchPeople(clubSlug, safeQuery);
        if (cancelled) return;
        setResults((Array.isArray(rows) ? rows : []).slice(0, 8).map(transform));
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [clubSlug, query, transform]);

  return { results, loading };
}

export default function AdminClassesPage() {
  return (
    <AdminRouteShell title="Academia | Pique Admin" activeItem="Academia" fromPath="/admin/academia">
      {(user) => <AdminClassesPageContent user={user} />}
    </AdminRouteShell>
  );
}

export function AdminClassesPageContent({ user, embedded = false }: { user: any; embedded?: boolean }) {
  const normalizedUser = useMemo(() => normalizeSessionUser(user || null), [user]);
  const clubSlug = useMemo(() => getActiveClubSlug(normalizedUser), [normalizedUser]);

  const [classSessions, setClassSessions] = useState<AdminClassSession[]>([]);
  const [teachers, setTeachers] = useState<AdminTeacher[]>([]);
  const [courts, setCourts] = useState<CourtOption[]>([]);
  const [activityTypes, setActivityTypes] = useState<ClubActivityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ClassStatusFilter>('all');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [form, setForm] = useState<ClassFormState>(() => buildEmptyClassForm());
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [enrollments, setEnrollments] = useState<AdminClassEnrollment[]>([]);
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(false);
  const [enrollmentsError, setEnrollmentsError] = useState('');
  const [enrollmentFilter, setEnrollmentFilter] = useState<EnrollmentFilter>('active');
  const [enrollmentModalOpen, setEnrollmentModalOpen] = useState(false);
  const [editingEnrollmentId, setEditingEnrollmentId] = useState<string | null>(null);
  const [enrollmentForm, setEnrollmentForm] = useState<EnrollmentFormState>(() => buildEmptyEnrollmentForm());
  const [enrollmentFormError, setEnrollmentFormError] = useState('');
  const [enrollmentFieldErrors, setEnrollmentFieldErrors] = useState<Record<string, string>>({});
  const [enrollmentSubmitting, setEnrollmentSubmitting] = useState(false);
  const [enrollmentStatusBusyId, setEnrollmentStatusBusyId] = useState<string | null>(null);
  const [classPassesByStudent, setClassPassesByStudent] = useState<Record<string, AdminClassPass[]>>({});
  const [classPassesLoading, setClassPassesLoading] = useState(false);
  const [classPassesError, setClassPassesError] = useState('');
  const [creditUsagesByEnrollment, setCreditUsagesByEnrollment] = useState<Record<string, AdminClassCreditUsage[]>>({});
  const [creditUsageLoading, setCreditUsageLoading] = useState(false);
  const [creditUsageError, setCreditUsageError] = useState('');
  const [creditUsageBusyPassId, setCreditUsageBusyPassId] = useState<string | null>(null);
  const [creditUsageConfirmState, setCreditUsageConfirmState] = useState<{
    classPass: AdminClassPass;
    enrollment: AdminClassEnrollment;
    reason: AdminClassCreditUsageReason;
  } | null>(null);
  const [classPassDrawerOpen, setClassPassDrawerOpen] = useState(false);
  const [classPassForm, setClassPassForm] = useState<ClassPassFormState | null>(null);
  const [classPassFormError, setClassPassFormError] = useState('');
  const [classPassFieldErrors, setClassPassFieldErrors] = useState<Record<string, string>>({});
  const [classPassSubmitting, setClassPassSubmitting] = useState(false);

  const loadClassSessions = useCallback(async () => {
    if (!clubSlug) {
      setClassSessions([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const rows = await ClubAdminService.getClassSessions(clubSlug);
      setClassSessions(rows);
    } catch (error) {
      reportUiError({ area: 'AdminClassesPage', action: 'loadClassSessions' }, error);
      setFeedback({ tone: 'error', message: extractErrorMessage(error, 'No se pudieron cargar las clases.') });
    } finally {
      setLoading(false);
    }
  }, [clubSlug]);

  const loadOptions = useCallback(async () => {
    if (!clubSlug) {
      setTeachers([]);
      setCourts([]);
      setActivityTypes([]);
      setOptionsLoading(false);
      return;
    }

    try {
      setOptionsLoading(true);
      const [teacherRows, courtRows, activityRows] = await Promise.all([
        ClubAdminService.getTeachers(clubSlug, true),
        ClubAdminService.getCourts(clubSlug),
        ClubAdminService.getActivityTypes(clubSlug),
      ]);
      setTeachers(teacherRows);
      setCourts(
        (Array.isArray(courtRows) ? courtRows : []).map((court: any) => ({
          id: Number(court?.id),
          name: String(court?.name || `Cancha ${court?.id}`),
        }))
      );
      setActivityTypes(Array.isArray(activityRows) ? activityRows : []);
    } catch (error) {
      reportUiError({ area: 'AdminClassesPage', action: 'loadOptions' }, error);
      setFeedback({
        tone: 'error',
        message: extractErrorMessage(error, 'No se pudieron cargar profesores, canchas o actividades.'),
      });
    } finally {
      setOptionsLoading(false);
    }
  }, [clubSlug]);

  const loadEnrollments = useCallback(
    async (classSessionId: string) => {
      if (!clubSlug) return;
      try {
        setEnrollmentsLoading(true);
        setEnrollmentsError('');
        const rows = await ClubAdminService.getClassEnrollments(clubSlug, classSessionId);
        setEnrollments(rows);
      } catch (error) {
        reportUiError({ area: 'AdminClassesPage', action: 'loadEnrollments' }, error);
        setEnrollments([]);
        setEnrollmentsError(translateEnrollmentError(error, 'No se pudieron cargar los alumnos de la clase.'));
      } finally {
        setEnrollmentsLoading(false);
      }
    },
    [clubSlug]
  );

  const loadClassPassesForStudents = useCallback(
    async (studentClientIds: string[], mode: 'replace' | 'merge' = 'replace') => {
      if (!clubSlug) {
        if (mode === 'replace') setClassPassesByStudent({});
        setClassPassesLoading(false);
        return;
      }

      const uniqueStudentIds = Array.from(
        new Set(studentClientIds.map((value) => String(value || '').trim()).filter(Boolean))
      );

      if (!uniqueStudentIds.length) {
        if (mode === 'replace') setClassPassesByStudent({});
        setClassPassesLoading(false);
        setClassPassesError('');
        return;
      }

      try {
        setClassPassesLoading(true);
        setClassPassesError('');
        const pairs = await Promise.all(
          uniqueStudentIds.map(async (studentClientId) => {
            const rows = await ClubAdminService.getClassPasses(clubSlug, {
              beneficiaryClientId: studentClientId,
              status: 'ACTIVE',
            });
            return [studentClientId, rows] as const;
          })
        );

        const nextMap = Object.fromEntries(pairs) as Record<string, AdminClassPass[]>;
        setClassPassesByStudent((prev) => (mode === 'merge' ? { ...prev, ...nextMap } : nextMap));
      } catch (error) {
        reportUiError({ area: 'AdminClassesPage', action: 'loadClassPassesForStudents' }, error);
        if (mode === 'replace') setClassPassesByStudent({});
        setClassPassesError(
          translateClassPassError(error, 'No se pudieron cargar los packs de clases del alumno.')
        );
      } finally {
        setClassPassesLoading(false);
      }
    },
    [clubSlug]
  );

  const loadEnrollmentCreditUsages = useCallback(
    async (enrollmentId: string) => {
      if (!clubSlug) return;
      try {
        setCreditUsageLoading(true);
        setCreditUsageError('');
        const rows = await ClubAdminService.getEnrollmentCreditUsages(clubSlug, enrollmentId);
        setCreditUsagesByEnrollment((prev) => ({ ...prev, [enrollmentId]: rows }));
      } catch (error) {
        reportUiError({ area: 'AdminClassesPage', action: 'loadEnrollmentCreditUsages' }, error);
        setCreditUsagesByEnrollment((prev) => ({ ...prev, [enrollmentId]: [] }));
        setCreditUsageError(
          translateClassPassError(error, 'No se pudieron cargar los consumos de crédito de esta inscripción.')
        );
      } finally {
        setCreditUsageLoading(false);
      }
    },
    [clubSlug]
  );

  useEffect(() => {
    void loadClassSessions();
    void loadOptions();
  }, [loadClassSessions, loadOptions]);

  useEffect(() => {
    if (!selectedClassId) {
      setEnrollments([]);
      setEnrollmentsError('');
      setEnrollmentsLoading(false);
      setClassPassesByStudent({});
      setClassPassesError('');
      setClassPassesLoading(false);
      setCreditUsagesByEnrollment({});
      setCreditUsageError('');
      setCreditUsageLoading(false);
      return;
    }
    void loadEnrollments(selectedClassId);
  }, [loadEnrollments, selectedClassId]);

  useEffect(() => {
    if (!selectedClassId) return;
    void loadClassPassesForStudents(enrollments.map((row) => row.studentClientId), 'replace');
  }, [enrollments, loadClassPassesForStudents, selectedClassId]);

  const summary = useMemo(() => {
    const activeCount = classSessions.filter((row) => ['DRAFT', 'SCHEDULED', 'CONFIRMED'].includes(row.status)).length;
    const publicCount = classSessions.filter((row) => row.visibility === 'PUBLIC').length;
    const cancelled = classSessions.filter((row) => row.status === 'CANCELLED').length;
    return {
      total: classSessions.length,
      activeCount,
      publicCount,
      cancelled,
    };
  }, [classSessions]);

  const filteredClasses = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return classSessions.filter((classSession) => {
      if (statusFilter === 'active' && !['DRAFT', 'SCHEDULED', 'CONFIRMED'].includes(classSession.status)) return false;
      if (statusFilter === 'completed' && classSession.status !== 'COMPLETED') return false;
      if (statusFilter === 'cancelled' && classSession.status !== 'CANCELLED') return false;
      if (!term) return true;
      const haystack = [
        classSession.teacher?.displayName || '',
        classSession.court?.name || '',
        classSession.activityType?.name || '',
        classSession.level || '',
        classSession.description || '',
        visibilityLabel(classSession.visibility),
        classTypeLabel(classSession.classType),
        statusLabel(classSession.status),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [classSessions, searchTerm, statusFilter]);

  const selectedClass = useMemo(
    () => classSessions.find((row) => row.id === selectedClassId) || null,
    [classSessions, selectedClassId]
  );

  useEffect(() => {
    if (!selectedClassId) return;
    if (!classSessions.some((row) => row.id === selectedClassId)) {
      setSelectedClassId(null);
      setEnrollments([]);
    }
  }, [classSessions, selectedClassId]);

  const filteredEnrollments = useMemo(() => {
    if (enrollmentFilter === 'cancelled') {
      return enrollments.filter((row) => row.enrollmentStatus === 'CANCELLED');
    }
    if (enrollmentFilter === 'active') {
      return enrollments.filter((row) => row.enrollmentStatus !== 'CANCELLED');
    }
    return enrollments;
  }, [enrollmentFilter, enrollments]);

  const editingEnrollment = useMemo(
    () => enrollments.find((row) => row.id === editingEnrollmentId) || null,
    [editingEnrollmentId, enrollments]
  );

  const editingEnrollmentCreditUsages = useMemo(
    () => (editingEnrollmentId ? creditUsagesByEnrollment[editingEnrollmentId] || [] : []),
    [creditUsagesByEnrollment, editingEnrollmentId]
  );

  useEffect(() => {
    if (!editingEnrollmentId || !enrollmentModalOpen) return;
    void loadEnrollmentCreditUsages(editingEnrollmentId);
  }, [editingEnrollmentId, enrollmentModalOpen, loadEnrollmentCreditUsages]);

  const resetClassForm = useCallback(() => {
    setForm(buildEmptyClassForm());
    setFormError('');
    setFieldErrors({});
    setEditingClassId(null);
  }, []);

  const resetEnrollmentForm = useCallback(() => {
    setEnrollmentForm(buildEmptyEnrollmentForm());
    setEnrollmentFormError('');
    setEnrollmentFieldErrors({});
    setEditingEnrollmentId(null);
    setCreditUsageError('');
    setCreditUsageConfirmState(null);
    setClassPassDrawerOpen(false);
    setClassPassForm(null);
    setClassPassFormError('');
    setClassPassFieldErrors({});
  }, []);

  const openCreateModal = useCallback(() => {
    resetClassForm();
    setModalOpen(true);
  }, [resetClassForm]);

  const openEditModal = useCallback(
    async (classSessionId: string) => {
      if (!clubSlug) return;
      try {
        setSubmitting(true);
        setFormError('');
        setFieldErrors({});
        const classSession = await ClubAdminService.getClassSession(clubSlug, classSessionId);
        setEditingClassId(classSession.id);
        setForm({
          teacherId: classSession.teacherId,
          visibility: classSession.visibility,
          classType: classSession.classType,
          activityTypeId: classSession.activityTypeId ? String(classSession.activityTypeId) : '',
          courtId: classSession.courtId ? String(classSession.courtId) : '',
          startsAt: toLocalDateTimeInputValue(classSession.startsAt),
          endsAt: toLocalDateTimeInputValue(classSession.endsAt),
          capacity: String(classSession.capacity || ''),
          pricePerStudent: classSession.pricePerStudent == null ? '' : String(classSession.pricePerStudent),
          status: classSession.status,
          level: classSession.level || '',
          description: classSession.description || '',
          requiresApproval: Boolean(classSession.requiresApproval),
          requiresPaymentToEnroll: Boolean(classSession.requiresPaymentToEnroll),
        });
        setModalOpen(true);
      } catch (error) {
        reportUiError({ area: 'AdminClassesPage', action: 'openEditModal' }, error);
        setFeedback({ tone: 'error', message: extractErrorMessage(error, 'No se pudo cargar la clase.') });
      } finally {
        setSubmitting(false);
      }
    },
    [clubSlug]
  );

  const closeModal = useCallback(() => {
    if (submitting) return;
    setModalOpen(false);
    resetClassForm();
  }, [resetClassForm, submitting]);

  const closeModalImmediately = useCallback(() => {
    setModalOpen(false);
    resetClassForm();
  }, [resetClassForm]);

  const updateClassType = useCallback((nextType: AdminClassSessionType) => {
    setForm((prev) => ({
      ...prev,
      classType: nextType,
      capacity: nextType === 'INDIVIDUAL' ? '1' : prev.capacity === '1' || !prev.capacity ? '2' : prev.capacity,
    }));
  }, []);

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!clubSlug || submitting) return;

    const durationMinutes = durationFromForm(form);
    const capacity = Number(form.capacity);
    const parsedPrice = parseOptionalPositiveNumber(form.pricePerStudent);

    if (!form.teacherId) {
      setFormError('Seleccioná un profesor para la clase.');
      setFieldErrors({ teacherId: 'Elegí un profesor.' });
      return;
    }

    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setFormError('Revisá el horario: la clase debe terminar después de empezar.');
      return;
    }

    if (!Number.isInteger(capacity) || capacity <= 0) {
      setFormError('Ingresá una capacidad válida.');
      return;
    }

    if (form.classType === 'INDIVIDUAL' && capacity !== 1) {
      setFormError('Las clases individuales usan capacidad 1.');
      return;
    }

    if (form.classType === 'GROUP' && capacity < 2) {
      setFormError('Las clases grupales necesitan capacidad mayor a 1.');
      return;
    }

    if (Number.isNaN(parsedPrice)) {
      setFormError('Ingresá un precio válido por alumno.');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');
      setFieldErrors({});

      const payload = {
        teacherId: form.teacherId,
        visibility: form.visibility,
        classType: form.classType,
        activityTypeId: form.activityTypeId ? Number(form.activityTypeId) : null,
        courtId: form.courtId ? Number(form.courtId) : null,
        startsAt: localInputToIso(form.startsAt),
        endsAt: localInputToIso(form.endsAt),
        durationMinutes,
        capacity,
        pricePerStudent: parsedPrice,
        status: form.status,
        level: normalizeOptionalText(form.level),
        description: normalizeOptionalText(form.description),
        requiresApproval: form.requiresApproval,
        requiresPaymentToEnroll: form.requiresPaymentToEnroll,
      };

      if (editingClassId) {
        await ClubAdminService.updateClassSession(clubSlug, editingClassId, payload);
        showAdminToast('Clase actualizada.');
      } else {
        await ClubAdminService.createClassSession(clubSlug, payload);
        showAdminToast('Clase creada.');
      }

      closeModalImmediately();
      await loadClassSessions();
      setFeedback(null);
    } catch (error) {
      reportUiError({ area: 'AdminClassesPage', action: 'submitForm' }, error);
      setFieldErrors(getApiFieldErrors(error));
      setFormError(extractErrorMessage(error, 'No se pudo guardar la clase.'));
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = useCallback(
    async (classSession: AdminClassSession, nextStatus: AdminClassSessionStatus) => {
      if (!clubSlug || statusBusyId) return;
      try {
        setStatusBusyId(classSession.id);
        await ClubAdminService.setClassSessionStatus(clubSlug, classSession.id, nextStatus);
        await loadClassSessions();
        showAdminToast(nextStatus === 'CANCELLED' ? 'Clase cancelada.' : 'Estado actualizado.');
      } catch (error) {
        reportUiError({ area: 'AdminClassesPage', action: 'updateStatus' }, error);
        setFeedback({ tone: 'error', message: extractErrorMessage(error, 'No se pudo actualizar el estado de la clase.') });
      } finally {
        setStatusBusyId(null);
      }
    },
    [clubSlug, loadClassSessions, statusBusyId]
  );

  const openEnrollmentCreateModal = useCallback(() => {
    resetEnrollmentForm();
    setEnrollmentModalOpen(true);
  }, [resetEnrollmentForm]);

  const openEnrollmentEditModal = useCallback((enrollment: AdminClassEnrollment) => {
    setEditingEnrollmentId(enrollment.id);
    setEnrollmentForm({
      selectedStudent: buildStudentOptionFromEnrollment(enrollment),
      studentQuery: '',
      selectedStudentUser: buildStudentUserOptionFromEnrollment(enrollment),
      studentUserQuery: '',
      selectedResponsible: buildResponsibleOptionFromEnrollment(enrollment),
      responsibleQuery: '',
      attendanceStatus: enrollment.attendanceStatus,
      initialAttendanceStatus: enrollment.attendanceStatus,
      notes: enrollment.notes || '',
    });
    setEnrollmentFormError('');
    setEnrollmentFieldErrors({});
    setCreditUsageError('');
    setEnrollmentModalOpen(true);
  }, []);

  const closeEnrollmentModal = useCallback(() => {
    if (enrollmentSubmitting) return;
    setEnrollmentModalOpen(false);
    resetEnrollmentForm();
  }, [enrollmentSubmitting, resetEnrollmentForm]);

  const closeEnrollmentModalImmediately = useCallback(() => {
    setEnrollmentModalOpen(false);
    resetEnrollmentForm();
  }, [resetEnrollmentForm]);

  const openClassPassDrawer = useCallback(() => {
    if (!editingEnrollment || !selectedClass) return;
    setClassPassForm(buildDefaultClassPassForm({ enrollment: editingEnrollment, selectedClass }));
    setClassPassFormError('');
    setClassPassFieldErrors({});
    setClassPassDrawerOpen(true);
  }, [editingEnrollment, selectedClass]);

  const closeClassPassDrawer = useCallback(() => {
    if (classPassSubmitting) return;
    setClassPassDrawerOpen(false);
    setClassPassForm(null);
    setClassPassFormError('');
    setClassPassFieldErrors({});
  }, [classPassSubmitting]);

  const studentSearch = usePersonSearchResults(
    clubSlug || '',
    enrollmentForm.studentQuery,
    buildStudentCandidate
  );

  const responsibleSearch = usePersonSearchResults(
    clubSlug || '',
    enrollmentForm.responsibleQuery,
    buildResponsibleCandidate
  );

  const currentStudentClientId = enrollmentForm.selectedStudent?.clientId || null;
  const studentUserSearchTransform = useCallback(
    (row: PersonSearchResult) => buildStudentUserCandidate(row, currentStudentClientId),
    [currentStudentClientId]
  );
  const studentUserSearch = usePersonSearchResults(
    clubSlug || '',
    enrollmentForm.studentUserQuery,
    studentUserSearchTransform
  );

  const submitEnrollmentForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!clubSlug || !selectedClass || enrollmentSubmitting) return;

    if (!enrollmentForm.selectedStudent?.clientId) {
      setEnrollmentFormError('Seleccioná un alumno explícitamente desde PersonSearch.');
      setEnrollmentFieldErrors({ studentClientId: 'Elegí un alumno del club.' });
      return;
    }

    try {
      setEnrollmentSubmitting(true);
      setEnrollmentFormError('');
      setEnrollmentFieldErrors({});

      if (editingEnrollmentId) {
        await ClubAdminService.updateClassEnrollment(clubSlug, selectedClass.id, editingEnrollmentId, {
          studentUserId: enrollmentForm.selectedStudentUser?.userId ?? null,
          billingResponsibleClientId: enrollmentForm.selectedResponsible?.clientId ?? null,
          notes: normalizeOptionalText(enrollmentForm.notes),
        });
        if (enrollmentForm.attendanceStatus !== enrollmentForm.initialAttendanceStatus) {
          await ClubAdminService.setClassEnrollmentAttendance(clubSlug, selectedClass.id, editingEnrollmentId, {
            attendanceStatus: enrollmentForm.attendanceStatus,
          });
        }
        showAdminToast('Inscripción actualizada.');
      } else {
        await ClubAdminService.createClassEnrollment(clubSlug, selectedClass.id, {
          studentClientId: enrollmentForm.selectedStudent.clientId,
          studentUserId: enrollmentForm.selectedStudentUser?.userId ?? enrollmentForm.selectedStudent.userId ?? null,
          billingResponsibleClientId: enrollmentForm.selectedResponsible?.clientId ?? null,
          notes: normalizeOptionalText(enrollmentForm.notes),
        });
        showAdminToast('Alumno agregado a la clase.');
      }

      closeEnrollmentModalImmediately();
      await loadEnrollments(selectedClass.id);
      setFeedback(null);
    } catch (error) {
      reportUiError({ area: 'AdminClassesPage', action: 'submitEnrollmentForm' }, error);
      setEnrollmentFieldErrors(getApiFieldErrors(error));
      setEnrollmentFormError(translateEnrollmentError(error, 'No se pudo guardar la inscripción.'));
    } finally {
      setEnrollmentSubmitting(false);
    }
  };

  const cancelEnrollment = useCallback(
    async (enrollment: AdminClassEnrollment) => {
      if (!clubSlug || !selectedClass || enrollmentStatusBusyId) return;
      try {
        setEnrollmentStatusBusyId(enrollment.id);
        await ClubAdminService.cancelClassEnrollment(clubSlug, selectedClass.id, enrollment.id);
        await loadEnrollments(selectedClass.id);
        showAdminToast('Inscripción cancelada.');
      } catch (error) {
        reportUiError({ area: 'AdminClassesPage', action: 'cancelEnrollment' }, error);
        setFeedback({
          tone: 'error',
          message: translateEnrollmentError(error, 'No se pudo cancelar la inscripción.'),
        });
      } finally {
        setEnrollmentStatusBusyId(null);
      }
    },
    [clubSlug, enrollmentStatusBusyId, loadEnrollments, selectedClass]
  );

  const consumeClassPassCredit = useCallback(async () => {
    if (!clubSlug || !selectedClass || !creditUsageConfirmState || creditUsageBusyPassId) return;

    const { classPass, enrollment, reason } = creditUsageConfirmState;
    try {
      setCreditUsageBusyPassId(classPass.id);
      await ClubAdminService.createClassPassUsage(clubSlug, classPass.id, {
        classEnrollmentId: enrollment.id,
        creditsUsed: 1,
        reason,
      });

      showAdminToast('Crédito consumido.');
      setCreditUsageConfirmState(null);
      await loadEnrollments(selectedClass.id);
      await Promise.all([
        loadClassPassesForStudents([enrollment.studentClientId], 'merge'),
        loadEnrollmentCreditUsages(enrollment.id),
      ]);
      setFeedback(null);
    } catch (error) {
      reportUiError({ area: 'AdminClassesPage', action: 'consumeClassPassCredit' }, error);
      const message = translateClassPassError(error, 'No se pudo consumir el crédito de la tarjetita.');
      setCreditUsageError(message);
      setEnrollmentFormError(message);
    } finally {
      setCreditUsageBusyPassId(null);
    }
  }, [
    clubSlug,
    creditUsageBusyPassId,
    creditUsageConfirmState,
    loadClassPassesForStudents,
    loadEnrollmentCreditUsages,
    loadEnrollments,
    selectedClass,
  ]);

  const submitClassPassForm = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!clubSlug || !selectedClass || !editingEnrollment || !classPassForm || classPassSubmitting) return;

      const totalCredits = Number(classPassForm.totalCredits);
      if (!classPassForm.packageName.trim()) {
        setClassPassFormError('Ingresá un nombre para el pack.');
        setClassPassFieldErrors({ packageName: 'Elegí un nombre.' });
        return;
      }
      if (!Number.isInteger(totalCredits) || totalCredits <= 0) {
        setClassPassFormError('La cantidad de créditos debe ser un entero mayor a 0.');
        setClassPassFieldErrors({ totalCredits: 'Ingresá créditos válidos.' });
        return;
      }

      try {
        setClassPassSubmitting(true);
        setClassPassFormError('');
        setClassPassFieldErrors({});

        await ClubAdminService.createClassPass(clubSlug, {
          ownerClientId: classPassForm.ownerClientId,
          beneficiaryClientId: classPassForm.beneficiaryClientId,
          beneficiaryUserId: editingEnrollment.studentUserId ?? null,
          packageName: classPassForm.packageName.trim(),
          totalCredits,
          expiresAt: classPassForm.expiresAt ? localInputToIso(classPassForm.expiresAt) : null,
          activityTypeId: classPassForm.restrictToActivity ? selectedClass.activityTypeId : null,
          classType: classPassForm.restrictToClassType ? selectedClass.classType : null,
          teacherId: classPassForm.restrictToTeacher ? selectedClass.teacherId : null,
          transferable: classPassForm.transferable,
          notes: normalizeOptionalText(classPassForm.notes),
        });

        showAdminToast('Pack asignado.');
        await loadClassPassesForStudents([editingEnrollment.studentClientId], 'merge');
        setClassPassDrawerOpen(false);
        setClassPassForm(null);
        setClassPassFormError('');
        setClassPassFieldErrors({});
        setFeedback(null);
      } catch (error) {
        reportUiError({ area: 'AdminClassesPage', action: 'submitClassPassForm' }, error);
        setClassPassFieldErrors(getApiFieldErrors(error));
        setClassPassFormError(
          translateCreateClassPassError(error, 'No se pudo asignar la tarjetita digital al alumno.')
        );
      } finally {
        setClassPassSubmitting(false);
      }
    },
    [
      classPassForm,
      classPassSubmitting,
      clubSlug,
      editingEnrollment,
      loadClassPassesForStudents,
      selectedClass,
    ]
  );

  const attendanceOptions = useMemo(
    () =>
      editingEnrollmentId && enrollmentForm.attendanceStatus.startsWith('CANCELLED')
        ? CANCELLED_ATTENDANCE_OPTIONS
        : ACTIVE_ATTENDANCE_OPTIONS,
    [editingEnrollmentId, enrollmentForm.attendanceStatus]
  );

  const compatiblePassSummary = useCallback(
    (enrollment: AdminClassEnrollment) => {
      if (!selectedClass) {
        return { label: 'Sin contexto de clase', muted: true };
      }

      if (enrollment.paymentStatus === 'COVERED_BY_CREDIT') {
        return { label: 'Cubierto por crédito', muted: false };
      }

      if (['PAID', 'REFUNDED'].includes(enrollment.paymentStatus)) {
        return { label: 'No aplica por estado de pago', muted: true };
      }

      const passes = classPassesByStudent[enrollment.studentClientId] || [];
      if (!passes.length) {
        return { label: classPassesLoading ? 'Cargando packs...' : 'Sin packs activos', muted: true };
      }

      const usablePasses = passes.filter((classPass) =>
        resolveClassPassAvailability({
          classPass,
          enrollment,
          selectedClass,
          hasUsage: false,
        }).usable
      );

      if (!usablePasses.length) {
        return { label: 'Sin packs compatibles', muted: true };
      }

      const availableCredits = usablePasses.reduce((total, classPass) => total + Number(classPass.remainingCredits || 0), 0);
      return {
        label: `${usablePasses.length} pack${usablePasses.length === 1 ? '' : 's'} · ${availableCredits} crédito${availableCredits === 1 ? '' : 's'}`,
        muted: false,
      };
    },
    [classPassesByStudent, classPassesLoading, selectedClass]
  );

  const classColumns = useMemo<AdminDataTableColumn<AdminClassSession>[]>(
    () => [
      {
        key: 'session',
        label: 'Clase',
        render: (classSession) => (
          <div className="min-w-0">
            <p className="truncate font-semibold text-p-text">{classSession.teacher?.displayName || 'Profesor sin referencia'}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-p-text-muted">
              <span className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${statusToneClasses(classSession.status)}`}>
                {statusLabel(classSession.status)}
              </span>
              <span className="inline-flex rounded-full border border-p-border bg-p-surface-2 px-2 py-0.5 font-semibold text-p-text-secondary">
                Visibilidad: {visibilityLabel(classSession.visibility)}
              </span>
              <span className="inline-flex rounded-full border border-p-border bg-p-surface-2 px-2 py-0.5 font-semibold text-p-text-secondary">
                Formato: {classTypeLabel(classSession.classType)}
              </span>
            </div>
          </div>
        ),
      },
      {
        key: 'schedule',
        label: 'Horario',
        width: 'w-[220px]',
        render: (classSession) => (
          <div className="text-[12px] text-p-text-secondary">
            <p>{formatDateRange(classSession.startsAt, classSession.endsAt)}</p>
            <p className="mt-0.5 text-p-text-muted">{classSession.durationMinutes} min</p>
          </div>
        ),
      },
      {
        key: 'resources',
        label: 'Profesor / recursos',
        render: (classSession) => (
          <div className="text-[12px] text-p-text-secondary">
            <p>{classSession.court?.name || 'Sin cancha asignada'}</p>
            <p className="mt-0.5 text-p-text-muted">{classSession.activityType?.name || 'Sin actividad específica'}</p>
          </div>
        ),
      },
      {
        key: 'capacity',
        label: 'Cupo',
        width: 'w-[90px]',
        render: (classSession) => (
          <div className="text-[12px] text-p-text-secondary">
            <p className="font-semibold text-p-text">{classSession.capacity}</p>
            <p className="mt-0.5 text-p-text-muted">{classTypeLabel(classSession.classType)}</p>
          </div>
        ),
      },
      {
        key: 'price',
        label: 'Precio',
        width: 'w-[130px]',
        render: (classSession) => <span className="text-[12px] text-p-text-secondary">{formatCurrency(classSession.pricePerStudent)}</span>,
      },
      {
        key: 'updatedAt',
        label: 'Actualizado',
        width: 'w-[170px]',
        render: (classSession) => <span className="text-[12px] text-p-text-muted">{formatDateTime(classSession.updatedAt)}</span>,
      },
      {
        key: 'actions',
        label: '',
        align: 'right',
        isActions: true,
        width: 'w-[250px]',
        render: (classSession) => (
          <div className="flex items-center justify-end gap-2 opacity-100">
            <button
              type="button"
              onClick={() => setSelectedClassId(classSession.id)}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-p-border bg-p-surface px-2.5 text-[11px] font-semibold text-p-text-muted transition hover:border-p-border-strong hover:text-p-text"
            >
              <Users size={13} />
              Gestionar
            </button>
            <button
              type="button"
              onClick={() => void openEditModal(classSession.id)}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-p-border bg-p-surface px-2.5 text-[11px] font-semibold text-p-text-muted transition hover:border-p-border-strong hover:text-p-text"
            >
              <Pencil size={13} />
              Editar
            </button>
            <button
              type="button"
              onClick={() => void updateStatus(classSession, 'CANCELLED')}
              disabled={statusBusyId === classSession.id || classSession.status === 'CANCELLED'}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-p-error bg-p-error-bg px-2.5 text-[11px] font-semibold text-[var(--error-fg)] transition hover:bg-[var(--error-fg)] hover:text-ink-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <XCircle size={13} />
              Cancelar
            </button>
          </div>
        ),
      },
    ],
    [openEditModal, statusBusyId, updateStatus]
  );

  const enrollmentColumns = useMemo<AdminDataTableColumn<AdminClassEnrollment>[]>(
    () => [
      {
        key: 'student',
        label: 'Alumno',
        render: (enrollment) => (
          <div className="min-w-0">
            <p className="truncate font-semibold text-p-text">{enrollment.snapshotName}</p>
            <p className="mt-0.5 text-[12px] text-p-text-muted">{personSecondaryLine({ email: enrollment.snapshotEmail, phone: enrollment.snapshotPhone })}</p>
          </div>
        ),
      },
      {
        key: 'responsible',
        label: 'Responsable',
        render: (enrollment) => (
          <div className="text-[12px] text-p-text-secondary">
            <p>{enrollment.billingResponsibleClient?.name || 'Sin responsable cargado'}</p>
            <p className="mt-0.5 text-p-text-muted">
              {enrollment.studentUser
                ? `Usuario del alumno: ${
                    [enrollment.studentUser.firstName, enrollment.studentUser.lastName]
                      .filter(Boolean)
                      .join(' ')
                      .trim() || enrollment.studentUser.email
                  }`
                : 'Alumno sin usuario de app explícito'}
            </p>
          </div>
        ),
      },
      {
        key: 'statuses',
        label: 'Estados',
        render: (enrollment) => (
          <div className="flex flex-wrap gap-1">
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${enrollmentToneClasses(enrollment.enrollmentStatus)}`}>
              {enrollmentStatusLabel(enrollment.enrollmentStatus)}
            </span>
            <span className="inline-flex rounded-full border border-p-border bg-p-surface-2 px-2 py-0.5 text-[11px] font-semibold text-p-text-secondary">
              {attendanceStatusLabel(enrollment.attendanceStatus)}
            </span>
            <span className="inline-flex rounded-full border border-p-border bg-p-surface-2 px-2 py-0.5 text-[11px] font-semibold text-p-text-secondary">
              {paymentStatusLabel(enrollment.paymentStatus)}
            </span>
          </div>
        ),
      },
      {
        key: 'price',
        label: 'Precio',
        width: 'w-[120px]',
        render: (enrollment) => <span className="text-[12px] text-p-text-secondary">{formatCurrency(enrollment.priceAtEnrollment)}</span>,
      },
      {
        key: 'credits',
        label: 'Créditos',
        width: 'w-[170px]',
        render: (enrollment) => {
          const summary = compatiblePassSummary(enrollment);
          return (
            <div className="text-[12px] text-p-text-secondary">
              <p className={summary.muted ? 'text-p-text-muted' : 'font-medium text-p-text'}>
                {summary.label}
              </p>
              <p className="mt-0.5 text-p-text-muted">Abrí la inscripción para usar la tarjetita.</p>
            </div>
          );
        },
      },
      {
        key: 'notes',
        label: 'Notas',
        render: (enrollment) => (
          <span className="line-clamp-2 text-[12px] text-p-text-secondary">
            {enrollment.notes || 'Sin notas'}
          </span>
        ),
      },
      {
        key: 'actions',
        label: '',
        align: 'right',
        isActions: true,
        width: 'w-[200px]',
        render: (enrollment) => (
          <div className="flex items-center justify-end gap-2 opacity-100">
            <button
              type="button"
              onClick={() => openEnrollmentEditModal(enrollment)}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-p-border bg-p-surface px-2.5 text-[11px] font-semibold text-p-text-muted transition hover:border-p-border-strong hover:text-p-text"
            >
              <Pencil size={13} />
              Editar
            </button>
            <button
              type="button"
              onClick={() => void cancelEnrollment(enrollment)}
              disabled={enrollmentStatusBusyId === enrollment.id || enrollment.enrollmentStatus === 'CANCELLED'}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-p-error bg-p-error-bg px-2.5 text-[11px] font-semibold text-[var(--error-fg)] transition hover:bg-[var(--error-fg)] hover:text-ink-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <XCircle size={13} />
              Cancelar
            </button>
          </div>
        ),
      },
    ],
    [cancelEnrollment, compatiblePassSummary, enrollmentStatusBusyId, openEnrollmentEditModal]
  );

  const canCreateClass = teachers.length > 0 && !optionsLoading;
  const durationMinutes = durationFromForm(form);
  const activeEnrollmentCount = enrollmentActiveCount(enrollments);
  const waitlistedCount = enrollmentWaitlistCount(enrollments);
  const cancelledEnrollmentCount = enrollmentCancelledCount(enrollments);
  const editingEnrollmentPasses = editingEnrollment
    ? classPassesByStudent[editingEnrollment.studentClientId] || []
    : [];
  const editingEnrollmentForCredit = useMemo(() => {
    if (!editingEnrollment) return null;
    return {
      ...editingEnrollment,
      attendanceStatus: editingEnrollmentId ? enrollmentForm.attendanceStatus : editingEnrollment.attendanceStatus,
    };
  }, [editingEnrollment, editingEnrollmentId, enrollmentForm.attendanceStatus]);
  const classFormContent = (
    <form id="class-session-form" onSubmit={submitForm} className="space-y-4">
      {formError && <AdminInlineError>{formError}</AdminInlineError>}

      <AdminDrawerSection title="Configuración base" className={drawerSectionCardClass}>
        <div className="space-y-4">
          <div className={helperCardClass}>
            <p className="font-semibold text-p-text">Visibilidad y formato se definen por separado</p>
            <p className="mt-1">
              Una clase pública puede ser individual, y una clase privada puede ser grupal. El cupo depende del formato, no de la visibilidad.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <SelectField
              label="Profesor"
              value={form.teacherId}
              onChange={(value) => setForm((prev) => ({ ...prev, teacherId: value }))}
              error={fieldErrors.teacherId}
              required
              options={[
                { value: '', label: optionsLoading ? 'Cargando profesores...' : 'Seleccionar profesor' },
                ...teachers.map((teacher) => ({
                  value: teacher.id,
                  label: teacher.isActive ? teacher.displayName : `${teacher.displayName} (inactivo)`,
                })),
              ]}
              inputClassName={fieldInputClass}
            />
            <SelectField
              label="Estado"
              value={form.status}
              onChange={(value) => setForm((prev) => ({ ...prev, status: value as AdminClassSessionStatus }))}
              error={fieldErrors.status}
              options={CLASS_STATUS_OPTIONS}
              inputClassName={fieldInputClass}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[12px] font-semibold text-p-text">Visibilidad</label>
              <AdminSegmentedControl
                options={[
                  { value: 'PUBLIC', label: 'Pública' },
                  { value: 'PRIVATE', label: 'Privada' },
                ]}
                value={form.visibility}
                onChange={(value) => setForm((prev) => ({ ...prev, visibility: value as AdminClassSessionVisibility }))}
                ariaLabel="Visibilidad de la clase"
              />
              {fieldErrors.visibility && <p className="text-[11px] text-[var(--error-fg)]">{fieldErrors.visibility}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-[12px] font-semibold text-p-text">Formato</label>
              <AdminSegmentedControl
                options={[
                  { value: 'INDIVIDUAL', label: 'Individual' },
                  { value: 'GROUP', label: 'Grupal' },
                ]}
                value={form.classType}
                onChange={(value) => updateClassType(value as AdminClassSessionType)}
                ariaLabel="Formato de la clase"
              />
              {fieldErrors.classType && <p className="text-[11px] text-[var(--error-fg)]">{fieldErrors.classType}</p>}
            </div>
          </div>
        </div>
      </AdminDrawerSection>

      <AdminDrawerSection title="Recursos y horario" className={drawerSectionCardClass}>
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField
              label="Cancha"
              value={form.courtId}
              onChange={(value) => setForm((prev) => ({ ...prev, courtId: value }))}
              error={fieldErrors.courtId}
              options={[
                { value: '', label: 'Sin cancha asignada' },
                ...courts.map((court) => ({ value: String(court.id), label: court.name })),
              ]}
              inputClassName={fieldInputClass}
            />
            <SelectField
              label="Actividad"
              value={form.activityTypeId}
              onChange={(value) => setForm((prev) => ({ ...prev, activityTypeId: value }))}
              error={fieldErrors.activityTypeId}
              options={[
                { value: '', label: 'Sin actividad específica' },
                ...activityTypes.map((activity) => ({ value: String(activity.id), label: activity.name })),
              ]}
              inputClassName={fieldInputClass}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Inicio"
              type="datetime-local"
              value={form.startsAt}
              onChange={(value) => setForm((prev) => ({ ...prev, startsAt: value }))}
              error={fieldErrors.startsAt}
              required
              inputClassName={fieldInputClass}
            />
            <Field
              label="Fin"
              type="datetime-local"
              value={form.endsAt}
              onChange={(value) => setForm((prev) => ({ ...prev, endsAt: value }))}
              error={fieldErrors.endsAt}
              required
              inputClassName={fieldInputClass}
            />
          </div>
        </div>
      </AdminDrawerSection>

      <AdminDrawerSection title="Capacidad y reglas" className={drawerSectionCardClass}>
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Field
              label="Duración"
              value={durationMinutes > 0 ? String(durationMinutes) : ''}
              onChange={() => undefined}
              disabled
              placeholder="Se calcula sola"
              hint="Se calcula a partir del inicio y el fin."
              inputClassName={fieldInputClass}
            />
            <Field
              label="Capacidad"
              type="number"
              value={form.capacity}
              onChange={(value) => setForm((prev) => ({ ...prev, capacity: value }))}
              error={fieldErrors.capacity}
              required
              disabled={form.classType === 'INDIVIDUAL'}
              hint={form.classType === 'INDIVIDUAL' ? 'Las clases individuales usan cupo 1.' : 'Para clases grupales debe ser mayor a 1.'}
              inputClassName={fieldInputClass}
            />
            <Field
              label="Precio por alumno"
              type="number"
              value={form.pricePerStudent}
              onChange={(value) => setForm((prev) => ({ ...prev, pricePerStudent: value }))}
              error={fieldErrors.pricePerStudent}
              placeholder="Opcional"
              inputClassName={fieldInputClass}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Nivel"
              value={form.level}
              onChange={(value) => setForm((prev) => ({ ...prev, level: value }))}
              error={fieldErrors.level}
              placeholder="Ej: Inicial, Intermedio"
              inputClassName={fieldInputClass}
            />
            <div className="space-y-2">
              <label className="text-[12px] font-semibold text-p-text">Reglas rápidas</label>
              <div className="grid gap-2">
                <CheckboxField
                  label="Requiere aprobación para inscribirse"
                  checked={form.requiresApproval}
                  onChange={(checked) => setForm((prev) => ({ ...prev, requiresApproval: checked }))}
                />
                <CheckboxField
                  label="Requiere pago para habilitar inscripción"
                  checked={form.requiresPaymentToEnroll}
                  onChange={(checked) => setForm((prev) => ({ ...prev, requiresPaymentToEnroll: checked }))}
                />
              </div>
            </div>
          </div>

          <TextAreaField
            label="Descripción"
            value={form.description}
            onChange={(value) => setForm((prev) => ({ ...prev, description: value }))}
            error={fieldErrors.description}
            placeholder="Contexto operativo de la clase, objetivo o notas visibles para el admin."
            inputClassName={`${fieldInputClass} min-h-[112px] py-2`}
          />
        </div>
      </AdminDrawerSection>
    </form>
  );

  const classPassFormContent = classPassForm ? (
    <form id="class-pass-form" onSubmit={submitClassPassForm} className="space-y-4">
      {classPassFormError ? <AdminInlineError>{classPassFormError}</AdminInlineError> : null}

      <AdminDrawerSection title="Titular y beneficiario" className={drawerSectionCardClass}>
        <div className="space-y-4">
          <div className={helperCardClass}>
            <p className="font-semibold text-p-text">Asignar créditos no registra un pago</p>
            <p className="mt-1">
              Esta acción crea una tarjetita digital para el alumno. El cobro de ese pack queda para una fase futura con AccountDrawer.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Titular del pack"
              value={classPassForm.ownerClientName}
              onChange={() => undefined}
              disabled
              hint="Por ahora se toma el responsable cargado en la inscripción. Si no existe, usa al alumno."
              inputClassName={fieldInputClass}
            />
            <Field
              label="Beneficiario"
              value={classPassForm.beneficiaryClientName}
              onChange={() => undefined}
              disabled
              hint="El pack se asigna al alumno de esta inscripción."
              inputClassName={fieldInputClass}
            />
          </div>
        </div>
      </AdminDrawerSection>

      <AdminDrawerSection title="Pack y vigencia" className={drawerSectionCardClass}>
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Nombre del pack"
              value={classPassForm.packageName}
              onChange={(value) => setClassPassForm((prev) => (prev ? { ...prev, packageName: value } : prev))}
              error={classPassFieldErrors.packageName}
              required
              inputClassName={fieldInputClass}
            />
            <Field
              label="Créditos"
              type="number"
              value={classPassForm.totalCredits}
              onChange={(value) =>
                setClassPassForm((prev) => {
                  if (!prev) return prev;
                  const nextCredits = String(value || '');
                  const autoName = /^Pack \d+ clases?$/.test(prev.packageName.trim());
                  return {
                    ...prev,
                    totalCredits: nextCredits,
                    packageName:
                      autoName && /^\d+$/.test(nextCredits)
                        ? `Pack ${nextCredits} clase${Number(nextCredits) === 1 ? '' : 's'}`
                        : prev.packageName,
                  };
                })
              }
              error={classPassFieldErrors.totalCredits}
              required
              inputClassName={fieldInputClass}
            />
          </div>

          <Field
            label="Vencimiento"
            type="datetime-local"
            value={classPassForm.expiresAt}
            onChange={(value) => setClassPassForm((prev) => (prev ? { ...prev, expiresAt: value } : prev))}
            error={classPassFieldErrors.expiresAt}
            hint="Opcional. Si lo dejás vacío, el pack queda sin vencimiento."
            inputClassName={fieldInputClass}
          />
        </div>
      </AdminDrawerSection>

      <AdminDrawerSection title="Restricciones" className={drawerSectionCardClass}>
        <div className="space-y-3">
          <CheckboxField
            label={`Restringir a la actividad actual${selectedClass?.activityType?.name ? ` (${selectedClass.activityType.name})` : ''}`}
            checked={classPassForm.restrictToActivity}
            onChange={(checked) => setClassPassForm((prev) => (prev ? { ...prev, restrictToActivity: checked } : prev))}
          />
          <CheckboxField
            label={`Restringir al formato actual${selectedClass ? ` (${classTypeLabel(selectedClass.classType)})` : ''}`}
            checked={classPassForm.restrictToClassType}
            onChange={(checked) => setClassPassForm((prev) => (prev ? { ...prev, restrictToClassType: checked } : prev))}
          />
          <CheckboxField
            label={`Restringir al profesor actual${selectedClass?.teacher?.displayName ? ` (${selectedClass.teacher.displayName})` : ''}`}
            checked={classPassForm.restrictToTeacher}
            onChange={(checked) => setClassPassForm((prev) => (prev ? { ...prev, restrictToTeacher: checked } : prev))}
          />
          <CheckboxField
            label="Pack transferible dentro del club"
            checked={classPassForm.transferable}
            onChange={(checked) => setClassPassForm((prev) => (prev ? { ...prev, transferable: checked } : prev))}
          />
        </div>
      </AdminDrawerSection>

      <AdminDrawerSection title="Notas" className={drawerSectionCardClass}>
        <TextAreaField
          label="Notas"
          value={classPassForm.notes}
          onChange={(value) => setClassPassForm((prev) => (prev ? { ...prev, notes: value } : prev))}
          error={classPassFieldErrors.notes}
          placeholder="Contexto operativo del pack o aclaraciones del titular."
          inputClassName={`${fieldInputClass} min-h-[112px] py-2`}
        />
      </AdminDrawerSection>
    </form>
  ) : null;

  return (
    <div
      className={`flex h-full min-h-0 flex-col gap-4 overflow-y-auto ${
        embedded ? 'px-0 pb-6' : 'p-4 pb-4 lg:p-6 lg:pb-6'
      }`}
    >
      {feedback && (
        <AdminFeedbackBanner tone={feedback.tone} title={feedback.tone === 'error' ? 'Error' : 'Listo'}>
          {feedback.message}
        </AdminFeedbackBanner>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard
          label="Programadas"
          value={summary.activeCount}
          format="number"
          delta={{ value: summary.total, label: `de ${summary.total} cargadas` }}
        />
        <MetricCard
          label="Públicas"
          value={summary.publicCount}
          format="number"
          valueColor="var(--accent-fg)"
        />
        <MetricCard
          label="Canceladas"
          value={summary.cancelled}
          format="number"
          valueColor={summary.cancelled > 0 ? 'var(--error-fg)' : 'var(--positive-fg)'}
        />
      </div>

      <AdminPanel
        title="Base de clases"
        description="Profesor, horario, visibilidad, formato, cupo y estado operativo."
        bodyClassName="p-0"
        actions={
          <AdminFilterToolbar className="border-0 bg-transparent p-0 gap-2 sm:flex-nowrap sm:justify-end">
            <AdminSegmentedControl
              options={[
                { value: 'all', label: 'Todas' },
                { value: 'active', label: 'Activas' },
                { value: 'completed', label: 'Completadas' },
                { value: 'cancelled', label: 'Canceladas' },
              ]}
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as ClassStatusFilter)}
              ariaLabel="Filtro de estado de clases"
              density="compact"
              className="w-fit"
            />
            <div className="relative w-full sm:w-[320px] sm:flex-none">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-p-text-muted" size={14} strokeWidth={2.5} />
              <input
                type="text"
                placeholder="Buscar por profesor, cancha, actividad o nivel..."
                className="h-8 w-full rounded-xl border border-p-border bg-p-surface pl-9 pr-3 text-[12px] text-p-text placeholder:text-p-text-muted outline-none transition focus:border-p-accent"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={openCreateModal}
              disabled={!canCreateClass}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-ink-900 px-2.5 text-[11px] font-semibold text-ink-50 shadow-p-md transition hover:bg-ink-800 hover:shadow-p-md disabled:cursor-not-allowed disabled:bg-ink-700/60 sm:w-auto"
            >
              <Plus size={14} />
              Nueva clase
            </button>
          </AdminFilterToolbar>
        }
      >
        <AdminDataTable
          columns={classColumns}
          data={filteredClasses}
          rowKey={(row) => row.id}
          loading={loading}
          onRowClick={(row) => setSelectedClassId(row.id)}
          rowClassName={(row) =>
            row.id === selectedClassId ? 'bg-p-surface-2/80 ring-1 ring-inset ring-p-border-strong' : ''
          }
          empty={{
            title: teachers.length === 0 && !optionsLoading ? 'Cargá profesores antes de crear clases' : 'Todavía no hay clases cargadas',
            description:
              teachers.length === 0 && !optionsLoading
                ? 'La clase necesita un profesor explícito. Primero completá el padrón en Profesores.'
                : 'Creá la primera clase para dejar lista la base operativa de Academia.',
            action: canCreateClass ? (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 transition hover:bg-ink-800"
              >
                <Plus size={14} />
                Nueva clase
              </button>
            ) : undefined,
          }}
        />
      </AdminPanel>

      <AdminDrawer
        open={Boolean(selectedClass) && !modalOpen && !enrollmentModalOpen}
        onClose={() => setSelectedClassId(null)}
        title={selectedClass ? selectedClass.teacher?.displayName || 'Clase sin profesor' : 'Clase'}
        subtitle={
          selectedClass
            ? 'Gestioná inscripciones, asistencia y contexto operativo desde este panel lateral.'
            : undefined
        }
        statusChip={selectedClass ? statusLabel(selectedClass.status) : undefined}
        statusChipClassName={selectedClass ? statusToneClasses(selectedClass.status) : undefined}
        size="lg"
        footer={
          selectedClass ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedClassId(null)}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-p-border px-3 text-sm font-semibold text-p-text-muted transition hover:border-p-border-strong hover:text-p-text"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={openEnrollmentCreateModal}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-ink-900 px-3 text-sm font-semibold text-ink-50 transition hover:bg-ink-800"
              >
                <UserPlus size={14} />
                Agregar alumno
              </button>
              <button
                type="button"
                onClick={() => void openEditModal(selectedClass.id)}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-p-border bg-p-surface px-3 text-sm font-semibold text-p-text-muted transition hover:border-p-border-strong hover:text-p-text"
              >
                <Pencil size={14} />
                Editar clase
              </button>
            </div>
          ) : null
        }
      >
        {selectedClass ? (
          <ClassSessionDrawerContent
            selectedClass={selectedClass}
            activeEnrollmentCount={activeEnrollmentCount}
            waitlistedCount={waitlistedCount}
            cancelledEnrollmentCount={cancelledEnrollmentCount}
            enrollmentsError={enrollmentsError}
            enrollmentFilter={enrollmentFilter}
            onEnrollmentFilterChange={(value) => setEnrollmentFilter(value)}
            enrollmentColumns={enrollmentColumns}
            filteredEnrollments={filteredEnrollments}
            enrollmentsLoading={enrollmentsLoading}
            onEnrollmentRowClick={openEnrollmentEditModal}
            onAddEnrollment={openEnrollmentCreateModal}
          />
        ) : null}
      </AdminDrawer>

      <AdminDrawer
        open={modalOpen}
        onClose={closeModal}
        title={editingClassId ? 'Editar clase' : 'Nueva clase'}
        subtitle={
          editingClassId
            ? 'Ajustá los datos operativos de la clase desde el panel lateral, sin mezclar agenda ni cobros.'
            : 'Creá la clase desde el panel lateral, manteniendo la página principal como espacio de listado y operación general.'
        }
        size="lg"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeModal}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-p-border px-3 text-sm font-semibold text-p-text-muted transition hover:border-p-border-strong hover:text-p-text"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="class-session-form"
              disabled={submitting}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-ink-900 px-3 text-sm font-semibold text-ink-50 transition hover:bg-ink-800 disabled:cursor-wait disabled:opacity-70"
            >
              {submitting ? 'Guardando...' : editingClassId ? 'Guardar cambios' : 'Crear clase'}
            </button>
          </div>
        }
      >
        {classFormContent}
      </AdminDrawer>

      <AdminDrawer
        open={enrollmentModalOpen && !classPassDrawerOpen}
        onClose={closeEnrollmentModal}
        title={editingEnrollmentId ? 'Editar inscripción' : 'Agregar alumno'}
        subtitle={
          editingEnrollmentId
            ? 'Ajustá responsable, notas o referencia explícita de usuario sin mezclar asistencia ni pagos.'
            : 'Seleccioná explícitamente al alumno y, si corresponde, un responsable de pago opcional.'
        }
        size="lg"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeEnrollmentModal}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-p-border px-3 text-sm font-semibold text-p-text-muted transition hover:border-p-border-strong hover:text-p-text"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="class-enrollment-form"
              disabled={enrollmentSubmitting}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-ink-900 px-3 text-sm font-semibold text-ink-50 transition hover:bg-ink-800 disabled:cursor-wait disabled:opacity-70"
            >
              {enrollmentSubmitting ? 'Guardando...' : editingEnrollmentId ? 'Guardar inscripción' : 'Agregar alumno'}
            </button>
          </div>
        }
      >
        <form id="class-enrollment-form" onSubmit={submitEnrollmentForm} className="space-y-4">
          {enrollmentFormError && <AdminInlineError>{enrollmentFormError}</AdminInlineError>}

          <AdminDrawerSection title="Identidad y responsable" className={drawerSectionCardClass}>
            <div className="space-y-4">
              <div className={helperCardClass}>
                <p className="font-semibold text-p-text">Alumno y responsable no son lo mismo</p>
                <p className="mt-1">
                  Alumno es quien toma la clase. Responsable es quien paga o administra, y puede ser otra persona.
                </p>
              </div>

              {editingEnrollmentId ? (
                <div className="rounded-xl border border-p-border bg-p-surface px-4 py-3">
                  <p className="text-[12px] font-semibold text-p-text">Alumno</p>
                  <p className="mt-1 text-[13px] font-medium text-p-text">
                    {enrollmentForm.selectedStudent?.displayName || 'Sin alumno'}
                  </p>
                  <p className="mt-1 text-[12px] text-p-text-muted">
                    {enrollmentForm.selectedStudent ? personSecondaryLine(enrollmentForm.selectedStudent) : 'Sin datos'}
                  </p>
                </div>
              ) : (
                <PersonSearchSelectField
                  label="Alumno"
                  required
                  placeholder="Buscar alumno por nombre, teléfono o email..."
                  selected={enrollmentForm.selectedStudent}
                  query={enrollmentForm.studentQuery}
                  onQueryChange={(value) => setEnrollmentForm((prev) => ({ ...prev, studentQuery: value }))}
                  results={studentSearch.results}
                  loading={studentSearch.loading}
                  onSelect={(candidate) =>
                    setEnrollmentForm((prev) => ({
                      ...prev,
                      selectedStudent: candidate,
                      studentQuery: '',
                      selectedStudentUser: candidate.userId ? candidate : null,
                      studentUserQuery: '',
                    }))
                  }
                  onClear={() =>
                    setEnrollmentForm((prev) => ({
                      ...prev,
                      selectedStudent: null,
                      studentQuery: '',
                      selectedStudentUser: null,
                      studentUserQuery: '',
                    }))
                  }
                  error={enrollmentFieldErrors.studentClientId}
                  helper="Solo se pueden inscribir clientes del club. Si la búsqueda sugiere crear uno nuevo, hacelo primero desde Clientes."
                />
              )}

              <PersonSearchSelectField
                label="Usuario del alumno"
                placeholder="Buscar usuario explícito del alumno..."
                selected={enrollmentForm.selectedStudentUser}
                query={enrollmentForm.studentUserQuery}
                onQueryChange={(value) => setEnrollmentForm((prev) => ({ ...prev, studentUserQuery: value }))}
                results={studentUserSearch.results}
                loading={studentUserSearch.loading}
                onSelect={(candidate) =>
                  setEnrollmentForm((prev) => ({
                    ...prev,
                    selectedStudentUser: candidate,
                    studentUserQuery: '',
                  }))
                }
                onClear={() =>
                  setEnrollmentForm((prev) => ({
                    ...prev,
                    selectedStudentUser: null,
                    studentUserQuery: '',
                  }))
                }
                error={enrollmentFieldErrors.studentUserId}
                helper="Opcional. Se guarda solo por selección explícita y no crea vínculos automáticos."
                disabled={!editingEnrollmentId && !enrollmentForm.selectedStudent}
              />

              <PersonSearchSelectField
                label="Responsable de pago"
                placeholder="Buscar responsable opcional..."
                selected={enrollmentForm.selectedResponsible}
                query={enrollmentForm.responsibleQuery}
                onQueryChange={(value) => setEnrollmentForm((prev) => ({ ...prev, responsibleQuery: value }))}
                results={responsibleSearch.results}
                loading={responsibleSearch.loading}
                onSelect={(candidate) =>
                  setEnrollmentForm((prev) => ({
                    ...prev,
                    selectedResponsible: candidate,
                    responsibleQuery: '',
                  }))
                }
                onClear={() =>
                  setEnrollmentForm((prev) => ({
                    ...prev,
                    selectedResponsible: null,
                    responsibleQuery: '',
                  }))
                }
                error={enrollmentFieldErrors.billingResponsibleClientId}
                helper="Opcional. Puede ser distinto del alumno y en esta fase solo se valida que pertenezca al club."
              />
            </div>
          </AdminDrawerSection>

          <AdminDrawerSection title="Asistencia y notas" className={drawerSectionCardClass}>
            <div className="space-y-4">
              {editingEnrollmentId ? (
                <SelectField
                  label="Asistencia"
                  value={enrollmentForm.attendanceStatus}
                  onChange={(value) =>
                    setEnrollmentForm((prev) => ({
                      ...prev,
                      attendanceStatus: value as AdminClassAttendanceStatus,
                    }))
                  }
                  error={enrollmentFieldErrors.attendanceStatus}
                  options={attendanceOptions}
                  inputClassName={fieldInputClass}
                />
              ) : (
                <div className={helperCardClass}>
                  <p className="font-semibold text-p-text">Asistencia inicial</p>
                  <p className="mt-1">
                    Las nuevas inscripciones arrancan como pendiente. La asistencia se gestiona después desde la edición del alumno.
                  </p>
                </div>
              )}

              <TextAreaField
                label="Notas"
                value={enrollmentForm.notes}
                onChange={(value) => setEnrollmentForm((prev) => ({ ...prev, notes: value }))}
                error={enrollmentFieldErrors.notes}
                placeholder="Notas operativas sobre esta inscripción."
                inputClassName={`${fieldInputClass} min-h-[112px] py-2`}
              />
            </div>
          </AdminDrawerSection>

          <AdminDrawerSection title="Tarjetita digital" className={drawerSectionCardClass}>
            {!editingEnrollmentId || !editingEnrollment || !editingEnrollmentForCredit ? (
              <div className={helperCardClass}>
                <p className="font-semibold text-p-text">Créditos después de guardar</p>
                <p className="mt-1">
                  Guardá primero la inscripción. Después vas a poder ver packs compatibles, saldo y consumir un crédito manualmente.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[13px] text-p-text-secondary">
                    Packs disponibles, saldo y consumo manual de créditos para esta inscripción.
                  </p>
                  <button
                    type="button"
                    onClick={openClassPassDrawer}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text transition hover:border-p-border-strong hover:text-p-text"
                  >
                    <Plus size={14} />
                    Asignar pack
                  </button>
                </div>

                <div className={helperCardClass}>
                  <p className="font-semibold text-p-text">Consumir crédito no registra un pago</p>
                  <p className="mt-1">
                    Esta acción solo usa un crédito del pack para cubrir la inscripción. No modifica asistencia ni genera cobros en cuenta.
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <SummaryBlock label="Pago actual" value={paymentStatusLabel(editingEnrollment.paymentStatus)} />
                  <SummaryBlock label="Asistencia" value={attendanceStatusLabel(editingEnrollmentForCredit.attendanceStatus)} />
                  <SummaryBlock label="Consumos" value={String(editingEnrollmentCreditUsages.length)} />
                </div>

                {resolveCreditUsageReason(editingEnrollmentForCredit.attendanceStatus) === 'MANUAL_ADJUSTMENT' ? (
                  <div className="rounded-xl border border-p-border-strong bg-p-surface px-3 py-3 text-[12px] text-p-text-secondary">
                    <p className="font-semibold text-p-text">Consumo manual</p>
                    <p className="mt-1">
                      La asistencia todavía no define un motivo automático. Si consumís ahora, la tarjetita se va a registrar como ajuste manual.
                    </p>
                  </div>
                ) : null}

                {creditUsageError ? <AdminInlineError>{creditUsageError}</AdminInlineError> : null}
                {classPassesError ? <AdminInlineError>{classPassesError}</AdminInlineError> : null}

                {editingEnrollmentCreditUsages.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[12px] font-semibold text-p-text">Trazabilidad registrada</p>
                    <div className="space-y-2">
                      {editingEnrollmentCreditUsages.map((usage) => (
                        <div key={usage.id} className="rounded-xl border border-p-border bg-p-surface px-3 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-[13px] font-semibold text-p-text">
                              {usage.classPass?.packageName || 'Pack sin referencia'}
                            </p>
                            <span className="inline-flex rounded-full border border-p-border bg-p-surface-2 px-2 py-0.5 text-[11px] font-semibold text-p-text-secondary">
                              {usage.creditsUsed} crédito{usage.creditsUsed === 1 ? '' : 's'}
                            </span>
                          </div>
                          <p className="mt-1 text-[12px] text-p-text-secondary">
                            {creditUsageReasonLabel(usage.reason)} · {formatDateTime(usage.usedAt)}
                          </p>
                          {usage.notes ? <p className="mt-1 text-[12px] text-p-text-muted">{usage.notes}</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {classPassesLoading && editingEnrollmentPasses.length === 0 ? (
                  <div className={helperCardClass}>Cargando packs activos del alumno...</div>
                ) : editingEnrollmentPasses.length === 0 ? (
                  <div className={helperCardClass}>
                    <p className="font-semibold text-p-text">Sin packs activos</p>
                    <p className="mt-1">
                      Este alumno no tiene una tarjetita digital activa y compatible para consumir desde esta clase.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {editingEnrollmentPasses.map((classPass) => {
                      const hasUsage = editingEnrollmentCreditUsages.some((usage) => usage.classPassId === classPass.id);
                      const availability = resolveClassPassAvailability({
                        classPass,
                        enrollment: editingEnrollmentForCredit,
                        selectedClass,
                        hasUsage,
                      });
                      const restrictionItems = buildClassPassRestrictionList(classPass);
                      const ownerIsDifferent =
                        classPass.ownerClient?.id && classPass.ownerClient.id !== classPass.beneficiaryClientId;

                      return (
                        <div key={classPass.id} className="rounded-xl border border-p-border bg-p-surface px-4 py-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-[13px] font-semibold text-p-text">{classPass.packageName}</p>
                                <span
                                  className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${classPassToneClasses(
                                    availability.effectiveStatus
                                  )}`}
                                >
                                  {classPassStatusLabel(availability.effectiveStatus)}
                                </span>
                              </div>
                              <p className="mt-1 text-[12px] text-p-text-secondary">
                                {classPass.remainingCredits}/{classPass.totalCredits} créditos disponibles
                              </p>
                              {ownerIsDifferent ? (
                                <p className="mt-1 text-[12px] text-p-text-muted">
                                  Titular: {classPass.ownerClient?.name || 'Cliente del club'}
                                </p>
                              ) : null}
                            </div>

                            <div className="flex flex-col items-start gap-2 md:items-end">
                              <span className="inline-flex rounded-full border border-p-border bg-p-surface-2 px-2 py-0.5 text-[11px] font-semibold text-p-text-secondary">
                                Motivo: {creditUsageReasonLabel(availability.reason)}
                              </span>
                              <button
                                type="button"
                                disabled={!availability.usable || creditUsageBusyPassId === classPass.id}
                                onClick={() =>
                                  setCreditUsageConfirmState({
                                    classPass,
                                    enrollment: editingEnrollmentForCredit,
                                    reason: availability.reason,
                                  })
                                }
                                className="inline-flex h-8 items-center justify-center rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:bg-ink-700/50"
                              >
                                {creditUsageBusyPassId === classPass.id
                                  ? 'Consumiendo...'
                                  : availability.reason === 'MANUAL_ADJUSTMENT'
                                    ? 'Consumir crédito manualmente'
                                    : 'Consumir 1 crédito'}
                              </button>
                            </div>
                          </div>

                          {restrictionItems.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {restrictionItems.map((item) => (
                                <span
                                  key={`${classPass.id}-${item}`}
                                  className="inline-flex rounded-full border border-p-border bg-p-surface-2 px-2 py-0.5 text-[11px] font-medium text-p-text-secondary"
                                >
                                  {item}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 text-[12px] text-p-text-muted">Sin restricciones específicas para esta clase.</p>
                          )}

                          {!availability.usable && availability.disabledReason ? (
                            <p className="mt-3 text-[12px] text-[var(--error-fg)]">{availability.disabledReason}</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </AdminDrawerSection>
        </form>
      </AdminDrawer>

      <AdminDrawer
        open={classPassDrawerOpen}
        onClose={closeClassPassDrawer}
        title="Asignar pack"
        subtitle="Creá una tarjetita digital para este alumno sin registrar cobro ni tocar el estado de pago de la inscripción."
        size="md"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeClassPassDrawer}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-p-border px-3 text-sm font-semibold text-p-text-muted transition hover:border-p-border-strong hover:text-p-text"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="class-pass-form"
              disabled={classPassSubmitting}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-ink-900 px-3 text-sm font-semibold text-ink-50 transition hover:bg-ink-800 disabled:cursor-wait disabled:opacity-70"
            >
              {classPassSubmitting ? 'Asignando...' : 'Asignar pack'}
            </button>
          </div>
        }
      >
        {classPassFormContent}
      </AdminDrawer>

      <AdminAppModal
        show={Boolean(creditUsageConfirmState)}
        onClose={() => {
          if (!creditUsageBusyPassId) setCreditUsageConfirmState(null);
        }}
        title={
          creditUsageConfirmState?.reason === 'MANUAL_ADJUSTMENT'
            ? 'Confirmar consumo manual de crédito'
            : 'Confirmar consumo de crédito'
        }
        message={
          creditUsageConfirmState ? (
            <div className="space-y-3">
              <p>
                Vas a consumir <strong>1 crédito</strong> de la tarjetita digital para cubrir esta inscripción.
                Esto <strong>no registra un pago</strong> ni cambia la asistencia.
              </p>
              {creditUsageConfirmState.reason === 'MANUAL_ADJUSTMENT' ? (
                <p className="rounded-xl border border-p-border-strong bg-p-surface px-3 py-3 text-[12px] text-p-text-secondary">
                  La asistencia todavía no define un motivo automático. Este consumo se va a registrar como
                  <strong> ajuste manual</strong>.
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryBlock label="Alumno" value={creditUsageConfirmState.enrollment.snapshotName} />
                <SummaryBlock label="Pack" value={creditUsageConfirmState.classPass.packageName} />
                <SummaryBlock
                  label="Créditos actuales"
                  value={`${creditUsageConfirmState.classPass.remainingCredits}/${creditUsageConfirmState.classPass.totalCredits}`}
                />
                <SummaryBlock
                  label="Restantes estimados"
                  value={String(Math.max(0, creditUsageConfirmState.classPass.remainingCredits - 1))}
                />
                <SummaryBlock label="Motivo" value={creditUsageReasonLabel(creditUsageConfirmState.reason)} />
                <SummaryBlock
                  label="Estado de pago"
                  value={paymentStatusLabel(creditUsageConfirmState.enrollment.paymentStatus)}
                />
              </div>
            </div>
          ) : null
        }
        cancelText="Cancelar"
        confirmText={
          creditUsageBusyPassId
            ? 'Consumiendo...'
            : creditUsageConfirmState?.reason === 'MANUAL_ADJUSTMENT'
              ? 'Consumir manualmente'
              : 'Consumir crédito'
        }
        confirmDisabled={Boolean(creditUsageBusyPassId)}
        onConfirm={() => {
          void consumeClassPassCredit();
        }}
      />
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/admin/academia?tab=clases', permanent: false },
});

function Field({
  label,
  value,
  onChange,
  error,
  required = false,
  type = 'text',
  placeholder,
  hint,
  disabled = false,
  inputClassName,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  inputClassName?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-semibold text-p-text">
        {label}
        {required ? ' *' : ''}
      </label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={
          inputClassName ||
          'h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none transition focus:border-p-accent disabled:cursor-not-allowed disabled:bg-p-surface-2 disabled:text-p-text-muted'
        }
      />
      {hint && !error && <p className="text-[11px] text-p-text-muted">{hint}</p>}
      {error && <p className="text-[11px] text-[var(--error-fg)]">{error}</p>}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  error,
  required = false,
  options,
  inputClassName,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  options: Array<{ value: string; label: string }>;
  inputClassName?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-semibold text-p-text">
        {label}
        {required ? ' *' : ''}
      </label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={
          inputClassName ||
          'h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none transition focus:border-p-accent'
        }
      >
        {options.map((option) => (
          <option key={`${label}-${option.value || 'empty'}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="text-[11px] text-[var(--error-fg)]">{error}</p>}
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  error,
  placeholder,
  inputClassName,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  inputClassName?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-semibold text-p-text">{label}</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        placeholder={placeholder}
        className={
          inputClassName ||
          'w-full rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] text-p-text outline-none transition focus:border-p-accent'
        }
      />
      {error && <p className="text-[11px] text-[var(--error-fg)]">{error}</p>}
    </div>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] text-p-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-p-border"
      />
      {label}
    </label>
  );
}

function SummaryBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">{label}</p>
      <p className="text-[13px] text-p-text">{value}</p>
    </div>
  );
}

function ClassSessionDrawerContent({
  selectedClass,
  activeEnrollmentCount,
  waitlistedCount,
  cancelledEnrollmentCount,
  enrollmentsError,
  enrollmentFilter,
  onEnrollmentFilterChange,
  enrollmentColumns,
  filteredEnrollments,
  enrollmentsLoading,
  onEnrollmentRowClick,
  onAddEnrollment,
}: {
  selectedClass: AdminClassSession;
  activeEnrollmentCount: number;
  waitlistedCount: number;
  cancelledEnrollmentCount: number;
  enrollmentsError: string;
  enrollmentFilter: EnrollmentFilter;
  onEnrollmentFilterChange: (value: EnrollmentFilter) => void;
  enrollmentColumns: AdminDataTableColumn<AdminClassEnrollment>[];
  filteredEnrollments: AdminClassEnrollment[];
  enrollmentsLoading: boolean;
  onEnrollmentRowClick: (row: AdminClassEnrollment) => void;
  onAddEnrollment: () => void;
}) {
  return (
    <>
      <AdminDrawerSection title="Resumen" className={drawerSectionCardClass}>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-p-text-muted">
          <span className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${statusToneClasses(selectedClass.status)}`}>
            {statusLabel(selectedClass.status)}
          </span>
          <span className="inline-flex rounded-full border border-p-border bg-p-surface px-2 py-0.5 font-semibold text-p-text-secondary">
            Visibilidad: {visibilityLabel(selectedClass.visibility)}
          </span>
          <span className="inline-flex rounded-full border border-p-border bg-p-surface px-2 py-0.5 font-semibold text-p-text-secondary">
            Formato: {classTypeLabel(selectedClass.classType)}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryBlock label="Profesor" value={selectedClass.teacher?.displayName || 'Sin profesor'} />
          <SummaryBlock label="Horario" value={formatDateRange(selectedClass.startsAt, selectedClass.endsAt)} />
          <SummaryBlock label="Cancha" value={selectedClass.court?.name || 'Sin cancha asignada'} />
          <SummaryBlock label="Actividad" value={selectedClass.activityType?.name || 'Sin actividad específica'} />
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <SummaryBlock label="Cupo usado" value={`${activeEnrollmentCount}/${selectedClass.capacity}`} />
          <SummaryBlock label="En espera" value={String(waitlistedCount)} />
          <SummaryBlock label="Cancelados" value={String(cancelledEnrollmentCount)} />
          <SummaryBlock label="Precio" value={formatCurrency(selectedClass.pricePerStudent)} />
        </div>

        {(selectedClass.level || selectedClass.description) && (
          <div className="grid gap-3 md:grid-cols-2">
            <SummaryBlock label="Nivel" value={selectedClass.level || 'Sin nivel definido'} />
            <SummaryBlock label="Descripción" value={selectedClass.description || 'Sin descripción'} />
          </div>
        )}
      </AdminDrawerSection>

      {enrollmentsError ? (
        <AdminFeedbackBanner tone="error" title="Error">
          {enrollmentsError}
        </AdminFeedbackBanner>
      ) : null}

      <AdminDrawerSection title="Alumnos" className={drawerSectionCardClass}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-p-text-secondary">
            Inscripciones, responsable opcional y estados informativos de la clase.
          </p>
          <AdminFilterToolbar className="border-0 bg-transparent p-0 gap-2 sm:flex-nowrap sm:justify-end">
            <AdminSegmentedControl
              options={[
                { value: 'active', label: 'Activos' },
                { value: 'all', label: 'Todos' },
                { value: 'cancelled', label: 'Cancelados' },
              ]}
              value={enrollmentFilter}
              onChange={(value) => onEnrollmentFilterChange(value as EnrollmentFilter)}
              ariaLabel="Filtro de inscripciones"
              density="compact"
              className="w-fit"
            />
          </AdminFilterToolbar>
        </div>

        <AdminDataTable
          columns={enrollmentColumns}
          data={filteredEnrollments}
          rowKey={(row) => row.id}
          loading={enrollmentsLoading}
          onRowClick={onEnrollmentRowClick}
          empty={{
            title: 'Todavía no hay alumnos en esta clase',
            description: 'Agregá el primer alumno con búsqueda explícita, sin mezclar todavía asistencia ni pagos.',
            action: (
              <button
                type="button"
                onClick={onAddEnrollment}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 transition hover:bg-ink-800"
              >
                <UserPlus size={14} />
                Agregar alumno
              </button>
            ),
          }}
        />
      </AdminDrawerSection>
    </>
  );
}

function PersonSearchSelectField({
  label,
  selected,
  query,
  onQueryChange,
  results,
  loading,
  onSelect,
  onClear,
  placeholder,
  error,
  helper,
  required = false,
  disabled = false,
}: {
  label: string;
  selected: EnrollmentPersonOption | null;
  query: string;
  onQueryChange: (value: string) => void;
  results: EnrollmentPersonOption[];
  loading: boolean;
  onSelect: (candidate: EnrollmentPersonOption) => void;
  onClear: () => void;
  placeholder: string;
  error?: string;
  helper?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const safeQuery = String(query || '').trim();
  return (
    <div className="space-y-2">
      <label className="text-[12px] font-semibold text-p-text">
        {label}
        {required ? ' *' : ''}
      </label>

      {selected ? (
        <div className="rounded-xl border border-p-border bg-p-surface px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-p-text">{selected.displayName}</p>
              <p className="mt-1 text-[12px] text-p-text-muted">{personSecondaryLine(selected)}</p>
              {personBadges(selected).length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {personBadges(selected).map((badge) => (
                    <span
                      key={`${label}-${badge}`}
                      className="inline-flex rounded-full border border-p-border bg-p-surface-2 px-2 py-0.5 text-[11px] font-medium text-p-text-secondary"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            {!disabled ? (
              <button
                type="button"
                onClick={onClear}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-p-border px-2.5 text-[11px] font-semibold text-p-text-muted transition hover:border-p-border-strong hover:text-p-text"
              >
                Cambiar
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            value={query}
            disabled={disabled}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={placeholder}
            className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none transition focus:border-p-accent disabled:cursor-not-allowed disabled:bg-p-surface-2 disabled:text-p-text-muted"
          />
          {loading ? (
            <div className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-3 text-[12px] text-p-text-muted">
              Buscando personas...
            </div>
          ) : safeQuery.length >= 2 ? (
            results.length > 0 ? (
              <div className="divide-y divide-p-border overflow-hidden rounded-xl border border-p-border bg-p-surface">
                {results.map((candidate) => (
                  <div key={`${label}-${candidate.personKey}`} className="px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-p-text">{candidate.displayName}</p>
                        <p className="mt-1 text-[12px] text-p-text-muted">{personSecondaryLine(candidate)}</p>
                        {personBadges(candidate).length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {personBadges(candidate).map((badge) => (
                              <span
                                key={`${candidate.personKey}-${badge}`}
                                className="inline-flex rounded-full border border-p-border bg-p-surface-2 px-2 py-0.5 text-[11px] font-medium text-p-text-secondary"
                              >
                                {badge}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {candidate.disabledReason ? (
                          <p className="mt-2 text-[11px] text-[var(--error-fg)]">{candidate.disabledReason}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(candidate.disabledReason)}
                        onClick={() => onSelect(candidate)}
                        className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-p-border px-2.5 text-[11px] font-semibold text-p-text-muted transition hover:border-p-border-strong hover:text-p-text disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Seleccionar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-3 text-[12px] text-p-text-muted">
                No encontramos coincidencias para esa búsqueda.
              </div>
            )
          ) : helper ? (
            <p className="text-[11px] text-p-text-muted">{helper}</p>
          ) : null}
        </div>
      )}

      {error ? <p className="text-[11px] text-[var(--error-fg)]">{error}</p> : null}
      {!error && helper && selected ? <p className="text-[11px] text-p-text-muted">{helper}</p> : null}
    </div>
  );
}
