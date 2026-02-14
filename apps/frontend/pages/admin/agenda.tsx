import AdminLayout from '../../components/AdminLayout';
import NotFound from '../../components/NotFound';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import AdminTabBookings from '../../components/admin/AdminTabBookings';
import Head from 'next/dist/shared/lib/head';

export default function AdminAgendaPage() {
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  if (!authChecked || !user) return null;
  if (user.role !== 'ADMIN') return <NotFound message="No tenés permiso para acceder al panel de administración." />;

  return (
    <div className="min-h-screen text-text relative overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <AdminLayout>
        <Head>
          <title>Turnos | Admin Panel</title>
        </Head>
        <AdminTabBookings />
      </AdminLayout>
    </div>
  );
}
