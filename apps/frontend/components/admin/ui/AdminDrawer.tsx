import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import { X } from 'lucide-react';
import { ADMIN_Z_INDEX } from '../../../utils/adminZIndex';
import { lockBodyScroll } from '../../../utils/bodyScrollLock';
import { useLastWhileOpen, usePresence } from '../../../hooks/usePresence';
import { useOverlayLayer } from './AdminOverlay';
import { modalCloseButtonCls } from './adminModalStyles';

// ---------------------------------------------------------------------------
// Terminología del proyecto
// ---------------------------------------------------------------------------
// Sidebar  = navegación principal del admin (columna izquierda permanente).
// Drawer   = panel lateral contextual para operar algo: gestionar una cuenta,
//            cobrar, cerrar caja, crear movimiento, ver detalle, editar, etc.
//            En desktop: slide-in desde la derecha sobre el contenido.
//            En mobile: pantalla completa con botón cerrar.
//
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminDrawerSize = 'sm' | 'md' | 'lg';

type AdminDrawerProps = {
  open: boolean;
  onClose: () => void;

  /** Título principal del drawer. */
  title: ReactNode;
  /** Subtítulo o descripción opcional debajo del título. */
  subtitle?: ReactNode;
  /** Badge de estado (p. ej. "Cuenta abierta", "En curso"). */
  statusChip?: ReactNode;
  /** Clases adicionales para el status chip. */
  statusChipClassName?: string;

  /**
   * Ancho del drawer en desktop.
   * sm  → 440px — formularios simples (abrir caja, crear movimiento).
   * md  → 580px — edición/gestión (cerrar caja, gestión de cuenta).
   * lg  → 670px — detalle complejo (pago, vista de cuenta completa).
   * Desktop: slide-in desde la derecha.
   * Mobile: siempre pantalla completa.
   */
  size?: AdminDrawerSize;

  /**
   * Pestañas opcionales bajo el header.
   * Útil para drawers con múltiples vistas (overview / add_item / payments…).
   */
  tabs?: Array<{ id: string; label: string }>;
  activeTabId?: string;
  onTabChange?: (id: string) => void;

  /**
   * Contenido del cuerpo (scrolleable).
   * Preferir estructurarlo con <AdminDrawerSection> para espaciado consistente.
   */
  children: ReactNode;

  /**
   * Footer fijo para acciones principales (botones Guardar, Cobrar, Cerrar…).
   * Siempre visible independientemente del scroll del body.
   */
  footer?: ReactNode;

  /** z-index CSS. Default centralizado para quedar sobre el shell admin. */
  zIndex?: number;

  /** Controles extra debajo del título (filtros, selectores). */
  headerExtra?: ReactNode;
  /** Capa sobre todo el panel (p. ej. "Confirmando pago..."). */
  overlay?: ReactNode;
  /** Clases del contenedor interno del cuerpo (default: separación vertical estándar). */
  bodyClassName?: string;
  bodyRef?: Ref<HTMLDivElement>;
  footerRef?: Ref<HTMLElement>;
  /** Escape cierra el drawer (default true). */
  closeOnEscape?: boolean;
};

// ---------------------------------------------------------------------------
// Size map
// ---------------------------------------------------------------------------

const sizeWidthClass: Record<AdminDrawerSize, string> = {
  sm: 'md:max-w-[440px]',
  md: 'md:max-w-[580px]',
  lg: 'md:max-w-[670px]',
};

// ---------------------------------------------------------------------------
// AdminDrawerSection
// ---------------------------------------------------------------------------

type AdminDrawerSectionProps = {
  title?: string;
  children: ReactNode;
  className?: string;
};

/**
 * AdminDrawerSection — agrupa contenido dentro del body de un drawer.
 *
 * Provee espaciado consistente y label de sección opcional.
 *
 * @example
 * <AdminDrawerSection title="Datos del turno">
 *   <DataRow label="Caja" value="Principal" />
 * </AdminDrawerSection>
 */
