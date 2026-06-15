import type { ReactNode } from 'react';

type AdminEmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export default function AdminEmptyState({ title, description, action }: AdminEmptyStateProps) {
  return (
    <div className="grid min-h-[220px] place-items-center rounded-xl border border-dashed border-p-border bg-p-surface-2 px-4 py-8 text-center">
      <div className="max-w-[360px]">
        <p className="text-[15px] font-bold text-p-text">{title}</p>
        {description && <p className="mt-2 text-[13px] leading-5 text-p-text-muted">{description}</p>}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
