import React from 'react';
import { useEffect } from 'react';
import Head from 'next/head'; 
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import AdminTabStatistics from '../../components/admin/AdminTabStatistics'; 
import { getActiveClubSlug, hasAdminAccess, normalizeSessionUser } from '../../utils/session';

export default function AdminStatisticsPage() {
  const router = useRouter();
  // Obtenemos el usuario validado
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin/statistics')}`);
  }, [authChecked, user, router]);

  if (!authChecked || !user) return <RouteTransitionScreen message={authChecked ? 'Redirigiendo al login...' : 'Validando acceso...'} />;

  if (!hasAdminAccess(user)) {
    return <NotFound message="No tenés permiso para acceder." />;
  }

  const userSlug = getActiveClubSlug(normalizeSessionUser(user as any));

  return (
    <div className="min-h-screen text-text relative overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <AdminLayout>
        <Head>
          <title>Estadísticas | TuCancha Admin</title>
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
