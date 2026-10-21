import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { AdminFeedbackBanner } from '../../../components/admin/ui/AdminFeedback';
import SettingsSection from './SettingsSection';
import { useAuth } from '../../../contexts/AuthContext';
import { BookingWindowService, type BookingWindowPolicy } from '../../../services/BookingWindowService';
import { showAdminToast } from '../../../utils/adminToast';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';
import { getActiveClubSlug, hasAdminAccess } from '../../../utils/session';

const selectClass =
  'h-9 rounded-lg border border-p-border bg-p-surface px-2 text-[13px] text-p-text outline-none focus:border-p-text-secondary disabled:opacity-50';
const primaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold !text-ink-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50';

// Horarios cada 30 minutos para elegir apertura y cierre.
const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours = String(Math.floor(index / 2)).padStart(2, '0');
  return `${hours}:${index % 2 === 0 ? '00' : '30'}`;
});

const DEFAULT_POLICY: BookingWindowPolicy = {
  enabled: false,
  weekdays: { memberOpensAt: '08:00', publicOpensAt: '11:00' },
  weekendMode: 'SAME',
  weekend: { memberOpensAt: '08:00', publicOpensAt: '11:00' },
  daysAhead: 1,
  closesAt: '00:00'
};

const daysAheadLabel = (days: number) =>
  days === 0 ? 'Solo hoy' : days === 1 ? 'Hoy y mañana' : `Hoy y los próximos ${days} días`;

function TimeSelect({ value, onChange, disabled, label }: { value: string; onChange: (value: string) => void; disabled?: boolean; label: string }) {
  // Si viene un horario que no está en la lista (ej. 08:15), se agrega para no perderlo.
  const options = TIME_OPTIONS.includes(value) ? TIME_OPTIONS : [...TIME_OPTIONS, value].sort();
  return (
    <select aria-label={label} className={selectClass} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {options.map((time) => <option key={time} value={time}>{time}</option>)}
    </select>
  );
}

