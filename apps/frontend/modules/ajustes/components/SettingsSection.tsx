import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SettingsSectionProps = {
  /** Título de la sección, mostrado en el header. */
  title: string;
  /** Descripción corta debajo del título. */
  description?: string;
  /** Acción opcional en el extremo derecho del header (botón Guardar, badge, etc.). */
  action?: ReactNode;
  /** Contenido de la sección. */
  children: ReactNode;
  /** Clase adicional para el contenedor raíz. */
  className?: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * SettingsSection — sección de configuración con header y cuerpo.
 *
 * Patrón inspirado en Stripe Settings / Notion Settings:
 * - Header: título + descripción + acción opcional (guardar, badge, etc.)
 * - Cuerpo: contenido libre con padding consistente
 * - Sin sombra (conforme al Documento Maestro)
 *
 * @example
 * <SettingsSection
 *   title="Confirmación de reservas"
 *   description="Define cómo se confirman las nuevas reservas del club."
 *   action={<button onClick={handleSave}>Guardar</button>}
 * >
 *   <AdminSegmentedControl ... />
 * </SettingsSection>
 */
export default function SettingsSection({
  title,
  description,
  action,
  children,
  className = '',
}: SettingsSectionProps) {
  return (
    <section
      className={[
        'overflow-hidden rounded-xl border border-p-border bg-p-surface',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 border-b border-p-border px-5 py-4">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold leading-snug text-p-text">{title}</p>
          {description && (
            <p className="mt-0.5 text-[12px] leading-snug text-p-text-muted">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {/* ── Body ── */}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
