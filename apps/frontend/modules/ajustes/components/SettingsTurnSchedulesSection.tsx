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
  type TurnSchedule,
  type TurnScheduleInput,
} from '../../../services/ActivityTurnService';
import { showAdminToast } from '../../../utils/adminToast';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';
import { getActiveClubSlug, hasAdminAccess } from '../../../utils/session';
import { adminChip } from '../../../components/admin/ui/adminChip';
import { adminButton } from '../../../components/admin/ui/adminButton';
import AdminTimeSelect from '../../../components/admin/ui/AdminTimeSelect';
import AdminCheckbox from '../../../components/admin/ui/AdminCheckbox';
import Link from 'next/link';

const inputClass =
  'h-9 w-full rounded-lg border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-text-secondary';
const labelClass = 'space-y-1 text-[12px] font-semibold text-p-text-secondary';
const primaryButtonClass = adminButton('primary', 'md');
const ghostButtonClass = adminButton('secondary', 'sm');
const iconButtonClass = `${adminButton('ghost', 'md')} !w-9 shrink-0 !px-0`;
const SLOT_MINUTES = [30, 45, 60, 90, 120];

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

  const draft = editing?.draft;

  return (
    <SettingsSection
      title="Actividades con cupo"
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
      {rows.some((row) => row.isActive) ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-p-border bg-p-surface-2 p-3">
          <p className="min-w-0 flex-1 text-[12px] text-p-text-secondary">
            Los turnos de cada día, los ingresos por el molinete y el kiosco están en Gimnasio. Acá se configura el horario y el cupo.
          </p>
          <Link href="/admin/gimnasio" className={ghostButtonClass}>
            Ir a Gimnasio
          </Link>
        </div>
      ) : null}
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
                <Link href="/admin/gimnasio" className={ghostButtonClass}>
                  Ver turnos
                </Link>
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
            <label className={`${labelClass} block`}>
              Nombre
              <input className={inputClass} value={draft.name} placeholder="Musculación" onChange={(e) => updateDraft({ name: e.target.value })} />
            </label>
            <div className="space-y-1">
              <p className="text-[12px] font-semibold text-p-text-secondary">Duración del turno</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Duración del turno">
                {SLOT_MINUTES.map((m) => {
                  const on = draft.slotMinutes === String(m);
                  return (
                    <button key={m} type="button" aria-pressed={on} className={adminChip(on, 'sm')} onClick={() => updateDraft({ slotMinutes: String(m) })}>
                      {m} min
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
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
                          className={`${adminChip(on, 'sm')} w-10 !px-0`}
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
                    <AdminTimeSelect ariaLabel="Desde" value={window.open} onChange={(value) => updateWindow(index, { open: value })} />
                  </label>
                  <label className="flex items-center gap-1 text-[12px] text-p-text-secondary">
                    a
                    <AdminTimeSelect ariaLabel="Hasta" value={window.close} onChange={(value) => updateWindow(index, { close: value })} />
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

            <div className="space-y-3">
              <AdminCheckbox
                label="Para entrar hace falta tener el turno reservado"
                checked={draft.requiresTurn}
                onChange={(checked) => updateDraft({ requiresTurn: checked })}
              />
              {draft.requiresTurn ? (
                <label className="ml-6 flex items-center gap-2 text-[13px] text-p-text-secondary">
                  Puede entrar desde
                  <input
                    type="number"
                    min={0}
                    max={60}
                    aria-label="Minutos antes del turno"
                    className={`${inputClass} !w-16 text-center`}
                    value={draft.earlyEntryMinutes}
                    onChange={(e) => updateDraft({ earlyEntryMinutes: e.target.value })}
                  />
                  minutos antes de su turno
                </label>
              ) : null}
              <AdminCheckbox
                label="Se puede reservar desde la app"
                checked={draft.isActive}
                onChange={(checked) => updateDraft({ isActive: checked })}
              />
            </div>
            <p className="text-[12px] text-p-text-muted">
              Quién puede reservar y cuántas veces por semana se define en cada plan (Ajustes → Planes → Incluye).
            </p>
          </div>
        ) : null}
      </AdminModal>

    </SettingsSection>
  );
}
