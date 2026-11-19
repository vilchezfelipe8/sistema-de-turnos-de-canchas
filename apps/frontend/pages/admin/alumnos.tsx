import type { GetServerSideProps } from 'next';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import {
  AcademyEmptyState,
  AcademyStatusBadge,
  academyAttendanceLabel,
  academyAttendanceTone,
  academyPassStatusLabel,
  academyPassStatusTone,
  academyPaymentLabel,
  academyPaymentTone,
} from '../../components/admin/academy/AcademyVisual';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import {
  AdminAppModal,
  AdminDrawer,
  AdminFeedbackBanner,
  AdminFilterToolbar,
  AdminInlineError,
  AdminPanel,
  AdminSegmentedControl,
} from '../../components/admin/ui';
import {
  ClubAdminService,
  type AdminAcademyStudentListItem,
  type AdminAcademyStudentOverview,
} from '../../services/ClubAdminService';
import { showAdminToast } from '../../utils/adminToast';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import { adminButton } from '../../components/admin/ui/adminButton';
import { adminChip } from '../../components/admin/ui/adminChip';
import { AdminSearchInput } from '../../components/admin/ui/AdminPersonPicker';
import StudentEnrollDrawer from '../../components/admin/academy/StudentEnrollDrawer';
import ClientSubscriptionsPanel from '../../components/admin/subscriptions/ClientSubscriptionsPanel';
import AccountDrawer, {
  type AccountDrawerContext,
  type AccountDrawerInitialView,
} from '../../modules/cuentas/components/AccountDrawer';
import { hasAdminAccess } from '../../utils/session';

const academyMetricCardClass = 'rounded-[22px] border-p-border bg-p-surface px-5 py-4 shadow-p-card';
const academyPanelClass = 'overflow-hidden rounded-[24px] border-p-border bg-p-surface shadow-p-card';
const academyPanelHeaderClass = 'border-b border-p-border px-4 py-4 lg:px-5';
const fieldInputClass =
  'h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text placeholder:text-p-text-muted outline-none transition focus:border-p-accent focus:ring-2 focus:ring-lima-300/30';
const fieldTextAreaClass =
  'min-h-[96px] w-full rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] text-p-text placeholder:text-p-text-muted outline-none transition focus:border-p-accent focus:ring-2 focus:ring-lima-300/30 resize-y';

type StudentPackFormState = {
  packageName: string;
  totalCredits: string;
  priceAtPurchase: string;
  expiresAt: string;
  notes: string;
};

const buildEmptyStudentPackForm = (): StudentPackFormState => ({
  packageName: '',
  totalCredits: '4',
  priceAtPurchase: '',
  expiresAt: '',
  notes: '',
});

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

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);

const paymentStatusLabel = (status: string) => {
  return academyPaymentLabel(status);
};

const attendanceStatusLabel = (status: string) => {
  return academyAttendanceLabel(status);
};

const enrollmentStatusLabel = (status: string) => {
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

const classPassStatusLabel = (status: string) => {
  return academyPassStatusLabel(status);
};

const classTypeLabel = (value: string | null) => {
  if (!value) return 'Sin formato';
  return value === 'GROUP' ? 'Grupal' : 'Individual';
};

const relationshipTypeLabel = (value: string) => {
  switch (value) {
    case 'PARENT':
      return 'Madre / padre';
    case 'GUARDIAN':
      return 'Tutor';
    case 'CHILD':
      return 'Hijo/a';
    case 'PAYER':
      return 'Responsable de pago';
    case 'FAMILY_MEMBER':
      return 'Familiar';
    case 'EMERGENCY_CONTACT':
      return 'Contacto de emergencia';
    case 'OTHER':
      return 'Otro vínculo';
    default:
      return value;
  }
};

const creditUsageReasonLabel = (value: string) => {
  switch (value) {
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
      return value;
  }
};

const formatClassDay = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/\./g, '')
    .replace(',', '');
};

const formatClassTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
};

/** "sáb 14 nov · 15:30" */
const formatClassWhen = (iso: string) => `${formatClassDay(iso)} · ${formatClassTime(iso)}`;

const SERIES_WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
/** "Mar, Jue" (lunes primero). */
const seriesWeekdaysLabel = (days: number[]) =>
  [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => SERIES_WEEKDAYS[d] || '').join(', ');

const formatShortDate = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace(/\./g, '');
};

type StudentFilter = 'all' | 'upcoming' | 'credits';

const PACK_SIZE_CHOICES = [4, 8, 12];

