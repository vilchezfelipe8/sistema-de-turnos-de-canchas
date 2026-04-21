import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { getActiveClubSlug, hasAdminAccess, normalizeSessionUser } from '../../utils/session';
import AdminTabServices from '../../components/admin/AdminTabServices';

export default function AdminServicesPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });
  const [clubSlug, setClubSlug] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin/services')}`);
  }, [authChecked, user, router]);

  useEffect(() => {
    if (!authChecked || !user) return;
    const normalizedUser = normalizeSessionUser(user as any);
    const activeSlug = getActiveClubSlug(normalizedUser);
    setClubSlug(activeSlug || undefined);
  }, [authChecked, user]);

  if (!authChecked || !user) return <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando acceso...'} />;
  if (!hasAdminAccess(user)) return <NotFound message="No tenes permiso para acceder al panel de administracion." />;

  return (
    <div className="min-h-screen text-text relative overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <AdminLayout>
        <Head>
          <title>Servicios | TuCancha Admin</title>
        </Head>
        <AdminTabServices clubSlug={clubSlug} />
      </AdminLayout>
    </div>
  );
}

