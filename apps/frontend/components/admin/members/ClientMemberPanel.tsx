import { useCallback, useEffect, useState } from 'react';
import { History, KeyRound, Smartphone } from 'lucide-react';
import AdminModal from '../ui/AdminModal';
import { AdminFeedbackBanner } from '../ui/AdminFeedback';
import MemberBadge from './MemberBadge';
import {
  MEMBER_STATUS_LABELS,
  MemberAdminService,
  type ClientMemberDetail,
  type ClubMemberStatus,
  type MemberCategory,
  type MemberHistoryEntry
} from '../../../services/MemberAdminService';
import { showAdminToast } from '../../../utils/adminToast';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';

type ClientMemberPanelProps = {
  clubSlug: string;
  clientId: string;
  clientHasDni: boolean;
  // Solo ADMIN/OWNER modifican el padrón (RN-09). STAFF solo puede generar códigos (RN-10).
  canManage: boolean;
  // Avisa al listado para refrescar el badge.
  onChanged?: () => void;
};

type MemberForm = {
  categoryId: string;
  memberNumber: string;
  joinedAt: string;
  validUntil: string;
  notes: string;
};

const emptyForm: MemberForm = { categoryId: '', memberNumber: '', joinedAt: '', validUntil: '', notes: '' };

const inputClass =
  'h-9 w-full rounded-lg border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-text-secondary';
const buttonClass =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass =
  'inline-flex h-9 items-center justify-center rounded-lg bg-ink-900 px-4 text-[12px] font-semibold !text-ink-50 hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50';

const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activa',
  PENDING_ACTIVATION: 'Pendiente de activar',
  DISABLED: 'Deshabilitada'
};

const HISTORY_ACTION_LABELS: Record<string, string> = {
  CREATED: 'Alta en el padrón',
  STATUS_CHANGED: 'Cambio de estado',
  CATEGORY_CHANGED: 'Cambio de categoría',
  UPDATED: 'Datos actualizados',
  MERGED: 'Fusión de clientes'
};

