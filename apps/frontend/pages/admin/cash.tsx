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
      
     

      {/* Aquí renderizamos el tablero que creamos antes */}
      <AdminCashDashboard />
      
    </AdminLayout>
  );
};

export default CashPage;