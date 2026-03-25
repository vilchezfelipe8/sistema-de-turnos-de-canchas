import { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { hasAdminAccess } from '../../utils/session';

export default function AdminIndex() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  useEffect(() => {
    if (!authChecked) return;
    if (!user) {
      if (getPendingLogoutRedirect()) return;
      void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin')}`);
      return;
    }
    if (!hasAdminAccess(user)) return;
    void router.replace('/admin/agenda');
  }, [authChecked, user, router]);

  return (
    <>
      <Head>
        <title>Admin | TuCancha</title>
      </Head>
      {!authChecked || !user
        ? <RouteTransitionScreen message={authChecked ? 'Redirigiendo al login...' : 'Validando acceso...'} />
        : !hasAdminAccess(user)
          ? <NotFound message="No tenes permiso para acceder al panel de administracion." />
          : null}
    </>
  );
}
