import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminFeedbackBanner } from '../../../components/admin/ui/AdminFeedback';
import SettingsSection from './SettingsSection';
import { useAuth } from '../../../contexts/AuthContext';
import { PlayerPricingService, type ClubPricingMode, type PlayerPriceTable } from '../../../services/PlayerPricingService';
import { useSettingsSaveSlot } from '../SettingsSaveContext';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';
import { getActiveClubSlug, hasAdminAccess } from '../../../utils/session';

const cellKey = (formatId: string, categoryId: string | null) => `${formatId}::${categoryId ?? 'GENERAL'}`;
const inputClass =
  'h-9 w-28 rounded-lg border border-p-border bg-p-surface px-2 text-right text-[13px] text-p-text outline-none focus:border-p-text-secondary';
const optionClass = (active: boolean) =>
  `h-9 rounded-lg border px-3 text-[12px] font-semibold transition ${active ? 'border-ink-900 bg-ink-900 !text-ink-50' : 'border-p-border text-p-text hover:bg-p-surface-2'}`;

// Ajustes > Precios: modo de precio del club y tabla de precio por jugador (modalidad × categoría).
export default function SettingsPerPlayerPricingSection() {
  const { user } = useAuth();
  const clubSlug = useMemo(() => getActiveClubSlug(user as any), [user]);
  const canManage = hasAdminAccess(user as any);

  const [pricingMode, setPricingMode] = useState<ClubPricingMode>('PER_COURT');
  const [onlineCheckoutEnabled, setOnlineCheckoutEnabled] = useState(true);
  const [savedSettings, setSavedSettings] = useState<{ pricingMode: ClubPricingMode; onlineCheckoutEnabled: boolean }>({
    pricingMode: 'PER_COURT',
    onlineCheckoutEnabled: true,
  });
  const [table, setTable] = useState<PlayerPriceTable | null>(null);
  const [cells, setCells] = useState<Record<string, string>>({});
  const [savedCells, setSavedCells] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const applyTable = (next: PlayerPriceTable) => {
    setTable(next);
    const nextCells: Record<string, string> = {};
    for (const price of next.prices) nextCells[cellKey(price.activityFormatId, price.memberCategoryId)] = String(price.pricePerPlayer);
    setCells(nextCells);
    setSavedCells(nextCells);
  };

  const applySettings = (next: { pricingMode: ClubPricingMode; onlineCheckoutEnabled: boolean }) => {
    setPricingMode(next.pricingMode);
    setOnlineCheckoutEnabled(next.onlineCheckoutEnabled);
    setSavedSettings({ pricingMode: next.pricingMode, onlineCheckoutEnabled: next.onlineCheckoutEnabled });
  };

  const load = useCallback(async () => {
    if (!clubSlug) return;
    setLoading(true);
    try {
      const [settings, priceTable] = await Promise.all([
        PlayerPricingService.getSettings(clubSlug),
        PlayerPricingService.getPriceTable(clubSlug)
      ]);
      applySettings(settings);
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

  const settingsChanges =
    Number(pricingMode !== savedSettings.pricingMode) + Number(onlineCheckoutEnabled !== savedSettings.onlineCheckoutEnabled);
  const cellChanges = Array.from(new Set([...Object.keys(cells), ...Object.keys(savedCells)])).filter(
    (key) => String(cells[key] ?? '').trim() !== String(savedCells[key] ?? '').trim()
  ).length;

  const handleSave = async (): Promise<boolean> => {
    if (!clubSlug) return false;
    try {
      setSaving(true);
      setError('');
      if (settingsChanges > 0) {
        applySettings(await PlayerPricingService.updateSettings(clubSlug, { pricingMode, onlineCheckoutEnabled }));
      }
      if (cellChanges > 0 && table) {
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
          return false;
        }
        applyTable(await PlayerPricingService.savePriceTable(clubSlug, prices));
      }
      return true;
    } catch (err) {
      reportUiError({ area: 'SettingsPerPlayerPricingSection', action: 'save' }, err);
      setError(extractErrorMessage(err, 'No se pudieron guardar los precios.'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setPricingMode(savedSettings.pricingMode);
    setOnlineCheckoutEnabled(savedSettings.onlineCheckoutEnabled);
    setCells(savedCells);
    setError('');
  };

  useSettingsSaveSlot('per-player-pricing', {
    changes: settingsChanges + cellChanges,
    save: handleSave,
    discard: handleDiscard,
  });

  if (!canManage) return null;

  return (
    <div className="space-y-4">
      {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}

      <SettingsSection
        title="Cómo se cobra el turno"
        description="Por cancha: un precio por turno, según la cancha. Por jugador: cada uno paga según la modalidad y si es socio."
      >
        <div className="flex flex-wrap gap-2">
          <button type="button" className={optionClass(pricingMode === 'PER_COURT')} disabled={loading || saving} onClick={() => setPricingMode('PER_COURT')}>
            Por cancha
          </button>
          <button type="button" className={optionClass(pricingMode === 'PER_PLAYER')} disabled={loading || saving} onClick={() => setPricingMode('PER_PLAYER')}>
            Por jugador
          </button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-[13px] text-p-text">
          <input
            type="checkbox"
            checked={!onlineCheckoutEnabled}
            disabled={loading || saving}
            onChange={(event) => setOnlineCheckoutEnabled(!event.target.checked)}
          />
          Cobrar solo en el mostrador (la app no ofrece pago online)
        </label>

      {pricingMode === 'PER_PLAYER' ? (
        <div className="mt-5 border-t border-p-border pt-5">
          <p className="text-[13px] font-semibold text-p-text">Precio por jugador</p>
          <p className="mb-3 mt-0.5 text-[12px] text-p-text-muted">Si una categoría no tiene precio, paga el de no socio. Las luces se reparten entre los jugadores.</p>
          {activeFormats.length === 0 ? (
            <p className="text-[13px] text-p-text-muted">Primero cargá las modalidades en Ajustes &gt; Horarios.</p>
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
        </div>
      ) : null}
      </SettingsSection>
    </div>
  );
}
