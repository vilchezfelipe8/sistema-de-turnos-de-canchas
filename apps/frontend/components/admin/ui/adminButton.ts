// Botones del admin: una sola fuente para todos (páginas, drawers, modales).
// Tamaños: sm = barras y filas, md = default, lg = pie de drawer / acción principal en el celular.

export type AdminButtonVariant = 'primary' | 'secondary' | 'danger' | 'accent' | 'ghost';
export type AdminButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-[background-color,border-color,color,opacity,transform] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/40';

const SIZE: Record<AdminButtonSize, string> = {
  sm: 'h-8 rounded-lg px-3 text-[12px]',
  md: 'h-9 rounded-lg px-4 text-[13px]',
  lg: 'h-10 rounded-xl px-5 text-[13px]',
};

const VARIANT: Record<AdminButtonVariant, string> = {
  primary: 'bg-ink-900 text-ink-50 hover:bg-ink-800',
  secondary: 'border border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2 hover:text-p-text',
  danger: 'bg-p-error text-white hover:opacity-90',
  accent: 'bg-p-brand text-p-brand-on hover:bg-lima-200',
  ghost: 'text-p-text-secondary hover:bg-p-surface-2 hover:text-p-text',
};

/** Clases de un botón del admin. Sumar layout aparte (w-full, flex-1, etc.). */
export const adminButton = (variant: AdminButtonVariant = 'primary', size: AdminButtonSize = 'md') =>
  `${BASE} ${SIZE[size]} ${VARIANT[variant]}`;
