import type { ReactNode } from 'react';

type AdminPanelProps = {
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
};

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export default function AdminPanel({
  children,
  title,
  description,
  actions,
  className,
  headerClassName,
  bodyClassName,
}: AdminPanelProps) {
  const resolvedBodyClassName = bodyClassName ? bodyClassName : 'p-4';

  return (
    <section className={cx('rounded-xl border border-[#dce2ee] bg-white', className)}>
      {(title || description || actions) && (
        <header className={cx('flex flex-wrap items-start justify-between gap-3 border-b border-[#eef2f8] px-4 py-3', headerClassName)}>
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold text-[#1f2638]">{title}</h2>}
            {description && <p className="mt-1 text-[12px] text-[#6f7890]">{description}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className={resolvedBodyClassName}>{children}</div>
    </section>
  );
}
