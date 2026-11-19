import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { GraduationCap } from 'lucide-react';
import { ClubService, MyCourse } from '../../services/ClubService';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import BusyLabel from '../ui/BusyLabel';

const CSS = `
  .mc-list { display:grid; gap:10px; }
  .mc-row { padding:14px; border:1px solid var(--border-subtle); border-radius:14px; background:var(--surface-2); }
  .mc-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
  .mc-title { margin:0; color:var(--text-primary); font-size:14px; font-weight:800; }
  .mc-sub { margin:3px 0 0; color:var(--text-secondary); font-size:12px; line-height:1.45; }
  .mc-badge { flex:none; padding:3px 8px; border:1px solid var(--border); border-radius:999px; background:var(--surface-1); color:var(--text-secondary); font-size:11px; font-weight:800; white-space:nowrap; }
  .mc-badge.is-in { border-color:var(--accent-border-subtle); background:var(--positive-bg); color:var(--positive-fg); }
  .mc-next { margin:10px 0 0; display:flex; flex-wrap:wrap; gap:6px; }
  .mc-chip { padding:4px 9px; border-radius:999px; background:var(--surface-1); border:1px solid var(--border-subtle); color:var(--text-primary); font-size:12px; font-weight:700; }
  .mc-foot { margin-top:10px; display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .mc-link { color:var(--accent-fg); font-size:12px; font-weight:800; text-decoration:none; }
  .mc-leave { background:none; border:none; padding:6px 0; font-family:inherit; font-size:12px; font-weight:700; color:var(--text-secondary); text-decoration:underline; cursor:pointer; }
  .mc-leave:disabled { opacity:.6; cursor:not-allowed; }
  .mc-note { margin:0; color:var(--text-muted); font-size:12px; }
`;

const notice = (message: string, tone: 'success' | 'error' = 'success') => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('app:notice', { detail: { message, tone } }));
};

const formatClassDate = (iso: string) => {
  const date = new Date(iso);
  const day = date.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
};

type Props = {
  /** Solo los cursos de este club (pestaña Clases de la página del club). */
  clubSlug?: string;
  /** 'club': se muestra como panel de la página del club. */
  variant?: 'profile' | 'club';
  /** Cambia cuando hay que volver a cargar (por ejemplo, después de anotarse). */
  reloadKey?: number;
};

/** "Mis cursos" del jugador: en qué cursos está (o pidió lugar), próximas clases y bajarse. */
export default function MyCoursesCard({ clubSlug, variant = 'profile', reloadKey = 0 }: Props = {}) {
  const inClub = variant === 'club';
  const [allCourses, setCourses] = useState<MyCourse[] | null>(null);
  const courses = allCourses && clubSlug ? allCourses.filter((course) => course.clubSlug === clubSlug) : allCourses;
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCourses(await ClubService.getMyCourses());
    } catch (error) {
      reportUiError({ area: 'MyCoursesCard', action: 'load' }, error);
      setCourses([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // Desde el aviso "te sumó al curso" se llega con #mis-cursos: la tarjeta carga después, así que se baja a mano.
  useEffect(() => {
    if (!courses?.length || typeof window === 'undefined' || window.location.hash !== '#mis-cursos') return;
    document.getElementById('mis-cursos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [courses]);

  const leave = async (course: MyCourse) => {
    const pending = course.status !== 'ACTIVE';
    if (!pending && !window.confirm('¿Te bajás del curso? Dejás de estar en las próximas clases.')) return;
    try {
      setBusyId(course.id);
      await ClubService.leaveClubCourse(course.clubSlug, course.id);
      notice(
        course.status === 'AWAITING_PAYMENT' ? 'Listo, liberamos tu lugar.' : pending ? 'Cancelaste el pedido.' : 'Te bajaste del curso.'
      );
      await load();
    } catch (error) {
      reportUiError({ area: 'MyCoursesCard', action: 'leave' }, error);
      notice(extractErrorMessage(error, 'No se pudo bajarte del curso.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (!courses || courses.length === 0) return null;

  return (
    <div
      className={inClub ? 'cl-panel' : 'p-public-card pf-card'}
      id="mis-cursos"
      style={inClub ? { scrollMarginTop: 88 } : { marginTop: 16 }}
    >
      <style>{CSS}</style>
      {inClub ? (
        <h2 className="cl-panel-h">Mis clases</h2>
      ) : (
        <h2 className="pf-card-title">
          <GraduationCap size={18} aria-hidden="true" /> Mis cursos
        </h2>
      )}
      <div className="mc-list">
        {courses.map((course) => {
          const busy = busyId === course.id;
          const pending = course.status !== 'ACTIVE';
          const awaitingPayment = course.status === 'AWAITING_PAYMENT';
          const details = [inClub ? null : course.clubName, course.teacher ? `con ${course.teacher}` : null, course.court, course.level].filter(Boolean);
          return (
            <article key={course.id} className={inClub ? 'cl-review-card' : 'mc-row'}>
              <div className="mc-head">
                <div>
                  <p className="mc-title">
                    {course.name || course.activity || 'Curso'} · {course.weekdaysLabel} {course.startTime}
                  </p>
                  <p className="mc-sub">{details.join(' · ')}</p>
                </div>
                <span className={`mc-badge${pending ? '' : ' is-in'}`}>
                  {awaitingPayment ? 'Falta pagar' : pending ? 'Esperando al club' : 'Anotado'}
                </span>
              </div>

              {!pending && course.nextClasses.length > 0 && (
                <div className="mc-next" aria-label="Próximas clases">
                  {course.nextClasses.map((iso) => (
                    <span key={iso} className="mc-chip">
                      {formatClassDate(iso)}
                    </span>
                  ))}
                </div>
              )}

              <div className="mc-foot">
                {course.clubSlug && !inClub ? (
                  <Link href={`/club/${course.clubSlug}?tab=clases`} className="mc-link">
                    {awaitingPayment ? 'Pagar en la página del club' : 'Ver club'}
                  </Link>
                ) : (
                  <span />
                )}
                {course.canLeave ? (
                  <button type="button" className="mc-leave" disabled={busy} onClick={() => void leave(course)}>
                    <BusyLabel busy={busy}>{pending ? 'Cancelar pedido' : 'Bajarme'}</BusyLabel>
                  </button>
                ) : (
                  <p className="mc-note">Para bajarte, hablá con el club.</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
