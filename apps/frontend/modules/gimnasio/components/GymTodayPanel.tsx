import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import AdminDateInput from '../../../components/admin/ui/AdminDateInput';
import AdminAppModal from '../../../components/admin/ui/AdminAppModal';
import AdminSegmentedControl from '../../../components/admin/ui/AdminSegmentedControl';
import AdminEmptyState from '../../../components/admin/ui/AdminEmptyState';
import { AdminFeedbackBanner } from '../../../components/admin/ui/AdminFeedback';
import { adminButton } from '../../../components/admin/ui/adminButton';
import {
  ActivityTurnService,
  type AccessLogDay,
  type AdminTurnDay,
  type TurnSchedule,
} from '../../../services/ActivityTurnService';
import { showAdminToast } from '../../../utils/adminToast';
import GymBookDrawer from './GymBookDrawer';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const shiftDay = (key: string, days: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + days));
};

const dayLabel = (key: string) => {
  const today = dateKey(new Date());
  if (key === today) return 'Hoy';
  if (key === shiftDay(today, -1)) return 'Ayer';
  if (key === shiftDay(today, 1)) return 'Mañana';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
};

const METHOD_LABEL: Record<string, string> = { FINGERPRINT: 'Huella', QR: 'Código QR', DNI: 'DNI' };

const cardCls = 'rounded-2xl border border-p-border bg-p-surface';
const cardHeaderCls = 'flex items-baseline justify-between gap-3 border-b border-p-border px-4 py-3';
const navButtonCls =
  'grid h-9 w-9 place-items-center rounded-lg text-p-text-muted transition-colors duration-150 hover:bg-p-surface-2 hover:text-p-text';

type Props = { clubSlug: string };

