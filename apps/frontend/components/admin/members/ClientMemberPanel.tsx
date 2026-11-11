import { useCallback, useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import AdminModal from '../ui/AdminModal';
import { AdminFeedbackBanner } from '../ui/AdminFeedback';
import MemberBadge from './MemberBadge';
import MemberRenewModal from './MemberRenewModal';
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
  /** Para los textos de renovar cuota. */
  clientName?: string;
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
  MERGED: 'Fusión de clientes',
  VALID_UNTIL_SYNCED: 'Al día actualizado por plan'
};

/** "2026-11-05" → "5 nov" (con año si no es el actual). */
const formatMemberDate = (value: string | null | undefined): string => {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date
    .toLocaleDateString('es-AR', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
    .replace(/\./g, '');
};

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function ClientMemberPanel({ clubSlug, clientId, clientHasDni, clientName, canManage, onChanged }: ClientMemberPanelProps) {
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);

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

  // Socio en una frase: qué categoría y si está al día.
  const expired = Boolean(member?.validUntil && String(member.validUntil).slice(0, 10) < todayKey());
  const statusLine = !member
    ? null
    : member.status === 'INACTIVE'
      ? { tone: 'text-p-text-muted', text: `Dado de baja${member.leftAt ? ` el ${formatMemberDate(member.leftAt)}` : ''}${member.statusReason ? ` · ${member.statusReason}` : ''}` }
      : member.status === 'SUSPENDED'
        ? { tone: 'text-p-warning', text: `Suspendido${member.statusReason ? ` · ${member.statusReason}` : ''} · paga como no socio` }
        : expired
          ? { tone: 'text-p-warning', text: `Cuota vencida el ${formatMemberDate(member.validUntil)} · paga como no socio` }
          : { tone: 'text-p-positive', text: member.validUntil ? `Al día hasta el ${formatMemberDate(member.validUntil)}` : 'Al día' };
  const appLine = !account
    ? 'Sin cuenta en la app'
    : account.status === 'ACTIVE'
      ? 'Usa la app'
      : account.status === 'PENDING_ACTIVATION'
        ? 'Tiene la app sin activar'
        : 'Cuenta de la app deshabilitada';

  const menuItems: Array<{ key: string; label: string; onClick: () => void; disabled?: boolean; title?: string }> = [];
  if (canManage && member) {
    if (member.status !== 'ACTIVE') menuItems.push({ key: 'reactivate', label: 'Reactivar', onClick: () => setStatusTarget('ACTIVE') });
    if (member.status === 'ACTIVE') menuItems.push({ key: 'suspend', label: 'Suspender', onClick: () => setStatusTarget('SUSPENDED') });
    if (member.status !== 'INACTIVE') menuItems.push({ key: 'leave', label: 'Dar de baja', onClick: () => setStatusTarget('INACTIVE') });
    menuItems.push({ key: 'history', label: 'Ver historial', onClick: () => void handleLoadHistory() });
  }
  if (member && !account && canManage) {
    menuItems.push({
      key: 'provision',
      label: 'Crear cuenta de la app',
      disabled: !clientHasDni,
      title: clientHasDni ? undefined : 'Cargá el DNI del cliente para crearle la cuenta.',
      onClick: () =>
        void runAction(
          'provisionAppAccount',
          async () => {
            const result = await MemberAdminService.provisionAppAccount(clubSlug, clientId);
            if (result.status === 'CONFLICT') throw new Error(result.detail || 'La cuenta quedó en conflicto para revisar.');
            if (result.status === 'SKIPPED_NO_DNI') throw new Error('El cliente no tiene DNI cargado.');
          },
          'Cuenta de la app preparada.'
        ),
    });
  }
  if (member && account && account.status !== 'DISABLED') {
    menuItems.push({
      key: 'code',
      label: account.status === 'PENDING_ACTIVATION' ? 'Ver código de activación' : 'Ver código para nueva contraseña',
      onClick: () => void handleIssueCode('ADMIN_ISSUED'),
    });
    menuItems.push({ key: 'whatsapp', label: 'Mandar código por WhatsApp', onClick: () => void handleIssueCode('WHATSAPP') });
  }

  return (
    <div>
      <div className="space-y-2 text-[13px]">
        {error ? <AdminFeedbackBanner tone="error" compact>{error}</AdminFeedbackBanner> : null}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-p-text">Socio</p>
            {member ? (
              <>
                <p className="mt-0.5 text-[14px] text-p-text">
                  {member.categoryName}
                  {member.memberNumber ? <span className="text-p-text-muted"> · N° {member.memberNumber}</span> : null}
                </p>
                {statusLine ? <p className={`text-[13px] font-semibold ${statusLine.tone}`}>{statusLine.text}</p> : null}
                <p className="text-[12px] text-p-text-muted">
                  {member.joinedAt ? `Socio desde el ${formatMemberDate(member.joinedAt)} · ` : ''}
                  {appLine}
                </p>
              </>
            ) : (
              <p className="mt-0.5 text-[13px] text-p-text-secondary">No es socio.</p>
            )}
          </div>
          <div className="relative flex flex-none items-center gap-2">
            {canManage && !member ? (
              <button
                type="button"
                className="text-[13px] font-semibold text-p-accent hover:underline underline-offset-2 disabled:opacity-50"
                disabled={submitting || categories.length === 0}
                onClick={() => openForm('create')}
              >
                Hacerlo socio
              </button>
            ) : null}
            {canManage && member && member.status === 'ACTIVE' ? (
              <button
                type="button"
                className={expired
                  ? 'inline-flex h-8 items-center rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 hover:bg-ink-800 disabled:opacity-50'
                  : 'text-[13px] font-semibold text-p-accent hover:underline underline-offset-2 disabled:opacity-50'}
                disabled={submitting}
                onClick={() => setRenewOpen(true)}
              >
                Renovar cuota
              </button>
            ) : null}
            {canManage && member ? (
              <button
                type="button"
                className="text-[13px] font-semibold text-p-accent hover:underline underline-offset-2 disabled:opacity-50"
                disabled={submitting}
                onClick={() => openForm('edit')}
              >
                Editar
              </button>
            ) : null}
            {menuItems.length > 0 ? (
              <>
                <button
                  type="button"
                  aria-label="Más opciones de socio"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-p-border text-p-text-secondary hover:bg-p-surface-2"
                >
                  <MoreHorizontal size={16} />
                </button>
                {menuOpen ? (
                  <>
                    <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-30 cursor-default" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-10 z-40 w-60 rounded-xl border border-p-border bg-p-surface p-1 shadow-xl">
                      {menuItems.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          disabled={submitting || item.disabled}
                          title={item.title}
                          onClick={() => {
                            setMenuOpen(false);
                            item.onClick();
                          }}
                          className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-p-text hover:bg-p-surface-2 disabled:opacity-50"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {issuedCode ? (
          <AdminFeedbackBanner tone="info">
            Código para el socio: <strong className="text-[16px] tracking-[0.2em]">{issuedCode.code}</strong>. Vence a las{' '}
            {new Date(issuedCode.expiresAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}. Entregalo en mano: el socio
            lo usa en &quot;Activá tu cuenta&quot; con su DNI.
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

      {member ? (
        <MemberRenewModal
          open={renewOpen}
          clubSlug={clubSlug}
          clientId={clientId}
          clientName={clientName || 'el socio'}
          validUntil={member.validUntil}
          onClose={() => setRenewOpen(false)}
          onRenewed={() => {
            void load();
            onChanged?.();
          }}
        />
      ) : null}

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
