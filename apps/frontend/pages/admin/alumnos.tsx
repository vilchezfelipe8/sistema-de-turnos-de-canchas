import type { GetServerSideProps } from 'next';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Users } from 'lucide-react';
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
  AdminDataTable,
  AdminDrawer,
  AdminDrawerSection,
  type AdminDataTableColumn,
  AdminFeedbackBanner,
  AdminFilterToolbar,
  AdminInlineError,
  MetricCard,
  AdminPanel,
} from '../../components/admin/ui';
import {
  ClubAdminService,
  type AdminAcademyStudentListItem,
  type AdminAcademyStudentOverview,
} from '../../services/ClubAdminService';
import { showAdminToast } from '../../utils/adminToast';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';

const drawerSectionCardClass = 'rounded-[22px] border border-p-border bg-p-surface-2 p-4 md:p-5';
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
  const studentsRequestRef = useRef(0);
  const overviewRequestRef = useRef(0);

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

    const packageName = studentPackForm.packageName.trim();
    const totalCredits = Number(studentPackForm.totalCredits);
    const parsedPrice = studentPackForm.priceAtPurchase.trim() ? Number(studentPackForm.priceAtPurchase) : null;
    const expiresAt = studentPackForm.expiresAt ? new Date(`${studentPackForm.expiresAt}T23:59:59`).toISOString() : null;

    if (packageName.length < 2) {
      setStudentPackError('Elegí un nombre claro para el pack.');
      return;
    }

    if (!Number.isInteger(totalCredits) || totalCredits <= 0) {
      setStudentPackError('La cantidad de créditos debe ser un entero mayor a 0.');
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

      showAdminToast('Pack asignado al alumno.');
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
  }, [clubSlug, loadOverview, overview, studentPackForm, studentPackSubmitting]);

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

  const columns = useMemo<AdminDataTableColumn<AdminAcademyStudentListItem>[]>(
    () => [
      {
        key: 'student',
        label: 'Alumno',
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate font-semibold text-p-text">{row.client.name}</p>
            <p className="mt-0.5 text-[12px] text-p-text-muted">{personSecondaryLine(row.client)}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {row.client.linkedUser ? (
                <AcademyStatusBadge label="Usuario Pique" tone="info" />
              ) : null}
              {row.summary.incomingRelationshipsCount > 0 ? (
                <AcademyStatusBadge
                  label={`${row.summary.incomingRelationshipsCount} responsable${row.summary.incomingRelationshipsCount === 1 ? '' : 's'}`}
                  tone="neutral"
                />
              ) : null}
            </div>
          </div>
        ),
      },
      {
        key: 'classes',
        label: 'Clases',
        width: 'w-[170px]',
        render: (row) => (
          <div className="text-[12px] text-p-text-secondary">
            <p className="font-medium text-p-text">{row.summary.upcomingEnrollmentsCount} próximas</p>
            <p className="mt-0.5 text-p-text-muted">{row.summary.pastEnrollmentsCount} pasadas</p>
          </div>
        ),
      },
      {
        key: 'credits',
        label: 'Créditos',
        width: 'w-[150px]',
        render: (row) => (
          <div className="text-[12px] text-p-text-secondary">
            <p className="font-medium text-p-text">{row.summary.totalRemainingCredits} disponibles</p>
            <p className="mt-0.5 text-p-text-muted">{row.summary.activePassesCount} pack{row.summary.activePassesCount === 1 ? '' : 's'} activo{row.summary.activePassesCount === 1 ? '' : 's'}</p>
          </div>
        ),
      },
      {
        key: 'activity',
        label: 'Actividad',
        render: (row) => (
          <div className="text-[12px] text-p-text-secondary">
            <p>Próxima: {formatDateTime(row.nextClassAt)}</p>
            <p className="mt-0.5 text-p-text-muted">Última: {formatDateTime(row.lastClassAt)}</p>
          </div>
        ),
      },
      {
        key: 'actions',
        label: '',
        align: 'right',
        isActions: true,
        width: 'w-[150px]',
        render: (row) => (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setSelectedStudentId(row.client.id)}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-ink-900 px-2.5 text-[11px] font-semibold text-ink-50 shadow-sm transition hover:bg-ink-800"
            >
              <Users size={13} />
              Ver alumno
            </button>
          </div>
        ),
      },
    ],
    []
  );

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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard label="Alumnos activos" value={summary.totalStudents} format="number" className={academyMetricCardClass} />
        <MetricCard label="Con próximas clases" value={summary.studentsWithUpcoming} format="number" valueColor="var(--accent-fg)" className={academyMetricCardClass} />
        <MetricCard label="Créditos disponibles" value={summary.totalRemainingCredits} format="number" className={academyMetricCardClass} />
      </div>

      <AdminPanel
        title="Alumnos de Academia"
        description="Vista operativa para escanear próximas clases, créditos, vínculos y movimiento académico sin abrir reportes."
        bodyClassName="p-0"
        className={academyPanelClass}
        headerClassName={academyPanelHeaderClass}
        actions={
          <AdminFilterToolbar className="border-0 bg-transparent p-0 gap-2 sm:flex-nowrap sm:justify-end">
            <div className="relative w-full sm:w-[320px] sm:flex-none">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-p-text-muted" size={14} strokeWidth={2.5} />
              <input
                type="text"
                placeholder="Buscar por nombre, teléfono o email..."
                className="h-8 w-full rounded-xl border border-p-border bg-p-surface pl-9 pr-3 text-[12px] text-p-text placeholder:text-p-text-muted outline-none transition focus:border-p-accent"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
          </AdminFilterToolbar>
        }
      >
        <AdminDataTable
          columns={columns}
          data={students}
          rowKey={(row) => row.client.id}
          loading={loading}
          onRowClick={(row) => setSelectedStudentId(row.client.id)}
          rowClassName={(row) =>
            row.client.id === selectedStudentId ? 'bg-p-surface-2/80 ring-1 ring-inset ring-p-border-strong' : ''
          }
          empty={{
            title: searchTerm.trim() ? 'No encontramos alumnos con ese criterio' : 'Todavía no hay alumnos con actividad académica',
            description: searchTerm.trim()
              ? 'Probá con otro nombre, teléfono o email.'
              : 'Aparecerán acá cuando el club tenga inscripciones, packs o vínculos académicos cargados.',
          }}
        />
      </AdminPanel>

      <AdminDrawer
        open={Boolean(selectedStudentId)}
        onClose={() => {
          setSelectedStudentId(null);
          setStudentDrawerTab('summary');
          setOverview(null);
          setOverviewError('');
          setStudentPackModalOpen(false);
          setStudentPackForm(buildEmptyStudentPackForm());
          setStudentPackError('');
        }}
        title={overview?.client.name || selectedStudentListRow?.client.name || 'Alumno'}
        subtitle="Resumen rápido de clases, asistencia, packs, consumos y vínculos relevantes de Academia."
        size="lg"
        tabs={[
          { id: 'summary', label: 'Resumen' },
          { id: 'classes', label: 'Clases' },
          { id: 'credits', label: 'Créditos' },
        ]}
        activeTabId={studentDrawerTab}
        onTabChange={(id) => setStudentDrawerTab(id as 'summary' | 'classes' | 'credits')}
        footer={
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setSelectedStudentId(null);
                setStudentDrawerTab('summary');
                setOverview(null);
                setOverviewError('');
                setStudentPackModalOpen(false);
                setStudentPackForm(buildEmptyStudentPackForm());
                setStudentPackError('');
              }}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-p-border px-3 text-sm font-semibold text-p-text-muted transition hover:border-p-border-strong hover:text-p-text"
            >
              Cerrar
            </button>
          </div>
        }
      >
        {overviewLoading ? (
          <div className="rounded-[22px] border border-p-border bg-p-surface-2 p-5 text-sm text-p-text-secondary">
            Cargando resumen académico del alumno...
          </div>
        ) : null}

        {!overviewLoading && overviewError ? <AdminInlineError>{overviewError}</AdminInlineError> : null}

        {!overviewLoading && overview ? (
          <div className="space-y-4">
            {(() => {
              const nextEnrollment = overview.upcomingEnrollments[0] || null;
              const lastEnrollment = overview.pastEnrollments[0] || null;
              const activePasses = overview.beneficiaryPasses.filter((row) => row.status === 'ACTIVE');
              const activeOrOwnedPass = activePasses[0] || overview.ownedPasses[0] || overview.beneficiaryPasses[0] || null;
              const nextExpiry =
                activePasses
                  .map((row) => row.expiresAt)
                  .filter(Boolean)
                  .sort()[0] || null;
              const lastUsage = overview.creditUsages[0] || null;
              const outstandingEnrollments = [...overview.upcomingEnrollments, ...overview.pastEnrollments].filter(
                (row) => row.paymentStatus === 'UNPAID' || row.paymentStatus === 'PARTIAL'
              );
              const outstandingAmount = outstandingEnrollments.reduce(
                (total, row) => total + Math.max(0, Number(row.priceAtEnrollment || 0) - Number(row.paidAmount || 0)),
                0
              );
              const primaryResponsible = overview.billingResponsibles[0]?.name || 'Sin responsable cargado';
              const linkedUserName =
                overview.client.linkedUser
                  ? [overview.client.linkedUser.firstName, overview.client.linkedUser.lastName]
                      .filter(Boolean)
                      .join(' ')
                      .trim() || overview.client.linkedUser.email
                  : 'Sin usuario vinculado';

              if (studentDrawerTab === 'classes') {
                return (
                  <AdminDrawerSection title="Clases" className={drawerSectionCardClass}>
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-3">
                        <SummaryBlock
                          label="Próximas"
                          value={`${overview.summary.upcomingEnrollmentsCount}`}
                        />
                        <SummaryBlock
                          label="Historial"
                          value={`${overview.summary.pastEnrollmentsCount}`}
                        />
                        <SummaryBlock
                          label="Próxima agenda"
                          value={
                            nextEnrollment
                              ? formatDateRange(nextEnrollment.classSession.startsAt, nextEnrollment.classSession.endsAt)
                              : 'Sin clases próximas'
                          }
                        />
                      </div>

                      {overview.upcomingEnrollments.length ? (
                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-p-text-muted">
                            Próximas
                          </p>
                          <div className="space-y-2">
                            {overview.upcomingEnrollments.slice(0, 4).map((row) => (
                              <EnrollmentCompactRow key={row.id} row={row} />
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {overview.pastEnrollments.length ? (
                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-p-text-muted">
                            Últimas clases
                          </p>
                          <div className="space-y-2">
                            {overview.pastEnrollments.slice(0, 5).map((row) => (
                              <EnrollmentCompactRow key={row.id} row={row} />
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {!overview.upcomingEnrollments.length && !overview.pastEnrollments.length ? (
                        <AcademyEmptyState
                          title="Todavía no hay clases cargadas"
                          description="Cuando el alumno tenga inscripciones o historial académico, lo vas a ver acá."
                        />
                      ) : null}
                    </div>
                  </AdminDrawerSection>
                );
              }

              if (studentDrawerTab === 'credits') {
                return (
                  <div className="space-y-4">
                    <AdminDrawerSection title="Créditos" className={drawerSectionCardClass}>
                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-[13px] text-p-text-secondary">
                            Los packs viven a nivel alumno. Desde acá podés asignar uno nuevo sin depender de una clase puntual.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setStudentPackForm(buildEmptyStudentPackForm());
                              setStudentPackError('');
                              setStudentPackModalOpen(true);
                            }}
                            className="inline-flex h-8 shrink-0 self-start items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text transition hover:border-p-border-strong hover:text-p-text sm:self-auto"
                          >
                            <Plus size={14} />
                            Asignar pack
                          </button>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                        <SummaryBlock label="Disponibles" value={`${overview.summary.totalRemainingCredits}`} />
                        <SummaryBlock label="Packs activos" value={`${overview.summary.activePassesCount}`} />
                        <SummaryBlock
                          label="Próximo vencimiento"
                          value={nextExpiry ? formatDateTime(nextExpiry) : 'Sin vencimientos cercanos'}
                        />
                        </div>
                      </div>
                    </AdminDrawerSection>

                    <AdminDrawerSection title="Packs" className={drawerSectionCardClass}>
                      {overview.beneficiaryPasses.length || overview.ownedPasses.length ? (
                        <div className="space-y-3">
                          {[...overview.beneficiaryPasses, ...overview.ownedPasses.filter((row) => row.beneficiaryClientId !== overview.client.id)]
                            .slice(0, 4)
                            .map((row) => (
                              <CompactPassCard
                                key={row.id}
                                row={row}
                                clientId={overview.client.id}
                              />
                            ))}
                        </div>
                      ) : (
                        <AcademyEmptyState
                          title="No hay packs cargados"
                          description="Los packs del alumno van a aparecer acá cuando tenga créditos asignados."
                        />
                      )}
                    </AdminDrawerSection>

                    <AdminDrawerSection title="Consumos" className={drawerSectionCardClass}>
                      {overview.creditUsages.length ? (
                        <div className="space-y-2">
                          {overview.creditUsages.slice(0, 5).map((row) => (
                            <CreditUsageCompactRow key={row.id} row={row} />
                          ))}
                        </div>
                      ) : (
                        <AcademyEmptyState
                          title="Sin consumos todavía"
                          description="Cuando el alumno use créditos en una inscripción, el movimiento va a quedar visible acá."
                        />
                      )}
                    </AdminDrawerSection>
                  </div>
                );
              }

              return (
                <AdminDrawerSection title="Resumen" className={drawerSectionCardClass}>
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <SummaryBlock label="Contacto" value={personSecondaryLine(overview.client)} />
                      <SummaryBlock
                        label="Próxima clase"
                        value={
                          nextEnrollment
                            ? formatDateRange(nextEnrollment.classSession.startsAt, nextEnrollment.classSession.endsAt)
                            : 'Sin clases próximas'
                        }
                      />
                      <SummaryBlock
                        label="Créditos"
                        value={`${overview.summary.totalRemainingCredits} disponibles`}
                      />
                      <SummaryBlock
                        label="Cobro"
                        value={outstandingAmount > 0 ? `${formatCurrency(outstandingAmount)} pendiente` : 'Al día'}
                      />
                      <SummaryBlock label="Responsable" value={primaryResponsible} />
                    </div>

                    <div className="rounded-2xl border border-p-border bg-p-surface p-4">
                      <div className="flex flex-wrap gap-2">
                        <AcademyStatusBadge
                          label={`${overview.summary.upcomingEnrollmentsCount} próxima${overview.summary.upcomingEnrollmentsCount === 1 ? '' : 's'}`}
                          tone="neutral"
                        />
                        <AcademyStatusBadge
                          label={`${overview.summary.activePassesCount} pack${overview.summary.activePassesCount === 1 ? '' : 's'} activo${overview.summary.activePassesCount === 1 ? '' : 's'}`}
                          tone="info"
                        />
                        <AcademyStatusBadge
                          label={linkedUserName === 'Sin usuario vinculado' ? linkedUserName : 'Usuario vinculado'}
                          tone={linkedUserName === 'Sin usuario vinculado' ? 'muted' : 'success'}
                        />
                        {nextEnrollment ? (
                          <AcademyStatusBadge
                            label={paymentStatusLabel(nextEnrollment.paymentStatus)}
                            tone={academyPaymentTone(nextEnrollment.paymentStatus)}
                          />
                        ) : null}
                        {lastUsage ? (
                          <AcademyStatusBadge
                            label={`Último consumo: ${creditUsageReasonLabel(lastUsage.reason)}`}
                            tone="muted"
                          />
                        ) : null}
                      </div>

                      <div className="mt-4 grid gap-3 border-t border-p-border pt-4 md:grid-cols-2">
                        <CompactInfoLine
                          label="Última clase"
                          value={
                            lastEnrollment
                              ? `${lastEnrollment.classSession.teacher?.displayName || 'Clase'} · ${formatDateTime(lastEnrollment.classSession.startsAt)}`
                              : 'Sin historial todavía'
                          }
                        />
                        <CompactInfoLine
                          label="Próximo vencimiento"
                          value={nextExpiry ? formatDateTime(nextExpiry) : 'Sin vencimientos cercanos'}
                        />
                      </div>
                    </div>
                  </div>
                </AdminDrawerSection>
              );
            })()}
          </div>
        ) : null}
      </AdminDrawer>

      <AdminAppModal
        show={studentPackModalOpen}
        onClose={closeStudentPackModal}
        onCancel={closeStudentPackModal}
        title={overview ? `Asignar pack a ${overview.client.name}` : 'Asignar pack'}
        confirmText={studentPackSubmitting ? 'Asignando...' : 'Asignar pack'}
        cancelText="Cancelar"
        confirmDisabled={studentPackSubmitting || !studentPackForm.packageName.trim() || !studentPackForm.totalCredits.trim()}
        onConfirm={() => void submitStudentPackForm()}
        message={
          <div className="space-y-4">
            {studentPackError ? <AdminInlineError>{studentPackError}</AdminInlineError> : null}

            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-p-text">Nombre del pack</label>
              <input
                type="text"
                value={studentPackForm.packageName}
                onChange={(event) => setStudentPackForm((prev) => ({ ...prev, packageName: event.target.value }))}
                placeholder="Ej. Pack 4 clases"
                className={fieldInputClass}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[12px] font-semibold text-p-text">Créditos</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={studentPackForm.totalCredits}
                  onChange={(event) => setStudentPackForm((prev) => ({ ...prev, totalCredits: event.target.value }))}
                  className={fieldInputClass}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[12px] font-semibold text-p-text">Precio acordado</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={studentPackForm.priceAtPurchase}
                  onChange={(event) => setStudentPackForm((prev) => ({ ...prev, priceAtPurchase: event.target.value }))}
                  placeholder="Opcional"
                  className={fieldInputClass}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-p-text">Vencimiento</label>
              <input
                type="date"
                value={studentPackForm.expiresAt}
                onChange={(event) => setStudentPackForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
                className={fieldInputClass}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-p-text">Notas</label>
              <textarea
                value={studentPackForm.notes}
                onChange={(event) => setStudentPackForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Opcional"
                className={fieldTextAreaClass}
              />
            </div>

            <div className="rounded-xl border border-p-border bg-p-surface px-4 py-3 text-[12px] text-p-text-secondary">
              Asignar un pack no registra un pago. Si después querés cobrarlo, abrí la cuenta del pack desde Academia.
            </div>
          </div>
        }
      />
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/admin/academia?tab=alumnos', permanent: false },
});

function SummaryBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-p-border bg-p-surface px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-p-text-muted">{label}</p>
      <p className="mt-2 min-w-0 break-words text-[15px] font-medium leading-snug text-p-text [overflow-wrap:anywhere]">
        {value}
      </p>
    </div>
  );
}

function MiniInfoCard({ title, items, emptyLabel }: { title: string; items: string[]; emptyLabel: string }) {
  const filtered = items.filter(Boolean);
  return (
    <div className="rounded-2xl border border-p-border bg-p-surface p-4">
      <p className="text-[12px] font-semibold text-p-text">{title}</p>
      {filtered.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {filtered.map((item) => (
            <AcademyStatusBadge key={item} label={item} tone="neutral" />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-p-text-muted">{emptyLabel}</p>
      )}
    </div>
  );
}

function OverviewCard({
  title,
  description,
  items,
  footer,
}: {
  title: string;
  description: string;
  items: Array<{ label: string; value: string }>;
  footer?: ReactNode;
}) {
  return (
    <div className="rounded-[22px] border border-p-border bg-p-surface p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <p className="text-[13px] font-semibold text-p-text">{title}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-p-text-muted">{description}</p>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div key={`${title}-${item.label}`} className="flex items-start justify-between gap-3 border-b border-p-border/70 pb-3 last:border-b-0 last:pb-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-p-text-muted">{item.label}</p>
            <p className="max-w-[70%] text-right text-[12px] text-p-text-secondary">{item.value}</p>
          </div>
        ))}
      </div>
      {footer ? <div className="mt-4 border-t border-p-border pt-3">{footer}</div> : null}
    </div>
  );
}

function CompactInfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-p-text-muted">{label}</p>
      <p className="text-[12px] leading-relaxed text-p-text-secondary">{value}</p>
    </div>
  );
}

function EnrollmentCompactRow({
  row,
}: {
  row: AdminAcademyStudentOverview['upcomingEnrollments'][number] | AdminAcademyStudentOverview['pastEnrollments'][number];
}) {
  return (
    <div className="rounded-2xl border border-p-border bg-p-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-p-text">
            {row.classSession.activityType?.name || 'Clase'} · {row.classSession.teacher?.displayName || 'Sin profesor'}
          </p>
          <p className="mt-1 text-[12px] text-p-text-secondary">
            {formatDateRange(row.classSession.startsAt, row.classSession.endsAt)}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <AcademyStatusBadge
            label={attendanceStatusLabel(row.attendanceStatus)}
            tone={academyAttendanceTone(row.attendanceStatus)}
          />
          <AcademyStatusBadge
            label={paymentStatusLabel(row.paymentStatus)}
            tone={academyPaymentTone(row.paymentStatus)}
          />
        </div>
      </div>
    </div>
  );
}

function CompactPassCard({
  row,
  clientId,
}: {
  row: AdminAcademyStudentOverview['beneficiaryPasses'][number] | AdminAcademyStudentOverview['ownedPasses'][number];
  clientId: string;
}) {
  return (
    <div className="rounded-2xl border border-p-border bg-p-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-p-text">{row.packageName}</p>
          <p className="mt-1 text-[12px] text-p-text-secondary">
            {row.remainingCredits}/{row.totalCredits} créditos ·{' '}
            {row.expiresAt ? `Vence ${formatDateTime(row.expiresAt)}` : 'Sin vencimiento'}
          </p>
        </div>
        <AcademyStatusBadge
          label={classPassStatusLabel(row.status)}
          tone={academyPassStatusTone(row.status)}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {row.activityType?.name ? <AcademyStatusBadge label={row.activityType.name} tone="neutral" /> : null}
        {row.classType ? <AcademyStatusBadge label={classTypeLabel(row.classType)} tone="muted" /> : null}
        {row.teacher?.displayName ? <AcademyStatusBadge label={row.teacher.displayName} tone="muted" /> : null}
        <AcademyStatusBadge
          label={
            row.ownerClient?.id && row.ownerClient.id !== clientId ? `Titular: ${row.ownerClient.name}` : 'Titular: el mismo alumno'
          }
          tone="info"
        />
      </div>
    </div>
  );
}

function CreditUsageCompactRow({ row }: { row: AdminAcademyStudentOverview['creditUsages'][number] }) {
  return (
    <div className="rounded-2xl border border-p-border bg-p-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-p-text">
            {row.classPass?.packageName || 'Pack'} · {creditUsageReasonLabel(row.reason)}
          </p>
          <p className="mt-1 text-[12px] text-p-text-secondary">
            {row.classEnrollment?.classSession?.activityType?.name || 'Clase'} · {formatDateTime(row.usedAt)}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <AcademyStatusBadge label={`${row.creditsUsed} crédito${row.creditsUsed === 1 ? '' : 's'}`} tone="info" />
          {row.classPass ? (
            <AcademyStatusBadge
              label={`${row.classPass.remainingCredits} disponibles`}
              tone={academyPassStatusTone(row.classPass.status)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
