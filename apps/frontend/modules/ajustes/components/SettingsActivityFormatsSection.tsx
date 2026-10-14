import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import AdminEmptyState from '../../../components/admin/ui/AdminEmptyState';
import { AdminFeedbackBanner } from '../../../components/admin/ui/AdminFeedback';
import SettingsSection from './SettingsSection';
import { useAuth } from '../../../contexts/AuthContext';
import { ClubAdminService, type ClubActivityType } from '../../../services/ClubAdminService';
import { PlayerPricingService, type ActivityFormat } from '../../../services/PlayerPricingService';
import { showAdminToast } from '../../../utils/adminToast';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';
import { getActiveClubSlug, hasAdminAccess } from '../../../utils/session';

const inputClass =
  'h-9 w-full rounded-lg border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-text-secondary';
const primaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold !text-ink-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50';
const ghostButtonClass =
  'inline-flex h-8 items-center justify-center rounded-lg border border-p-border px-3 text-[12px] font-semibold text-p-text transition hover:bg-p-surface-2 disabled:cursor-not-allowed disabled:opacity-50';

// Ajustes > Actividades: modalidades de juego (ej. Tenis Single 2 jugadores / Dobles 4) para el precio por jugador.
export default function SettingsActivityFormatsSection() {
  const { user } = useAuth();
  const clubSlug = useMemo(() => getActiveClubSlug(user as any), [user]);
  const canManage = hasAdminAccess(user as any);

  const [activities, setActivities] = useState<ClubActivityType[]>([]);
  const [formats, setFormats] = useState<ActivityFormat[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<number, { name: string; playerCount: string }>>({});

  const load = useCallback(async () => {
    if (!clubSlug) return;
    setLoading(true);
    try {
      const [activityRows, formatRows] = await Promise.all([
        ClubAdminService.getActivityTypes(clubSlug),
        PlayerPricingService.listFormats(clubSlug)
      ]);
      setActivities(activityRows);
      setFormats(formatRows);
      setError('');
    } catch (err) {
      reportUiError({ area: 'SettingsActivityFormatsSection', action: 'load' }, err);
      setError(extractErrorMessage(err, 'No se pudieron cargar las modalidades.'));
    } finally {
      setLoading(false);
    }
  }, [clubSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (activityId: number) => {
    const draft = drafts[activityId];
    if (!clubSlug || !draft || saving) return;
    try {
      setSaving(true);
      setError('');
      await PlayerPricingService.createFormat(clubSlug, {
        activityTypeId: activityId,
        name: draft.name.trim(),
        playerCount: Number(draft.playerCount),
        sortOrder: formats.filter((format) => format.activityTypeId === activityId).length
      });
      setDrafts((prev) => ({ ...prev, [activityId]: { name: '', playerCount: '' } }));
      await load();
      showAdminToast('Modalidad creada.');
    } catch (err) {
      reportUiError({ area: 'SettingsActivityFormatsSection', action: 'createFormat' }, err);
      setError(extractErrorMessage(err, 'No se pudo crear la modalidad.'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (format: ActivityFormat) => {
    if (!clubSlug || saving) return;
    try {
      setSaving(true);
      setError('');
      await PlayerPricingService.updateFormat(clubSlug, format.id, { isActive: !format.isActive });
      await load();
      showAdminToast(format.isActive ? 'Modalidad desactivada.' : 'Modalidad activada.');
    } catch (err) {
      reportUiError({ area: 'SettingsActivityFormatsSection', action: 'toggleFormat' }, err);
      setError(extractErrorMessage(err, 'No se pudo actualizar la modalidad.'));
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return <AdminEmptyState title="Sin permiso" description="Solo owner y admin pueden configurar las modalidades." />;
  }

  return (
    <div className="space-y-4">
      {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}
      <AdminFeedbackBanner tone="info" compact>
        Las modalidades definen cuántos jugadores tiene un turno (ej. Single 2, Dobles 4). Se usan cuando el club cobra por jugador (Ajustes &gt; Precios).
      </AdminFeedbackBanner>

      {loading && activities.length === 0 ? <p className="text-[13px] text-p-text-muted">Cargando...</p> : null}

      {activities.map((activity) => {
        const activityFormats = formats.filter((format) => format.activityTypeId === activity.id);
        const draft = drafts[activity.id] || { name: '', playerCount: '' };
        return (
          <SettingsSection key={activity.id} title={activity.name} description="Modalidades de juego de esta actividad.">
            <div className="space-y-2">
              {activityFormats.length === 0 ? (
                <p className="text-[13px] text-p-text-muted">Sin modalidades.</p>
              ) : null}
              {activityFormats.map((format) => (
                <div key={format.id} className="flex items-center justify-between gap-2 rounded-lg border border-p-border px-3 py-2">
                  <p className="text-[13px] text-p-text">
                    <span className="font-semibold">{format.name}</span> · {format.playerCount} jugador{format.playerCount === 1 ? '' : 'es'}
                    {!format.isActive ? <span className="ml-2 text-[11px] text-p-text-muted">(desactivada)</span> : null}
                  </p>
                  <button type="button" className={ghostButtonClass} disabled={saving} onClick={() => void handleToggle(format)}>
                    {format.isActive ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              ))}
            </div>
            <form
              className="mt-3 grid gap-2 sm:grid-cols-[1fr_140px_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreate(activity.id);
              }}
            >
              <input
                className={inputClass}
                placeholder="Nombre (Single, Dobles...)"
                value={draft.name}
                onChange={(event) => setDrafts((prev) => ({ ...prev, [activity.id]: { ...draft, name: event.target.value } }))}
                required
                minLength={2}
              />
              <input
                className={inputClass}
                type="number"
                min={1}
                max={30}
                placeholder="Jugadores"
                value={draft.playerCount}
                onChange={(event) => setDrafts((prev) => ({ ...prev, [activity.id]: { ...draft, playerCount: event.target.value } }))}
                required
              />
              <button type="submit" className={primaryButtonClass} disabled={saving}>
                <Plus size={14} /> Agregar
              </button>
            </form>
          </SettingsSection>
        );
      })}
    </div>
  );
}
