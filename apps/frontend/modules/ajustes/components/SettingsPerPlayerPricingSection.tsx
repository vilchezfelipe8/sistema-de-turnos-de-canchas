import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { AdminFeedbackBanner } from '../../../components/admin/ui/AdminFeedback';
import SettingsSection from './SettingsSection';
import { useAuth } from '../../../contexts/AuthContext';
import { PlayerPricingService, type ClubPricingMode, type PlayerPriceTable } from '../../../services/PlayerPricingService';
import { showAdminToast } from '../../../utils/adminToast';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';
import { getActiveClubSlug, hasAdminAccess } from '../../../utils/session';

const cellKey = (formatId: string, categoryId: string | null) => `${formatId}::${categoryId ?? 'GENERAL'}`;
const inputClass =
  'h-9 w-28 rounded-lg border border-p-border bg-p-surface px-2 text-right text-[13px] text-p-text outline-none focus:border-p-text-secondary';
const primaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold !text-ink-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50';
const optionClass = (active: boolean) =>
  `h-9 rounded-lg border px-3 text-[12px] font-semibold transition ${active ? 'border-ink-900 bg-ink-900 !text-ink-50' : 'border-p-border text-p-text hover:bg-p-surface-2'}`;

// Ajustes > Precios: modo de precio del club y tabla de precio por jugador (modalidad × categoría).
export default function SettingsPerPlayerPricingSection() {
  const { user } = useAuth();
  const clubSlug = useMemo(() => getActiveClubSlug(user as any), [user]);
  const canManage = hasAdminAccess(user as any);

  const [pricingMode, setPricingMode] = useState<ClubPricingMode>('PER_COURT');
  const [onlineCheckoutEnabled, setOnlineCheckoutEnabled] = useState(true);
  const [table, setTable] = useState<PlayerPriceTable | null>(null);
  const [cells, setCells] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const applyTable = (next: PlayerPriceTable) => {
    setTable(next);
    const nextCells: Record<string, string> = {};
    for (const price of next.prices) nextCells[cellKey(price.activityFormatId, price.memberCategoryId)] = String(price.pricePerPlayer);
    setCells(nextCells);
  };

  const load = useCallback(async () => {
    if (!clubSlug) return;
    setLoading(true);
    try {
      const [settings, priceTable] = await Promise.all([
        PlayerPricingService.getSettings(clubSlug),
        PlayerPricingService.getPriceTable(clubSlug)
      ]);
      setPricingMode(settings.pricingMode);
      setOnlineCheckoutEnabled(settings.onlineCheckoutEnabled);
      applyTable(priceTable);
      setError('');
    } catch (err) {
      reportUiError({ area: 'SettingsPerPlayerPricingSection', action: 'load' }, err);
      setError(extractErrorMessage(err, 'No se pudo cargar la configuración de precios.'));
    } finally {
      setLoading(false);
    }
  }, [clubSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateSettings = async (body: { pricingMode?: ClubPricingMode; onlineCheckoutEnabled?: boolean }) => {
    if (!clubSlug || saving) return;
    try {
      setSaving(true);
      setError('');
      const result = await PlayerPricingService.updateSettings(clubSlug, body);
      setPricingMode(result.pricingMode);
      setOnlineCheckoutEnabled(result.onlineCheckoutEnabled);
      showAdminToast('Configuración actualizada.');
    } catch (err) {
      reportUiError({ area: 'SettingsPerPlayerPricingSection', action: 'updateSettings' }, err);
      setError(extractErrorMessage(err, 'No se pudo actualizar la configuración.'));
    } finally {
      setSaving(false);
    }
  };

  const activeFormats = (table?.formats || []).filter((format) => format.isActive);
  const activeCategories = (table?.categories || []).filter((category) => category.isActive);
  const columns: Array<{ id: string | null; name: string }> = [{ id: null, name: 'No socio' }, ...activeCategories];

  // RN-13: advertir si un precio socio supera al general (no bloquea).
  const warnings = activeFormats.flatMap((format) => {
    const general = Number(cells[cellKey(format.id, null)]);
    return activeCategories
      .filter((category) => {
        const value = Number(cells[cellKey(format.id, category.id)]);
        return cells[cellKey(format.id, category.id)] && Number.isFinite(general) && value > general;
      })
      .map((category) => `${format.activityName} ${format.name}: el precio ${category.name} es mayor que el de no socio.`);
  });
  const missingGeneral = activeFormats.filter((format) => !String(cells[cellKey(format.id, null)] || '').trim());

  const handleSave = async () => {
    if (!clubSlug || !table || saving) return;
    const prices = activeFormats.flatMap((format) =>
      columns.map((column) => {
        const raw = String(cells[cellKey(format.id, column.id)] ?? '').trim();
        return {
          activityFormatId: format.id,
          memberCategoryId: column.id,
          pricePerPlayer: raw === '' ? null : Number(raw)
        };
      })
    );
    if (prices.some((price) => price.pricePerPlayer !== null && (!Number.isFinite(price.pricePerPlayer) || price.pricePerPlayer < 0))) {
      setError('Los precios deben ser números positivos.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      applyTable(await PlayerPricingService.savePriceTable(clubSlug, prices));
      showAdminToast('Precios guardados.');
    } catch (err) {
      reportUiError({ area: 'SettingsPerPlayerPricingSection', action: 'savePrices' }, err);
      setError(extractErrorMessage(err, 'No se pudieron guardar los precios.'));
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) return null;

  return (
    <div className="space-y-4">
      {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}

      <SettingsSection
        title="Modo de precio de los turnos"
        description="Por cancha: un precio por turno según cancha y horario. Por jugador: cada jugador paga según la modalidad y su categoría (socio / no socio)."
      >
        <div className="flex flex-wrap gap-2">
          <button type="button" className={optionClass(pricingMode === 'PER_COURT')} disabled={loading || saving} onClick={() => void updateSettings({ pricingMode: 'PER_COURT' })}>
            Por cancha
          </button>
          <button type="button" className={optionClass(pricingMode === 'PER_PLAYER')} disabled={loading || saving} onClick={() => void updateSettings({ pricingMode: 'PER_PLAYER' })}>
            Por jugador
          </button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-[13px] text-p-text">
          <input
            type="checkbox"
            checked={!onlineCheckoutEnabled}
            disabled={loading || saving}
            onChange={(event) => void updateSettings({ onlineCheckoutEnabled: !event.target.checked })}
          />
          Cobrar solo en el mostrador (la app no ofrece pago online)
        </label>
      </SettingsSection>

      {pricingMode === 'PER_PLAYER' ? (
        <SettingsSection
          title="Precio por jugador"
          description="Precio que paga cada jugador por turno. Si una categoría no tiene precio, paga el de no socio. El recargo por luces se reparte entre los jugadores."
          action={
            <button type="button" className={primaryButtonClass} disabled={saving || loading} onClick={() => void handleSave()}>
              <Save size={14} /> Guardar
            </button>
          }
        >
          {activeFormats.length === 0 ? (
            <p className="text-[13px] text-p-text-muted">Primero cargá las modalidades en Ajustes &gt; Actividades.</p>
          ) : (
            <div className="overflow-auto">
              <table className="text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-p-text-muted">
                    <th className="py-2 pr-4">Modalidad</th>
                    {columns.map((column) => (
                      <th key={column.id ?? 'general'} className="px-2 py-2 text-right">{column.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeFormats.map((format) => (
                    <tr key={format.id} className="border-t border-p-border">
                      <td className="py-2 pr-4">
                        <span className="font-semibold text-p-text">{format.activityName} {format.name}</span>
                        <span className="ml-1 text-[12px] text-p-text-muted">({format.playerCount} jug.)</span>
                      </td>
                      {columns.map((column) => (
                        <td key={column.id ?? 'general'} className="px-2 py-2 text-right">
                          <input
                            className={inputClass}
                            type="number"
                            min={0}
                            step="1"
                            placeholder={column.id ? 'general' : '$'}
                            value={cells[cellKey(format.id, column.id)] ?? ''}
                            onChange={(event) => setCells((prev) => ({ ...prev, [cellKey(format.id, column.id)]: event.target.value }))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {missingGeneral.length > 0 ? (
            <div className="mt-3">
              <AdminFeedbackBanner tone="warning" compact>
                Sin precio de no socio no se puede reservar: {missingGeneral.map((format) => `${format.activityName} ${format.name}`).join(', ')}.
              </AdminFeedbackBanner>
            </div>
          ) : null}
          {warnings.length > 0 ? (
            <div className="mt-3">
              <AdminFeedbackBanner tone="warning" compact>{warnings.join(' ')}</AdminFeedbackBanner>
            </div>
          ) : null}
        </SettingsSection>
      ) : null}
    </div>
  );
}
