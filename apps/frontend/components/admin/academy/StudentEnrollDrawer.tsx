import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { AdminDrawer, AdminInlineError } from '../ui';
import { adminButton } from '../ui/adminButton';
import { AdminSearchInput } from '../ui/AdminPersonPicker';
import { ClubAdminService, type AdminClassSession } from '../../../services/ClubAdminService';
import { showAdminToast } from '../../../utils/adminToast';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const weekdaysLabel = (days: number[]) =>
  [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAYS[d] || '').join(', ');

const formatWhen = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = date
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/\./g, '')
    .replace(',', '');
  const time = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${day} · ${time}`;
};

type Option = {
  key: string;
  kind: 'course' | 'class';
  /** Curso: id del curso. Clase suelta: id de la clase. */
  targetId: string;
  title: string;
  detail: string;
  spotsLeft: number;
  search: string;
};

const spotsText = (left: number) => (left <= 0 ? 'Llena' : left === 1 ? 'Queda 1 lugar' : `Quedan ${left} lugares`);

type Props = {
  open: boolean;
  onClose: () => void;
  clubSlug: string;
  student: { id: string; name: string; userId: number | null } | null;
  /** Clases a las que ya está anotado (no se ofrecen). */
  enrolledSessionIds: string[];
  onEnrolled: () => void;
};

/**
 * Anotar a un alumno desde su ficha: elige un curso (queda en todas las clases que vienen)
 * o una clase suelta. Cómo paga se resuelve solo (pack, plan o se le cobra la clase).
 */
export default function StudentEnrollDrawer({ open, onClose, clubSlug, student, enrolledSessionIds, onEnrolled }: Props) {
  const [sessions, setSessions] = useState<AdminClassSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !clubSlug) return;
    let cancelled = false;
    setQuery('');
    setSelectedKey(null);
    setError('');
    setLoading(true);
    ClubAdminService.getClassSessions(clubSlug)
      .then((rows) => {
        if (!cancelled) setSessions(Array.isArray(rows) ? rows : []);
      })
      .catch((loadError) => {
        if (cancelled) return;
        reportUiError({ area: 'StudentEnrollDrawer', action: 'loadSessions' }, loadError);
        setError(extractErrorMessage(loadError, 'No se pudieron cargar las clases.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, clubSlug]);

  const options = useMemo<Option[]>(() => {
    const now = Date.now();
    const enrolled = new Set(enrolledSessionIds);
    const upcoming = sessions
      .filter((row) => new Date(row.startsAt).getTime() > now && (row.status === 'SCHEDULED' || row.status === 'CONFIRMED'))
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    const courses = new Map<string, Option>();
    const singles: Option[] = [];
    for (const row of upcoming) {
      const what = [row.activityType?.name, row.teacher?.displayName ? `con ${row.teacher.displayName}` : null]
        .filter(Boolean)
        .join(' ');
      const spotsLeft = Math.max(0, Number(row.capacity || 0) - Number(row.enrolledCount || 0));
      if (row.seriesId && row.series && row.series.status === 'ACTIVE') {
        if (courses.has(row.seriesId)) continue;
        // Si ya está en la próxima clase del curso, ya está en el curso.
        if (enrolled.has(row.id)) {
          courses.set(row.seriesId, { key: 'skip', kind: 'course', targetId: '', title: '', detail: '', spotsLeft: 0, search: '' });
          continue;
        }
        const title = `${weekdaysLabel(row.series.weekdays)} ${row.series.startTime}`;
        courses.set(row.seriesId, {
          key: `course-${row.seriesId}`,
          kind: 'course',
          targetId: row.seriesId,
          title,
          detail: [what || 'Curso', `empieza ${formatWhen(row.startsAt)}`].join(' · '),
          spotsLeft,
          search: `${title} ${what}`.toLowerCase(),
        });
        continue;
      }
      if (row.seriesId || enrolled.has(row.id)) continue;
      const title = formatWhen(row.startsAt);
      singles.push({
        key: `class-${row.id}`,
        kind: 'class',
        targetId: row.id,
        title,
        detail: what || 'Clase',
        spotsLeft,
        search: `${title} ${what}`.toLowerCase(),
      });
    }
    return [...[...courses.values()].filter((row) => row.key !== 'skip'), ...singles];
  }, [sessions, enrolledSessionIds]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((row) => row.search.includes(q)) : options;
  }, [options, query]);

  const selected = options.find((row) => row.key === selectedKey) || null;
  const courses = visible.filter((row) => row.kind === 'course');
  const singles = visible.filter((row) => row.kind === 'class');

  const submit = async () => {
    if (!student || !selected || submitting) return;
    try {
      setSubmitting(true);
      setError('');
      if (selected.kind === 'course') {
        const result = await ClubAdminService.addClassSeriesMember(clubSlug, selected.targetId, { studentClientId: student.id });
        const count = Number(result?.enrolled || 0);
        const full = Array.isArray(result?.full) ? result.full.length : 0;
        showAdminToast(
          `${student.name} quedó en el curso: ${count === 1 ? '1 clase' : `${count} clases`}.${
            full ? ` ${full === 1 ? '1 estaba llena' : `${full} estaban llenas`}.` : ''
          }`
        );
      } else {
        await ClubAdminService.createClassEnrollment(clubSlug, selected.targetId, {
          studentClientId: student.id,
          studentUserId: student.userId,
          enrollmentStatus: selected.spotsLeft > 0 ? 'ENROLLED' : 'WAITLISTED',
        });
        showAdminToast(selected.spotsLeft > 0 ? `${student.name} quedó anotado.` : `${student.name} quedó en espera.`);
      }
      onEnrolled();
      onClose();
    } catch (submitError) {
      reportUiError({ area: 'StudentEnrollDrawer', action: 'submit' }, submitError);
      setError(extractErrorMessage(submitError, 'No se pudo anotar al alumno.'));
    } finally {
      setSubmitting(false);
    }
  };

  const renderOption = (row: Option) => {
    const active = row.key === selectedKey;
    const full = row.spotsLeft <= 0;
    return (
      <li key={row.key}>
        <button
          type="button"
          aria-pressed={active}
          onClick={() => setSelectedKey(row.key)}
          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
            active ? 'bg-p-surface-2' : 'hover:bg-p-surface-2'
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-p-text">{row.title}</span>
            <span className="block truncate text-[12px] text-p-text-muted">{row.detail}</span>
          </span>
          <span className={`shrink-0 text-[12px] ${full ? 'text-p-warning' : 'text-p-text-muted'}`}>{spotsText(row.spotsLeft)}</span>
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
              active ? 'border-ink-900 bg-ink-900 text-ink-50' : 'border-p-border'
            }`}
          >
            {active ? <Check size={12} /> : null}
          </span>
        </button>
      </li>
    );
  };

  const listCls = 'divide-y divide-p-border overflow-hidden rounded-2xl border border-p-border bg-p-surface';

  return (
    <AdminDrawer
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={student ? `Anotar a ${student.name}` : 'Anotar a una clase'}
      subtitle="Elegí un curso o una clase. Cómo paga se resuelve solo."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className={adminButton('secondary', 'lg')}>
            Cancelar
          </button>
          <button type="button" onClick={() => void submit()} disabled={!selected || submitting} className={adminButton('primary', 'lg')}>
            {submitting
              ? 'Anotando...'
              : selected?.kind === 'course'
                ? 'Anotar al curso'
                : selected && selected.spotsLeft <= 0
                  ? 'Anotar en espera'
                  : 'Anotar'}
          </button>
        </div>
      }
    >
      {options.length > 4 ? (
        <AdminSearchInput value={query} onChange={setQuery} placeholder="Buscar por día, deporte o profe" />
      ) : null}

      {error ? <AdminInlineError>{error}</AdminInlineError> : null}

      {loading ? (
        <p className="py-8 text-center text-[13px] text-p-text-muted">Cargando clases…</p>
      ) : options.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-p-text-muted">
          No hay cursos ni clases próximas para anotarlo. Crealas en la pestaña Clases.
        </p>
      ) : (
        <>
          {courses.length ? (
            <section className="space-y-2">
              <p className="text-[13px] font-semibold text-p-text">Cursos</p>
              <p className="text-[12px] text-p-text-muted">Queda anotado en todas las clases que vienen.</p>
              <ul className={listCls}>{courses.map(renderOption)}</ul>
            </section>
          ) : null}
          {singles.length ? (
            <section className="space-y-2">
              <p className="text-[13px] font-semibold text-p-text">Clases sueltas</p>
              <ul className={listCls}>{singles.map(renderOption)}</ul>
            </section>
          ) : null}
          {!courses.length && !singles.length ? (
            <p className="py-6 text-center text-[13px] text-p-text-muted">Nada coincide con “{query}”.</p>
          ) : null}
        </>
      )}
    </AdminDrawer>
  );
}
