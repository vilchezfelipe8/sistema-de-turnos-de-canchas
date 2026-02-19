import { useEffect } from 'react';
import { useRouter } from 'next/router';
import NotFound from '../../components/NotFound';
import { useValidateAuth } from '../../hooks/useValidateAuth';

export default function AdminIndex() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  useEffect(() => {
    if (!authChecked || !user) return;
    if (user.role !== 'ADMIN') return;
    router.replace('/admin/agenda');
  }, [authChecked, user, router]);

  if (!authChecked || !user) return null;
  if (user.role !== 'ADMIN') return <NotFound message="No tenés permiso para acceder al panel de administración." />;
  return null;
}
