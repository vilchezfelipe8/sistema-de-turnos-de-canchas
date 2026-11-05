import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { AdminFeedbackBanner } from '../../../components/admin/ui/AdminFeedback';
import SettingsSection from './SettingsSection';
import { useAuth } from '../../../contexts/AuthContext';
import { PlayerPricingService, type OnlineDepositSettings } from '../../../services/PlayerPricingService';
import { showAdminToast } from '../../../utils/adminToast';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';
import { getActiveClubSlug, hasAdminAccess } from '../../../utils/session';

const inputClass =
  'h-9 w-24 rounded-lg border border-p-border bg-p-surface px-2 text-right text-[13px] text-p-text outline-none focus:border-p-text-secondary';
const primaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold !text-ink-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50';

// Ajustes > Reservas: seña online obligatoria al reservar desde la app (modo "Con seña").
export default function SettingsOnlineDepositSection() {
  const { user } = useAuth();
  const clubSlug = useMemo(() => getActiveClubSlug(user as any), [user]);
  const canManage = hasAdminAccess(user as any);

  const [settings, setSettings] = useState<OnlineDepositSettings & { onlineCheckoutEnabled?: boolean }>({});
  const [required, setRequired] = useState(false);
  const [holdMinutes, setHoldMinutes] = useState('15');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const apply = (next: OnlineDepositSettings & { onlineCheckoutEnabled?: boolean }) => {
    setSettings(next);
    setRequired(Boolean(next.onlineDepositRequired));
    setHoldMinutes(String(next.onlineDepositHoldMinutes ?? 15));
  };

  const load = useCallback(async () => {
    if (!clubSlug) return;
    setLoading(true);
    try {
      apply(await PlayerPricingService.getSettings(clubSlug));
      setError('');
    } catch (err) {
      reportUiError({ area: 'SettingsOnlineDepositSection', action: 'load' }, err);
      setError(extractErrorMessage(err, 'No se pudo cargar la configuración de seña online.'));
    } finally {
      setLoading(false);
    }
  }, [clubSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!clubSlug || saving) return;
    const minutes = Number(holdMinutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) {
      setError('El tiempo para pagar la seña tiene que ser entre 5 y 240 minutos.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      apply(await PlayerPricingService.updateSettings(clubSlug, { onlineDepositRequired: required, onlineDepositHoldMinutes: minutes }));
      showAdminToast('Seña online guardada.');
    } catch (err) {
      reportUiError({ area: 'SettingsOnlineDepositSection', action: 'save' }, err);
      setError(extractErrorMessage(err, 'No se pudo guardar la seña online.'));
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) return null;

  const depositMode = settings.bookingConfirmationMode === 'DEPOSIT_REQUIRED' && Number(settings.bookingDepositPercent || 0) > 0;
  const onlineOff = settings.onlineCheckoutEnabled === false;

  return (
    <SettingsSection
      title="Seña online"
      description="Cuando el club confirma reservas con seña, el jugador puede pagarla con Mercado Pago desde la app. Al cubrirla, la reserva se confirma sola."
      action={(
        <button type="button" className={primaryButtonClass} disabled={loading || saving || !depositMode} onClick={() => void handleSave()}>
          <Save size={14} />
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      )}
    >
      <div className="space-y-3">
        {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}
        {!loading && !depositMode && (
          <AdminFeedbackBanner tone="info">
            Para usar la seña online, elegí la confirmación &quot;Con seña&quot; y cargá el porcentaje en Confirmación de reservas.
          </AdminFeedbackBanner>
        )}
        {!loading && depositMode && onlineOff && (
          <AdminFeedbackBanner tone="warning">
            El club tiene el pago online apagado (Ajustes → Precios): la seña se cobra en el mostrador.
          </AdminFeedbackBanner>
        )}
        {depositMode && (
          <p className="text-[12px] text-p-text-muted">
            Seña actual: <b className="text-p-text">{Number(settings.bookingDepositPercent)}% del turno</b>. El jugador puede pagar la seña o el total.
          </p>
        )}
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-p-brand"
            checked={required}
            disabled={loading || saving || !depositMode}
            onChange={(event) => setRequired(event.target.checked)}
          />
          <span>
            <span className="block text-[13px] font-semibold text-p-text">Seña online obligatoria para reservar desde la app</span>
            <span className="block text-[11px] text-p-text-muted">
              El checkout deja de ofrecer &quot;Pagar en el club&quot;. Si el jugador no paga la seña a tiempo, el turno se libera solo.
              Las reservas que cargás desde el panel no se ven afectadas.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-p-text">Tiempo para pagar la seña</p>
            <p className="text-[11px] text-p-text-muted">Desde que se crea la reserva. Si hay un pago en curso en Mercado Pago, se espera.</p>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-p-text-muted">
            <input
              aria-label="Minutos para pagar la seña"
              className={inputClass}
              type="number"
              inputMode="numeric"
              min={5}
              max={240}
              step={1}
              disabled={loading || saving || !depositMode || !required}
              value={holdMinutes}
              onChange={(event) => setHoldMinutes(event.target.value)}
            />
            minutos
          </label>
        </div>
      </div>
    </SettingsSection>
  );
}
