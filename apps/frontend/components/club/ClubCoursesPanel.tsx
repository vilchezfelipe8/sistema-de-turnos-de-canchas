import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ClubService, ClubCourse } from '../../services/ClubService';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import BusyLabel from '../ui/BusyLabel';

type Tone = 'info' | 'success' | 'error';

type Props = {
  slug: string;
  /** Hay sesión iniciada: puede anotarse. */
  loggedIn: boolean;
  loginHref: string;
  /** Si no se pasa, usa el aviso general de la app. */
  onNotice?: (message: string, tone?: Tone) => void;
};

const defaultNotice = (message: string, tone: Tone = 'info') => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('app:notice', { detail: { message, tone } }));
};

const formatPrice = (value: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value);

/** Cursos que el club muestra en la app: el jugador se anota (o pide lugar) y se baja. */
export default function ClubCoursesPanel({ slug, loggedIn, loginHref, onNotice = defaultNotice }: Props) {
  const [courses, setCourses] = useState<ClubCourse[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCourses(await ClubService.getClubCourses(slug));
    } catch (error) {
      reportUiError({ area: 'ClubCoursesPanel', action: 'load' }, error);
      setCourses([]);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load, loggedIn]);

  const join = async (course: ClubCourse) => {
    try {
      setBusyId(course.id);
      const result = await ClubService.joinClubCourse(slug, course.id);
      onNotice(
        result.status === 'PENDING'
          ? 'Listo, le avisamos al club. Te confirman tu lugar.'
          : 'Listo, estás anotado al curso.',
        'success'
      );
      await load();
    } catch (error) {
      reportUiError({ area: 'ClubCoursesPanel', action: 'join' }, error);
      onNotice(extractErrorMessage(error, 'No se pudo anotarte.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const leave = async (course: ClubCourse) => {
    const pending = course.myStatus === 'PENDING';
    if (!pending && !window.confirm('¿Te bajás del curso? Dejás de estar en las próximas clases.')) return;
    try {
      setBusyId(course.id);
      await ClubService.leaveClubCourse(slug, course.id);
      onNotice(pending ? 'Cancelaste el pedido.' : 'Te bajaste del curso.', 'success');
      await load();
    } catch (error) {
      reportUiError({ area: 'ClubCoursesPanel', action: 'leave' }, error);
      onNotice(extractErrorMessage(error, 'No se pudo bajarte del curso.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (courses.length === 0) return null;

  return (
    <section className="cl-panel" aria-labelledby="club-courses-title">
      <h2 id="club-courses-title" className="cl-panel-h">Cursos</h2>
      <div className="cl-reviews">
        {courses.map((course) => {
          const busy = busyId === course.id;
          const full = course.spotsLeft <= 0;
          const details = [
            course.teacher ? `Con ${course.teacher}` : null,
            course.level,
            course.pricePerClass != null ? `${formatPrice(course.pricePerClass)} la clase` : null,
          ].filter(Boolean);
          return (
            <article key={course.id} className="cl-review-card">
              <div className="cl-review-head">
                <span className="cl-review-name">{course.activity || 'Curso'}</span>
                <span className="cl-course-when">
                  {course.weekdaysLabel} {course.startTime}
                </span>
              </div>
              {details.length > 0 && <p className="cl-review-comment">{details.join(' · ')}</p>}
              {course.description && <p className="cl-review-comment cl-course-desc">{course.description}</p>}

              {course.myStatus === 'ACTIVE' ? (
                <div className="cl-course-actions">
                  <span className="cl-course-state is-in">Estás anotado</span>
                  <button type="button" className="cl-course-link" disabled={busy} onClick={() => void leave(course)}>
                    <BusyLabel busy={busy}>Bajarme</BusyLabel>
                  </button>
                </div>
              ) : course.myStatus === 'PENDING' ? (
                <div className="cl-course-actions">
                  <span className="cl-course-state">Esperando que el club te acepte</span>
                  <button type="button" className="cl-course-link" disabled={busy} onClick={() => void leave(course)}>
                    <BusyLabel busy={busy}>Cancelar pedido</BusyLabel>
                  </button>
                </div>
              ) : full ? (
                <div className="cl-course-actions">
                  <span className="cl-course-state">Sin lugares por ahora</span>
                </div>
              ) : !loggedIn ? (
                <Link href={loginHref} className="cl-review-cta">
                  Iniciá sesión para anotarte
                </Link>
              ) : (
                <button type="button" className="cl-review-cta" disabled={busy} onClick={() => void join(course)}>
                  <BusyLabel busy={busy}>{course.requiresApproval ? 'Pedir lugar' : 'Anotarme'}</BusyLabel>
                </button>
              )}
              {!course.myStatus && !full && course.spotsLeft <= 3 && (
                <p className="cl-course-spots">
                  {course.spotsLeft === 1 ? 'Queda 1 lugar' : `Quedan ${course.spotsLeft} lugares`}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
