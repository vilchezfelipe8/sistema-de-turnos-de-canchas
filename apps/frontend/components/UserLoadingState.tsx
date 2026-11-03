import type { CSSProperties } from 'react';
import { useUserTheme } from '../contexts/UserThemeContext';
import PiqueLogo from './PiqueLogo';
import Spinner from './ui/Spinner';

type UserLoadingStateMode = 'page' | 'block' | 'inline';

interface UserLoadingStateProps {
  message?: string;
  mode?: UserLoadingStateMode;
  minHeight?: string | number;
}

// Única pantalla de carga de la app (estilos en pique.css → "Loading (sistema único)").
// page: validar sesión / cambiar de pantalla · block: una sección entera · inline: dentro de un panel.
// Para contenido con forma conocida (tarjetas, listas) usar <Skeleton /> en vez de esto.
export default function UserLoadingState({
  message = 'Cargando...',
  mode = 'block',
  minHeight,
}: UserLoadingStateProps) {
  const { isLight } = useUserTheme();

  if (mode === 'inline') {
    return (
      <span className="p-loader-inline" role="status">
        <Spinner size={14} />
        <span>{message}</span>
      </span>
    );
  }

  const style: CSSProperties | undefined = mode === 'block' && minHeight !== undefined ? { minHeight } : undefined;

  return (
    <div
      className={`p-loader p-loader-delayed ${mode === 'page' ? 'p-loader-page' : 'p-loader-block'}`}
      style={style}
      role="status"
      aria-live="polite"
    >
      <div className="p-loader-mark" aria-hidden="true">
        <PiqueLogo variant={isLight ? 'isotipo' : 'isotipoDark'} alt="" />
        <span className="p-loader-ring" />
      </div>
      <p className="p-loader-msg">{message}</p>
    </div>
  );
}
