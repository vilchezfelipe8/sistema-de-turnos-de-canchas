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
            className="h-10 rounded-lg border border-p-border bg-p-surface px-4 text-[12px] font-semibold text-p-text-secondary transition hover:bg-p-surface-2"
          >
            {actionLabel}
          </button>
        ) : undefined
      }
    />
  );
}
