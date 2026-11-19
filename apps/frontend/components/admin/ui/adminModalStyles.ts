import { adminButton } from './adminButton';

// Anatomía única de los modales del admin. Usar con <AdminOverlay> cuando un modal
// necesita un cuerpo propio; si alcanza con título + contenido + botones, usar <AdminModal>.

const modalPanelBase =
  'w-full max-h-[92dvh] rounded-t-3xl border border-p-border bg-p-surface shadow-p-lg max-sm:border-b-0 sm:max-h-[88vh] sm:rounded-2xl';

/** Panel: hoja desde abajo en el celular, tarjeta centrada en desktop. Header y pie fijos, cuerpo con scroll (modalBodyCls). Sumar el max-w. */
export const modalPanelCls = `flex flex-col overflow-hidden ${modalPanelBase}`;

/** Igual que modalPanelCls pero scrollea el panel entero (modales con contenido libre). */
export const modalPanelScrollCls = `overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] ${modalPanelBase}`;

export const modalHeaderCls = 'flex shrink-0 items-start justify-between gap-4 border-b border-p-border px-5 py-4';
export const modalTitleCls = 'text-[17px] font-semibold tracking-[-0.01em] text-p-text';
export const modalDescriptionCls = 'mt-1 text-[13px] leading-5 text-p-text-muted';
export const modalCloseButtonCls =
  'grid h-8 w-8 shrink-0 place-items-center rounded-full border border-p-border text-p-text-muted transition-colors hover:bg-p-surface-2 hover:text-p-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/40';
export const modalBodyCls = 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5';
export const modalFooterCls =
  'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-p-border px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]';

/** Botones de pie de modal / drawer (mismos que en todo el admin). */
export const modalSecondaryButtonCls = adminButton('secondary', 'lg');
export const modalPrimaryButtonCls = adminButton('primary', 'lg');
export const modalDangerButtonCls = adminButton('danger', 'lg');
