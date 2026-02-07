import React from 'react';
import Head from 'next/head';
import AdminLayout from '../../components/AdminLayout'; // Ajustá la ruta si es necesario
import AdminCashDashboard from '../../components/admin/AdminCashDashboard'; // Tu componente nuevo

const CashPage = () => {
  return (
    <AdminLayout>
      <Head>
        <title>Caja | Admin Panel</title>
      </Head>
      
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Gestión de Caja</h1>
        <p className="text-gray-400 text-sm">Control de ingresos, egresos y balance diario.</p>
      </div>

      {/* Aquí renderizamos el tablero que creamos antes */}
      <AdminCashDashboard />
      
    </AdminLayout>
  );
};

export default CashPage;