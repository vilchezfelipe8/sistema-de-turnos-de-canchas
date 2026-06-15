import type { CSSProperties } from 'react';
import { useUserTheme } from '../contexts/UserThemeContext';
import PiqueLogo from './PiqueLogo';

type UserLoadingStateMode = 'page' | 'block' | 'inline';

interface UserLoadingStateProps {
  message?: string;
  mode?: UserLoadingStateMode;
  minHeight?: string | number;
}

const shellBase: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export default function UserLoadingState({
  message = 'Cargando...',
  mode = 'block',
  minHeight,
}: UserLoadingStateProps) {
  const { isLight } = useUserTheme();
  const panel = (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: mode === 'inline' ? '8px 12px' : '14px 18px',
        borderRadius: 14,
        border: isLight ? '1px solid var(--accent-border-subtle)' : '1px solid var(--accent-bg-muted)',
        background: isLight ? 'var(--accent-bg-muted)' : 'var(--accent-bg-soft)',
        color: isLight ? 'var(--positive-fg)' : 'var(--positive-fg)',
        fontSize: mode === 'inline' ? 12 : 13,
        fontWeight: 700,
        letterSpacing: '.01em',
      }}
    >
      <PiqueLogo
        variant={isLight ? 'isotipo' : 'isotipoDark'}
        style={{
          width: mode === 'inline' ? 18 : 22,
          height: mode === 'inline' ? 18 : 22,
          display: 'block',
        }}
      />
      <span>{message}</span>
    </div>
  );

  if (mode === 'inline') return panel;

  if (mode === 'page') {
    return (
      <main
        style={{
          ...shellBase,
        minHeight: '100vh',
          background: isLight
            ? 'radial-gradient(circle at 18% 86%, var(--accent-bg-muted), transparent 42%), var(--bg)'
            : 'radial-gradient(circle at 18% 86%, var(--accent-bg-muted), transparent 42%), var(--bg)',
          color: isLight ? 'var(--text-primary)' : 'var(--text-primary)',
          fontFamily: "'Geist',system-ui,sans-serif",
          padding: 24,
        }}
      >
        {panel}
      </main>
    );
  }

  return (
    <div
      style={{
        ...shellBase,
        minHeight: minHeight ?? '40vh',
      }}
    >
      {panel}
    </div>
  );
}
