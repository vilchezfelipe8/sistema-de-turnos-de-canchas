import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import AdminModal from '../../../components/admin/ui/AdminModal';
import { AdminFeedbackBanner } from '../../../components/admin/ui/AdminFeedback';
import SettingsSection from './SettingsSection';
import { useAuth } from '../../../contexts/AuthContext';
import { ClubAdminService, type ClubActivityType } from '../../../services/ClubAdminService';
import { MemberAdminService, type MemberCategory } from '../../../services/MemberAdminService';
import {
  BILLING_TYPE_LABELS,
  SubscriptionAdminService,
  type SubscriptionBillingType,
  type SubscriptionEntitlementKind,
  type SubscriptionPlan,
  type SubscriptionPlanInput,
} from '../../../services/SubscriptionAdminService';
import { formatMoney } from '../../cuentas/accountUtils';
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

type OptionDraft = { id?: string | null; label: string; installmentsCount: string; installmentPrice: string };
type EntitlementDraft = {
  kind: SubscriptionEntitlementKind;
  activityTypeId: string;
  timesPerWeek: string;
  creditsPerPeriod: string;
  classType: '' | 'INDIVIDUAL' | 'GROUP';
};
type PlanDraft = {
  name: string;
  description: string;
  billingType: SubscriptionBillingType;
  periodMonths: string;
  enrollmentFee: string;
  dueDayOfMonth: string;
  graceDays: string;
  pauseMaxDays: string;
  pauseMaxCount: string;
  grantsMemberCategoryId: string;
  options: OptionDraft[];
  entitlements: EntitlementDraft[];
};

const emptyDraft = (): PlanDraft => ({
  name: '',
  description: '',
  billingType: 'RECURRING',
  periodMonths: '1',
  enrollmentFee: '',
  dueDayOfMonth: '',
  graceDays: '5',
  pauseMaxDays: '0',
  pauseMaxCount: '0',
  grantsMemberCategoryId: '',
  options: [{ label: 'Mensual', installmentsCount: '1', installmentPrice: '' }],
  entitlements: [],
});

const draftFromPlan = (plan: SubscriptionPlan): PlanDraft => ({
  name: plan.name,
  description: plan.description || '',
  billingType: plan.billingType,
  periodMonths: String(plan.periodMonths),
  enrollmentFee: plan.enrollmentFee ? String(plan.enrollmentFee) : '',
  dueDayOfMonth: plan.dueDayOfMonth ? String(plan.dueDayOfMonth) : '',
  graceDays: String(plan.graceDays),
  pauseMaxDays: String(plan.pauseMaxDays),
  pauseMaxCount: String(plan.pauseMaxCount),
  grantsMemberCategoryId: plan.grantsMemberCategory?.id || '',
  options: plan.options
    .filter((option) => option.isActive)
    .map((option) => ({
      id: option.id,
      label: option.label,
      installmentsCount: String(option.installmentsCount),
      installmentPrice: String(option.installmentPrice),
    })),
  entitlements: plan.entitlements.map((row) => ({
    kind: row.kind,
    activityTypeId: String(row.activityType.id),
    timesPerWeek: row.timesPerWeek ? String(row.timesPerWeek) : '',
    creditsPerPeriod: row.creditsPerPeriod ? String(row.creditsPerPeriod) : '',
    classType: row.classType || '',
  })),
});

const toNumberOrNull = (value: string) => (value.trim() === '' ? null : Number(value));

const draftToInput = (draft: PlanDraft): SubscriptionPlanInput => ({
  name: draft.name.trim(),
  description: draft.description.trim() || null,
  billingType: draft.billingType,
  periodMonths: Number(draft.periodMonths),
  enrollmentFee: toNumberOrNull(draft.enrollmentFee),
  dueDayOfMonth: toNumberOrNull(draft.dueDayOfMonth),
  graceDays: Number(draft.graceDays || 0),
  pauseMaxDays: Number(draft.pauseMaxDays || 0),
  pauseMaxCount: Number(draft.pauseMaxCount || 0),
  grantsMemberCategoryId: draft.grantsMemberCategoryId || null,
  options: draft.options.map((option) => ({
    id: option.id || null,
    label: option.label.trim(),
    installmentsCount: draft.billingType === 'RECURRING' ? 1 : Number(option.installmentsCount),
    installmentPrice: Number(option.installmentPrice),
  })),
  entitlements: draft.entitlements
    .filter((row) => row.activityTypeId)
    .map((row) => ({
      kind: row.kind,
      activityTypeId: Number(row.activityTypeId),
      timesPerWeek: row.kind === 'ACTIVITY_ACCESS' ? toNumberOrNull(row.timesPerWeek) : null,
      creditsPerPeriod: row.kind === 'CLASS_CREDITS' ? toNumberOrNull(row.creditsPerPeriod) : null,
      classType: row.kind === 'CLASS_CREDITS' && row.classType ? row.classType : null,
    })),
});

