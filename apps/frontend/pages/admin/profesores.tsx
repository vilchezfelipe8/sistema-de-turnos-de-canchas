import type { GetServerSideProps } from 'next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Pencil, Plus, Search, UserRoundX } from 'lucide-react';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import {
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
import { ClubAdminService, type AdminTeacher } from '../../services/ClubAdminService';
import { getApiFieldErrors } from '../../utils/apiError';
import { showAdminToast } from '../../utils/adminToast';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';

type TeacherStatusFilter = 'all' | 'active' | 'inactive';

type TeacherFormState = {
  displayName: string;
  email: string;
  phone: string;
  specialtiesText: string;
  notes: string;
  isInternal: boolean;
};

const EMPTY_FORM: TeacherFormState = {
  displayName: '',
  email: '',
  phone: '',
  specialtiesText: '',
  notes: '',
  isInternal: false,
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

const parseSpecialties = (raw: string) =>
  Array.from(
    new Set(
      String(raw || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );

const drawerSectionCardClass = 'rounded-2xl border border-p-border bg-p-surface-2 p-4';
const fieldInputClass =
  'h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text shadow-p-card outline-none transition focus:border-p-accent focus:ring-2 focus:ring-lima-300/30';
const sectionNoteClass = 'rounded-xl border border-p-border bg-p-surface p-3 text-[13px] text-p-text-secondary';

export default function AdminTeachersPage() {
  return (
    <AdminRouteShell title="Academia | Pique Admin" activeItem="Academia" fromPath="/admin/academia">
      {(user) => <AdminTeachersPageContent user={user} />}
    </AdminRouteShell>
  );
}

export function AdminTeachersPageContent({ user, embedded = false }: { user: any; embedded?: boolean }) {
  const normalizedUser = useMemo(() => normalizeSessionUser(user || null), [user]);
  const clubSlug = useMemo(() => getActiveClubSlug(normalizedUser), [normalizedUser]);

  const [teachers, setTeachers] = useState<AdminTeacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<TeacherStatusFilter>('all');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null);
  const [form, setForm] = useState<TeacherFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const loadTeachers = useCallback(async () => {
    if (!clubSlug) {
      setTeachers([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const rows = await ClubAdminService.getTeachers(clubSlug, true);
      setTeachers(rows);
    } catch (error) {
      reportUiError({ area: 'AdminTeachersPage', action: 'loadTeachers' }, error);
      setFeedback({ tone: 'error', message: extractErrorMessage(error, 'No se pudieron cargar los profesores.') });
    } finally {
      setLoading(false);
    }
  }, [clubSlug]);

  useEffect(() => {
    void loadTeachers();
  }, [loadTeachers]);

  const summary = useMemo(() => {
    const active = teachers.filter((teacher) => teacher.isActive).length;
    return {
      total: teachers.length,
      active,
      inactive: Math.max(0, teachers.length - active),
    };
  }, [teachers]);

  const filteredTeachers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return teachers.filter((teacher) => {
      if (statusFilter === 'active' && !teacher.isActive) return false;
      if (statusFilter === 'inactive' && teacher.isActive) return false;
      if (!term) return true;
      const haystack = [
        teacher.displayName,
        teacher.email || '',
        teacher.phone || '',
        teacher.client?.name || '',
        ...(teacher.specialties || []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [searchTerm, statusFilter, teachers]);

  const openCreateModal = () => {
    setEditingTeacherId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setFieldErrors({});
    setModalOpen(true);
  };

  const openEditModal = useCallback(async (teacherId: string) => {
    if (!clubSlug) return;
    try {
      setFormError('');
      setFieldErrors({});
      setSubmitting(true);
      const teacher = await ClubAdminService.getTeacher(clubSlug, teacherId);
      setEditingTeacherId(teacher.id);
      setForm({
        displayName: teacher.displayName || '',
        email: teacher.email || '',
        phone: teacher.phone || '',
        specialtiesText: Array.isArray(teacher.specialties) ? teacher.specialties.join(', ') : '',
        notes: teacher.notes || '',
        isInternal: Boolean(teacher.isInternal),
      });
      setModalOpen(true);
    } catch (error) {
      reportUiError({ area: 'AdminTeachersPage', action: 'openEditModal' }, error);
      setFeedback({ tone: 'error', message: extractErrorMessage(error, 'No se pudo cargar el profesor.') });
    } finally {
      setSubmitting(false);
    }
  }, [clubSlug]);

  const closeModal = useCallback(() => {
    if (submitting) return;
    setModalOpen(false);
    setEditingTeacherId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setFieldErrors({});
  }, [submitting]);

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!clubSlug || submitting) return;

    try {
      setSubmitting(true);
      setFormError('');
      setFieldErrors({});

      const payload = {
        displayName: form.displayName.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        specialties: parseSpecialties(form.specialtiesText),
        notes: form.notes.trim() || null,
        isInternal: Boolean(form.isInternal),
      };

      if (editingTeacherId) {
        await ClubAdminService.updateTeacher(clubSlug, editingTeacherId, payload);
        showAdminToast('Profesor actualizado.');
      } else {
        await ClubAdminService.createTeacher(clubSlug, payload);
        showAdminToast('Profesor creado.');
      }

      closeModal();
      await loadTeachers();
      setFeedback(null);
    } catch (error) {
      reportUiError({ area: 'AdminTeachersPage', action: 'submitForm' }, error);
      setFieldErrors(getApiFieldErrors(error));
      setFormError(extractErrorMessage(error, 'No se pudo guardar el profesor.'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTeacherStatus = useCallback(async (teacher: AdminTeacher) => {
    if (!clubSlug || statusBusyId) return;
    try {
      setStatusBusyId(teacher.id);
      await ClubAdminService.setTeacherActive(clubSlug, teacher.id, !teacher.isActive);
      await loadTeachers();
      showAdminToast(teacher.isActive ? 'Profesor desactivado.' : 'Profesor reactivado.');
    } catch (error) {
      reportUiError({ area: 'AdminTeachersPage', action: 'toggleTeacherStatus' }, error);
      setFeedback({ tone: 'error', message: extractErrorMessage(error, 'No se pudo actualizar el estado del profesor.') });
    } finally {
      setStatusBusyId(null);
    }
  }, [clubSlug, loadTeachers, statusBusyId]);

  const columns = useMemo<AdminDataTableColumn<AdminTeacher>[]>(
    () => [
      {
        key: 'displayName',
        label: 'Profesor',
        render: (teacher) => (
          <div className="min-w-0">
            <p className="truncate font-semibold text-p-text">{teacher.displayName}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-p-text-muted">
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${
                  teacher.isActive
                    ? 'border-p-positive bg-p-positive-bg text-p-positive'
                    : 'border-p-border bg-p-surface-2 text-p-text-muted'
                }`}
              >
                {teacher.isActive ? 'Activo' : 'Inactivo'}
              </span>
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${
                  teacher.isInternal
                    ? 'border-p-accent bg-p-surface-2 text-p-accent'
                    : 'border-p-border bg-p-surface-2 text-p-text-muted'
                }`}
              >
                {teacher.isInternal ? 'Interno' : 'Externo'}
              </span>
            </div>
          </div>
        ),
      },
      {
        key: 'contact',
        label: 'Contacto',
        render: (teacher) => (
          <div className="text-[12px] text-p-text-secondary">
            <p>{teacher.email || 'Sin email'}</p>
            <p className="mt-0.5 text-p-text-muted">{teacher.phone || 'Sin teléfono'}</p>
          </div>
        ),
      },
      {
        key: 'specialties',
        label: 'Especialidades',
        render: (teacher) =>
          teacher.specialties.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {teacher.specialties.slice(0, 3).map((specialty) => (
                <span
                  key={specialty}
                  className="inline-flex rounded-full border border-p-border bg-p-surface-2 px-2 py-0.5 text-[11px] font-medium text-p-text-secondary"
                >
                  {specialty}
                </span>
              ))}
              {teacher.specialties.length > 3 && (
                <span className="inline-flex rounded-full border border-p-border bg-p-surface-2 px-2 py-0.5 text-[11px] font-medium text-p-text-muted">
                  +{teacher.specialties.length - 3}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[12px] text-p-text-muted">Sin especialidades</span>
          ),
      },
      {
        key: 'updatedAt',
        label: 'Actualizado',
        width: 'w-[170px]',
        render: (teacher) => <span className="text-[12px] text-p-text-muted">{formatDateTime(teacher.updatedAt)}</span>,
      },
      {
        key: 'actions',
        label: '',
        align: 'right',
        isActions: true,
        width: 'w-[160px]',
        render: (teacher) => (
          <div className="flex items-center justify-end gap-2 opacity-100">
            <button
              type="button"
              onClick={() => void openEditModal(teacher.id)}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-p-border bg-p-surface px-2.5 text-[11px] font-semibold text-p-text-muted transition hover:border-p-border-strong hover:text-p-text"
            >
              <Pencil size={13} />
              Editar
            </button>
            <button
              type="button"
              onClick={() => void toggleTeacherStatus(teacher)}
              disabled={statusBusyId === teacher.id}
              className={`inline-flex h-8 items-center justify-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold transition ${
                teacher.isActive
                  ? 'border border-p-error bg-p-error-bg text-[var(--error-fg)] hover:bg-[var(--error-fg)] hover:text-ink-50'
                  : 'border border-p-positive bg-p-positive-bg text-p-positive hover:bg-p-positive hover:text-ink-900'
              } disabled:cursor-wait disabled:opacity-70`}
            >
              {teacher.isActive ? <UserRoundX size={13} /> : <CheckCircle2 size={13} />}
              {teacher.isActive ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        ),
      },
    ],
    [openEditModal, statusBusyId, toggleTeacherStatus]
  );

  const teacherFormContent = (
    <form id="teacher-form" onSubmit={submitForm} className="space-y-4">
      {formError && <AdminInlineError>{formError}</AdminInlineError>}

      <AdminDrawerSection title="Datos básicos" className={drawerSectionCardClass}>
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Nombre"
              value={form.displayName}
              onChange={(value) => setForm((prev) => ({ ...prev, displayName: value }))}
              error={fieldErrors.displayName}
              required
              inputClassName={fieldInputClass}
            />
            <Field
              label="Teléfono"
              value={form.phone}
              onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))}
              error={fieldErrors.phone}
              inputClassName={fieldInputClass}
            />
          </div>

          <Field
            label="Email"
            type="email"
            value={form.email}
            onChange={(value) => setForm((prev) => ({ ...prev, email: value }))}
            error={fieldErrors.email}
            inputClassName={fieldInputClass}
          />

          <Field
            label="Especialidades"
            value={form.specialtiesText}
            onChange={(value) => setForm((prev) => ({ ...prev, specialtiesText: value }))}
            error={fieldErrors.specialties}
            placeholder="Ej: Pádel, Tenis, Preparación física"
            hint="Separalas con coma. Se guardan como tags simples."
            inputClassName={fieldInputClass}
          />
        </div>
      </AdminDrawerSection>

      <AdminDrawerSection title="Contexto operativo" className={drawerSectionCardClass}>
        <div className="space-y-4">
          <div className={sectionNoteClass}>
            Este padrón define identidad y disponibilidad operativa del profesor. Las clases que dicte se gestionan aparte.
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-semibold text-p-text">Notas</label>
            <textarea
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              rows={4}
              className={`${fieldInputClass} min-h-[112px] py-2`}
              placeholder="Información operativa, disponibilidad general o contexto del profesor."
            />
            {fieldErrors.notes && <p className="text-[11px] text-[var(--error-fg)]">{fieldErrors.notes}</p>}
          </div>

          <label className="flex items-center gap-2 rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] text-p-text">
            <input
              type="checkbox"
              checked={form.isInternal}
              onChange={(event) => setForm((prev) => ({ ...prev, isInternal: event.target.checked }))}
              className="h-4 w-4 rounded border-p-border"
            />
            Profesor interno del club
          </label>
        </div>
      </AdminDrawerSection>
    </form>
  );

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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <MetricCard
          label="Activos"
          value={summary.active}
          format="number"
          valueColor="var(--positive-fg)"
          delta={{ value: summary.total, label: `de ${summary.total} cargados` }}
        />
        <MetricCard
          label="Inactivos"
          value={summary.inactive}
          format="number"
          valueColor={summary.inactive > 0 ? 'var(--text-muted)' : 'var(--positive-fg)'}
        />
      </div>

      <AdminPanel
        title="Padrón de profesores"
        description="Alta, edición y estado operativo del equipo docente."
        bodyClassName="p-0"
        actions={
          <AdminFilterToolbar className="border-0 bg-transparent p-0 gap-2 sm:flex-nowrap sm:justify-end">
            <AdminSegmentedControl
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'active', label: 'Activos' },
                { value: 'inactive', label: 'Inactivos' },
              ]}
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as TeacherStatusFilter)}
              ariaLabel="Filtro de estado de profesores"
              density="compact"
              className="w-fit"
            />
            <div className="relative w-full sm:w-[300px] sm:flex-none">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-p-text-muted" size={14} strokeWidth={2.5} />
              <input
                type="text"
                placeholder="Buscar por nombre, contacto o especialidad..."
                className="h-8 w-full rounded-xl border border-p-border bg-p-surface pl-9 pr-3 text-[12px] text-p-text placeholder:text-p-text-muted outline-none transition focus:border-p-accent"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-ink-900 px-2.5 text-[11px] font-semibold text-ink-50 shadow-p-md transition hover:bg-ink-800 hover:shadow-p-md sm:w-auto"
            >
              <Plus size={14} strokeWidth={2.5} />
              Nuevo profesor
            </button>
          </AdminFilterToolbar>
        }
      >
        <AdminDataTable
          columns={columns}
          data={filteredTeachers}
          rowKey={(row) => row.id}
          loading={loading}
          onRowClick={(row) => void openEditModal(row.id)}
          empty={{
            title: 'Todavía no hay profesores cargados',
            description: 'Creá el primer profesor para dejar lista la base del módulo Academia.',
            action: (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 transition hover:bg-ink-800"
              >
                <Plus size={14} />
                Nuevo profesor
              </button>
            ),
          }}
        />
      </AdminPanel>

      <AdminDrawer
        open={modalOpen}
        onClose={closeModal}
        title={editingTeacherId ? 'Editar profesor' : 'Nuevo profesor'}
        subtitle="Padrón de profesores con el mismo lenguaje visual del resto del admin: datos, contexto y acciones en un panel lateral."
        size="md"
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
              form="teacher-form"
              disabled={submitting}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-ink-900 px-3 text-sm font-semibold text-ink-50 transition hover:bg-ink-800 disabled:cursor-wait disabled:opacity-70"
            >
              {submitting ? 'Guardando...' : editingTeacherId ? 'Guardar cambios' : 'Crear profesor'}
            </button>
          </div>
        }
      >
        {teacherFormContent}
      </AdminDrawer>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/admin/academia?tab=profesores', permanent: false },
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
        className={inputClassName || "h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none transition focus:border-p-accent"}
      />
      {hint && !error && <p className="text-[11px] text-p-text-muted">{hint}</p>}
      {error && <p className="text-[11px] text-[var(--error-fg)]">{error}</p>}
    </div>
  );
}
