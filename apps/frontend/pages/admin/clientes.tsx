import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Navbar from '../../components/NavBar';
import ClientsPage from '../../components/ClientsPage'; // Ajustá la ruta si hace falta
import AdminSidebar from '../../components/AdminSidebar';
import { ClubService } from '../../services/ClubService';

const ClientesAdminPage = () => {
  const router = useRouter();
  const { slug } = router.query;
  const [loading, setLoading] = useState(true);

  // Verificación de seguridad rápida
  useEffect(() => {
    if (!router.isReady) return;
    const checkAuth = () => {
       const userStr = localStorage.getItem('user');
       if (!userStr) {
         router.push('/login');
         return;
       }
       // Aquí podrías validar si es admin del club
       setLoading(false);
    };
    checkAuth();
  }, [router.isReady, slug]);

  if (loading) return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Cargando...</div>;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <Navbar />
      <AdminSidebar />
      
      <main className="pt-24 pl-0 md:pl-64 pr-4 pb-4 container mx-auto transition-all duration-300">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6 flex items-center justify-between">
            <div>
               <h1 className="text-2xl font-bold text-white tracking-tight">Gestión de Clientes</h1>
               <p className="text-gray-400 text-sm mt-1">Base de datos de personas que han reservado.</p>
            </div>
          </div>

          {/* Aquí cargamos tu componente de Clientes */}
          <ClientsPage />
        </div>
      </main>
    </div>
  );
};

export default ClientesAdminPage;