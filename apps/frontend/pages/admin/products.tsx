import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import AdminTabProducts from '../../components/admin/AdminTabProducts';
import Head from 'next/head';
import { getActiveClubSlug, hasAdminAccess, normalizeSessionUser } from '../../utils/session';

export default function AdminProductsPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });
  const [clubSlug, setClubSlug] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin/products')}`);
  }, [authChecked, user, router]);

  useEffect(() => {
    if (!authChecked || !user) return;
    const normalizedUser = normalizeSessionUser(user as any);
    const activeSlug = getActiveClubSlug(normalizedUser);
    setClubSlug(activeSlug || undefined);
  }, [authChecked, user]);

  if (!authChecked || !user) return <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando acceso...'} />;
  if (!hasAdminAccess(user)) return <NotFound message="No tenés permiso para acceder al panel de administración." />;

  return (
    <div className="min-h-screen text-text relative overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <AdminLayout>
        <Head>
          <title>Productos y Stock | TuCancha Admin</title>
        </Head>
        <AdminTabProducts clubSlug={clubSlug} />
      </AdminLayout>
    </div>
  );
}

