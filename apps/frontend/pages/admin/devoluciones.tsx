import Head from 'next/head';
import AdminLayout from '../../components/AdminLayout';
import NotFound from '../../components/NotFound';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { hasAdminAccess } from '../../utils/session';
import AdminTabRefunds from '../../components/admin/AdminTabRefunds';

export default function AdminRefundsPage() {
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  if (!authChecked || !user) return null;
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
