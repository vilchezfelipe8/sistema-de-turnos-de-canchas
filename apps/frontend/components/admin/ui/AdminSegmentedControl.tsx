import type { ReactNode } from 'react';

export type AdminSegmentedOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  /** Número al lado del texto (se oculta si es 0 o null). */
  count?: number | null;
  /** Pinta el número en naranja: algo pide atención. */
  alert?: boolean;
};

type AdminSegmentedControlProps = {
  options: AdminSegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  /**
   * 'tabs' (default): cambiar de sección dentro de una página (activo verde).
   * 'filter': filtrar una lista o elegir un período (activo negro).
   */
  variant?: 'tabs' | 'filter';
  density?: 'default' | 'compact';
};

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

/** Único control segmentado del admin: pestañas de sección y filtros de lista. */
export default function AdminSegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  variant = 'tabs',
  density = 'default',
}: AdminSegmentedControlProps) {
  const isTabs = variant === 'tabs';
  const compact = density === 'compact' || !isTabs;
  return (
    <div
      role={isTabs ? 'tablist' : 'group'}
      aria-label={ariaLabel}
      className={cx(
        'inline-flex max-w-full items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xl border border-p-border bg-p-surface p-1',
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const showCount = typeof option.count === 'number' && option.count > 0;
        return (
          <button
            key={option.value}
            type="button"
            role={isTabs ? 'tab' : undefined}
            aria-selected={isTabs ? active : undefined}
            aria-pressed={isTabs ? undefined : active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cx(
              compact ? 'h-8 px-3 text-[12px]' : 'h-9 px-3.5 text-[13px]',
              'inline-flex shrink-0 items-center gap-1.5 rounded-lg font-semibold outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-lima-300/40',
              active
                ? isTabs
                  ? 'bg-p-positive-bg text-p-accent'
                  : 'bg-ink-900 text-ink-50'
                : 'text-p-text-muted hover:bg-p-surface-2 hover:text-p-text',
              option.disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent'
            )}
          >
            {option.label}
            {showCount && (
              <span className={cx('tabular-nums', option.alert && !active ? 'text-p-warning' : active ? 'opacity-80' : '')}>
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
