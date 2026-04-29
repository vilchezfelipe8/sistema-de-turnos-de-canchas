import { AdminEmptyState } from '../../../components/admin/ui';

type ReportsEmptyStateProps = {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

export default function ReportsEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: ReportsEmptyStateProps) {
  return (
    <AdminEmptyState
      title={title}
      description={description}
      action={
        actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="h-10 rounded-lg border border-[#dce2ee] bg-white px-4 text-[12px] font-semibold text-[#46516a] transition hover:bg-[#f8f9fd]"
          >
            {actionLabel}
          </button>
        ) : undefined
      }
    />
  );
}
