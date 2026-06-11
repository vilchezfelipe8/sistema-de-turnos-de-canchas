import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import AdminAppModal from '../../../components/admin/ui/AdminAppModal';
import AdminDataTable from '../../../components/admin/ui/AdminDataTable';
import AdminEmptyState from '../../../components/admin/ui/AdminEmptyState';
import AdminPanel from '../../../components/admin/ui/AdminPanel';
import { AdminFeedbackBanner, AdminInlineError } from '../../../components/admin/ui/AdminFeedback';
import { useAuth } from '../../../contexts/AuthContext';
import { ClubAdminService, type ClubMember, type ClubMembershipRole } from '../../../services/ClubAdminService';
import { showAdminToast } from '../../../utils/adminToast';
import { getApiFieldErrors } from '../../../utils/apiError';
import { getActiveClubSlug, getActiveMembershipRole, hasAdminAccess } from '../../../utils/session';
import { extractErrorMessage } from '../../../utils/uiError';

const OWNER_ROLE_OPTIONS: ClubMembershipRole[] = ['ADMIN', 'STAFF'];
const ADMIN_ROLE_OPTIONS: ClubMembershipRole[] = ['STAFF'];

const formatRole = (role: string) => {
  if (role === 'OWNER') return 'Owner';
  if (role === 'ADMIN') return 'Admin';
  if (role === 'STAFF') return 'Staff';
  return role;
};

const fullName = (member: ClubMember) => {
  const first = String(member.user?.firstName || '').trim();
  const last = String(member.user?.lastName || '').trim();
  const joined = `${first} ${last}`.trim();
  return joined || member.user?.email || `Usuario #${member.userId}`;
};

