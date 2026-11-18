import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import AdminModal from '../../../components/admin/ui/AdminModal';
import { AdminFeedbackBanner } from '../../../components/admin/ui/AdminFeedback';
import SettingsSection from './SettingsSection';
import { useAuth } from '../../../contexts/AuthContext';
import {
  ActivityTurnService,
  WEEKDAY_SHORT,
  windowsLabel,
  type AdminTurnDay,
  type TurnSchedule,
  type TurnScheduleInput,
} from '../../../services/ActivityTurnService';
import { showAdminToast } from '../../../utils/adminToast';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';
import { getActiveClubSlug, hasAdminAccess } from '../../../utils/session';

const inputClass =
  'h-9 w-full rounded-lg border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-text-secondary';
const labelClass = 'space-y-1 text-[12px] font-semibold text-p-text-secondary';
const primaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold !text-ink-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50';
const ghostButtonClass =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-p-border px-3 text-[12px] font-semibold text-p-text transition hover:bg-p-surface-2 disabled:cursor-not-allowed disabled:opacity-50';
const iconButtonClass =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-p-border text-p-text-muted hover:bg-p-surface-2 hover:text-p-text';

// Lunes primero.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

type WindowDraft = { weekdays: number[]; open: string; close: string };
type Draft = {
  name: string;
  slotMinutes: string;
  capacity: string;
  windows: WindowDraft[];
  bookAheadDays: string;
  requiresTurn: boolean;
  earlyEntryMinutes: string;
  isActive: boolean;
};

const emptyDraft = (): Draft => ({
  name: 'Musculación',
  slotMinutes: '60',
  capacity: '20',
  windows: [
    { weekdays: [1, 2, 3, 4, 5], open: '07:00', close: '23:00' },
    { weekdays: [6], open: '08:00', close: '14:00' },
  ],
  bookAheadDays: '7',
  requiresTurn: true,
  earlyEntryMinutes: '15',
  isActive: true,
});

const draftFrom = (row: TurnSchedule): Draft => ({
  name: row.name,
  slotMinutes: String(row.slotMinutes),
  capacity: String(row.capacity),
  windows: row.windows.map((w) => ({ ...w, weekdays: [...w.weekdays] })),
  bookAheadDays: String(row.bookAheadDays),
  requiresTurn: row.requiresTurn,
  earlyEntryMinutes: String(row.earlyEntryMinutes),
  isActive: row.isActive,
});

const toInput = (draft: Draft): TurnScheduleInput => ({
  name: draft.name.trim(),
  slotMinutes: Number(draft.slotMinutes),
  capacity: Number(draft.capacity),
  windows: draft.windows,
  bookAheadDays: Number(draft.bookAheadDays),
  requiresTurn: draft.requiresTurn,
  earlyEntryMinutes: draft.requiresTurn ? Number(draft.earlyEntryMinutes || 0) : 0,
  isActive: draft.isActive,
});

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

