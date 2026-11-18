import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ActivityTurnService,
  WEEKDAY_SHORT,
  type MyTurn,
  type PublicTurnActivity,
  type TurnDay,
} from '../../services/ActivityTurnService';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import BusyLabel from '../ui/BusyLabel';

type Tone = 'info' | 'success' | 'error';

type Props = {
  slug: string;
  loggedIn: boolean;
  loginHref: string;
  onNotice: (message: string, tone?: Tone) => void;
};

const weekdayOf = (key: string) => new Date(`${key}T12:00:00Z`).getUTCDay();
const shortDay = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

const dayChipLabel = (key: string, index: number) =>
  index === 0 ? 'Hoy' : index === 1 ? 'Mañana' : `${WEEKDAY_SHORT[weekdayOf(key)]} ${key.slice(8, 10)}`;

const myTurnLabel = (turn: MyTurn, today: string | undefined) =>
  `${turn.date === today ? 'Hoy' : `${WEEKDAY_SHORT[weekdayOf(turn.date)]} ${shortDay(turn.date)}`} de ${turn.time} a ${turn.endTime}`;

/** Turnero del club (ej. Musculación): el socio elige día y franja con lugar. */
export default function ClubTurnsPanel({ slug, loggedIn, loginHref, onNotice }: Props) {
  const [activities, setActivities] = useState<PublicTurnActivity[]>([]);
  const [mine, setMine] = useState<MyTurn[]>([]);
  const [activityId, setActivityId] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [day, setDay] = useState<TurnDay | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const result = await ActivityTurnService.listPublic(slug);
      setActivities(result.activities);
      setMine(result.mine);
      setActivityId((prev) => (prev && result.activities.some((a) => a.activityTypeId === prev) ? prev : result.activities[0]?.activityTypeId ?? null));
    } catch (error) {
      reportUiError({ area: 'ClubTurnsPanel', action: 'loadList' }, error);
      setActivities([]);
    }
  }, [slug]);

  useEffect(() => {
    void loadList();
  }, [loadList, loggedIn]);

  const activity = activities.find((a) => a.activityTypeId === activityId) || null;

  useEffect(() => {
    if (!activity) return;
    setDate((prev) => (prev && activity.days.includes(prev) ? prev : activity.days[0] ?? null));
  }, [activity]);

  const loadDay = useCallback(async () => {
    if (!activityId || !date) return;
    try {
      setLoadingDay(true);
      setDay(await ActivityTurnService.daySlots(slug, activityId, date));
    } catch (error) {
      reportUiError({ area: 'ClubTurnsPanel', action: 'loadDay' }, error);
      setDay(null);
    } finally {
      setLoadingDay(false);
    }
  }, [slug, activityId, date]);

  useEffect(() => {
    void loadDay();
  }, [loadDay, loggedIn]);

  const book = async (startsAt: string) => {
    if (!activityId) return;
    try {
      setBusy(startsAt);
      await ActivityTurnService.book(slug, activityId, startsAt);
      onNotice('Listo, turno reservado.', 'success');
      await Promise.all([loadDay(), loadList()]);
    } catch (error) {
      reportUiError({ area: 'ClubTurnsPanel', action: 'book' }, error);
      onNotice(extractErrorMessage(error, 'No se pudo reservar el turno.'), 'error');
      await loadDay();
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (turnId: string) => {
    if (!window.confirm('¿Cancelás el turno? El lugar queda libre para otro.')) return;
    try {
      setBusy(turnId);
      await ActivityTurnService.cancelMine(slug, turnId);
      onNotice('Turno cancelado.', 'success');
      await Promise.all([loadDay(), loadList()]);
    } catch (error) {
      reportUiError({ area: 'ClubTurnsPanel', action: 'cancel' }, error);
      onNotice(extractErrorMessage(error, 'No se pudo cancelar el turno.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (activities.length === 0) return null;

  const today = activity?.days[0];
  const upcoming = slots(day).filter((slot) => !slot.isPast);
  const blocked = day?.access && !day.access.allowed;
  const weekFull = Boolean(day?.week && day.week.used >= day.week.limit);

  return (
    <section className="cl-panel" id="turnos" aria-labelledby="club-turns-title" style={{ scrollMarginTop: 88 }}>
      <h2 id="club-turns-title" className="cl-panel-h">Turnos</h2>

      {activities.length > 1 && (
        <div className="cl-turn-chips" role="tablist" aria-label="Actividad">
          {activities.map((row) => (
            <button
              key={row.activityTypeId}
              type="button"
              role="tab"
              aria-selected={row.activityTypeId === activityId}
              className={`cl-turn-chip${row.activityTypeId === activityId ? ' is-on' : ''}`}
              onClick={() => setActivityId(row.activityTypeId)}
            >
              {row.name}
            </button>
          ))}
        </div>
      )}

      {activity && (
        <p className="cl-review-comment">
          {activities.length === 1 ? `${activity.name}: ` : ''}turnos de {activity.slotMinutes} min.
          {activity.requiresTurn ? ' Para entrar necesitás tu turno reservado.' : ''}
        </p>
      )}

      {mine.length > 0 && (
        <div className="cl-turn-mine">
          <p className="cl-turn-sub">Tus turnos</p>
          {mine.map((turn) => (
            <div key={turn.id} className="cl-course-actions cl-turn-mine-row">
              <span className="cl-course-state is-in">
                {activities.length > 1 ? `${turn.activityName} · ` : ''}
                {myTurnLabel(turn, today)}
              </span>
              {!turn.started && (
                <button type="button" className="cl-course-link" disabled={busy === turn.id} onClick={() => void cancel(turn.id)}>
                  <BusyLabel busy={busy === turn.id}>Cancelar</BusyLabel>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {activity && (
        <div className="cl-turn-chips cl-turn-days" aria-label="Día">
          {activity.days.map((key, index) => (
            <button
              key={key}
              type="button"
              aria-pressed={key === date}
              className={`cl-turn-chip${key === date ? ' is-on' : ''}`}
              onClick={() => setDate(key)}
            >
              {dayChipLabel(key, index)}
            </button>
          ))}
        </div>
      )}

      {!loggedIn ? (
        <Link href={loginHref} className="cl-review-cta">
          Iniciá sesión para reservar
        </Link>
      ) : blocked ? (
        <p className="cl-turn-blocked" role="status">
          {day!.access!.message}
          {day!.access!.code === 'UNPAID' || day!.access!.code === 'PAUSED' ? (
            <>
              {' '}
              <Link href="/perfil">Ver mis planes</Link>
            </>
          ) : null}
        </p>
      ) : day?.week ? (
        <p className={`cl-course-spots${weekFull ? ' is-few' : ' is-plan'}`}>
          {weekFull
            ? `Ya reservaste tus ${day.week.limit} turnos de esta semana.`
            : `Te ${day.week.limit - day.week.used === 1 ? 'queda 1 turno' : `quedan ${day.week.limit - day.week.used} turnos`} esta semana.`}
        </p>
      ) : null}

      {loadingDay && !day ? (
        <p className="cl-review-empty">Cargando turnos…</p>
      ) : upcoming.length === 0 ? (
        <p className="cl-review-empty">No quedan turnos para este día.</p>
      ) : (
        <div className="cl-turn-grid">
          {upcoming.map((slot) => {
            const isMine = Boolean(slot.myTurnId);
            const full = slot.available <= 0 && !isMine;
            const disabled = !loggedIn || Boolean(blocked) || full || isMine || weekFull || busy !== null;
            return (
              <button
                key={slot.startsAt}
                type="button"
                className={`cl-turn-slot${isMine ? ' is-mine' : ''}${full ? ' is-full' : ''}`}
                disabled={disabled}
                onClick={() => void book(slot.startsAt)}
                aria-label={`${slot.time}: ${isMine ? 'tu turno' : full ? 'completo' : `quedan ${slot.available}`}`}
              >
                <span className="cl-turn-time">
                  <BusyLabel busy={busy === slot.startsAt}>{slot.time}</BusyLabel>
                </span>
                <span className="cl-turn-left">{isMine ? 'Tu turno' : full ? 'Completo' : `Quedan ${slot.available}`}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function slots(day: TurnDay | null) {
  return day?.slots ?? [];
}
