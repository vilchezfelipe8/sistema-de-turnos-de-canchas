import Head from 'next/head';
import AdminDevDashboard from '../../components/admin/AdminDevDashboard';

const MetricsPage = () => {
  return (
    <>
      <Head>
        <title>Metricas | Pique Admin</title>
      </Head>
      <div className="min-h-screen bg-p-bg p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-p-text">Panel de Monitoreo</h1>
          <p className="text-p-text-muted text-sm">Estado del servidor en tiempo real</p>
        </div>
        <AdminDevDashboard />
      </div>
    </>
  );
};

export const getServerSideProps = async () => {
  if (process.env.NODE_ENV === 'production') {
    return { notFound: true };
  }
  return { props: {} };
};

export default MetricsPage;