// Ajustes > Turnero: actividades sin cancha con cupo por franja (ej. Musculación).
export default function SettingsTurnSchedulesSection() {
  const { user } = useAuth();
  const clubSlug = useMemo(() => getActiveClubSlug(user as any), [user]);
  const canManage = hasAdminAccess(user as any);

  const [rows, setRows] = useState<TurnSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<{ activityTypeId: number | null; draft: Draft } | null>(null);
  const [viewing, setViewing] = useState<{ schedule: TurnSchedule; date: string } | null>(null);
  const [dayData, setDayData] = useState<AdminTurnDay | null>(null);
  const [dayError, setDayError] = useState('');

  const load = useCallback(async () => {
    if (!clubSlug) return;
    setLoading(true);
    try {
      setRows(await ActivityTurnService.listSchedules(clubSlug));
      setError('');
    } catch (err) {
      reportUiError({ area: 'SettingsTurnSchedulesSection', action: 'load' }, err);
      setError(extractErrorMessage(err, 'No se pudieron cargar los turneros.'));
    } finally {
      setLoading(false);
    }
  }, [clubSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDay = useCallback(async () => {
    if (!clubSlug || !viewing) return;
    try {
      setDayError('');
      setDayData(await ActivityTurnService.adminDay(clubSlug, viewing.schedule.activityTypeId, viewing.date));
    } catch (err) {
      reportUiError({ area: 'SettingsTurnSchedulesSection', action: 'loadDay' }, err);
      setDayData(null);
      setDayError(extractErrorMessage(err, 'No se pudieron cargar los turnos.'));
    }
  }, [clubSlug, viewing]);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  const updateDraft = (patch: Partial<Draft>) => setEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev));
  const updateWindow = (index: number, patch: Partial<WindowDraft>) =>
    setEditing((prev) =>
      prev ? { ...prev, draft: { ...prev.draft, windows: prev.draft.windows.map((w, i) => (i === index ? { ...w, ...patch } : w)) } } : prev
    );

  const handleSave = async () => {
    if (!editing || !clubSlug) return;
    try {
      setSaving(true);
      setFormError('');
      const input = toInput(editing.draft);
      if (editing.activityTypeId) {
        await ActivityTurnService.updateSchedule(clubSlug, editing.activityTypeId, input);
        showAdminToast('Turnero guardado.');
      } else {
        await ActivityTurnService.createSchedule(clubSlug, input);
        showAdminToast('Turnero creado. Sumalo a los planes que lo incluyen.');
      }
      setEditing(null);
      await load();
    } catch (err) {
      reportUiError({ area: 'SettingsTurnSchedulesSection', action: 'save' }, err);
      setFormError(extractErrorMessage(err, 'No se pudo guardar el turnero.'));
    } finally {
      setSaving(false);
    }
  };

  const handleCancelTurn = async (turnId: string, name: string) => {
    if (!clubSlug || !window.confirm(`¿Cancelás el turno de ${name}?`)) return;
    try {
      await ActivityTurnService.adminCancel(clubSlug, turnId);
      showAdminToast('Turno cancelado.');
      await loadDay();
    } catch (err) {
      reportUiError({ area: 'SettingsTurnSchedulesSection', action: 'cancelTurn' }, err);
      setDayError(extractErrorMessage(err, 'No se pudo cancelar el turno.'));
    }
  };

  const draft = editing?.draft;
  const visibleSlots = (dayData?.slots || []).filter((slot) => slot.people.length > 0 || !slot.isPast);

  return (
    <SettingsSection
      title="Turnero"
      description="Para actividades sin cancha con cupo por hora, como Musculación. Los socios reservan su turno desde la app y el plan define cuántas veces por semana pueden venir."
      action={
        canManage ? (
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => {
              setFormError('');
              setEditing({ activityTypeId: null, draft: emptyDraft() });
            }}
          >
            <Plus size={14} /> Nuevo turnero
          </button>
        ) : null
      }
    >
      {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}
      {loading && !rows.length ? <p className="text-[13px] text-p-text-muted">Cargando...</p> : null}
      {!loading && !rows.length ? (
        <p className="text-[13px] text-p-text-muted">Todavía no hay turnero. Creá uno, por ejemplo &quot;Musculación&quot;.</p>
      ) : null}

      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.activityTypeId} className={`rounded-xl border border-p-border p-3 ${row.isActive ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-p-text">
                  {row.name}
                  {!row.isActive ? <span className="ml-2 text-[11px] font-semibold text-p-text-muted">Pausado</span> : null}
                </p>
                <p className="text-[12px] text-p-text-muted">
                  Turnos de {row.slotMinutes} min · {row.capacity} lugares · Reserva hasta {row.bookAheadDays}{' '}
                  {row.bookAheadDays === 1 ? 'día' : 'días'} antes
                </p>
                <p className="text-[12px] text-p-text-secondary">{windowsLabel(row.windows)}</p>
                <p className="text-[12px] text-p-text-secondary">
                  {row.requiresTurn
                    ? `Para entrar hace falta turno (desde ${row.earlyEntryMinutes} min antes).`
                    : 'Se puede entrar sin turno.'}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className={ghostButtonClass} onClick={() => setViewing({ schedule: row, date: todayKey() })}>
                  Ver turnos
                </button>
                {canManage ? (
                  <button
                    type="button"
                    className={ghostButtonClass}
                    onClick={() => {
                      setFormError('');
                      setEditing({ activityTypeId: row.activityTypeId, draft: draftFrom(row) });
                    }}
                  >
                    Editar
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <AdminModal
        open={editing !== null}
        title={editing?.activityTypeId ? 'Editar turnero' : 'Nuevo turnero'}
        description="Los turnos que ya reservaron se mantienen aunque cambies el horario."
        onClose={() => setEditing(null)}
        maxWidthClassName="max-w-2xl"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className={ghostButtonClass} onClick={() => setEditing(null)}>
              Cancelar
            </button>
            <button type="button" className={primaryButtonClass} disabled={saving} onClick={() => void handleSave()}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        }
      >
        {draft ? (
          <div className="space-y-4">
            {formError ? (
              <AdminFeedbackBanner tone="error" compact>
                {formError}
              </AdminFeedbackBanner>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={`${labelClass} sm:col-span-3`}>
                Nombre
                <input className={inputClass} value={draft.name} placeholder="Musculación" onChange={(e) => updateDraft({ name: e.target.value })} />
              </label>
              <label className={labelClass}>
                Duración del turno
                <select className={inputClass} value={draft.slotMinutes} onChange={(e) => updateDraft({ slotMinutes: e.target.value })}>
                  {[30, 45, 60, 90, 120].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Lugares por turno
                <input type="number" min={1} max={500} className={inputClass} value={draft.capacity} onChange={(e) => updateDraft({ capacity: e.target.value })} />
              </label>
              <label className={labelClass}>
                Reservar hasta (días antes)
                <input
                  type="number"
                  min={0}
                  max={30}
                  className={inputClass}
                  value={draft.bookAheadDays}
                  onChange={(e) => updateDraft({ bookAheadDays: e.target.value })}
                />
              </label>
            </div>

            <div className="space-y-2">
              <p className="text-[12px] font-semibold text-p-text-secondary">Horarios</p>
              {draft.windows.map((window, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-p-border p-2">
                  <div className="flex gap-1" role="group" aria-label="Días">
                    {WEEK_ORDER.map((d) => {
                      const on = window.weekdays.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          className={`h-8 w-10 rounded-md border text-[11px] font-semibold ${
                            on ? 'border-ink-900 bg-ink-900 !text-ink-50' : 'border-p-border text-p-text-secondary hover:bg-p-surface-2'
                          }`}
                          onClick={() =>
                            updateWindow(index, { weekdays: on ? window.weekdays.filter((x) => x !== d) : [...window.weekdays, d] })
                          }
                        >
                          {WEEKDAY_SHORT[d]}
                        </button>
                      );
                    })}
                  </div>
                  <label className="flex items-center gap-1 text-[12px] text-p-text-secondary">
                    de
                    <input type="time" className={`${inputClass} w-28`} value={window.open} onChange={(e) => updateWindow(index, { open: e.target.value })} />
                  </label>
                  <label className="flex items-center gap-1 text-[12px] text-p-text-secondary">
                    a
                    <input type="time" className={`${inputClass} w-28`} value={window.close} onChange={(e) => updateWindow(index, { close: e.target.value })} />
                  </label>
                  {draft.windows.length > 1 ? (
                    <button
                      type="button"
                      className={iconButtonClass}
                      aria-label="Quitar horario"
                      onClick={() => updateDraft({ windows: draft.windows.filter((_, i) => i !== index) })}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => updateDraft({ windows: [...draft.windows, { weekdays: [], open: '08:00', close: '12:00' }] })}
              >
                <Plus size={13} /> Agregar horario
              </button>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[13px] text-p-text">
                <input type="checkbox" checked={draft.requiresTurn} onChange={(e) => updateDraft({ requiresTurn: e.target.checked })} />
                Para entrar hace falta tener el turno reservado
              </label>
              {draft.requiresTurn ? (
                <label className={`${labelClass} block max-w-xs`}>
                  Puede entrar desde (minutos antes del turno)
                  <input
                    type="number"
                    min={0}
                    max={60}
                    className={inputClass}
                    value={draft.earlyEntryMinutes}
                    onChange={(e) => updateDraft({ earlyEntryMinutes: e.target.value })}
                  />
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-[13px] text-p-text">
                <input type="checkbox" checked={draft.isActive} onChange={(e) => updateDraft({ isActive: e.target.checked })} />
                Se puede reservar desde la app
              </label>
            </div>
            <p className="text-[12px] text-p-text-muted">
              Quién puede reservar y cuántas veces por semana se define en cada plan (Ajustes → Planes → Incluye).
            </p>
          </div>
        ) : null}
      </AdminModal>

      <AdminModal
        open={viewing !== null}
        title={viewing ? `Turnos de ${viewing.schedule.name}` : ''}
        onClose={() => {
          setViewing(null);
          setDayData(null);
        }}
        maxWidthClassName="max-w-xl"
      >
        {viewing ? (
          <div className="space-y-3">
            <label className={`${labelClass} block max-w-[200px]`}>
              Día
              <input
                type="date"
                className={inputClass}
                value={viewing.date}
                onChange={(e) => e.target.value && setViewing({ ...viewing, date: e.target.value })}
              />
            </label>
            {dayError ? (
              <AdminFeedbackBanner tone="error" compact>
                {dayError}
              </AdminFeedbackBanner>
            ) : null}
            {dayData && visibleSlots.length === 0 ? <p className="text-[13px] text-p-text-muted">No hay turnos este día.</p> : null}
            <ul className="divide-y divide-p-border rounded-lg border border-p-border">
              {visibleSlots.map((slot) => (
                <li key={slot.startsAt} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold tabular-nums text-p-text">{slot.time}</span>
                    <span className="text-[12px] text-p-text-muted">
                      {slot.booked} de {dayData?.capacity} {slot.available === 0 ? '· Completo' : ''}
                    </span>
                  </div>
                  {slot.people.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {slot.people.map((person) => (
                        <li key={person.turnId} className="flex items-center justify-between gap-2 text-[12px] text-p-text-secondary">
                          <span>{person.name}</span>
                          {!slot.isPast && new Date(slot.startsAt).getTime() > Date.now() ? (
                            <button
                              type="button"
                              className="text-[12px] font-semibold text-p-text-muted underline hover:text-p-text"
                              onClick={() => void handleCancelTurn(person.turnId, person.name)}
                            >
                              Cancelar
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </AdminModal>
    </SettingsSection>
  );
}
