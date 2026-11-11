import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { AdminFeedbackBanner } from '../../../components/admin/ui/AdminFeedback';
import SettingsSection from './SettingsSection';
import { useAuth } from '../../../contexts/AuthContext';
import { PlayerPricingService, type PaymentMethodDiscounts } from '../../../services/PlayerPricingService';
import { showAdminToast } from '../../../utils/adminToast';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';
import { getActiveClubSlug, hasAdminAccess } from '../../../utils/session';

const METHODS: Array<{ key: keyof PaymentMethodDiscounts; label: string; hint: string }> = [
  { key: 'CASH', label: 'Efectivo', hint: 'Ej. 20 = el precio efectivo es 20% menos que el de lista.' },
  { key: 'TRANSFER', label: 'Transferencia', hint: 'Dejalo en 0 si la transferencia paga precio de lista.' },
  { key: 'CARD', label: 'Tarjeta', hint: 'Normalmente 0.' },
  { key: 'ONLINE', label: 'Pago online (app)', hint: 'Descuento por pagar por adelantado con Mercado Pago desde la app.' },
];

const inputClass =
  'h-9 w-24 rounded-lg border border-p-border bg-p-surface px-2 text-right text-[13px] text-p-text outline-none focus:border-p-text-secondary';
const primaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold !text-ink-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50';

const EXAMPLE_LIST_PRICE = 37500;

// Ajustes > Precios: descuento por medio de pago (precio efectivo vs precio de lista).
export default function SettingsPaymentMethodDiscountSection() {
  const { user } = useAuth();
  const clubSlug = useMemo(() => getActiveClubSlug(user as any), [user]);
  const canManage = hasAdminAccess(user as any);

  const [drafts, setDrafts] = useState<Record<keyof PaymentMethodDiscounts, string>>({ CASH: '0', TRANSFER: '0', CARD: '0', ONLINE: '0' });
  const [showCashPriceInApp, setShowCashPriceInApp] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const applyDiscounts = (discounts?: PaymentMethodDiscounts) =>
    setDrafts({
      CASH: String(discounts?.CASH ?? 0),
      TRANSFER: String(discounts?.TRANSFER ?? 0),
      CARD: String(discounts?.CARD ?? 0),
      ONLINE: String(discounts?.ONLINE ?? 0),
    });

  const load = useCallback(async () => {
    if (!clubSlug) return;
    setLoading(true);
    try {
      const settings = await PlayerPricingService.getSettings(clubSlug);
      applyDiscounts(settings.paymentMethodDiscounts);
      setShowCashPriceInApp(settings.showCashPriceInApp !== false);
      setError('');
    } catch (err) {
      reportUiError({ area: 'SettingsPaymentMethodDiscountSection', action: 'load' }, err);
      setError(extractErrorMessage(err, 'No se pudo cargar el descuento por medio de pago.'));
    } finally {
      setLoading(false);
    }
  }, [clubSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!clubSlug || saving) return;
    const parsed = METHODS.reduce((acc, method) => {
      acc[method.key] = Number(String(drafts[method.key] || '0').replace(',', '.'));
      return acc;
    }, {} as PaymentMethodDiscounts);
    if (Object.values(parsed).some((value) => !Number.isFinite(value) || value < 0 || value > 90)) {
      setError('Cada descuento tiene que ser un porcentaje entre 0 y 90.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      const result = await PlayerPricingService.updateSettings(clubSlug, { paymentMethodDiscounts: parsed, showCashPriceInApp });
      applyDiscounts(result.paymentMethodDiscounts);
      setShowCashPriceInApp(result.showCashPriceInApp !== false);
      showAdminToast('Descuentos por medio de pago guardados.');
    } catch (err) {
      reportUiError({ area: 'SettingsPaymentMethodDiscountSection', action: 'save' }, err);
      setError(extractErrorMessage(err, 'No se pudo guardar el descuento.'));
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) return null;

  const cashPercent = Number(drafts.CASH || 0);
  const exampleCash = Number.isFinite(cashPercent) ? EXAMPLE_LIST_PRICE * (1 - cashPercent / 100) : EXAMPLE_LIST_PRICE;

  return (
    <SettingsSection
      title="Precio por medio de pago"
      description="Los precios cargados son de lista. Al cobrar en el mostrador con un medio que tenga descuento, se ofrece el precio con descuento y se descuenta del saldo."
      action={(
        <button type="button" className={primaryButtonClass} disabled={loading || saving} onClick={() => void handleSave()}>
          <Save size={14} />
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      )}
    >
      <div className="space-y-3">
        {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}
        {METHODS.map((method) => (
          <div key={method.key} className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-p-text">{method.label}</p>
              <p className="text-[11px] text-p-text-muted">{method.hint}</p>
            </div>
            <label className="flex items-center gap-2 text-[12px] text-p-text-muted">
              <input
                aria-label={`Descuento ${method.label}`}
                className={inputClass}
                type="number"
                inputMode="decimal"
                min={0}
                max={90}
                step="0.5"
                disabled={loading || saving}
                value={drafts[method.key]}
                onChange={(event) => setDrafts((prev) => ({ ...prev, [method.key]: event.target.value }))}
              />
              % menos
            </label>
          </div>
        ))}
        <label className="flex cursor-pointer items-start gap-2 border-t border-p-border pt-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-p-brand"
            checked={showCashPriceInApp}
            disabled={loading || saving}
            onChange={(event) => setShowCashPriceInApp(event.target.checked)}
          />
          <span>
            <span className="block text-[13px] font-semibold text-p-text">Mostrar el precio efectivo en la app</span>
            <span className="block text-[11px] text-p-text-muted">
              El jugador ve cuánto le sale pagando en efectivo en el club. Si lo apagás, solo lo ve en el mostrador
              (más gente paga online por adelantado).
            </span>
          </span>
        </label>
        {cashPercent > 0 && (
          <p className="rounded-lg border border-p-border bg-p-surface-2 px-3 py-2 text-[12px] text-p-text-muted">
            Ejemplo: una clase de lista ${EXAMPLE_LIST_PRICE.toLocaleString('es-AR')} se cobra ${Math.round(exampleCash).toLocaleString('es-AR')} en efectivo.
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
