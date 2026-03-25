import { useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import AdminTabClub from '../../components/admin/AdminTabClub';
import Head from 'next/head';
import { hasAdminAccess } from '../../utils/session';

export default function AdminSettingsPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin/settings')}`);
  }, [authChecked, user, router]);

  if (!authChecked || !user) return <RouteTransitionScreen message={authChecked ? 'Redirigiendo al login...' : 'Validando acceso...'} />;
  if (!hasAdminAccess(user)) return <NotFound message="No tenés permiso para acceder al panel de administración." />;

  return (
    <div className="min-h-screen text-text relative overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <AdminLayout>
        <Head>
          <title>Configuracion | TuCancha Admin</title>
        </Head>
        <AdminTabClub />
      </AdminLayout>
    </div>
  );
}
