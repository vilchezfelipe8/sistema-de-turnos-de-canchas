import { useEffect, useState } from 'react';
import Navbar from '../../components/NavBar';
import AdminLayout from '../../components/AdminLayout';
import NotFound from '../../components/NotFound';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { ClubService, Club } from '../../services/ClubService';
import AdminTabProducts from '../../components/admin/AdminTabProducts';
import Head from 'next/dist/shared/lib/head';

export default function AdminProductsPage() {
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });
  const [club, setClub] = useState<Club | null>(null);

  useEffect(() => {
    if (!authChecked || !user?.clubId) return;
    ClubService.getClubById(user.clubId).then(setClub).catch(() => setClub(null));
  }, [authChecked, user?.clubId]);

  if (!authChecked || !user) return null;
  if (user.role !== 'ADMIN') return <NotFound message="No tenés permiso para acceder al panel de administración." />;

  return (
    <div className="min-h-screen text-text relative overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <Navbar />
      <AdminLayout>
        <Head>
          <title>Productos & Stock | Admin Panel</title>
        </Head>
        <AdminTabProducts clubSlug={club?.slug} />
      </AdminLayout>
    </div>
  );
}