const periodLabel = (months: number) => (months === 1 ? '1 mes' : `${months} meses`);

const entitlementSummary = (plan: SubscriptionPlan) =>
  plan.entitlements
    .map((row) =>
      row.kind === 'ACTIVITY_ACCESS'
        ? `${row.activityType.name}${row.timesPerWeek ? ` ${row.timesPerWeek}x semana` : ' libre'}`
        : `${row.creditsPerPeriod} clases de ${row.activityType.name}`
    )
    .join(' · ');

// Ajustes > Planes: abonos del club (gimnasio, cuota social, clases mensuales).
export default function SettingsSubscriptionPlansSection() {
  const { user } = useAuth();
  const clubSlug = useMemo(() => getActiveClubSlug(user as any), [user]);
  const canManage = hasAdminAccess(user as any);

  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [activities, setActivities] = useState<ClubActivityType[]>([]);
  const [categories, setCategories] = useState<MemberCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<{ planId: string | null; draft: PlanDraft } | null>(null);

  const load = useCallback(async () => {
    if (!clubSlug) return;
    setLoading(true);
    try {
      const [planRows, activityRows, categoryRows] = await Promise.all([
        SubscriptionAdminService.listPlans(clubSlug, true),
        ClubAdminService.getActivityTypes(clubSlug).catch(() => [] as ClubActivityType[]),
        MemberAdminService.listCategories(clubSlug).catch(() => [] as MemberCategory[]),
      ]);
      setPlans(planRows);
      setActivities(activityRows);
      setCategories(categoryRows.filter((category) => category.isActive));
      setError('');
    } catch (err) {
      reportUiError({ area: 'SettingsSubscriptionPlansSection', action: 'load' }, err);
      setError(extractErrorMessage(err, 'No se pudieron cargar los planes.'));
    } finally {
      setLoading(false);
    }
  }, [clubSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateDraft = (patch: Partial<PlanDraft>) =>
    setEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev));
  const updateOption = (index: number, patch: Partial<OptionDraft>) =>
    setEditing((prev) =>
      prev
        ? { ...prev, draft: { ...prev.draft, options: prev.draft.options.map((row, i) => (i === index ? { ...row, ...patch } : row)) } }
        : prev
    );
  const updateEntitlement = (index: number, patch: Partial<EntitlementDraft>) =>
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            draft: { ...prev.draft, entitlements: prev.draft.entitlements.map((row, i) => (i === index ? { ...row, ...patch } : row)) },
          }
        : prev
    );

  const handleSave = async () => {
    if (!editing || !clubSlug) return;
    try {
      setSaving(true);
      setFormError('');
      const input = draftToInput(editing.draft);
      if (editing.planId) {
        await SubscriptionAdminService.updatePlan(clubSlug, editing.planId, input);
        showAdminToast('Plan guardado.');
      } else {
        await SubscriptionAdminService.createPlan(clubSlug, input);
        showAdminToast('Plan creado.');
      }
      setEditing(null);
      await load();
    } catch (err) {
      reportUiError({ area: 'SettingsSubscriptionPlansSection', action: 'save' }, err);
      setFormError(extractErrorMessage(err, 'No se pudo guardar el plan.'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (plan: SubscriptionPlan) => {
    if (!clubSlug) return;
    try {
      setSaving(true);
      await SubscriptionAdminService.setPlanActive(clubSlug, plan.id, !plan.isActive);
      showAdminToast(plan.isActive ? 'Plan desactivado.' : 'Plan activado.');
      await load();
    } catch (err) {
      reportUiError({ area: 'SettingsSubscriptionPlansSection', action: 'toggleActive' }, err);
      setError(extractErrorMessage(err, 'No se pudo cambiar el estado del plan.'));
    } finally {
      setSaving(false);
    }
  };

  const draft = editing?.draft;
  const isFixedTerm = draft?.billingType === 'FIXED_TERM';

  return (
    <SettingsSection
      title="Planes"
      description="Abonos que vende el club: gimnasio, cuota social o clases mensuales. Cada cuota queda en la cuenta del cliente y se cobra como cualquier otra, con el precio efectivo si corresponde."
      action={
        canManage ? (
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => {
              setFormError('');
              setEditing({ planId: null, draft: emptyDraft() });
            }}
          >
            <Plus size={14} /> Nuevo plan
          </button>
        ) : null
      }
    >
      {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}
      {loading && !plans.length ? <p className="text-[13px] text-p-text-muted">Cargando planes...</p> : null}
      {!loading && !plans.length ? (
        <p className="text-[13px] text-p-text-muted">Todavía no hay planes. Creá el primero, por ejemplo &quot;Musculación mensual&quot;.</p>
      ) : null}

      <ul className="space-y-2">
        {plans.map((plan) => (
          <li key={plan.id} className={`rounded-xl border border-p-border p-3 ${plan.isActive ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-p-text">
                  {plan.name}
                  {!plan.isActive ? <span className="ml-2 text-[11px] font-semibold text-p-text-muted">Desactivado</span> : null}
                </p>
                <p className="text-[12px] text-p-text-muted">
                  {BILLING_TYPE_LABELS[plan.billingType]} · {periodLabel(plan.periodMonths)}
                  {plan.grantsMemberCategory ? ` · Da categoría: ${plan.grantsMemberCategory.name}` : ''}
                  {plan.subscriptionsCount
                    ? ` · ${plan.subscriptionsCount} ${plan.subscriptionsCount === 1 ? 'vendido' : 'vendidos'}`
                    : ''}
                </p>
                {plan.entitlements.length ? <p className="text-[12px] text-p-text-secondary">{entitlementSummary(plan)}</p> : null}
                <p className="mt-1 text-[12px] text-p-text">
                  {plan.options
                    .filter((option) => option.isActive)
                    .map((option) =>
                      option.installmentsCount > 1
                        ? `${option.label}: ${option.installmentsCount} × ${formatMoney(option.installmentPrice)}`
                        : `${option.label}: ${formatMoney(option.installmentPrice)}`
                    )
                    .join(' · ')}
                </p>
              </div>
              {canManage ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={ghostButtonClass}
                    onClick={() => {
                      setFormError('');
                      setEditing({ planId: plan.id, draft: draftFromPlan(plan) });
                    }}
                  >
                    Editar
                  </button>
                  <button type="button" className={ghostButtonClass} disabled={saving} onClick={() => void handleToggleActive(plan)}>
                    {plan.isActive ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <AdminModal
        open={editing !== null}
        title={editing?.planId ? 'Editar plan' : 'Nuevo plan'}
        description="Los precios son de lista. El descuento en efectivo se configura en Precios y se aplica al cobrar."
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
            {formError ? <AdminFeedbackBanner tone="error" compact>{formError}</AdminFeedbackBanner> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={`${labelClass} sm:col-span-2`}>
                Nombre
                <input className={inputClass} value={draft.name} placeholder="Full Pass Trimestral" onChange={(e) => updateDraft({ name: e.target.value })} />
              </label>
              <label className={labelClass}>
                Tipo
                <select
                  className={inputClass}
                  value={draft.billingType}
                  onChange={(e) => {
                    const billingType = e.target.value as SubscriptionBillingType;
                    updateDraft({
                      billingType,
                      options: billingType === 'RECURRING' ? draft.options.map((row) => ({ ...row, installmentsCount: '1' })) : draft.options,
                    });
                  }}
                >
                  <option value="RECURRING">Se renueva solo (mensual, cuota social)</option>
                  <option value="FIXED_TERM">Plazo fijo (trimestral, semestral)</option>
                </select>
              </label>
              <label className={labelClass}>
                Duración (meses)
                <input type="number" min={1} max={24} className={inputClass} value={draft.periodMonths} onChange={(e) => updateDraft({ periodMonths: e.target.value })} />
              </label>
              <label className={labelClass}>
                Matrícula (opcional)
                <input type="number" min={0} className={inputClass} value={draft.enrollmentFee} onChange={(e) => updateDraft({ enrollmentFee: e.target.value })} />
              </label>
              <label className={labelClass}>
                Día fijo de vencimiento (opcional)
                <input
                  type="number"
                  min={1}
                  max={28}
                  className={inputClass}
                  value={draft.dueDayOfMonth}
                  placeholder="Vacío = según la fecha de alta"
                  onChange={(e) => updateDraft({ dueDayOfMonth: e.target.value })}
                />
              </label>
              <label className={labelClass}>
                Días de gracia
                <input type="number" min={0} max={60} className={inputClass} value={draft.graceDays} onChange={(e) => updateDraft({ graceDays: e.target.value })} />
              </label>
              <label className={labelClass}>
                Hace socio de la categoría
                <select className={inputClass} value={draft.grantsMemberCategoryId} onChange={(e) => updateDraft({ grantsMemberCategoryId: e.target.value })}>
                  <option value="">No cambia la condición de socio</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Pausa máxima (días)
                <input type="number" min={0} max={180} className={inputClass} value={draft.pauseMaxDays} onChange={(e) => updateDraft({ pauseMaxDays: e.target.value })} />
              </label>
              <label className={labelClass}>
                Pausas permitidas por plazo
                <input type="number" min={0} max={12} className={inputClass} value={draft.pauseMaxCount} onChange={(e) => updateDraft({ pauseMaxCount: e.target.value })} />
              </label>
            </div>

            <div className="space-y-2">
              <p className="text-[12px] font-semibold text-p-text-secondary">Formas de pago</p>
              {draft.options.map((option, index) => (
                <div key={option.id || `new-${index}`} className="flex items-end gap-2">
                  <label className={`${labelClass} flex-1`}>
                    Nombre
                    <input className={inputClass} value={option.label} placeholder="1 pago" onChange={(e) => updateOption(index, { label: e.target.value })} />
                  </label>
                  {isFixedTerm ? (
                    <label className={`${labelClass} w-24`}>
                      Cuotas
                      <input
                        type="number"
                        min={1}
                        className={inputClass}
                        value={option.installmentsCount}
                        onChange={(e) => updateOption(index, { installmentsCount: e.target.value })}
                      />
                    </label>
                  ) : null}
                  <label className={`${labelClass} w-36`}>
                    {isFixedTerm ? 'Precio de cada cuota' : 'Precio'}
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={option.installmentPrice}
                      onChange={(e) => updateOption(index, { installmentPrice: e.target.value })}
                    />
                  </label>
                  {draft.options.length > 1 ? (
                    <button
                      type="button"
                      className={iconButtonClass}
                      aria-label="Quitar forma de pago"
                      onClick={() => updateDraft({ options: draft.options.filter((_, i) => i !== index) })}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              ))}
              {isFixedTerm ? (
                <button
                  type="button"
                  className={ghostButtonClass}
                  onClick={() => updateDraft({ options: [...draft.options, { label: '', installmentsCount: '1', installmentPrice: '' }] })}
                >
                  <Plus size={13} /> Otra forma de pago
                </button>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-[12px] font-semibold text-p-text-secondary">Qué incluye</p>
              {draft.entitlements.map((row, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2">
                  <label className={`${labelClass} w-40`}>
                    Tipo
                    <select
                      className={inputClass}
                      value={row.kind}
                      onChange={(e) => updateEntitlement(index, { kind: e.target.value as SubscriptionEntitlementKind })}
                    >
                      <option value="ACTIVITY_ACCESS">Acceso</option>
                      <option value="CLASS_CREDITS">Clases por período</option>
                    </select>
                  </label>
                  <label className={`${labelClass} min-w-[140px] flex-1`}>
                    Actividad
                    <select className={inputClass} value={row.activityTypeId} onChange={(e) => updateEntitlement(index, { activityTypeId: e.target.value })}>
                      <option value="">Elegí una actividad</option>
                      {activities.map((activity) => (
                        <option key={activity.id} value={activity.id}>
                          {activity.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {row.kind === 'ACTIVITY_ACCESS' ? (
                    <label className={`${labelClass} w-32`}>
                      Veces x semana
                      <input
                        type="number"
                        min={1}
                        className={inputClass}
                        value={row.timesPerWeek}
                        placeholder="Libre"
                        onChange={(e) => updateEntitlement(index, { timesPerWeek: e.target.value })}
                      />
                    </label>
                  ) : (
                    <>
                      <label className={`${labelClass} w-24`}>
                        Clases
                        <input
                          type="number"
                          min={1}
                          className={inputClass}
                          value={row.creditsPerPeriod}
                          onChange={(e) => updateEntitlement(index, { creditsPerPeriod: e.target.value })}
                        />
                      </label>
                      <label className={`${labelClass} w-32`}>
                        Modalidad
                        <select
                          className={inputClass}
                          value={row.classType}
                          onChange={(e) => updateEntitlement(index, { classType: e.target.value as EntitlementDraft['classType'] })}
                        >
                          <option value="">Cualquiera</option>
                          <option value="GROUP">Grupal</option>
                          <option value="INDIVIDUAL">Individual</option>
                        </select>
                      </label>
                    </>
                  )}
                  <button
                    type="button"
                    className={iconButtonClass}
                    aria-label="Quitar beneficio"
                    onClick={() => updateDraft({ entitlements: draft.entitlements.filter((_, i) => i !== index) })}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={ghostButtonClass}
                disabled={!activities.length}
                title={activities.length ? undefined : 'Primero cargá actividades en Ajustes → Actividades.'}
                onClick={() =>
                  updateDraft({
                    entitlements: [
                      ...draft.entitlements,
                      { kind: 'ACTIVITY_ACCESS', activityTypeId: '', timesPerWeek: '', creditsPerPeriod: '', classType: '' },
                    ],
                  })
                }
              >
                <Plus size={13} /> Agregar actividad
              </button>
            </div>

            <label className={labelClass}>
              Descripción (opcional)
              <input className={inputClass} value={draft.description} onChange={(e) => updateDraft({ description: e.target.value })} />
            </label>
          </div>
        ) : null}
      </AdminModal>
    </SettingsSection>
  );
}