export function AdminDrawerSection({
  title,
  children,
  className,
}: AdminDrawerSectionProps) {
  return (
    <section
      className={[
        'space-y-3',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {title && (
        <p className="text-[13px] font-semibold text-p-text">
          {title}
        </p>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// AdminDrawer
// ---------------------------------------------------------------------------

/**
 * AdminDrawer — panel lateral contextual canónico del Admin v2.
 *
 * Usar para cualquier acción operativa que requiera contexto adicional:
 * gestionar una cuenta, cobrar, cerrar caja, crear movimiento, ver detalle,
 * editar entidad, confirmar acción destructiva, etc.
 *
 * Comportamiento:
 *   - Desktop: slide-in desde la derecha. Ancho controlado por `size`.
 *   - Mobile: pantalla completa. Siempre ocupa todo el viewport.
 *   - Cierre: click en backdrop, botón ×, o tecla Escape.
 *   - Footer: fijo al pie, visible sin importar el scroll del body.
 *
 * @example
 * <AdminDrawer
 *   open={isOpen}
 *   onClose={handleClose}
 *   title="Cerrar caja"
 *   subtitle="Ingresá el efectivo contado para generar el arqueo."
 *   size="sm"
 *   footer={<button onClick={handleSubmit}>Confirmar cierre</button>}
 * >
 *   <AdminDrawerSection title="Efectivo">
 *     <input ... />
 *   </AdminDrawerSection>
 * </AdminDrawer>
 */
export default function AdminDrawer({
  open,
  onClose,
  title,
  subtitle,
  statusChip,
  statusChipClassName = '',
  size = 'md',
  tabs = [],
  activeTabId,
  onTabChange,
  children,
  footer,
  zIndex = ADMIN_Z_INDEX.drawer,
  headerExtra,
  overlay,
  bodyClassName = 'space-y-5',
  bodyRef,
  footerRef,
  closeOnEscape = true,
}: AdminDrawerProps) {
  const { rendered, state } = usePresence(open);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useOverlayLayer(open, () => onCloseRef.current(), closeOnEscape);

  useEffect(() => {
    if (!open) return;
    return lockBodyScroll();
  }, [open]);

  // Durante la salida se sigue viendo lo último que se mostró.
  const view = useLastWhileOpen(open, { title, subtitle, statusChip, statusChipClassName, tabs, activeTabId, children, footer, headerExtra, overlay });

  if (!rendered) return null;

  return (
    <div
      className="fixed inset-0"
      style={{ zIndex }}
      role="presentation"
      aria-hidden={state === 'closed' || undefined}
    >
      {/* ── Backdrop ── */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Cerrar panel"
        data-state={state}
        className="p-motion-backdrop fixed inset-0 bg-[var(--overlay)] md:top-16"
        onClick={() => {
          if (open) onClose();
        }}
      />

      {/* ── Panel ── */}
      <aside
        role="dialog"
        aria-modal="true"
        data-state={state}
        className={[
          'p-motion-drawer',
          // Mobile: hoja inferior que ocupa casi todo el alto
          'fixed inset-x-0 bottom-0 flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t',
          // Desktop: slide-in desde la derecha
          `md:inset-y-0 md:left-auto md:right-0 md:top-16 md:max-h-none md:w-full md:rounded-none md:border-t-0`,
          sizeWidthClass[size],
          'border-l border-p-border bg-p-surface shadow-p-lg',
        ].join(' ')}
      >
        <div className="relative flex min-h-0 flex-1 flex-col md:h-full">
          {view.overlay}

          {/* ── Header ── */}
          <header className="shrink-0 border-b border-p-border bg-p-surface px-4 pb-3.5 pt-2.5 md:px-6 md:py-5">
            <span aria-hidden="true" className="mx-auto mb-2.5 block h-1 w-10 rounded-full bg-p-border-strong md:hidden" />
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-[18px] font-semibold leading-snug tracking-[-0.01em] text-p-text md:text-[20px]">
                  {view.title}
                </h2>
                {view.subtitle && (
                  <div className="mt-1.5 text-[13px] leading-snug text-p-text-muted">
                    {view.subtitle}
                  </div>
                )}
                {view.statusChip && (
                  <span
                    className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${view.statusChipClassName}`}
                  >
                    {view.statusChip}
                  </span>
                )}
                {view.headerExtra}
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className={modalCloseButtonCls}
              >
                <X size={14} />
              </button>
            </div>
          </header>

          {/* ── Tabs opcionales ── */}
          {view.tabs.length > 0 && (
            <div className="shrink-0 border-b border-p-border bg-p-surface px-4 md:px-6">
              <nav className="flex items-center gap-5 overflow-x-auto md:gap-6">
                {view.tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onTabChange?.(tab.id)}
                    className={[
                      'h-12 whitespace-nowrap border-b-2 text-[13px] font-semibold transition',
                      view.activeTabId === tab.id
                        ? 'border-p-accent text-p-accent'
                        : 'border-transparent text-p-text-muted hover:text-p-text',
                    ].join(' ')}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>
          )}

          {/* ── Body (scrolleable) ── */}
          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-p-surface px-4 py-4 md:px-6 md:py-6">
            <div className={bodyClassName}>
              {view.children}
            </div>
          </div>

          {/* ── Footer fijo ── */}
          {view.footer && (
            <footer ref={footerRef} className="shrink-0 border-t border-p-border bg-p-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 md:py-4">
              {view.footer}
            </footer>
          )}
        </div>
      </aside>
    </div>
  );
}
