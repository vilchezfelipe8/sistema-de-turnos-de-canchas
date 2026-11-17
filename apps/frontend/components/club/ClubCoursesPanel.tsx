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
  /** Avisa cuántos cursos hay (para mostrar el acceso arriba en la página del club). */
  onCount?: (count: number) => void;
};

const defaultNotice = (message: string, tone: Tone = 'info') => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('app:notice', { detail: { message, tone } }));
};

const formatPrice = (value: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value);

const shortDay = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
const classesLabel = (count: number) => (count === 1 ? '1 clase' : `${count} clases`);

/** Cursos que el club muestra en la app: el jugador se anota (o pide lugar) y se baja. */
export default function ClubCoursesPanel({ slug, loggedIn, loginHref, onNotice = defaultNotice, onCount }: Props) {
  const [courses, setCourses] = useState<ClubCourse[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    onCount?.(courses.length);
  }, [courses.length, onCount]);

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

  // Vuelta de Mercado Pago (?curso=...&checkoutStatus=...): se avisa cómo salió y se limpia la URL.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get('checkoutStatus');
    if (!params.get('curso') || !status) return;
    if (status === 'success') onNotice('¡Pago recibido! En unos segundos quedás anotado al curso.', 'success');
    else if (status === 'pending') onNotice('Tu pago está en proceso. Cuando se acredite, quedás anotado.', 'info');
    else onNotice('El pago no se completó. Tu lugar queda guardado unos minutos para que pruebes de nuevo.', 'error');
    params.delete('curso');
    params.delete('checkoutStatus');
    const query = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    // El aviso de Mercado Pago puede tardar unos segundos: se vuelve a mirar.
    const timer = window.setTimeout(() => void load(), 4000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const join = async (course: ClubCourse) => {
    try {
      setBusyId(course.id);
      const result = await ClubService.joinClubCourse(slug, course.id);
      if (result.initPoint) {
        // Cobro al anotarse: el lugar queda guardado y se paga en Mercado Pago.
        window.location.href = result.initPoint;
        return;
      }
      onNotice(
        result.status === 'PENDING'
          ? 'Listo, le avisamos al club. Te confirman tu lugar.'
          : result.coveredByPlan
            ? 'Listo, estás anotado. Lo cubre tu plan.'
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
    const pending = course.myStatus === 'PENDING' || course.myStatus === 'AWAITING_PAYMENT';
    if (!pending && !window.confirm('¿Te bajás del curso? Dejás de estar en las próximas clases.')) return;
    try {
      setBusyId(course.id);
      await ClubService.leaveClubCourse(slug, course.id);
      onNotice(
        course.myStatus === 'AWAITING_PAYMENT' ? 'Listo, liberamos tu lugar.' : pending ? 'Cancelaste el pedido.' : 'Te bajaste del curso.',
        'success'
      );
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
    <section className="cl-panel" id="cursos" aria-labelledby="club-courses-title" style={{ scrollMarginTop: 88 }}>
      <h2 id="club-courses-title" className="cl-panel-h">Cursos</h2>
      <div className="cl-reviews">
        {courses.map((course) => {
          const busy = busyId === course.id;
          const full = course.spotsLeft <= 0;
          const details = [
            course.name ? course.activity : null,
            course.teacher ? `Con ${course.teacher}` : null,
            course.level,
            `${course.durationMinutes} min`,
            course.pricePerClass != null ? `${formatPrice(course.pricePerClass)} la clase` : null,
          ].filter(Boolean);
          const dates = [
            course.startsLater ? `Empieza el ${shortDay(course.startsOn)}` : null,
            course.endsOn ? `Hasta el ${shortDay(course.endsOn)}` : null,
          ].filter(Boolean);
          const coverage = course.planCoverage;
          const paid = course.requiresPayment && course.signupPrice;
          const paidByPlan = Boolean(paid && course.signupPrice!.classes === 0);
          return (
            <article key={course.id} className="cl-review-card">
              <div className="cl-review-head">
                <span className="cl-review-name">{course.name || course.activity || 'Curso'}</span>
                <span className="cl-course-when">
                  {course.weekdaysLabel} {course.startTime}
                </span>
              </div>
              {details.length > 0 && <p className="cl-review-comment">{details.join(' · ')}</p>}
              {dates.length > 0 && <p className="cl-course-dates">{dates.join(' · ')}</p>}
              {course.description && <p className="cl-review-comment cl-course-desc">{course.description}</p>}

              {course.myStatus === 'ACTIVE' ? (
                <div className="cl-course-actions">
                  <span className="cl-course-state is-in">Estás anotado</span>
                  <button type="button" className="cl-course-link" disabled={busy} onClick={() => void leave(course)}>
                    <BusyLabel busy={busy}>Bajarme</BusyLabel>
                  </button>
                </div>
              ) : course.myStatus === 'AWAITING_PAYMENT' ? (
                <>
                  <button type="button" className="cl-review-cta" disabled={busy} onClick={() => void join(course)}>
                    <BusyLabel busy={busy}>Pagar y confirmar mi lugar</BusyLabel>
                  </button>
                  <div className="cl-course-actions">
                    <span className="cl-course-state">Te guardamos el lugar unos minutos</span>
                    <button type="button" className="cl-course-link" disabled={busy} onClick={() => void leave(course)}>
                      Cancelar
                    </button>
                  </div>
                </>
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
                <>
                  <button type="button" className="cl-review-cta" disabled={busy} onClick={() => void join(course)}>
                    <BusyLabel busy={busy}>
                      {paid && !paidByPlan
                        ? `Anotarme y pagar ${formatPrice(course.signupPrice!.total)}`
                        : course.requiresApproval && !paid
                          ? 'Pedir lugar'
                          : 'Anotarme'}
                    </BusyLabel>
                  </button>
                  {coverage?.full ? (
                    <p className="cl-course-spots is-plan">Lo cubre tu plan.</p>
                  ) : paid ? (
                    <p className="cl-course-spots">
                      Pagás {course.signupPrice!.monthLabel} con Mercado Pago: {classesLabel(course.signupPrice!.classes)}.
                      {course.signupPrice!.coveredByPlan > 0 ? ` Tu plan cubre ${classesLabel(course.signupPrice!.coveredByPlan)} más.` : ''}
                    </p>
                  ) : coverage ? (
                    <p className="cl-course-spots is-plan">
                      Tu plan cubre {classesLabel(coverage.covered)} de {classesLabel(coverage.classes)} este mes.
                    </p>
                  ) : null}
                </>
              )}
              {!course.myStatus && !full && (
                <p className={`cl-course-spots${course.spotsLeft <= 3 ? ' is-few' : ''}`}>
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
