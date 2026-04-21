import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import AdminLayout from '../../components/AdminLayout';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { hasAdminAccess } from '../../utils/session';
import AdminTabRefunds from '../../components/admin/AdminTabRefunds';

export default function AdminRefundsPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin/devoluciones')}`);
  }, [authChecked, user, router]);

  if (!authChecked || !user) return <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando acceso...'} />;
  if (!hasAdminAccess(user)) return <NotFound message="No tenes permiso para acceder al panel de administracion." />;

  return (
    <div className="min-h-screen text-text relative overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <AdminLayout>
        <Head>
          <title>Devoluciones | TuCancha Admin</title>
        </Head>
        <AdminTabRefunds />
      </AdminLayout>
    </div>
  );
}

