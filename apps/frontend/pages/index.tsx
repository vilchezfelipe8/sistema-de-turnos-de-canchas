import React from 'react';

export default function Home() {
  return (
    <main style={{ padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1>Sistema de Turnos - Frontend</h1>
      <p>Frontend minimal para desarrollo. Configura <code>NEXT_PUBLIC_API_URL</code> en tus variables de entorno.</p>
      <p>
        API base: <code>{process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}</code>
      </p>
    </main>
  );
}