const enrollmentPaymentText = (row: { paymentStatus: string; priceAtEnrollment: number; paidAmount: number }) => {
  if (row.paymentStatus === 'COVERED_BY_CREDIT') return 'Pagó con pack';
  if (row.paymentStatus === 'PAID') return 'Pagó';
  if (row.paymentStatus === 'REFUNDED') return 'Se le devolvió';
  const owed = Math.max(0, Number(row.priceAtEnrollment || 0) - Number(row.paidAmount || 0));
  return owed > 0 ? `Debe ${formatCurrency(owed)}` : 'Sin cargo';
};

const enrollmentAttendanceText = (row: { attendanceStatus: string; enrollmentStatus: string }) => {
  if (row.enrollmentStatus === 'CANCELLED') return 'Se bajó';
  switch (row.attendanceStatus) {
    case 'ATTENDED':
      return 'Vino';
    case 'ABSENT':
    case 'NO_SHOW':
      return 'Faltó';
    case 'CANCELLED_ON_TIME':
      return 'Avisó que no venía';
    case 'CANCELLED_LATE':
      return 'Avisó tarde';
    default:
      return 'Sin marcar';
  }
};

const personSecondaryLine = (row: { email?: string | null; phone?: string | null }) =>
  String(row.phone || '').trim() || String(row.email || '').trim() || 'Sin contacto cargado';

export default function AdminAcademyStudentsPage() {
  return (
    <AdminRouteShell title="Academia | Pique Admin" activeItem="Academia" fromPath="/admin/academia">
      {(user) => <AdminAcademyStudentsPageContent user={user} />}
    </AdminRouteShell>
  );
}

