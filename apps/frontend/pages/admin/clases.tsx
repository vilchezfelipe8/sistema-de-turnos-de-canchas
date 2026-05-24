import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, XCircle } from 'lucide-react';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import {
  AdminDataTable,
  type AdminDataTableColumn,
  AdminFeedbackBanner,
  AdminFilterToolbar,
  AdminInlineError,
  AdminModal,
  AdminPageHeader,
  AdminPanel,
  AdminSegmentedControl,
} from '../../components/admin/ui';
import {
  ClubAdminService,
  type AdminClassSession,
  type AdminClassSessionStatus,
  type AdminClassSessionType,
  type AdminClassSessionVisibility,
  type AdminTeacher,
  type ClubActivityType,
} from '../../services/ClubAdminService';
import { getApiFieldErrors } from '../../utils/apiError';
import { showAdminToast } from '../../utils/adminToast';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';

type ClassStatusFilter = 'all' | 'active' | 'completed' | 'cancelled';

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

const buildEmptyForm = (): ClassFormState => {
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

const formatDateTime = (value: string) => {
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

export default function AdminClassesPage() {
  return (
    <AdminRouteShell title="Clases | Pique Admin" activeItem="Clases" fromPath="/admin/clases">
      {(user) => <AdminClassesPageContent user={user} />}
    </AdminRouteShell>
  );
}

function AdminClassesPageContent({ user }: { user: any }) {
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
  const [form, setForm] = useState<ClassFormState>(() => buildEmptyForm());
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

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

  useEffect(() => {
    void loadClassSessions();
    void loadOptions();
  }, [loadClassSessions, loadOptions]);

  const summary = useMemo(() => {
    const publicCount = classSessions.filter((row) => row.visibility === 'PUBLIC').length;
    const groupCount = classSessions.filter((row) => row.classType === 'GROUP').length;
    const cancelled = classSessions.filter((row) => row.status === 'CANCELLED').length;
    return {
      total: classSessions.length,
      publicCount,
      groupCount,
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

  const resetForm = useCallback(() => {
    setForm(buildEmptyForm());
    setFormError('');
    setFieldErrors({});
    setEditingClassId(null);
  }, []);

  const openCreateModal = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const openEditModal = useCallback(async (classSessionId: string) => {
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
  }, [clubSlug]);

  const closeModal = useCallback(() => {
    if (submitting) return;
    setModalOpen(false);
    resetForm();
  }, [resetForm, submitting]);

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

      closeModal();
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

  const updateStatus = useCallback(async (classSession: AdminClassSession, nextStatus: AdminClassSessionStatus) => {
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
  }, [clubSlug, loadClassSessions, statusBusyId]);

  const columns = useMemo<AdminDataTableColumn<AdminClassSession>[]>(
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
        width: 'w-[190px]',
        render: (classSession) => (
          <div className="flex items-center justify-end gap-2 opacity-100">
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

  const canCreateClass = teachers.length > 0 && !optionsLoading;
  const durationMinutes = durationFromForm(form);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 pb-0 lg:p-6 lg:pb-0">
      <AdminPageHeader
        eyebrow="Academia"
        title="Clases"
        description="Gestioná clases básicas del club sin mezclar todavía inscripciones, agenda compuesta ni cobros."
        actions={
          <button
            type="button"
            onClick={openCreateModal}
            disabled={!canCreateClass}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-ink-900 px-3 text-sm font-semibold text-ink-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:bg-ink-700/60"
          >
            <Plus size={15} />
            Nueva clase
          </button>
        }
      />

      <AdminFeedbackBanner tone="success" title="Diseño del modelo">
        La visibilidad define si la clase se publica o queda cerrada. El formato define si la clase es individual o grupal.
      </AdminFeedbackBanner>

      {feedback && (
        <AdminFeedbackBanner tone={feedback.tone} title={feedback.tone === 'error' ? 'Error' : 'Listo'}>
          {feedback.message}
        </AdminFeedbackBanner>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <AdminPanel title="Clases" bodyClassName="px-4 py-4">
          <p className="text-[28px] font-semibold text-p-text">{summary.total}</p>
          <p className="mt-1 text-[12px] text-p-text-muted">Total cargadas en el club</p>
        </AdminPanel>
        <AdminPanel title="Públicas" bodyClassName="px-4 py-4">
          <p className="text-[28px] font-semibold text-p-accent">{summary.publicCount}</p>
          <p className="mt-1 text-[12px] text-p-text-muted">Visibles para oferta futura</p>
        </AdminPanel>
        <AdminPanel title="Grupales" bodyClassName="px-4 py-4">
          <p className="text-[28px] font-semibold text-p-text">{summary.groupCount}</p>
          <p className="mt-1 text-[12px] text-p-text-muted">Formato con más de un cupo</p>
        </AdminPanel>
        <AdminPanel title="Canceladas" bodyClassName="px-4 py-4">
          <p className="text-[28px] font-semibold text-[var(--error-fg)]">{summary.cancelled}</p>
          <p className="mt-1 text-[12px] text-p-text-muted">Conservadas por trazabilidad</p>
        </AdminPanel>
      </div>

      <AdminPanel
        title="Listado"
        description="Base operativa de clases: profesor, horario, visibilidad, formato, capacidad y estado."
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
          </AdminFilterToolbar>
        }
      >
        <AdminDataTable
          columns={columns}
          data={filteredClasses}
          rowKey={(row) => row.id}
          loading={loading}
          onRowClick={(row) => void openEditModal(row.id)}
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

      <AdminModal
        open={modalOpen}
        onClose={closeModal}
        title={editingClassId ? 'Editar clase' : 'Nueva clase'}
        description="Fase 3 de Academia: clase básica como entidad propia, sin inscripciones ni agenda compuesta todavía."
        maxWidthClassName="max-w-[780px]"
        footer={
          <>
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
          </>
        }
      >
        <form id="class-session-form" onSubmit={submitForm} className="space-y-4">
          {formError && <AdminInlineError>{formError}</AdminInlineError>}

          <div className="rounded-xl border border-p-border bg-p-surface-2 px-4 py-3 text-[12px] text-p-text-secondary">
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
            />
            <SelectField
              label="Estado"
              value={form.status}
              onChange={(value) => setForm((prev) => ({ ...prev, status: value as AdminClassSessionStatus }))}
              error={fieldErrors.status}
              options={CLASS_STATUS_OPTIONS}
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
            />
            <Field
              label="Fin"
              type="datetime-local"
              value={form.endsAt}
              onChange={(value) => setForm((prev) => ({ ...prev, endsAt: value }))}
              error={fieldErrors.endsAt}
              required
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field
              label="Duración"
              value={durationMinutes > 0 ? String(durationMinutes) : ''}
              onChange={() => undefined}
              disabled
              placeholder="Se calcula sola"
              hint="Se calcula a partir del inicio y el fin."
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
            />
            <Field
              label="Precio por alumno"
              type="number"
              value={form.pricePerStudent}
              onChange={(value) => setForm((prev) => ({ ...prev, pricePerStudent: value }))}
              error={fieldErrors.pricePerStudent}
              placeholder="Opcional"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Nivel"
              value={form.level}
              onChange={(value) => setForm((prev) => ({ ...prev, level: value }))}
              error={fieldErrors.level}
              placeholder="Ej: Inicial, Intermedio"
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
          />
        </form>
      </AdminModal>
    </div>
  );
}

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
        className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none transition focus:border-p-accent disabled:cursor-not-allowed disabled:bg-p-surface-2 disabled:text-p-text-muted"
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  options: Array<{ value: string; label: string }>;
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
        className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none transition focus:border-p-accent"
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-semibold text-p-text">{label}</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        placeholder={placeholder}
        className="w-full rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] text-p-text outline-none transition focus:border-p-accent"
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
