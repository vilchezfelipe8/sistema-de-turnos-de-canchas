import { AdminEmptyState } from '../../../components/admin/ui';
import { adminButton } from '../../../components/admin/ui/adminButton';

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
            className={adminButton('secondary', 'lg')}
          >
            {actionLabel}
          </button>
        ) : undefined
      }
    />
  );
}
