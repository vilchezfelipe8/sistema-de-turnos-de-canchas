import { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import NotFound from '../NotFound';
import RouteTransitionScreen from '../RouteTransitionScreen';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { getActiveClubSlug, hasAdminAccess, hasOperatorAccess } from '../../utils/session';
import AdminPlaygroundShell from './AdminPlaygroundShell';
import { CLUB_LOCKED_SIDEBAR_ITEMS } from './playgroundNavigation';

type AdminRouteShellProps = {
  title: string;
  activeItem: string;
  fromPath: string;
  requiredAccess?: 'admin' | 'operator';
  children: ReactNode | ((user: any) => ReactNode);
};

export default function AdminRouteShell({
  title,
  activeItem,
  fromPath,
  requiredAccess = 'admin',
  children,
}: AdminRouteShellProps) {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });
  const isLockedForActiveClub = Boolean(
    user && CLUB_LOCKED_SIDEBAR_ITEMS[getActiveClubSlug(user) || '']?.has(activeItem)
  );

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || fromPath)}`);
  }, [authChecked, fromPath, router, user]);

  useEffect(() => {
    if (!authChecked || !isLockedForActiveClub) return;
    void router.replace('/admin/agenda');
  }, [authChecked, isLockedForActiveClub, router]);

  if (!authChecked || !user || isLockedForActiveClub) {
    return (
      <>
        <Head>
          <title>{title}</title>
        </Head>
        <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando acceso...'} />
      </>
    );
  }

  const canAccess = requiredAccess === 'operator' ? hasOperatorAccess(user) : hasAdminAccess(user);

  if (!canAccess) {
    return <NotFound message="No tenes permiso para acceder al panel de administracion." />;
  }

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <AdminPlaygroundShell activeItem={activeItem} user={user}>
        {typeof children === 'function' ? children(user) : children}
      </AdminPlaygroundShell>
    </>
  );
}
