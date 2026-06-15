import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

export type AdminFeedbackTone = 'success' | 'error' | 'info' | 'warning';

const toneClasses: Record<AdminFeedbackTone, {
  shell: string;
  icon: string;
  dot: string;
}> = {
  success: {
    shell: 'border-p-positive bg-p-positive-bg text-p-positive',
    icon: 'text-p-positive',
    dot: 'bg-p-positive',
  },
  error: {
    shell: 'border-p-error bg-p-error-bg text-p-error',
    icon: 'text-p-error',
    dot: 'bg-p-error',
  },
  info: {
    shell: 'border-p-border bg-p-surface-2 text-p-text-secondary',
    icon: 'text-p-accent',
    dot: 'bg-p-accent',
  },
  warning: {
    shell: 'border-p-warning bg-p-warning-bg text-p-warning',
    icon: 'text-p-warning',
    dot: 'bg-p-warning',
  },
};

const iconForTone = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
  warning: AlertTriangle,
} as const;

type AdminFeedbackBannerProps = {
  tone?: AdminFeedbackTone;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  compact?: boolean;
};

export function AdminFeedbackBanner({
  tone = 'info',
  title,
  children,
  className = '',
  compact = false,
}: AdminFeedbackBannerProps) {
  const Icon = iconForTone[tone];
  const classes = toneClasses[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={[
        'rounded-xl border shadow-p-card',
        compact ? 'px-3 py-2' : 'px-3.5 py-3',
        classes.shell,
        className,
      ].filter(Boolean).join(' ')}
    >
      <div className="flex items-start gap-2.5">
        <span className={['mt-0.5 shrink-0', classes.icon].join(' ')}>
          <Icon size={15} strokeWidth={2.3} />
        </span>
        <div className="min-w-0 text-[12px] leading-5">
          {title ? (
            <p className="font-semibold text-current">{title}</p>
          ) : null}
          <div className={title ? 'mt-0.5 font-medium' : 'font-semibold'}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

type AdminInlineErrorProps = {
  children?: ReactNode;
  className?: string;
};

export function AdminInlineError({ children, className = '' }: AdminInlineErrorProps) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className={[
        'mt-1.5 text-[12px] font-semibold leading-4 text-p-error',
        className,
      ].filter(Boolean).join(' ')}
    >
      {children}
    </p>
  );
}

type AdminNoticeProps = {
  tone?: AdminFeedbackTone;
  children: ReactNode;
  className?: string;
};

export function AdminNotice({ tone = 'info', children, className = '' }: AdminNoticeProps) {
  const Icon = iconForTone[tone];
  const classes = toneClasses[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={[
        'pointer-events-auto inline-flex max-w-[420px] items-start gap-2 rounded-xl border px-3 py-2.5 text-[12px] font-semibold leading-5 shadow-p-lg',
        classes.shell,
        className,
      ].filter(Boolean).join(' ')}
    >
      <span className={['mt-0.5 shrink-0', classes.icon].join(' ')}>
        <Icon size={15} strokeWidth={2.3} />
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