export default function ClientMemberPanel({ clubSlug, clientId, clientHasDni, canManage, onChanged }: ClientMemberPanelProps) {
  const [detail, setDetail] = useState<ClientMemberDetail | null>(null);
  const [categories, setCategories] = useState<MemberCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [form, setForm] = useState<MemberForm>(emptyForm);
  const [statusTarget, setStatusTarget] = useState<ClubMemberStatus | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [history, setHistory] = useState<MemberHistoryEntry[] | null>(null);
  const [issuedCode, setIssuedCode] = useState<{ code: string; expiresAt: string } | null>(null);

  const load = useCallback(async () => {
    if (!clubSlug || !clientId) return;
    setLoading(true);
    try {
      const [memberDetail, categoryRows] = await Promise.all([
        MemberAdminService.getClientMember(clubSlug, clientId),
        MemberAdminService.listCategories(clubSlug)
      ]);
      setDetail(memberDetail);
      setCategories(categoryRows.filter((category) => category.isActive));
      setError('');
    } catch (err) {
      reportUiError({ area: 'ClientMemberPanel', action: 'load' }, err);
      setError(extractErrorMessage(err, 'No se pudo cargar la condición de socio.'));
    } finally {
      setLoading(false);
    }
  }, [clientId, clubSlug]);

  useEffect(() => {
    setHistory(null);
    setIssuedCode(null);
    setFormMode(null);
    void load();
  }, [load]);

  const member = detail?.member ?? null;

  const runAction = async (action: string, fn: () => Promise<unknown>, successMessage: string) => {
    try {
      setSubmitting(true);
      setError('');
      await fn();
      showAdminToast(successMessage);
      await load();
      onChanged?.();
      return true;
    } catch (err) {
      reportUiError({ area: 'ClientMemberPanel', action }, err);
      setError(extractErrorMessage(err, 'No se pudo completar la acción.'));
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const openForm = (mode: 'create' | 'edit') => {
    setForm(
      mode === 'edit' && member
        ? {
            categoryId: member.categoryId,
            memberNumber: member.memberNumber || '',
            joinedAt: member.joinedAt || '',
            validUntil: member.validUntil || '',
            notes: member.notes || ''
          }
        : { ...emptyForm, categoryId: categories[0]?.id || '' }
    );
    setFormMode(mode);
  };

  const handleSubmitForm = async () => {
    const body = {
      categoryId: form.categoryId,
      memberNumber: form.memberNumber.trim() || null,
      joinedAt: form.joinedAt || null,
      validUntil: form.validUntil || null,
      notes: form.notes.trim() || null
    };
    const ok = await runAction(
      formMode === 'create' ? 'createMember' : 'updateMember',
      async () => {
        const result = formMode === 'create'
          ? await MemberAdminService.createMember(clubSlug, clientId, body)
          : await MemberAdminService.updateMember(clubSlug, clientId, body);
        if (result.account?.status === 'CONFLICT') {
          showAdminToast('Socio dado de alta. La cuenta de la app quedó para revisar.');
        }
      },
      formMode === 'create' ? 'Socio dado de alta.' : 'Socio actualizado.'
    );
    if (ok) setFormMode(null);
  };

  const handleChangeStatus = async () => {
    if (!statusTarget) return;
    const ok = await runAction(
      'changeMemberStatus',
      () => MemberAdminService.changeStatus(clubSlug, clientId, statusTarget, statusReason.trim()),
      statusTarget === 'ACTIVE' ? 'Socio reactivado.' : statusTarget === 'SUSPENDED' ? 'Socio suspendido.' : 'Socio dado de baja.'
    );
    if (ok) {
      setStatusTarget(null);
      setStatusReason('');
    }
  };

  const handleLoadHistory = async () => {
    try {
      setHistory(await MemberAdminService.getHistory(clubSlug, clientId));
    } catch (err) {
      reportUiError({ area: 'ClientMemberPanel', action: 'loadHistory' }, err);
      setError(extractErrorMessage(err, 'No se pudo cargar el historial.'));
    }
  };

  const handleIssueCode = async (channel: 'ADMIN_ISSUED' | 'WHATSAPP') => {
    try {
      setSubmitting(true);
      setError('');
      const result = await MemberAdminService.issueActivationCode(clubSlug, clientId, channel);
      if (channel === 'ADMIN_ISSUED' && result.code) {
        setIssuedCode({ code: result.code, expiresAt: result.expiresAt });
      } else {
        showAdminToast('Código enviado por WhatsApp.');
      }
    } catch (err) {
      reportUiError({ area: 'ClientMemberPanel', action: 'issueActivationCode' }, err);
      setError(extractErrorMessage(err, 'No se pudo generar el código.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !detail) {
    return <p className="text-[12px] text-p-text-muted">Cargando condición de socio...</p>;
  }
  if (!detail?.membersEnabled) return null;

  const account = detail.appAccount;

  return (
    <div>
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-p-text-muted">Socio</h3>
      <div className="space-y-3 rounded-xl border border-p-border p-3 text-[13px]">
        {error ? <AdminFeedbackBanner tone="error" compact>{error}</AdminFeedbackBanner> : null}

        <div className="flex flex-wrap items-center gap-2">
          <MemberBadge member={member} showNonMember />
          {member ? (
            <span className="text-[12px] text-p-text-muted">
              Estado: {MEMBER_STATUS_LABELS[member.status]}
              {member.statusReason ? ` (${member.statusReason})` : ''}
            </span>
          ) : null}
        </div>

        {member ? (
          <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1 text-[12px]">
            <dt className="text-p-text-muted">Categoría</dt>
            <dd className="text-p-text">{member.categoryName}</dd>
            <dt className="text-p-text-muted">N° de socio</dt>
            <dd className="text-p-text">{member.memberNumber || '—'}</dd>
            <dt className="text-p-text-muted">Alta</dt>
            <dd className="text-p-text">{member.joinedAt || '—'}</dd>
            <dt className="text-p-text-muted">Al día hasta</dt>
            <dd className="text-p-text">{member.validUntil || 'Sin vencimiento'}</dd>
            {member.leftAt ? (
              <>
                <dt className="text-p-text-muted">Baja</dt>
                <dd className="text-p-text">{member.leftAt}</dd>
              </>
            ) : null}
            <dt className="text-p-text-muted">Cuenta de la app</dt>
            <dd className="text-p-text">{account ? ACCOUNT_STATUS_LABELS[account.status] || account.status : 'Sin cuenta'}</dd>
          </dl>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canManage && !member ? (
            <button type="button" className={buttonClass} disabled={submitting || categories.length === 0} onClick={() => openForm('create')}>
              Dar de alta como socio
            </button>
          ) : null}
          {canManage && member ? (
            <>
              <button type="button" className={buttonClass} disabled={submitting} onClick={() => openForm('edit')}>
                Editar
              </button>
              {member.status !== 'ACTIVE' ? (
                <button type="button" className={buttonClass} disabled={submitting} onClick={() => setStatusTarget('ACTIVE')}>
                  Reactivar
                </button>
              ) : null}
              {member.status === 'ACTIVE' ? (
                <button type="button" className={buttonClass} disabled={submitting} onClick={() => setStatusTarget('SUSPENDED')}>
                  Suspender
                </button>
              ) : null}
              {member.status !== 'INACTIVE' ? (
                <button type="button" className={buttonClass} disabled={submitting} onClick={() => setStatusTarget('INACTIVE')}>
                  Dar de baja
                </button>
              ) : null}
              <button type="button" className={buttonClass} onClick={() => void handleLoadHistory()}>
                <History size={13} /> Historial
              </button>
            </>
          ) : null}
          {member && !account && canManage ? (
            <button
              type="button"
              className={buttonClass}
              disabled={submitting || !clientHasDni}
              title={clientHasDni ? undefined : 'Cargá el DNI del cliente para crearle la cuenta.'}
              onClick={() =>
                void runAction(
                  'provisionAppAccount',
                  async () => {
                    const result = await MemberAdminService.provisionAppAccount(clubSlug, clientId);
                    if (result.status === 'CONFLICT') throw new Error(result.detail || 'La cuenta quedó en conflicto para revisar.');
                    if (result.status === 'SKIPPED_NO_DNI') throw new Error('El cliente no tiene DNI cargado.');
                  },
                  'Cuenta de la app preparada.'
                )
              }
            >
              <Smartphone size={13} /> Crear cuenta de la app
            </button>
          ) : null}
          {member && account && account.status !== 'DISABLED' ? (
            <>
              <button type="button" className={buttonClass} disabled={submitting} onClick={() => void handleIssueCode('ADMIN_ISSUED')}>
                <KeyRound size={13} /> {account.status === 'PENDING_ACTIVATION' ? 'Código de activación' : 'Código para nueva contraseña'}
              </button>
              <button type="button" className={buttonClass} disabled={submitting} onClick={() => void handleIssueCode('WHATSAPP')}>
                Enviar por WhatsApp
              </button>
            </>
          ) : null}
        </div>

        {issuedCode ? (
          <AdminFeedbackBanner tone="info">
            Código para el socio: <strong className="text-[16px] tracking-[0.2em]">{issuedCode.code}</strong>. Vence a las{' '}
            {new Date(issuedCode.expiresAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}. Entregalo en mano: el socio
            lo usa en "Activá tu cuenta" con su DNI.
          </AdminFeedbackBanner>
        ) : null}

        {history ? (
          <ul className="space-y-1.5 border-t border-p-border pt-2 text-[12px]">
            {history.length === 0 ? <li className="text-p-text-muted">Sin movimientos.</li> : null}
            {history.map((entry) => (
              <li key={entry.id} className="text-p-text-secondary">
                <span className="font-semibold text-p-text">{HISTORY_ACTION_LABELS[entry.action] || entry.action}</span>
                {entry.fromStatus && entry.toStatus ? ` · ${MEMBER_STATUS_LABELS[entry.fromStatus]} → ${MEMBER_STATUS_LABELS[entry.toStatus]}` : ''}
                {entry.fromCategoryName && entry.toCategoryName ? ` · ${entry.fromCategoryName} → ${entry.toCategoryName}` : ''}
                {entry.reason ? ` · ${entry.reason}` : ''}
                <span className="text-p-text-muted">
                  {' '}— {new Date(entry.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                  {entry.changedBy ? ` · ${entry.changedBy}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <AdminModal
        open={formMode !== null}
        title={formMode === 'create' ? 'Dar de alta como socio' : 'Editar socio'}
        description={formMode === 'create' && !clientHasDni ? 'El cliente no tiene DNI: se lo da de alta, pero sin cuenta de la app hasta cargar el DNI.' : undefined}
        onClose={() => setFormMode(null)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass} onClick={() => setFormMode(null)}>
              Cancelar
            </button>
            <button type="button" className={primaryButtonClass} disabled={submitting || !form.categoryId} onClick={() => void handleSubmitForm()}>
              {submitting ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-[12px] font-semibold text-p-text-secondary sm:col-span-2">
            Categoría
            <select className={inputClass} value={form.categoryId} onChange={(event) => setForm((prev) => ({ ...prev, categoryId: event.target.value }))}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[12px] font-semibold text-p-text-secondary">
            N° de socio
            <input className={inputClass} value={form.memberNumber} onChange={(event) => setForm((prev) => ({ ...prev, memberNumber: event.target.value }))} />
          </label>
          <label className="space-y-1 text-[12px] font-semibold text-p-text-secondary">
            Fecha de alta
            <input type="date" className={inputClass} value={form.joinedAt} onChange={(event) => setForm((prev) => ({ ...prev, joinedAt: event.target.value }))} />
          </label>
          <label className="space-y-1 text-[12px] font-semibold text-p-text-secondary">
            Al día hasta (opcional)
            <input type="date" className={inputClass} value={form.validUntil} onChange={(event) => setForm((prev) => ({ ...prev, validUntil: event.target.value }))} />
          </label>
          <label className="space-y-1 text-[12px] font-semibold text-p-text-secondary sm:col-span-2">
            Notas
            <input className={inputClass} value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
          </label>
        </div>
      </AdminModal>

      <AdminModal
        open={statusTarget !== null}
        title={statusTarget === 'ACTIVE' ? 'Reactivar socio' : statusTarget === 'SUSPENDED' ? 'Suspender socio' : 'Dar de baja al socio'}
        description={
          statusTarget === 'ACTIVE'
            ? 'Vuelve a tener precio socio en las reservas nuevas.'
            : 'Las reservas ya hechas mantienen su precio. Las nuevas se cobran como no socio.'
        }
        onClose={() => setStatusTarget(null)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass} onClick={() => setStatusTarget(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={submitting || (statusTarget !== 'ACTIVE' && statusReason.trim().length < 3)}
              onClick={() => void handleChangeStatus()}
            >
              Confirmar
            </button>
          </div>
        }
      >
        {statusTarget !== 'ACTIVE' ? (
          <label className="space-y-1 text-[12px] font-semibold text-p-text-secondary">
            Motivo (obligatorio)
            <input className={inputClass} value={statusReason} onChange={(event) => setStatusReason(event.target.value)} placeholder="Ej: cuota atrasada" />
          </label>
        ) : (
          <p className="text-[13px] text-p-text-secondary">¿Confirmás la reactivación?</p>
        )}
      </AdminModal>
    </div>
  );
}