export function AdminAcademyStudentsPageContent({ user, embedded = false }: { user: any; embedded?: boolean }) {
  const normalizedUser = useMemo(() => normalizeSessionUser(user || null), [user]);
  const clubSlug = useMemo(() => getActiveClubSlug(normalizedUser), [normalizedUser]);

  const [students, setStudents] = useState<AdminAcademyStudentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [studentFilter, setStudentFilter] = useState<StudentFilter>('all');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [studentDrawerTab, setStudentDrawerTab] = useState<'summary' | 'classes' | 'credits'>('summary');
  const [studentPackModalOpen, setStudentPackModalOpen] = useState(false);
  const [studentPackForm, setStudentPackForm] = useState<StudentPackFormState>(buildEmptyStudentPackForm);
  const [studentPackError, setStudentPackError] = useState('');
  const [studentPackSubmitting, setStudentPackSubmitting] = useState(false);
  const [overview, setOverview] = useState<AdminAcademyStudentOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [enrollDrawerOpen, setEnrollDrawerOpen] = useState(false);
  // Cobro de una clase desde la ficha: abre la cuenta encima (la ficha vuelve al cerrar).
  const [chargeAccount, setChargeAccount] = useState<{
    accountId: string;
    initialView: AccountDrawerInitialView;
    context: AccountDrawerContext;
  } | null>(null);
  const [chargeBusyId, setChargeBusyId] = useState<string | null>(null);
  const [plansVersion, setPlansVersion] = useState(0);
  const studentsRequestRef = useRef(0);
  const overviewRequestRef = useRef(0);
  // Desde la ficha del cliente: /admin/academia?tab=alumnos&alumno=<clientId>
  const studentFromUrlHandledRef = useRef(false);
  useEffect(() => {
    if (studentFromUrlHandledRef.current || typeof window === 'undefined' || students.length === 0) return;
    const fromUrl = new URLSearchParams(window.location.search).get('alumno');
    studentFromUrlHandledRef.current = true;
    if (!fromUrl || !students.some((row) => String(row.client.id) === fromUrl)) return;
    setStudentFilter('all');
    setStudentDrawerTab('summary');
    setSelectedStudentId(fromUrl);
  }, [students]);

  const loadStudents = useCallback(
    async (query?: string) => {
      if (!clubSlug) {
        setStudents([]);
        setLoading(false);
        return;
      }
      const requestId = studentsRequestRef.current + 1;
      studentsRequestRef.current = requestId;
      try {
        setLoading(true);
        const rows = await ClubAdminService.getAcademyStudents(clubSlug, { q: query?.trim() || undefined });
        if (studentsRequestRef.current !== requestId) return;
        setStudents(rows);
        setFeedback(null);
      } catch (error) {
        if (studentsRequestRef.current !== requestId) return;
        reportUiError({ area: 'AdminAcademyStudentsPage', action: 'loadStudents' }, error);
        setStudents([]);
        setFeedback({
          tone: 'error',
          message: extractErrorMessage(error, 'No se pudieron cargar los alumnos de Academia.'),
        });
      } finally {
        if (studentsRequestRef.current !== requestId) return;
        setLoading(false);
      }
    },
    [clubSlug]
  );

  const loadOverview = useCallback(
    async (clientId: string) => {
      if (!clubSlug) return;
      const requestId = overviewRequestRef.current + 1;
      overviewRequestRef.current = requestId;
      try {
        setOverviewLoading(true);
        setOverviewError('');
        const row = await ClubAdminService.getAcademyStudentOverview(clubSlug, clientId);
        if (overviewRequestRef.current !== requestId) return;
        setOverview(row);
      } catch (error) {
        if (overviewRequestRef.current !== requestId) return;
        reportUiError({ area: 'AdminAcademyStudentsPage', action: 'loadOverview' }, error);
        setOverview(null);
        setOverviewError(
          extractErrorMessage(error, 'No se pudo cargar el resumen académico del alumno.')
        );
      } finally {
        if (overviewRequestRef.current !== requestId) return;
        setOverviewLoading(false);
      }
    },
    [clubSlug]
  );

  const closeStudentPackModal = useCallback(() => {
    if (studentPackSubmitting) return;
    setStudentPackModalOpen(false);
    setStudentPackForm(buildEmptyStudentPackForm());
    setStudentPackError('');
  }, [studentPackSubmitting]);

  const submitStudentPackForm = useCallback(async () => {
    if (!clubSlug || !overview || studentPackSubmitting) return;

    const totalCredits = Number(studentPackForm.totalCredits);
    const packageName =
      studentPackForm.packageName.trim() ||
      (Number.isInteger(totalCredits) && totalCredits > 0 ? `Pack ${totalCredits} clase${totalCredits === 1 ? '' : 's'}` : '');
    const parsedPrice = studentPackForm.priceAtPurchase.trim() ? Number(studentPackForm.priceAtPurchase) : null;
    const expiresAt = studentPackForm.expiresAt ? new Date(`${studentPackForm.expiresAt}T23:59:59`).toISOString() : null;

    if (packageName.length < 2) {
      setStudentPackError('Poné cuántas clases trae el pack.');
      return;
    }

    if (!Number.isInteger(totalCredits) || totalCredits <= 0) {
      setStudentPackError('Poné cuántas clases trae el pack.');
      return;
    }

    if (parsedPrice != null && (!Number.isFinite(parsedPrice) || parsedPrice <= 0)) {
      setStudentPackError('Si cargás un precio, debe ser mayor a 0.');
      return;
    }

    try {
      setStudentPackSubmitting(true);
      setStudentPackError('');
      await ClubAdminService.createClassPass(clubSlug, {
        ownerClientId: overview.client.id,
        ownerUserId: overview.client.linkedUser?.id ?? undefined,
        beneficiaryClientId: overview.client.id,
        beneficiaryUserId: overview.client.linkedUser?.id ?? undefined,
        packageName,
        totalCredits,
        priceAtPurchase: parsedPrice,
        expiresAt,
        notes: studentPackForm.notes.trim() || null,
      });

      showAdminToast('Pack cargado.');
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('academy:changed'));
      void loadStudents(searchTerm);
      setStudentPackModalOpen(false);
      setStudentPackForm(buildEmptyStudentPackForm());
      setStudentPackError('');
      await loadOverview(overview.client.id);
    } catch (error) {
      reportUiError({ area: 'AdminAcademyStudentsPage', action: 'submitStudentPackForm' }, error);
      setStudentPackError(extractErrorMessage(error, 'No se pudo asignar el pack al alumno.'));
    } finally {
      setStudentPackSubmitting(false);
    }
  }, [clubSlug, loadOverview, loadStudents, overview, searchTerm, studentPackForm, studentPackSubmitting]);

  useEffect(() => {
    const query = searchTerm.trim();
    const timer = window.setTimeout(() => {
      void loadStudents(query);
    }, query ? 220 : 0);

    return () => window.clearTimeout(timer);
  }, [loadStudents, searchTerm]);

  useEffect(() => {
    if (!selectedStudentId) {
      overviewRequestRef.current += 1;
      setOverview(null);
      setOverviewError('');
      setOverviewLoading(false);
      return;
    }
    setStudentDrawerTab('summary');
    void loadOverview(selectedStudentId);
  }, [loadOverview, selectedStudentId]);

  useEffect(() => {
    if (!selectedStudentId) return;
    if (!students.some((row) => row.client.id === selectedStudentId)) {
      setSelectedStudentId(null);
      setOverview(null);
    }
  }, [selectedStudentId, students]);

  const summary = useMemo(() => {
    return students.reduce(
      (acc, row) => {
        acc.totalStudents += 1;
        acc.totalRemainingCredits += row.summary.totalRemainingCredits;
        acc.totalActivePasses += row.summary.activePassesCount;
        if (row.summary.upcomingEnrollmentsCount > 0) acc.studentsWithUpcoming += 1;
        return acc;
      },
      {
        totalStudents: 0,
        totalRemainingCredits: 0,
        totalActivePasses: 0,
        studentsWithUpcoming: 0,
      }
    );
  }, [students]);

  const selectedStudentListRow = useMemo(
    () => students.find((row) => row.client.id === selectedStudentId) || null,
    [selectedStudentId, students]
  );

  const visibleStudents = useMemo(() => {
    if (studentFilter === 'upcoming') return students.filter((row) => row.summary.upcomingEnrollmentsCount > 0);
    if (studentFilter === 'credits') return students.filter((row) => row.summary.totalRemainingCredits > 0);
    return students;
  }, [studentFilter, students]);

  const closeStudentDrawer = () => {
    setSelectedStudentId(null);
    setOverview(null);
    setOverviewError('');
    setStudentPackModalOpen(false);
    setStudentPackForm(buildEmptyStudentPackForm());
    setStudentPackError('');
  };

  const openPackModal = () => {
    setStudentPackForm(buildEmptyStudentPackForm());
    setStudentPackError('');
    setStudentPackModalOpen(true);
  };

  const refreshStudent = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('academy:changed'));
    void loadStudents(searchTerm);
    if (overview) void loadOverview(overview.client.id);
  };

  const chargeEnrollment = async (row: AdminAcademyStudentOverview['upcomingEnrollments'][number]) => {
    if (!clubSlug || chargeBusyId) return;
    try {
      setChargeBusyId(row.id);
      let payload = await ClubAdminService.getClassEnrollmentAccount(clubSlug, row.id);
      if (!payload.account?.id) payload = await ClubAdminService.openClassEnrollmentAccount(clubSlug, row.id);
      const accountId = payload.account?.id;
      if (!accountId) throw new Error(payload.blockedReason || 'No se pudo abrir la cuenta de la clase.');
      setChargeAccount({
        accountId,
        initialView: 'payment',
        context: {
          title: overview?.client.name || row.snapshotName,
          subtitle: [
            'Clase',
            row.classSession.activityType?.name,
            row.classSession.teacher?.displayName ? `con ${row.classSession.teacher.displayName}` : null,
            formatClassWhen(row.classSession.startsAt),
          ]
            .filter(Boolean)
            .join(' · '),
        },
      });
    } catch (error) {
      reportUiError({ area: 'AdminAcademyStudentsPage', action: 'chargeEnrollment' }, error);
      showAdminToast(extractErrorMessage(error, 'No se pudo abrir el cobro de la clase.'));
    } finally {
      setChargeBusyId(null);
    }
  };

  return (
    <div
      className={`flex h-full min-h-0 flex-col gap-4 overflow-y-auto ${
        embedded ? 'px-0 pb-6' : 'p-4 pb-4 lg:p-6 lg:pb-6'
      }`}
    >
      {feedback ? (
        <AdminFeedbackBanner tone={feedback.tone} title={feedback.tone === 'error' ? 'Error' : 'Listo'}>
          {feedback.message}
        </AdminFeedbackBanner>
      ) : null}

      {summary.totalStudents > 0 && (
        <p className="text-[14px] text-p-text-secondary">
          <span className="font-semibold text-p-text">
            {summary.totalStudents === 1 ? '1 alumno' : `${summary.totalStudents} alumnos`}
          </span>
          {summary.studentsWithUpcoming > 0 ? ` · ${summary.studentsWithUpcoming} con clases próximas` : ''}
          {summary.totalRemainingCredits > 0 ? ` · ${summary.totalRemainingCredits} clases a favor en packs` : ''}
        </p>
      )}

      <AdminPanel
        title="Alumnos"
        description="Quién viene a clases, cuántas le quedan y cuándo es la próxima."
        bodyClassName="p-0"
        className={academyPanelClass}
        headerClassName={academyPanelHeaderClass}
        actions={
          <AdminFilterToolbar className="border-0 bg-transparent p-0 gap-2 sm:flex-nowrap sm:justify-end">
            <AdminSegmentedControl
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'upcoming', label: 'Con clases' },
                { value: 'credits', label: 'Con pack' },
              ]}
              value={studentFilter}
              onChange={(value) => setStudentFilter(value as StudentFilter)}
              ariaLabel="Qué alumnos ver"
              variant="filter"
              className="w-fit"
            />
            <AdminSearchInput
              placeholder="Buscar por nombre o teléfono..."
              value={searchTerm}
              onChange={(value) => setSearchTerm(value)}
              wrapperClassName="w-full sm:w-[260px] sm:flex-none"
            />
          </AdminFilterToolbar>
        }
      >
        {loading && students.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-p-border border-t-p-accent" />
          </div>
        ) : visibleStudents.length === 0 ? (
          <div className="p-4 lg:p-5">
            <AcademyEmptyState
              title={
                searchTerm.trim()
                  ? 'No hay alumnos con esa búsqueda'
                  : studentFilter === 'upcoming'
                    ? 'Nadie tiene clases próximas'
                    : studentFilter === 'credits'
                      ? 'Nadie tiene clases a favor'
                      : 'Todavía no hay alumnos'
              }
              description={
                searchTerm.trim() || studentFilter !== 'all'
                  ? undefined
                  : 'Aparecen acá cuando anotás a alguien en una clase o le vendés un pack.'
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-p-border">
            {visibleStudents.map((row) => {
              const selected = row.client.id === selectedStudentId;
              return (
                <li key={row.client.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedStudentId(row.client.id)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-p-surface-2 lg:px-5 ${
                      selected ? 'bg-p-surface-2' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-p-text">{row.client.name}</p>
                      <p className="truncate text-[12px] text-p-text-muted">
                        {row.nextClassAt
                          ? `Próxima: ${formatClassWhen(row.nextClassAt)}`
                          : row.lastClassAt
                            ? `Última clase: ${formatShortDate(row.lastClassAt)}`
                            : 'Sin clases todavía'}
                      </p>
                    </div>
                    {row.summary.totalRemainingCredits > 0 ? (
                      <div className="flex-none text-right">
                        <p className="text-[14px] font-semibold text-p-text">{row.summary.totalRemainingCredits}</p>
                        <p className="text-[11px] text-p-text-muted">
                          {row.summary.totalRemainingCredits === 1 ? 'clase a favor' : 'clases a favor'}
                        </p>
                      </div>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </AdminPanel>

      <AdminDrawer
        open={Boolean(selectedStudentId)}
        onClose={closeStudentDrawer}
        title={overview?.client.name || selectedStudentListRow?.client.name || 'Alumno'}
        subtitle={
          overview
            ? [overview.client.phone, overview.client.email].filter(Boolean).join(' · ') || 'Sin teléfono ni email'
            : undefined
        }
        size="lg"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={openPackModal} disabled={!overview} className={adminButton('secondary', 'lg')}>
              Cargar pack
            </button>
            <button
              type="button"
              onClick={() => setEnrollDrawerOpen(true)}
              disabled={!overview}
              className={adminButton('primary', 'lg')}
            >
              Anotar a una clase
            </button>
          </div>
        }
      >
        {overviewLoading && !overview ? (
          <div className="px-1 py-10 text-center">
            <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-p-border border-t-p-accent" />
          </div>
        ) : null}

        {!overviewLoading && overviewError ? <AdminInlineError>{overviewError}</AdminInlineError> : null}

        {overview ? (
          (() => {
            const allEnrollments = [...overview.upcomingEnrollments, ...overview.pastEnrollments];
            const owing = allEnrollments.filter(
              (row) =>
                row.enrollmentStatus !== 'CANCELLED' &&
                (row.paymentStatus === 'UNPAID' || row.paymentStatus === 'PARTIAL') &&
                Number(row.priceAtEnrollment || 0) - Number(row.paidAmount || 0) > 0
            );
            const owedAmount = owing.reduce(
              (total, row) => total + Math.max(0, Number(row.priceAtEnrollment || 0) - Number(row.paidAmount || 0)),
              0
            );
            const passes = [
              ...overview.beneficiaryPasses,
              ...overview.ownedPasses.filter((row) => row.beneficiaryClientId !== overview.client.id),
            ];
            const activePasses = passes.filter((row) => row.status === 'ACTIVE');
            const oldPasses = passes.filter((row) => row.status !== 'ACTIVE');
            const attended = overview.pastEnrollments.filter((row) => row.attendanceStatus === 'ATTENDED').length;
            const marked = overview.pastEnrollments.filter(
              (row) => row.enrollmentStatus !== 'CANCELLED' && row.attendanceStatus !== 'PENDING'
            ).length;
            const sectionTitle = 'text-[13px] font-semibold text-p-text';
            const nowMs = Date.now();
            const pastClasses = overview.pastEnrollments
              .filter((row) => new Date(row.classSession.startsAt).getTime() <= nowMs)
              .sort((a, b) => new Date(b.classSession.startsAt).getTime() - new Date(a.classSession.startsAt).getTime());
            const listCls = 'divide-y divide-p-border overflow-hidden rounded-2xl border border-p-border bg-p-surface';

            return (
              <div className="space-y-6">
                <p className="text-[14px] text-p-text-secondary">
                  {overview.summary.upcomingEnrollmentsCount > 0
                    ? overview.summary.upcomingEnrollmentsCount === 1
                      ? 'Tiene 1 clase próxima'
                      : `Tiene ${overview.summary.upcomingEnrollmentsCount} clases próximas`
                    : 'No tiene clases próximas'}
                  {overview.summary.totalRemainingCredits > 0
                    ? ` · ${overview.summary.totalRemainingCredits} a favor en packs`
                    : ''}
                  {marked > 0 ? ` · vino a ${attended} de ${marked}` : ''}.
                </p>

                {owedAmount > 0 ? (
                  <section className="space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className={sectionTitle}>Debe</p>
                      <p className="text-[15px] font-semibold tabular-nums text-p-warning">{formatCurrency(owedAmount)}</p>
                    </div>
                    <ul className={listCls}>
                      {owing.map((row) => {
                        const owed = Math.max(0, Number(row.priceAtEnrollment || 0) - Number(row.paidAmount || 0));
                        return (
                          <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[14px] font-medium text-p-text">
                                {formatClassWhen(row.classSession.startsAt)}
                              </p>
                              <p className="truncate text-[12px] text-p-text-muted">
                                {[row.classSession.activityType?.name || 'Clase', row.classSession.teacher?.displayName ? `con ${row.classSession.teacher.displayName}` : null]
                                  .filter(Boolean)
                                  .join(' ')}
                              </p>
                            </div>
                            <span className="shrink-0 text-[13px] font-semibold tabular-nums text-p-warning">
                              {formatCurrency(owed)}
                            </span>
                            <button
                              type="button"
                              onClick={() => void chargeEnrollment(row)}
                              disabled={Boolean(chargeBusyId)}
                              className={adminButton('primary', 'sm')}
                            >
                              {chargeBusyId === row.id ? 'Abriendo...' : 'Cobrar'}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null}

                {(() => {
                  const active = overview.upcomingEnrollments.filter((row) => row.enrollmentStatus !== 'CANCELLED');
                  const courses = new Map<string, { series: NonNullable<(typeof active)[number]['classSession']['series']>; rows: typeof active }>();
                  for (const row of active) {
                    const series = row.classSession.series;
                    if (!series) continue;
                    const entry = courses.get(series.id) || { series, rows: [] };
                    entry.rows.push(row);
                    courses.set(series.id, entry);
                  }
                  if (!courses.size) return null;
                  return (
                    <section className="space-y-2">
                      <p className={sectionTitle}>Cursos</p>
                      <ul className={listCls}>
                        {[...courses.values()].map(({ series, rows }) => {
                          const first = rows[0];
                          const covered = rows.filter((row) => row.paymentStatus === 'COVERED_BY_CREDIT' || row.paymentStatus === 'PAID').length;
                          return (
                            <li key={series.id} className="flex items-center gap-3 px-4 py-3">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-semibold text-p-text">
                                  {seriesWeekdaysLabel(series.weekdays)} {series.startTime}
                                  <span className="font-normal text-p-text-secondary">
                                    {' '}· {first.classSession.activityType?.name || 'Clase'} con {first.classSession.teacher?.displayName || 'sin profesor'}
                                  </span>
                                </p>
                                <p className="truncate text-[12px] text-p-text-muted">
                                  {rows.length === 1 ? '1 clase por delante' : `${rows.length} clases por delante`} · próxima {formatClassWhen(first.classSession.startsAt)}
                                </p>
                              </div>
                              <p className="flex-none text-right text-[12px] text-p-text-muted">
                                {covered === rows.length ? 'Pagas' : covered > 0 ? `${covered} pagas` : ''}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })()}

                {overview.upcomingEnrollments.length && !overview.upcomingEnrollments.some((row) => !row.classSession.series) ? null : (
                <section className="space-y-2">
                  <p className={sectionTitle}>{overview.upcomingEnrollments.some((row) => row.classSession.series) ? 'Clases sueltas' : 'Próximas clases'}</p>
                  {overview.upcomingEnrollments.some((row) => !row.classSession.series) ? (
                    <ul className={listCls}>
                      {overview.upcomingEnrollments
                        .filter((row) => !row.classSession.series)
                        .map((row) => (
                          <StudentClassRow key={row.id} row={row} />
                        ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-p-text-muted">Ninguna. Anotalo con &ldquo;Anotar a una clase&rdquo;.</p>
                  )}
                </section>
                )}

                <section className="space-y-2">
                  <p className={sectionTitle}>Packs de clases</p>
                  {activePasses.length ? (
                    <ul className={listCls}>
                      {activePasses.map((row) => (
                        <StudentPassRow key={row.id} row={row} clientId={overview.client.id} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-p-text-muted">
                      No tiene packs activos. Con un pack, las clases se descuentan solas en vez de cobrarlas una por una.
                    </p>
                  )}
                  {oldPasses.length ? (
                    <p className="text-[12px] text-p-text-muted">
                      {oldPasses.length === 1 ? '1 pack terminado o vencido.' : `${oldPasses.length} packs terminados o vencidos.`}
                    </p>
                  ) : null}
                </section>

                <section>
                  <ClientSubscriptionsPanel
                    key={plansVersion}
                    clubSlug={clubSlug || ''}
                    clientId={overview.client.id}
                    clientName={overview.client.name}
                    canManage={hasAdminAccess(user)}
                    onChanged={refreshStudent}
                  />
                </section>

                {pastClasses.length ? (
                  <section className="space-y-2">
                    <p className={sectionTitle}>Últimas clases</p>
                    <ul className={listCls}>
                      {pastClasses.slice(0, 8).map((row) => (
                        <StudentClassRow key={row.id} row={row} past />
                      ))}
                    </ul>
                  </section>
                ) : null}

                {overview.billingResponsibles.length ? (
                  <section className="space-y-1">
                    <p className={sectionTitle}>Quién paga</p>
                    <p className="text-[13px] text-p-text-secondary">
                      {overview.billingResponsibles.map((row) => row.name).join(', ')}
                    </p>
                  </section>
                ) : null}
              </div>
            );
          })()
        ) : null}
      </AdminDrawer>

      <StudentEnrollDrawer
        open={enrollDrawerOpen}
        onClose={() => setEnrollDrawerOpen(false)}
        clubSlug={clubSlug || ''}
        student={
          overview
            ? { id: overview.client.id, name: overview.client.name, userId: overview.client.linkedUser?.id ?? null }
            : null
        }
        enrolledSessionIds={overview ? overview.upcomingEnrollments.map((row) => row.classSessionId) : []}
        onEnrolled={refreshStudent}
      />

      <AccountDrawer
        accountId={chargeAccount?.accountId || null}
        open={Boolean(chargeAccount)}
        initialView={chargeAccount?.initialView}
        context={chargeAccount?.context}
        onClose={() => setChargeAccount(null)}
        onSuccess={() => {
          refreshStudent();
          setPlansVersion((value) => value + 1);
        }}
      />

      <AdminAppModal
        show={studentPackModalOpen}
        onClose={closeStudentPackModal}
        onCancel={closeStudentPackModal}
        title={overview ? `Pack de clases para ${overview.client.name}` : 'Pack de clases'}
        confirmText={studentPackSubmitting ? 'Guardando...' : 'Cargar pack'}
        cancelText="Cancelar"
        confirmDisabled={studentPackSubmitting || !studentPackForm.totalCredits.trim()}
        onConfirm={() => void submitStudentPackForm()}
        message={
          <div className="space-y-4">
            {studentPackError ? <AdminInlineError>{studentPackError}</AdminInlineError> : null}

            <div className="space-y-2">
              <p className="text-[13px] font-semibold text-p-text">¿Cuántas clases?</p>
              <div className="flex flex-wrap items-center gap-2">
                {PACK_SIZE_CHOICES.map((size) => {
                  const active = studentPackForm.totalCredits === String(size);
                  return (
                    <button
                      key={size}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setStudentPackForm((prev) => ({ ...prev, totalCredits: String(size) }))}
                      className={adminChip(active)}
                    >
                      {size}
                    </button>
                  );
                })}
                <label className="inline-flex items-center gap-2 text-[13px] text-p-text-secondary">
                  otra:
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={PACK_SIZE_CHOICES.includes(Number(studentPackForm.totalCredits)) ? '' : studentPackForm.totalCredits}
                    onChange={(event) => setStudentPackForm((prev) => ({ ...prev, totalCredits: event.target.value }))}
                    className={fieldInputClass.replace('w-full', 'w-20')}
                  />
                </label>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-p-text">
                  Precio <span className="font-normal text-p-text-muted">(opcional)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={studentPackForm.priceAtPurchase}
                  onChange={(event) => setStudentPackForm((prev) => ({ ...prev, priceAtPurchase: event.target.value }))}
                  placeholder="$"
                  className={fieldInputClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-p-text">
                  Vence <span className="font-normal text-p-text-muted">(opcional)</span>
                </label>
                <input
                  type="date"
                  value={studentPackForm.expiresAt}
                  onChange={(event) => setStudentPackForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
                  className={fieldInputClass}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-semibold text-p-text">
                Notas <span className="font-normal text-p-text-muted">(opcional)</span>
              </label>
              <textarea
                value={studentPackForm.notes}
                onChange={(event) => setStudentPackForm((prev) => ({ ...prev, notes: event.target.value }))}
                className={fieldTextAreaClass}
              />
            </div>

            <p className="text-[12px] text-p-text-muted">
              Cargar el pack no registra el pago.
            </p>
          </div>
        }
      />
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/admin/academia?tab=alumnos', permanent: false },
});

type StudentEnrollmentRow = AdminAcademyStudentOverview['upcomingEnrollments'][number];
type StudentPassRowData = AdminAcademyStudentOverview['beneficiaryPasses'][number];

function StudentClassRow({ row, past = false }: { row: StudentEnrollmentRow; past?: boolean }) {
  const payment = enrollmentPaymentText(row);
  const owes = row.enrollmentStatus !== 'CANCELLED' && payment.startsWith('Debe');
  const cancelledClass = row.classSession.status === 'CANCELLED';
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="w-[92px] flex-none">
        <p className={`text-[13px] font-semibold text-p-text ${cancelledClass ? 'line-through' : ''}`}>
          {formatClassDay(row.classSession.startsAt)}
        </p>
        <p className="text-[12px] text-p-text-muted">{formatClassTime(row.classSession.startsAt)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-p-text">
          {row.classSession.activityType?.name || 'Clase'}
          <span className="font-normal text-p-text-secondary">
            {' '}con {row.classSession.teacher?.displayName || 'sin profesor'}
          </span>
        </p>
        <p className="truncate text-[12px] text-p-text-muted">
          {cancelledClass
            ? 'Clase cancelada'
            : [past ? enrollmentAttendanceText(row) : row.enrollmentStatus === 'WAITLISTED' ? 'En espera' : null, row.enrollmentStatus === 'CANCELLED' && !past ? 'Se bajó' : null]
                .filter(Boolean)
                .join(' · ') || (row.classSession.court?.name ?? 'Sin cancha')}
        </p>
      </div>
      <p className={`flex-none text-right text-[12px] ${owes ? 'font-semibold text-[var(--error-fg)]' : 'text-p-text-muted'}`}>
        {row.enrollmentStatus === 'CANCELLED' ? '' : payment}
      </p>
    </li>
  );
}

function StudentPassRow({ row, clientId }: { row: StudentPassRowData; clientId: string }) {
  const used = Math.max(0, row.totalCredits - row.remainingCredits);
  const ownerIsOther = row.ownerClient?.id && row.ownerClient.id !== clientId;
  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-[13px] font-semibold text-p-text">{row.packageName}</p>
        <p className="flex-none text-[13px] text-p-text">
          <span className="font-semibold">{row.remainingCredits}</span>
          <span className="text-p-text-muted"> de {row.totalCredits} quedan</span>
        </p>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-p-surface-3">
        <div
          className="h-full rounded-full bg-ink-900"
          style={{ width: `${Math.round((row.remainingCredits / Math.max(1, row.totalCredits)) * 100)}%` }}
        />
      </div>
      <p className="mt-1.5 text-[12px] text-p-text-muted">
        {[
          used > 0 ? (used === 1 ? 'Usó 1' : `Usó ${used}`) : 'Sin usar',
          row.expiresAt ? `vence el ${formatShortDate(row.expiresAt)}` : null,
          row.activityType?.name ? `solo ${row.activityType.name}` : null,
          row.teacher?.displayName ? `con ${row.teacher.displayName}` : null,
          ownerIsOther ? `lo paga ${row.ownerClient?.name}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </li>
  );
}
