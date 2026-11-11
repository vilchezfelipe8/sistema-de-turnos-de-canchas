import { formatMemberBadge, type MemberSummary } from '../../../services/MemberAdminService';

type MemberBadgeProps = {
  member: MemberSummary | null | undefined;
  // Mostrar "No socio" cuando no hay registro. En listados densos conviene ocultarlo.
  showNonMember?: boolean;
  className?: string;
};

// Badge de condición de socio: "Socio · Activo · N° 1234", "Socio suspendido", "No socio".
export default function MemberBadge({ member, showNonMember = false, className = '' }: MemberBadgeProps) {
  if (!member && !showNonMember) return null;
  const current = Boolean(member?.isCurrent);
  const tone = current
    ? 'bg-p-positive-bg text-p-accent'
    : member
      ? 'bg-p-warning-bg text-p-warning'
      : 'bg-p-surface-2 text-p-text-muted';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone} ${className}`}
      title={member?.validUntil ? `Al día hasta ${member.validUntil}` : undefined}
    >
      {formatMemberBadge(member)}
    </span>
  );
}