// Ajustes > Reservas: desde qué hora reservan socios y no socios desde la app (prioridad de socios).
export default function SettingsBookingWindowSection() {
  const { user } = useAuth();
  const clubSlug = useMemo(() => getActiveClubSlug(user as any), [user]);
  const canManage = hasAdminAccess(user as any);

  const [policy, setPolicy] = useState<BookingWindowPolicy>(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!clubSlug) return;
    setLoading(true);
    try {
      setPolicy(await BookingWindowService.getPolicy(clubSlug));
      setError('');
    } catch (err) {
      reportUiError({ area: 'SettingsBookingWindowSection', action: 'load' }, err);
      setError(extractErrorMessage(err, 'No se pudo cargar la configuración de ventanas de reserva.'));
    } finally {
      setLoading(false);
    }
  }, [clubSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!clubSlug || saving) return;
    try {
      setSaving(true);
      setError('');
      setPolicy(await BookingWindowService.savePolicy(clubSlug, policy));
      showAdminToast('Ventanas de reserva guardadas.');
    } catch (err) {
      reportUiError({ area: 'SettingsBookingWindowSection', action: 'save' }, err);
      setError(extractErrorMessage(err, 'No se pudo guardar la configuración.'));
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) return null;

  const disabled = loading || saving;
  const closeLabel = policy.closesAt === '00:00' ? 'medianoche' : `las ${policy.closesAt}`;
  const weekdaySummary = `De lunes a viernes: de 00:00 a ${policy.weekdays.memberOpensAt} nadie reserva, de ${policy.weekdays.memberOpensAt} a ${policy.weekdays.publicOpensAt} solo socios y desde las ${policy.weekdays.publicOpensAt} todos, hasta ${closeLabel}.`;
  const weekendSummary = policy.weekendMode === 'SAME'
    ? 'El fin de semana, igual.'
    : policy.weekendMode === 'NO_PRIORITY'
      ? `El fin de semana reservan todos desde las ${policy.weekend.publicOpensAt}.`
      : `El fin de semana: socios desde las ${policy.weekend.memberOpensAt} y el resto desde las ${policy.weekend.publicOpensAt}.`;

  return (
    <div className="space-y-4">
      {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}

      <SettingsSection
        title="Ventanas de reserva"
        description="Definí desde qué hora puede reservar cada jugador desde la app. Los socios vigentes del padrón pueden tener prioridad. Fuera de su horario el jugador no ve los turnos, solo un aviso. No afecta al mostrador ni a los turnos fijos."
        action={
          <button type="button" className={primaryButtonClass} disabled={disabled} onClick={() => void handleSave()}>
            <Save size={14} /> Guardar
          </button>
        }
      >
        <label className="flex items-center gap-2 text-[13px] font-semibold text-p-text">
          <input
            type="checkbox"
            checked={policy.enabled}
            disabled={disabled}
            onChange={(event) => setPolicy((prev) => ({ ...prev, enabled: event.target.checked }))}
          />
          Activar ventanas de reserva
        </label>

        <div className={`mt-4 space-y-4 ${policy.enabled ? '' : 'opacity-60'}`}>
          <div className="overflow-auto">
            <table className="text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-p-text-muted">
                  <th className="py-2 pr-6">Días</th>
                  <th className="px-2 py-2">Socios desde</th>
                  <th className="px-2 py-2">No socios desde</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-p-border">
                  <td className="py-2 pr-6 font-semibold text-p-text">Lunes a viernes</td>
                  <td className="px-2 py-2">
                    <TimeSelect
                      label="Socios de lunes a viernes desde"
                      value={policy.weekdays.memberOpensAt}
                      disabled={disabled}
                      onChange={(value) => setPolicy((prev) => ({ ...prev, weekdays: { ...prev.weekdays, memberOpensAt: value } }))}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <TimeSelect
                      label="No socios de lunes a viernes desde"
                      value={policy.weekdays.publicOpensAt}
                      disabled={disabled}
                      onChange={(value) => setPolicy((prev) => ({ ...prev, weekdays: { ...prev.weekdays, publicOpensAt: value } }))}
                    />
                  </td>
                </tr>
                <tr className="border-t border-p-border align-top">
                  <td className="py-2 pr-6">
                    <span className="block font-semibold text-p-text">Sábado y domingo</span>
                    <select
                      aria-label="Horario del fin de semana"
                      className={`${selectClass} mt-2`}
                      value={policy.weekendMode}
                      disabled={disabled}
                      onChange={(event) => setPolicy((prev) => ({ ...prev, weekendMode: event.target.value as BookingWindowPolicy['weekendMode'] }))}
                    >
                      <option value="SAME">Igual que en la semana</option>
                      <option value="CUSTOM">Otros horarios</option>
                      <option value="NO_PRIORITY">Sin prioridad (todos a la misma hora)</option>
                    </select>
                  </td>
                  {policy.weekendMode === 'SAME' ? (
                    <>
                      <td className="px-2 py-2 text-p-text-muted">{policy.weekdays.memberOpensAt}</td>
                      <td className="px-2 py-2 text-p-text-muted">{policy.weekdays.publicOpensAt}</td>
                    </>
                  ) : policy.weekendMode === 'NO_PRIORITY' ? (
                    <td className="px-2 py-2" colSpan={2}>
                      <span className="mr-2 text-[12px] text-p-text-muted">Todos desde</span>
                      <TimeSelect
                        label="Todos el fin de semana desde"
                        value={policy.weekend.publicOpensAt}
                        disabled={disabled}
                        onChange={(value) => setPolicy((prev) => ({ ...prev, weekend: { ...prev.weekend, publicOpensAt: value } }))}
                      />
                    </td>
                  ) : (
                    <>
                      <td className="px-2 py-2">
                        <TimeSelect
                          label="Socios el fin de semana desde"
                          value={policy.weekend.memberOpensAt}
                          disabled={disabled}
                          onChange={(value) => setPolicy((prev) => ({ ...prev, weekend: { ...prev.weekend, memberOpensAt: value } }))}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <TimeSelect
                          label="No socios el fin de semana desde"
                          value={policy.weekend.publicOpensAt}
                          disabled={disabled}
                          onChange={(value) => setPolicy((prev) => ({ ...prev, weekend: { ...prev.weekend, publicOpensAt: value } }))}
                        />
                      </td>
                    </>
                  )}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-6">
            <label className="block text-[12px] font-semibold text-p-text-muted">
              Qué días se pueden reservar
              <select
                className={`${selectClass} mt-1 block`}
                value={policy.daysAhead}
                disabled={disabled}
                onChange={(event) => setPolicy((prev) => ({ ...prev, daysAhead: Number(event.target.value) }))}
              >
                {[0, 1, 2, 3, 4, 5, 6, 7].map((days) => <option key={days} value={days}>{daysAheadLabel(days)}</option>)}
              </select>
            </label>
            <label className="block text-[12px] font-semibold text-p-text-muted">
              Las reservas cierran a las
              <span className="mt-1 block">
                <TimeSelect
                  label="Las reservas cierran a las"
                  value={policy.closesAt}
                  disabled={disabled}
                  onChange={(value) => setPolicy((prev) => ({ ...prev, closesAt: value }))}
                />
              </span>
            </label>
          </div>

          <div className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2.5 text-[12px] text-p-text-secondary">
            <span className="font-semibold text-p-text">Así lo ven los jugadores: </span>
            {weekdaySummary} {weekendSummary} Siempre para {daysAheadLabel(policy.daysAhead).toLowerCase()}.
            <span className="mt-1 block text-p-text-muted">Cierre a las 00:00 significa hasta la medianoche.</span>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
