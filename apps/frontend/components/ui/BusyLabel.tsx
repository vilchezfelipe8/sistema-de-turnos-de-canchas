import type { ReactNode } from 'react';
import Spinner from './Spinner';

interface BusyLabelProps {
  busy: boolean;
  children: ReactNode;
  // Texto solo para lectores de pantalla mientras está ocupado.
  srLabel?: string;
  spinnerSize?: number;
}

// Contenido de botón que, mientras la acción corre, muestra solo el spinner.
// El texto queda oculto pero ocupa su lugar: el botón no cambia de ancho.
export default function BusyLabel({ busy, children, srLabel = 'Procesando', spinnerSize = 15 }: BusyLabelProps) {
  return (
    <span className="p-busy">
      <span className="p-busy-content" aria-hidden={busy || undefined}>{children}</span>
      {busy && (
        <span className="p-busy-spin">
          <Spinner size={spinnerSize} />
          <span className="p-sr-only">{srLabel}</span>
        </span>
      )}
    </span>
  );
}
