import { useState } from 'react';
import type { GetServerSideProps } from 'next';
import UserLoadingState from '../../components/UserLoadingState';
import Skeleton, { SkeletonText } from '../../components/ui/Skeleton';
import BusyLabel from '../../components/ui/BusyLabel';
import { useUserTheme } from '../../contexts/UserThemeContext';

// Vitrina de los estados de carga (solo en desarrollo): /dev/loading
export const getServerSideProps: GetServerSideProps = async () =>
  process.env.NODE_ENV === 'production' ? { notFound: true } : { props: {} };

export default function DevLoadingPage() {
  const { isLight, toggleTheme } = useUserTheme();
  const [fullPage, setFullPage] = useState(false);

  if (fullPage) {
    return (
      <div onClick={() => setFullPage(false)} style={{ cursor: 'pointer' }}>
        <UserLoadingState mode="page" message="Validando sesión..." />
      </div>
    );
  }

  const section: React.CSSProperties = { background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 18, padding: 20, marginBottom: 16 };
  const title: React.CSSProperties = { margin: '0 0 14px', fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' };

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 20px', fontFamily: 'var(--font-sans)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <button type="button" className="p-btn-primary" onClick={() => setFullPage(true)} style={{ padding: '10px 16px', borderRadius: 12 }}>
            Ver pantalla completa (tocá para salir)
          </button>
          <button type="button" onClick={toggleTheme} style={{ padding: '10px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-1)', color: 'var(--text-primary)', cursor: 'pointer' }}>
            Tema: {isLight ? 'claro' : 'oscuro'}
          </button>
        </div>

        <section style={section}>
          <h2 style={title}>Bloque (una sección entera)</h2>
          <UserLoadingState mode="block" minHeight={180} message="Cargando club..." />
        </section>

        <section style={section}>
          <h2 style={title}>Inline (dentro de un panel)</h2>
          <UserLoadingState mode="inline" message="Cargando sesiones..." />
        </section>

        <section style={section}>
          <h2 style={title}>Esqueleto (contenido con forma conocida)</h2>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
            <Skeleton variant="circle" width={48} height={48} />
            <div style={{ flex: 1 }}><SkeletonText lines={2} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 8 }}>
            {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} height={38} radius={12} />)}
          </div>
        </section>

        <section style={section}>
          <h2 style={title}>Botón ocupado (solo spinner)</h2>
          <button type="button" disabled className="p-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 12 }}>
            <BusyLabel busy>Guardar cambios</BusyLabel>
          </button>
        </section>
      </div>
    </main>
  );
}
