import type { ReactNode } from 'react';
import { Info, AlertTriangle } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SettingsInfoNoteVariant = 'info' | 'warning' | 'neutral';

type SettingsInfoNoteProps = {
  /** Título opcional en negrita. */
  title?: string;
  /** Contenido: string o JSX. */
  children: ReactNode;
  /**
   * Variante visual:
   * - info    → azul — explicaciones de comportamiento del sistema.
   * - warning → amarillo — alertas de acción irreversible o restricción.
   * - neutral → gris claro — notas informativas sin urgencia.
   */
  variant?: SettingsInfoNoteVariant;
  /** Ícono personalizado. Si se omite, se usa uno por defecto según variant. */
  icon?: ReactNode;
  className?: string;
};

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const variantStyles: Record<
  SettingsInfoNoteVariant,
  { container: string; icon: string; title: string; text: string }
> = {
  info: {
    container: 'border-[#bfdbfe] bg-[#eff6ff]',
    icon: 'text-[#1d4ed8]',
    title: 'text-[#1d4ed8]',
    text: 'text-[#1e40af]',
  },
  warning: {
    container: 'border-[#fde68a] bg-[#fffbeb]',
    icon: 'text-[#92400e]',
    title: 'text-[#92400e]',
    text: 'text-[#78350f]',
  },
  neutral: {
    container: 'border-[#dce2ee] bg-[#f8f9fc]',
    icon: 'text-[#6f7890]',
    title: 'text-[#4e5870]',
    text: 'text-[#4e5870]',
  },
};

const defaultIcon: Record<SettingsInfoNoteVariant, ReactNode> = {
  info: <Info size={15} strokeWidth={2.3} />,
  warning: <AlertTriangle size={15} strokeWidth={2.3} />,
  neutral: <Info size={15} strokeWidth={2.3} />,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * SettingsInfoNote — callout informativo para secciones de configuración.
 *
 * Úsalo para:
 * - Explicar comportamiento del sistema (variant="info").
 * - Advertir sobre acciones irreversibles (variant="warning").
 * - Mostrar restricciones o notas sin urgencia (variant="neutral").
 *
 * @example
 * <SettingsInfoNote variant="neutral" title="Alta de canchas">
 *   Deshabilitada en el panel. Contactá a soporte para agregar canchas.
 * </SettingsInfoNote>
 *
 * <SettingsInfoNote variant="info">
 *   El precio definido es la base para la duración por defecto de cada actividad.
 * </SettingsInfoNote>
 */
export default function SettingsInfoNote({
  title,
  children,
  variant = 'neutral',
  icon,
  className = '',
}: SettingsInfoNoteProps) {
  const styles = variantStyles[variant];
  const iconNode = icon ?? defaultIcon[variant];

  return (
    <div
      className={[
        'flex items-start gap-3 rounded-xl border px-4 py-3',
        styles.container,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Icon */}
      <div className={['mt-0.5 shrink-0', styles.icon].join(' ')}>{iconNode}</div>

      {/* Text */}
      <div className="min-w-0">
        {title && (
          <p className={['text-[11px] font-semibold uppercase tracking-wide', styles.title].join(' ')}>
            {title}
          </p>
        )}
        <p className={['text-[12px] leading-5', styles.text, title ? 'mt-1' : ''].join(' ')}>
          {children}
        </p>
      </div>
    </div>
  );
}
