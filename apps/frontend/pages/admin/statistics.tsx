import React from 'react';
import Head from 'next/head'; 
import AdminLayout from '../../components/AdminLayout';
import NotFound from '../../components/NotFound';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import AdminTabStatistics from '../../components/admin/AdminTabStatistics'; 

export default function AdminStatisticsPage() {
  // Obtenemos el usuario validado
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  if (!authChecked || !user) return null;

  if (user.role !== 'ADMIN') {
    return <NotFound message="No tenés permiso para acceder." />;
  }

  // 👇 INTELIGENCIA: Buscamos el slug en el objeto user. 
  // (Depende de cómo sea tu usuario, suele ser user.club.slug o user.clubSlug)
  // Probá con user.club?.slug primero.
  const userSlug = (user as any).club?.slug || (user as any).slug || (user as any).clubSlug;

  return (
    <div className="min-h-screen text-text relative overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <AdminLayout>
        <Head>
          <title>Estadísticas | Admin Panel</title>
        </Head>
        
        {/* 👇 ACÁ ESTÁ LA MAGIA: Le pasamos el slug manual si no está en la URL */}
        {userSlug ? (
            <AdminTabStatistics slugProp={userSlug} />
        ) : (
            <div className="p-8 text-red-500">Error: No se encontró el club asociado a este administrador.</div>
        )}

      </AdminLayout>
    </div>
  );
}