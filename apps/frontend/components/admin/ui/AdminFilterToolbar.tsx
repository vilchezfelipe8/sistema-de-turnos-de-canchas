import type { ReactNode } from 'react';

type AdminFilterToolbarProps = {
  children: ReactNode;
  className?: string;
};

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export default function AdminFilterToolbar({ children, className }: AdminFilterToolbarProps) {
  return (
    <div className={cx('flex flex-wrap items-center gap-2 rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-2', className)}>
      {children}
    </div>
  );
}
