import type { GetServerSideProps } from 'next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Plus, Search } from 'lucide-react';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import { AdminDrawer, AdminFeedbackBanner, AdminInlineError } from '../../components/admin/ui';
import { ClubAdminService, type AdminClassSession, type AdminTeacher } from '../../services/ClubAdminService';
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

/** "mar 10 nov · 19:00". */
const formatClassWhen = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const day = date
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/,/g, '')
    .replace(/\./g, '');
  const time = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${day} · ${time}`;
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

const fieldInputClass =
  'h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[14px] text-p-text outline-none transition focus:border-p-border-strong';

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
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [classSessions, setClassSessions] = useState<AdminClassSession[]>([]);
  const [activityNames, setActivityNames] = useState<string[]>([]);
  const [customSpecialty, setCustomSpecialty] = useState('');

  const loadTeachers = useCallback(async () => {
    if (!clubSlug) {
      setTeachers([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [rows, sessions, activities] = await Promise.all([
        ClubAdminService.getTeachers(clubSlug, true),
        ClubAdminService.getClassSessions(clubSlug).catch(() => [] as AdminClassSession[]),
        ClubAdminService.getActivityTypes(clubSlug).catch(() => [] as any[]),
      ]);
      setTeachers(rows);
      setClassSessions(Array.isArray(sessions) ? sessions : []);
      setActivityNames(
        (Array.isArray(activities) ? activities : [])
          .map((activity: any) => String(activity?.name || '').trim())
          .filter(Boolean)
      );
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

  const selectedTeacher = useMemo(
    () => teachers.find((teacher) => teacher.id === selectedTeacherId) || null,
    [selectedTeacherId, teachers]
  );

  const teacherUpcoming = useMemo(() => {
    if (!selectedTeacher) return [] as AdminClassSession[];
    const now = Date.now();
    return classSessions
      .filter((session) => session.teacherId === selectedTeacher.id && new Date(session.startsAt).getTime() >= now && session.status !== 'CANCELLED')
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
      .slice(0, 5);
  }, [classSessions, selectedTeacher]);

  const classCountByTeacher = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, number>();
    for (const session of classSessions) {
      if (new Date(session.startsAt).getTime() < now || session.status === 'CANCELLED') continue;
      map.set(session.teacherId, (map.get(session.teacherId) || 0) + 1);
    }
    return map;
  }, [classSessions]);

  const selectedSpecialties = parseSpecialties(form.specialtiesText);
  const toggleSpecialty = (name: string) => {
    const has = selectedSpecialties.some((item) => item.toLowerCase() === name.toLowerCase());
    const next = has ? selectedSpecialties.filter((item) => item.toLowerCase() !== name.toLowerCase()) : [...selectedSpecialties, name];
    setForm((prev) => ({ ...prev, specialtiesText: next.join(', ') }));
  };

  const openCreateModal = () => {
    setCustomSpecialty('');
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
      window.dispatchEvent(new Event('academy:changed'));
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
      window.dispatchEvent(new Event('academy:changed'));
      showAdminToast(teacher.isActive ? 'Profesor desactivado.' : 'Profesor reactivado.');
    } catch (error) {
      reportUiError({ area: 'AdminTeachersPage', action: 'toggleTeacherStatus' }, error);
      setFeedback({ tone: 'error', message: extractErrorMessage(error, 'No se pudo actualizar el estado del profesor.') });
    } finally {
      setStatusBusyId(null);
    }
  }, [clubSlug, loadTeachers, statusBusyId]);

  const specialtyOptions = Array.from(new Set([...activityNames, ...selectedSpecialties]));

  const teacherFormContent = (
    <form id="teacher-form" onSubmit={submitForm} className="space-y-4">
      {formError && <AdminInlineError>{formError}</AdminInlineError>}

      <Field
        label="Nombre"
        value={form.displayName}
        onChange={(value) => setForm((prev) => ({ ...prev, displayName: value }))}
        error={fieldErrors.displayName}
        placeholder="Juan Pérez"
        inputClassName={fieldInputClass}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Teléfono"
          value={form.phone}
          onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))}
          error={fieldErrors.phone}
          placeholder="351 555 1234"
          optional
          inputClassName={fieldInputClass}
        />
        <Field
          label="Email"
          type="email"
          value={form.email}
          onChange={(value) => setForm((prev) => ({ ...prev, email: value }))}
          error={fieldErrors.email}
          placeholder="juan@email.com"
          optional
          inputClassName={fieldInputClass}
        />
      </div>

      <div>
        <p className="mb-1.5 text-[13px] font-medium text-p-text">¿Qué enseña?</p>
        <div className="flex flex-wrap gap-2">
          {specialtyOptions.map((name) => {
            const active = selectedSpecialties.some((item) => item.toLowerCase() === name.toLowerCase());
            return (
              <button
                key={name}
                type="button"
                aria-pressed={active}
                onClick={() => toggleSpecialty(name)}
                className={`h-9 rounded-lg border px-3 text-[13px] font-semibold transition ${
                  active ? 'border-ink-900 bg-ink-900 text-ink-50' : 'border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2'
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={customSpecialty}
            onChange={(event) => setCustomSpecialty(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const name = customSpecialty.trim();
              if (name) toggleSpecialty(name);
              setCustomSpecialty('');
            }}
            placeholder="Otra (ej: Preparación física)"
            className="h-9 min-w-0 flex-1 rounded-lg border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-border-strong"
          />
          <button
            type="button"
            onClick={() => {
              const name = customSpecialty.trim();
              if (name) toggleSpecialty(name);
              setCustomSpecialty('');
            }}
            className="h-9 rounded-lg border border-p-border px-3 text-[13px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
          >
            Agregar
          </button>
        </div>
        {fieldErrors.specialties && <p className="mt-1 text-[11px] text-[var(--error-fg)]">{fieldErrors.specialties}</p>}
      </div>

      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={form.isInternal}
          onChange={(event) => setForm((prev) => ({ ...prev, isInternal: event.target.checked }))}
          className="mt-0.5 h-4 w-4 accent-p-brand"
        />
        <span>
          <span className="block text-[14px] font-medium text-p-text">Trabaja para el club</span>
          <span className="block text-[12px] text-p-text-muted">Destildalo si es un profesor externo que alquila la cancha.</span>
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-[13px] font-medium text-p-text">
          Notas <span className="font-normal text-p-text-muted">(opcional)</span>
        </span>
        <textarea
          value={form.notes}
          onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          rows={3}
          className="w-full rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[14px] text-p-text outline-none focus:border-p-border-strong"
          placeholder="Ej: puede martes y jueves a la tarde."
        />
        {fieldErrors.notes && <p className="text-[11px] text-[var(--error-fg)]">{fieldErrors.notes}</p>}
      </label>
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

      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[14px] text-p-text-secondary">
          {summary.total === 0 ? (
            'Todavía no hay profesores.'
          ) : (
            <>
              <span className="font-semibold text-p-text">
                {summary.active === 1 ? '1 profesor' : `${summary.active} profesores`}
              </span>
              {summary.inactive > 0 ? ` · ${summary.inactive} dados de baja` : ''}
            </>
          )}
        </p>
        {summary.total > 0 && (
          <label className="relative w-full sm:w-[240px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-p-text-muted" size={14} />
            <input
              type="text"
              placeholder="Buscar profesor"
              className="h-10 w-full rounded-xl border border-p-border bg-p-surface pl-9 pr-3 text-[13px] text-p-text outline-none focus:border-p-border-strong"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>
        )}
        {summary.inactive > 0 && (
          <button
            type="button"
            onClick={() => setStatusFilter((prev) => (prev === 'all' ? 'active' : 'all'))}
            className="text-[13px] font-semibold text-p-text-secondary hover:underline underline-offset-2"
          >
            {statusFilter === 'all' ? 'Ocultar dados de baja' : 'Ver dados de baja'}
          </button>
        )}
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-3.5 text-[13px] font-semibold text-ink-50 hover:bg-ink-800"
        >
          <Plus size={15} strokeWidth={2.5} />
          Nuevo profesor
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-p-surface-2" />
          ))}
        </div>
      ) : summary.total === 0 ? null : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className={selectedTeacher ? 'max-lg:hidden' : ''}>
            {filteredTeachers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-p-border px-4 py-8 text-center text-[13px] text-p-text-muted">
                Nadie coincide con esa búsqueda.
              </p>
            ) : (
              <ul className="divide-y divide-p-border overflow-hidden rounded-2xl border border-p-border bg-p-surface">
                {filteredTeachers.map((teacher) => {
                  const upcoming = classCountByTeacher.get(teacher.id) || 0;
                  const isSelected = teacher.id === selectedTeacherId;
                  return (
                    <li key={teacher.id}>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelectedTeacherId(teacher.id)}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition ${
                          isSelected ? 'bg-p-surface-2' : 'hover:bg-p-surface-2'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className={`truncate text-[14px] font-semibold ${teacher.isActive ? 'text-p-text' : 'text-p-text-muted line-through'}`}>
                            {teacher.displayName}
                          </p>
                          <p className="truncate text-[12px] text-p-text-muted">
                            {[teacher.specialties.join(', ') || null, teacher.phone || teacher.email || null].filter(Boolean).join(' · ') ||
                              'Sin datos'}
                          </p>
                        </div>
                        <span className="flex-none text-[12px] text-p-text-secondary">
                          {!teacher.isActive ? 'Dado de baja' : upcoming === 0 ? 'Sin clases' : upcoming === 1 ? '1 clase' : `${upcoming} clases`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className={selectedTeacher ? '' : 'max-lg:hidden'}>
            {selectedTeacher ? (
              <div className="rounded-2xl border border-p-border bg-p-surface">
                <div className="border-b border-p-border px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setSelectedTeacherId(null)}
                    className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-p-accent lg:hidden"
                  >
                    <ChevronLeft size={15} />
                    Volver a la lista
                  </button>
                  <p className="text-[20px] font-bold leading-tight text-p-text">{selectedTeacher.displayName}</p>
                  <p className="mt-0.5 text-[14px] text-p-text-secondary">
                    {[selectedTeacher.phone, selectedTeacher.email].filter(Boolean).join(' · ') || 'Sin teléfono ni email'}
                  </p>
                  <p className="mt-1 text-[12px] text-p-text-muted">
                    {selectedTeacher.isActive ? (selectedTeacher.isInternal ? 'Trabaja para el club' : 'Profesor externo') : 'Dado de baja'}
                  </p>
                </div>
                <div className="space-y-5 px-5 py-4">
                  <div>
                    <p className="text-[13px] font-semibold text-p-text">Enseña</p>
                    {selectedTeacher.specialties.length === 0 ? (
                      <p className="mt-1 text-[13px] text-p-text-muted">No cargaste qué enseña.</p>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {selectedTeacher.specialties.map((specialty) => (
                          <span key={specialty} className="rounded-full bg-p-surface-2 px-2.5 py-1 text-[12px] font-medium text-p-text-secondary">
                            {specialty}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-p-border pt-4">
                    <p className="text-[13px] font-semibold text-p-text">Próximas clases</p>
                    {teacherUpcoming.length === 0 ? (
                      <p className="mt-1 text-[13px] text-p-text-muted">No tiene clases programadas.</p>
                    ) : (
                      <ul className="mt-1 divide-y divide-p-border">
                        {teacherUpcoming.map((session) => (
                          <li key={session.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                            <span className="text-p-text">{formatClassWhen(session.startsAt)}</span>
                            <span className="text-right text-p-text-muted">
                              {[session.activityType?.name, session.court?.name].filter(Boolean).join(' · ')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {selectedTeacher.notes ? (
                    <div className="border-t border-p-border pt-4">
                      <p className="text-[13px] font-semibold text-p-text">Notas</p>
                      <p className="mt-1 whitespace-pre-line text-[13px] text-p-text-secondary">{selectedTeacher.notes}</p>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-p-border px-5 py-3">
                  <button
                    type="button"
                    onClick={() => void openEditModal(selectedTeacher.id)}
                    className="text-[13px] font-semibold text-p-accent hover:underline underline-offset-2"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleTeacherStatus(selectedTeacher)}
                    disabled={statusBusyId === selectedTeacher.id}
                    className="text-[13px] font-semibold text-p-text-secondary hover:underline underline-offset-2 disabled:opacity-50"
                  >
                    {selectedTeacher.isActive ? 'Dar de baja' : 'Reactivar'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-p-border px-6 text-center">
                <p className="text-[13px] text-p-text-muted">Elegí un profesor para ver qué enseña y sus próximas clases.</p>
              </div>
            )}
          </div>
        </div>
      )}

      <AdminDrawer
        open={modalOpen}
        onClose={closeModal}
        title={editingTeacherId ? 'Editar profesor' : 'Nuevo profesor'}
        subtitle={editingTeacherId ? undefined : 'Quién da clases en el club.'}
        size="md"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeModal}
              className="h-10 rounded-xl border border-p-border px-4 text-[13px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="teacher-form"
              disabled={submitting}
              className="h-10 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 hover:bg-ink-800 disabled:cursor-wait disabled:opacity-70"
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
  optional = false,
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
  optional?: boolean;
  inputClassName?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-medium text-p-text">
        {label}
        {optional ? <span className="font-normal text-p-text-muted"> (opcional)</span> : null}
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
