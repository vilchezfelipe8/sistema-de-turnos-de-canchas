// Chips de opción del admin (elegir duración, días, modalidad, especialidad...).
// Uno solo para todo el admin: activo negro, inactivo con borde. Usar con aria-pressed.

export type AdminChipSize = 'sm' | 'md' | 'lg' | 'xl';

const BASE =
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg border font-semibold transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/40';

const SIZE: Record<AdminChipSize, string> = {
  sm: 'h-8 px-3 text-[12px]',
  md: 'h-9 px-3 text-[13px]',
  lg: 'h-10 px-3.5 text-[13px]',
  xl: 'h-11 rounded-xl px-4 text-[14px]',
};

const ACTIVE = 'border-ink-900 bg-ink-900 !text-ink-50';
const IDLE = 'border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2 hover:text-p-text';

/** Clases de un chip de opción. Sumar layout aparte (flex-1, w-10, etc.). */
export const adminChip = (active: boolean, size: AdminChipSize = 'md') =>
  `${BASE} ${SIZE[size]} ${active ? ACTIVE : IDLE}`;
