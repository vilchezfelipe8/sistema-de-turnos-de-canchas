import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Plus } from 'lucide-react';
import AdminEmptyState from '../../../components/admin/ui/AdminEmptyState';
import { AdminFeedbackBanner } from '../../../components/admin/ui/AdminFeedback';
import SettingsSection from './SettingsSection';
import { useAuth } from '../../../contexts/AuthContext';
import { MemberAdminService, type MemberCategory } from '../../../services/MemberAdminService';
import { showAdminToast } from '../../../utils/adminToast';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';
import { getActiveClubSlug, hasAdminAccess } from '../../../utils/session';

const inputClass =
  'h-9 w-full rounded-lg border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-text-secondary';
const primaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold !text-ink-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50';
const ghostButtonClass =
  'inline-flex h-8 items-center justify-center rounded-lg border border-p-border px-3 text-[12px] font-semibold text-p-text transition hover:bg-p-surface-2 disabled:cursor-not-allowed disabled:opacity-50';

// Ajustes > Socios: habilita el módulo y administra las categorías de socio del club.
export default function SettingsClubMembersSection() {
  const { user } = useAuth();
  const clubSlug = useMemo(() => getActiveClubSlug(user as any), [user]);
  const canManage = hasAdminAccess(user as any);

  const [membersEnabled, setMembersEnabled] = useState(false);
  const [categories, setCategories] = useState<MemberCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [categoryDraft, setCategoryDraft] = useState({ code: '', name: '', description: '' });
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');

  const load = useCallback(async () => {
    if (!clubSlug) return;
    setLoading(true);
    try {
      const [settings, rows] = await Promise.all([
        MemberAdminService.getSettings(clubSlug),
        MemberAdminService.listCategories(clubSlug)
      ]);
      setMembersEnabled(settings.membersEnabled);
      setCategories(rows);
      setError('');
    } catch (err) {
      reportUiError({ area: 'SettingsClubMembersSection', action: 'load' }, err);
      setError(extractErrorMessage(err, 'No se pudo cargar la configuración de socios.'));
    } finally {
      setLoading(false);
    }
  }, [clubSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggleModule = async () => {
    if (!clubSlug || saving) return;
    try {
      setSaving(true);
      setError('');
      const result = await MemberAdminService.updateSettings(clubSlug, !membersEnabled);
      setMembersEnabled(result.membersEnabled);
      showAdminToast(result.membersEnabled ? 'Módulo de socios activado.' : 'Módulo de socios desactivado.');
    } catch (err) {
      reportUiError({ area: 'SettingsClubMembersSection', action: 'toggleModule' }, err);
      setError(extractErrorMessage(err, 'No se pudo actualizar el módulo de socios.'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!clubSlug || saving) return;
    try {
      setSaving(true);
      setError('');
      await MemberAdminService.createCategory(clubSlug, {
        code: categoryDraft.code.trim(),
        name: categoryDraft.name.trim(),
        description: categoryDraft.description.trim() || null,
        sortOrder: categories.length
      });
      setCategoryDraft({ code: '', name: '', description: '' });
      await load();
      showAdminToast('Categoría creada.');
    } catch (err) {
      reportUiError({ area: 'SettingsClubMembersSection', action: 'createCategory' }, err);
      setError(extractErrorMessage(err, 'No se pudo crear la categoría.'));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateCategory = async (category: MemberCategory, body: { name?: string; isActive?: boolean }) => {
    if (!clubSlug || saving) return;
    try {
      setSaving(true);
      setError('');
      await MemberAdminService.updateCategory(clubSlug, category.id, body);
      setEditingCategoryId(null);
      await load();
      showAdminToast('Categoría actualizada.');
    } catch (err) {
      reportUiError({ area: 'SettingsClubMembersSection', action: 'updateCategory' }, err);
      setError(extractErrorMessage(err, 'No se pudo actualizar la categoría.'));
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <AdminEmptyState
        title="Sin permiso para socios"
        description="Solo owner y admin pueden configurar el padrón de socios del club."
      />
    );
  }

  return (
    <div className="space-y-4">
      {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}

      <SettingsSection
        title="Módulo de socios"
        description="Habilita el padrón de socios, las categorías y el precio socio. Si está apagado, todos los jugadores pagan precio general."
        action={
          <button type="button" onClick={handleToggleModule} disabled={loading || saving} className={primaryButtonClass}>
            <BadgeCheck size={14} />
            {membersEnabled ? 'Desactivar' : 'Activar'}
          </button>
        }
      >
        <p className="text-[13px] text-p-text-secondary">
          {loading ? 'Cargando...' : membersEnabled ? 'El módulo está activo.' : 'El módulo está desactivado.'}
        </p>
      </SettingsSection>

      {membersEnabled ? (
        <SettingsSection
          title="Categorías de socio"
          description="Cada socio pertenece a una categoría (ej. Activo, Cadete, Vitalicio). Los precios por categoría se cargan en Precios."
        >
          <div className="space-y-2">
            {categories.length === 0 && !loading ? (
              <p className="text-[13px] text-p-text-muted">Todavía no hay categorías.</p>
            ) : null}
            {categories.map((category) => (
              <div
                key={category.id}
                className="flex flex-col gap-2 rounded-lg border border-p-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  {editingCategoryId === category.id ? (
                    <input
                      className={inputClass}
                      value={editingCategoryName}
                      onChange={(event) => setEditingCategoryName(event.target.value)}
                      autoFocus
                    />
                  ) : (
                    <p className="text-[13px] font-semibold text-p-text">
                      {category.name}
                      {!category.isActive ? <span className="ml-2 text-[11px] font-medium text-p-text-muted">(desactivada)</span> : null}
                    </p>
                  )}
                  <p className="text-[12px] text-p-text-muted">
                    {category.code} · {category.activeMembersCount} socio{category.activeMembersCount === 1 ? '' : 's'} activo{category.activeMembersCount === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {editingCategoryId === category.id ? (
                    <>
                      <button
                        type="button"
                        className={ghostButtonClass}
                        disabled={saving || editingCategoryName.trim().length < 2}
                        onClick={() => void handleUpdateCategory(category, { name: editingCategoryName.trim() })}
                      >
                        Guardar
                      </button>
                      <button type="button" className={ghostButtonClass} onClick={() => setEditingCategoryId(null)}>
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={ghostButtonClass}
                        onClick={() => {
                          setEditingCategoryId(category.id);
                          setEditingCategoryName(category.name);
                        }}
                      >
                        Renombrar
                      </button>
                      <button
                        type="button"
                        className={ghostButtonClass}
                        disabled={saving}
                        onClick={() => void handleUpdateCategory(category, { isActive: !category.isActive })}
                      >
                        {category.isActive ? 'Desactivar' : 'Activar'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={handleCreateCategory} className="mt-4 grid gap-2 sm:grid-cols-[140px_1fr_1fr_auto]">
            <input
              className={inputClass}
              placeholder="Código (ACTIVO)"
              value={categoryDraft.code}
              onChange={(event) => setCategoryDraft((prev) => ({ ...prev, code: event.target.value }))}
              required
            />
            <input
              className={inputClass}
              placeholder="Nombre (Socio activo)"
              value={categoryDraft.name}
              onChange={(event) => setCategoryDraft((prev) => ({ ...prev, name: event.target.value }))}
              required
              minLength={2}
            />
            <input
              className={inputClass}
              placeholder="Descripción (opcional)"
              value={categoryDraft.description}
              onChange={(event) => setCategoryDraft((prev) => ({ ...prev, description: event.target.value }))}
            />
            <button type="submit" disabled={saving} className={primaryButtonClass}>
              <Plus size={14} />
              Agregar
            </button>
          </form>
        </SettingsSection>
      ) : null}
    </div>
  );
}
