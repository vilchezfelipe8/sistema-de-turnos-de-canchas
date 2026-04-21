import React from 'react';
// Asegurate de que la ruta de importación sea correcta
import AdminLayout from '../../components/AdminLayout';
import AdminDevDashboard from '../../components/admin/AdminDevDashboard';
import Head from 'next/head';

const MetricsPage = () => {
  return (
    <AdminLayout>
      <Head>
          <title>Metricas | TuCancha Admin</title>
        </Head>
      <div className="p-6">
        {/* Título de la sección */}
        <div className="mb-6">
          {/* 👇 CAMBIO AQUÍ: Le puse text-white para que se vea bien blanco */}
          <h1 className="text-2xl font-bold text-white">Panel de Monitoreo</h1>
          
          {/* Opcional: Aclaré un poco el subtítulo también para que acompañe */}
          <p className="text-gray-400 text-sm">Estado del servidor en tiempo real</p>
        </div>

        {/* Tu componente de métricas */}
        <AdminDevDashboard />
      </div>
    </AdminLayout>
  );
};

export const getServerSideProps = async () => {
  if (process.env.NODE_ENV === 'production') {
    return { notFound: true };
  }
  return { props: {} };
};

export default MetricsPage;