/** Gimnasio → Hoy: quién tiene turno en cada franja y quién entró (o no) por el molinete. */
export default function GymTodayPanel({ clubSlug }: Props) {
  const [schedules, setSchedules] = useState<TurnSchedule[] | null>(null);
  const [scheduleId, setScheduleId] = useState<number | null>(null);
  const [date, setDate] = useState(() => dateKey(new Date()));
  const [day, setDay] = useState<AdminTurnDay | null>(null);
  const [logs, setLogs] = useState<AccessLogDay | null>(null);
  const [error, setError] = useState('');
  const [cancelTarget, setCancelTarget] = useState<{ turnId: string; name: string; time: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [bookSlot, setBookSlot] = useState<{ startsAt: string; time: string; takenClientIds: string[] } | null>(null);

  const isToday = date === dateKey(new Date());

  useEffect(() => {
    if (!clubSlug) return;
    let cancelled = false;
    ActivityTurnService.listSchedules(clubSlug)
      .then((rows) => {
        if (cancelled) return;
        const active = rows.filter((row) => row.isActive);
        setSchedules(active);
        setScheduleId((current) => current ?? active[0]?.activityTypeId ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        reportUiError({ area: 'GymTodayPanel', action: 'listSchedules' }, err);
        setSchedules([]);
        setError(extractErrorMessage(err, 'No se pudieron cargar los turneros.'));
      });
    return () => {
      cancelled = true;
    };
  }, [clubSlug]);

  const load = useCallback(async () => {
    if (!clubSlug || !scheduleId) return;
    try {
      const [nextDay, nextLogs] = await Promise.all([
        ActivityTurnService.adminDay(clubSlug, scheduleId, date),
        ActivityTurnService.accessLogs(clubSlug, date),
      ]);
      setDay(nextDay);
      setLogs(nextLogs);
      setError('');
    } catch (err) {
      reportUiError({ area: 'GymTodayPanel', action: 'load' }, err);
      setError(extractErrorMessage(err, 'No se pudo cargar el día.'));
    }
  }, [clubSlug, scheduleId, date]);

  useEffect(() => {
    setDay(null);
    setLogs(null);
    void load();
  }, [load]);

  // Hoy se actualiza solo: la gente entra por el molinete mientras la pantalla está abierta.
  useEffect(() => {
    if (!isToday) return;
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [isToday, load]);

  const slots = useMemo(() => {
    const all = day?.slots || [];
    // De días pasados se ve todo; de hoy, las franjas que vienen y las que ya tuvieron gente.
    return isToday ? all.filter((slot) => !slot.isPast || slot.people.length > 0) : all;
  }, [day, isToday]);

  const booked = (day?.slots || []).reduce((total, slot) => total + slot.people.length, 0);

  const confirmCancel = async () => {
    if (!cancelTarget || !clubSlug) return;
    try {
      setCancelling(true);
      await ActivityTurnService.adminCancel(clubSlug, cancelTarget.turnId);
      showAdminToast('Turno cancelado.');
      setCancelTarget(null);
      await load();
    } catch (err) {
      reportUiError({ area: 'GymTodayPanel', action: 'cancelTurn' }, err);
      showAdminToast(extractErrorMessage(err, 'No se pudo cancelar el turno.'));
    } finally {
      setCancelling(false);
    }
  };

  if (schedules && schedules.length === 0) {
    return (
      <AdminEmptyState
        title="Todavía no hay turnero"
        description="Configurá los horarios y el cupo (por ejemplo, Musculación) y acá vas a ver quién viene y quién entró cada día."
        action={
          <Link href="/admin/ajustes?tab=turnero" className={adminButton('primary', 'md')}>
            Configurar turnero
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-xl border border-p-border bg-p-surface p-1">
          <button type="button" aria-label="Día anterior" className={navButtonCls} onClick={() => setDate((value) => shiftDay(value, -1))}>
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[150px] px-1 text-center text-[13px] font-semibold capitalize text-p-text">{dayLabel(date)}</span>
          <button type="button" aria-label="Día siguiente" className={navButtonCls} onClick={() => setDate((value) => shiftDay(value, 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
        <AdminDateInput value={date} onChange={(value) => value && setDate(value)} className="w-[160px]" />
        {!isToday ? (
          <button type="button" className={adminButton('ghost', 'md')} onClick={() => setDate(dateKey(new Date()))}>
            Volver a hoy
          </button>
        ) : null}
        {schedules && schedules.length > 1 ? (
          <AdminSegmentedControl
            variant="filter"
            ariaLabel="Actividad"
            value={String(scheduleId ?? '')}
            onChange={(value) => setScheduleId(Number(value))}
            options={schedules.map((row) => ({ value: String(row.activityTypeId), label: row.name }))}
          />
        ) : null}
        <a href="/admin/kiosco" target="_blank" rel="noopener noreferrer" className={`${adminButton('secondary', 'md')} ml-auto`}>
          Abrir kiosco <ExternalLink size={14} />
        </a>
      </div>

      {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={cardCls}>
          <header className={cardHeaderCls}>
            <h2 className="text-[14px] font-semibold text-p-text">Turnos{day ? ` de ${day.name}` : ''}</h2>
            <p className="text-[12px] text-p-text-muted">
              {day ? (booked === 1 ? '1 reserva' : `${booked} reservas`) : ''}
            </p>
          </header>
          {!day ? (
            <p className="px-4 py-6 text-center text-[13px] text-p-text-muted">Cargando...</p>
          ) : slots.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-p-text-muted">
              {day.slots.length === 0 ? 'Este día no abre.' : 'Ya no quedan turnos hoy.'}
            </p>
          ) : (
            <ul className="divide-y divide-p-border">
              {slots.map((slot) => {
                const full = slot.available === 0;
                const upcoming = new Date(slot.startsAt).getTime() > Date.now();
                // Se puede anotar hasta que termina la franja (alguien que llega en el medio).
                const bookable = !full && new Date(slot.endsAt).getTime() > Date.now();
                return (
                  <li key={slot.startsAt} className={`px-4 py-2.5 ${slot.isPast && slot.people.length === 0 ? 'opacity-50' : ''}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] font-semibold tabular-nums text-p-text">{slot.time}</span>
                      <span className="flex items-center gap-2">
                        <span className={`text-[12px] tabular-nums ${full ? 'font-semibold text-p-warning' : 'text-p-text-muted'}`}>
                          {slot.booked} de {day.capacity}
                          {full ? ' · completo' : ''}
                        </span>
                        {bookable ? (
                          <button
                            type="button"
                            className={adminButton('secondary', 'sm')}
                            onClick={() =>
                              setBookSlot({
                                startsAt: slot.startsAt,
                                time: slot.time,
                                takenClientIds: slot.people.map((person) => person.clientId),
                              })
                            }
                          >
                            Anotar
                          </button>
                        ) : null}
                      </span>
                    </div>
                    {slot.people.length ? (
                      <ul className="mt-1.5 space-y-1">
                        {slot.people.map((person) => (
                          <li key={person.turnId} className="flex items-center justify-between gap-2 text-[13px]">
                            <span className="min-w-0 truncate text-p-text-secondary">
                              {person.name}
                              {person.checkedInAt ? <span className="ml-1.5 text-[12px] font-semibold text-p-positive">· entró</span> : null}
                            </span>
                            {upcoming && !person.checkedInAt ? (
                              <button
                                type="button"
                                className={adminButton('ghost', 'sm')}
                                onClick={() => setCancelTarget({ turnId: person.turnId, name: person.name, time: slot.time })}
                              >
                                Cancelar
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={cardCls}>
          <header className={cardHeaderCls}>
            <h2 className="text-[14px] font-semibold text-p-text">Ingresos</h2>
            <p className="text-[12px] text-p-text-muted">
              {logs
                ? `${logs.allowed} ${logs.allowed === 1 ? 'entró' : 'entraron'} · ${logs.denied} ${
                    logs.denied === 1 ? 'rechazado' : 'rechazados'
                  }`
                : ''}
            </p>
          </header>
          {!logs ? (
            <p className="px-4 py-6 text-center text-[13px] text-p-text-muted">Cargando...</p>
          ) : logs.rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-p-text-muted">
              {isToday ? 'Todavía nadie pasó por el molinete.' : 'Nadie intentó entrar este día.'}
            </p>
          ) : (
            <ul className="divide-y divide-p-border">
              {logs.rows.map((row) => (
                <li key={row.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className="w-11 shrink-0 pt-px text-[12px] font-semibold tabular-nums text-p-text-muted">{row.time}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-p-text">
                      {row.name || 'Sin identificar'}
                      <span className="font-normal text-p-text-muted"> · {METHOD_LABEL[row.method] || row.method}</span>
                    </p>
                    {row.result === 'DENIED' ? <p className="text-[12px] text-p-text-secondary">{row.message}</p> : null}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      row.result === 'ALLOWED' ? 'bg-p-positive-bg text-p-positive' : 'bg-p-warning-bg text-p-warning'
                    }`}
                  >
                    {row.result === 'ALLOWED' ? 'Entró' : 'Rechazado'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <GymBookDrawer
        open={Boolean(bookSlot)}
        onClose={() => setBookSlot(null)}
        clubSlug={clubSlug}
        slot={
          bookSlot && day && scheduleId
            ? { activityTypeId: scheduleId, activityName: day.name, startsAt: bookSlot.startsAt, time: bookSlot.time }
            : null
        }
        takenClientIds={bookSlot?.takenClientIds || []}
        onBooked={() => void load()}
      />

      <AdminAppModal
        show={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title="¿Cancelás el turno?"
        message={cancelTarget ? `${cancelTarget.name} a las ${cancelTarget.time}. El lugar queda libre para otro.` : ''}
        cancelText="Volver"
        confirmText={cancelling ? 'Cancelando...' : 'Cancelar turno'}
        confirmDisabled={cancelling}
        isWarning
        onConfirm={() => void confirmCancel()}
      />
    </div>
  );
}