export default function SettingsMembersSection() {
  const { user } = useAuth();
  const clubSlug = useMemo(() => getActiveClubSlug(user as any), [user]);
  const actorRole = useMemo(() => getActiveMembershipRole(user as any), [user]);
  const isAdminManager = hasAdminAccess(user as any);
  const canAssignAdmin = actorRole === 'OWNER';
  const inviteRoleOptions = canAssignAdmin ? OWNER_ROLE_OPTIONS : ADMIN_ROLE_OPTIONS;
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<ClubMembershipRole>(inviteRoleOptions[0] || 'STAFF');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteFieldErrors, setInviteFieldErrors] = useState<Record<string, string>>({});
  const [pendingRoleChange, setPendingRoleChange] = useState<{ member: ClubMember; role: ClubMembershipRole } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<ClubMember | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');

  const loadMembers = async (silent = false) => {
    if (!clubSlug) return;
    if (!silent) setLoading(true);
    try {
      const items = await ClubAdminService.listMembers(clubSlug);
      setMembers(items);
      setError('');
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo cargar el staff del club.'));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadMembers();
  }, [clubSlug]);

  useEffect(() => {
    setInviteRole(inviteRoleOptions[0] || 'STAFF');
  }, [actorRole]);

  const handleInvite = async () => {
    if (!clubSlug || inviteSubmitting) return;
    setInviteSubmitting(true);
    setInviteFieldErrors({});
    setError('');
    try {
      await ClubAdminService.inviteMember(clubSlug, {
        email: inviteEmail.trim(),
        role: inviteRole
      });
      await loadMembers(true);
      setInviteEmail('');
      setInviteRole(inviteRoleOptions[0] || 'STAFF');
      showAdminToast('Acceso otorgado correctamente.');
    } catch (err) {
      setInviteFieldErrors(getApiFieldErrors(err));
      setError(extractErrorMessage(err, 'No se pudo dar acceso al miembro.'));
    } finally {
      setInviteSubmitting(false);
    }
  };

  const confirmRoleChange = async () => {
    if (!clubSlug || !pendingRoleChange || actionSubmitting) return;
    setActionSubmitting(true);
    setActionError('');
    try {
      await ClubAdminService.updateMemberRole(
        clubSlug,
        pendingRoleChange.member.id,
        pendingRoleChange.role
      );
      await loadMembers(true);
      showAdminToast('Rol actualizado.');
      setPendingRoleChange(null);
    } catch (err) {
      setActionError(extractErrorMessage(err, 'No se pudo actualizar el rol.'));
    } finally {
      setActionSubmitting(false);
    }
  };

  const confirmRemove = async () => {
    if (!clubSlug || !pendingRemove || actionSubmitting) return;
    setActionSubmitting(true);
    setActionError('');
    try {
      await ClubAdminService.removeMember(clubSlug, pendingRemove.id);
      await loadMembers(true);
      showAdminToast('Acceso removido.');
      setPendingRemove(null);
    } catch (err) {
      setActionError(extractErrorMessage(err, 'No se pudo quitar el acceso.'));
    } finally {
      setActionSubmitting(false);
    }
  };

  const canManageMember = (member: ClubMember) => {
    if (actorRole === 'OWNER') return true;
    if (actorRole === 'ADMIN') return member.role === 'STAFF';
    return false;
  };

  const roleOptionsForMember = (member: ClubMember): ClubMembershipRole[] => {
    if (actorRole === 'OWNER') {
      if (member.role === 'OWNER') return ['OWNER', 'ADMIN', 'STAFF'];
      if (member.role === 'ADMIN') return ['ADMIN', 'STAFF'];
      return ['STAFF', 'ADMIN'];
    }
    return ['STAFF'];
  };

  if (!isAdminManager) {
    return (
      <AdminEmptyState
        title="Sin permiso para gestionar staff"
        description="Solo owner y admin pueden administrar accesos del club."
      />
    );
  }

  return (
    <div className="space-y-4">
      <AdminPanel
        title="Staff y permisos"
        description="Otorgá acceso operativo a usuarios existentes de Pique. No hay linking ni invitaciones automáticas."
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_180px_auto]">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-p-text-secondary">Email del usuario</span>
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="staff@club.com"
              disabled={inviteSubmitting}
              className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none transition focus:border-p-accent"
            />
            <AdminInlineError>{inviteFieldErrors.email}</AdminInlineError>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-p-text-secondary">Rol</span>
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as ClubMembershipRole)}
              disabled={inviteSubmitting}
              className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none transition focus:border-p-accent"
            >
              {inviteRoleOptions.map((role) => (
                <option key={role} value={role}>
                  {formatRole(role)}
                </option>
              ))}
            </select>
            <AdminInlineError>{inviteFieldErrors.role}</AdminInlineError>
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={handleInvite}
              disabled={inviteSubmitting || !clubSlug}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-ink-900 px-4 text-[12px] font-semibold text-ink-50 transition hover:bg-ink-800 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserPlus size={14} />
              {inviteSubmitting ? 'Otorgando...' : 'Dar acceso'}
            </button>
          </div>
        </div>

        {error ? (
          <AdminFeedbackBanner tone="error" className="mt-3">
            {error}
          </AdminFeedbackBanner>
        ) : null}

        <div className="mt-3">
          <AdminFeedbackBanner tone="info" compact>
            El usuario ya debe existir en Pique. Este flujo crea la membresía del club y deja auditoría.
          </AdminFeedbackBanner>
        </div>
      </AdminPanel>

      <AdminPanel
        title="Miembros activos"
        description="Owner gestiona todos los roles. Admin solo puede administrar staff."
        bodyClassName="p-0"
      >
        {loading ? (
          <div className="grid min-h-[180px] place-items-center p-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-p-border border-t-p-accent" />
          </div>
        ) : members.length === 0 ? (
          <div className="p-4">
            <AdminEmptyState
              title="Todavía no hay staff configurado"
              description="Cuando otorgues acceso a un usuario existente, va a aparecer acá."
            />
          </div>
        ) : (
          <AdminDataTable
            columns={[
              {
                key: 'user',
                label: 'Miembro',
                render: (member) => (
                  <div>
                    <p className="font-semibold text-p-text">{fullName(member)}</p>
                    <p className="mt-0.5 text-[12px] text-p-text-muted">{member.user?.email || 'Sin email'}</p>
                  </div>
                )
              },
              {
                key: 'role',
                label: 'Rol',
                width: 'w-[160px]',
                render: (member) => (
                  <span className="inline-flex rounded-full border border-p-border bg-p-surface-2 px-2.5 py-1 text-[11px] font-semibold text-p-text-secondary">
                    {formatRole(String(member.role))}
                  </span>
                )
              },
              {
                key: 'status',
                label: 'Estado',
                width: 'w-[120px]',
                render: () => (
                  <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-p-positive">
                    <ShieldCheck size={13} />
                    Activo
                  </span>
                )
              },
              {
                key: 'actions',
                label: 'Acciones',
                align: 'right',
                width: 'w-[240px]',
                render: (member) => {
                  if (!canManageMember(member)) {
                    return <span className="text-[12px] text-p-text-muted">Sin acciones</span>;
                  }
                  return (
                    <div className="flex items-center justify-end gap-2">
                      <select
                        value={String(member.role)}
                        onChange={(event) =>
                          setPendingRoleChange({ member, role: event.target.value as ClubMembershipRole })
                        }
                        className="h-9 rounded-lg border border-p-border bg-p-surface px-2 text-[12px] text-p-text outline-none transition focus:border-p-accent"
                      >
                        {roleOptionsForMember(member).map((role) => (
                          <option key={role} value={role}>
                            {formatRole(role)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setPendingRemove(member)}
                        className="inline-flex h-9 items-center gap-1 rounded-lg border border-p-border px-3 text-[12px] font-semibold text-p-error transition hover:bg-p-error-bg"
                      >
                        <UserMinus size={13} />
                        Quitar
                      </button>
                    </div>
                  );
                }
              }
            ]}
            data={members}
            rowKey={(member) => member.id}
            empty={{
              title: 'No hay miembros activos',
              description: 'Todavía no se otorgó acceso a nadie.'
            }}
          />
        )}
      </AdminPanel>

      <AdminAppModal
        show={Boolean(pendingRoleChange)}
        onClose={() => {
          if (actionSubmitting) return;
          setPendingRoleChange(null);
          setActionError('');
        }}
        title="Confirmar cambio de rol"
        message={
          <div className="space-y-3">
            <p>
              Vas a actualizar el acceso de <strong>{pendingRoleChange ? fullName(pendingRoleChange.member) : ''}</strong>{' '}
              a <strong>{pendingRoleChange ? formatRole(pendingRoleChange.role) : ''}</strong>.
            </p>
            {actionError ? <AdminFeedbackBanner tone="error" compact>{actionError}</AdminFeedbackBanner> : null}
          </div>
        }
        cancelText="Cancelar"
        confirmText={actionSubmitting ? 'Guardando...' : 'Guardar rol'}
        confirmDisabled={actionSubmitting}
        onConfirm={confirmRoleChange}
      />

      <AdminAppModal
        show={Boolean(pendingRemove)}
        onClose={() => {
          if (actionSubmitting) return;
          setPendingRemove(null);
          setActionError('');
        }}
        title="Quitar acceso al club"
        isWarning
        message={
          <div className="space-y-3">
            <p>
              Vas a quitar el acceso de <strong>{pendingRemove ? fullName(pendingRemove) : ''}</strong>. La acción es manual y queda auditada.
            </p>
            {actionError ? <AdminFeedbackBanner tone="error" compact>{actionError}</AdminFeedbackBanner> : null}
          </div>
        }
        cancelText="Cancelar"
        confirmText={actionSubmitting ? 'Quitando...' : 'Quitar acceso'}
        confirmDisabled={actionSubmitting}
        onConfirm={confirmRemove}
      />
    </div>
  );
}
