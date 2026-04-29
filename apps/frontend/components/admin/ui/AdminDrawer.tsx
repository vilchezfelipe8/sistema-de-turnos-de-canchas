import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Terminología del proyecto
// ---------------------------------------------------------------------------
// Sidebar  = navegación principal del admin (columna izquierda permanente).
// Drawer   = panel lateral contextual para operar algo: gestionar una cuenta,
//            cobrar, cerrar caja, crear movimiento, ver detalle, editar, etc.
//            En desktop: slide-in desde la derecha sobre el contenido.
//            En mobile: pantalla completa con botón cerrar.
//
// Componentes relacionados (legado):
//   AdminSidebarScaffold   → primitivo de drawer ya desplegado. Renombrar
//                            en una pasada futura; no tocar por compatibilidad.
//   AgendaLikeRightSidebar → wrapper fino de AdminSidebarScaffold.
//                            Preferir AdminDrawer para features nuevas.
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
   * lg  → 740px — detalle complejo (pago, vista de cuenta completa).
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

  /** z-index CSS. Default 2147483150 para quedar sobre modales de la app. */
  zIndex?: number;
};

// ---------------------------------------------------------------------------
// Size map
// ---------------------------------------------------------------------------

const sizeWidthClass: Record<AdminDrawerSize, string> = {
  sm: 'md:max-w-[440px]',
  md: 'md:max-w-[580px]',
  lg: 'md:max-w-[740px]',
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
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#98a1b3]">
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
 * Preferir AdminDrawer sobre AgendaLikeRightSidebar para features nuevas.
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
  zIndex = 2147483150,
}: AdminDrawerProps) {
  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0"
      style={{ zIndex }}
      role="presentation"
    >
      {/* ── Backdrop ── */}
      <button
        type="button"
        aria-label="Cerrar panel"
        className="fixed inset-0 bg-[#101326]/20 md:top-16"
        onClick={onClose}
      />

      {/* ── Panel ── */}
      <aside
        role="dialog"
        aria-modal="true"
        className={[
          // Mobile: pantalla completa
          'fixed inset-0 w-full',
          // Desktop: slide-in desde la derecha
          `md:inset-y-0 md:left-auto md:right-0 md:top-16 md:w-full`,
          sizeWidthClass[size],
          'border-l border-[#e6e8ee] bg-white shadow-2xl',
        ].join(' ')}
      >
        <div className="relative flex h-full flex-col">

          {/* ── Header ── */}
          <header className="shrink-0 border-b border-[#eef0f5] px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-[#1a2035]">
                  {title}
                </h2>
                {subtitle && (
                  <p className="mt-2 text-[13px] leading-snug text-[#6f7890]">
                    {subtitle}
                  </p>
                )}
                {statusChip && (
                  <span
                    className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusChipClassName}`}
                  >
                    {statusChip}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#e4e7ee] text-[#6f7890] transition hover:bg-[#f5f6f8]"
              >
                <X size={16} />
              </button>
            </div>
          </header>

          {/* ── Tabs opcionales ── */}
          {tabs.length > 0 && (
            <div className="shrink-0 border-b border-[#eef0f5] px-6">
              <nav className="flex items-center gap-6 overflow-x-auto">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onTabChange?.(tab.id)}
                    className={[
                      'h-12 whitespace-nowrap border-b-2 text-[13px] font-semibold transition',
                      activeTabId === tab.id
                        ? 'border-[#3053e2] text-[#3053e2]'
                        : 'border-transparent text-[#6f7890] hover:text-[#2a3245]',
                    ].join(' ')}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>
          )}

          {/* ── Body (scrolleable) ── */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <div className="space-y-5">
              {children}
            </div>
          </div>

          {/* ── Footer fijo ── */}
          {footer && (
            <footer className="shrink-0 border-t border-[#eef0f5] bg-white px-6 py-4">
              {footer}
            </footer>
          )}
        </div>
      </aside>
    </div>
  );
}
