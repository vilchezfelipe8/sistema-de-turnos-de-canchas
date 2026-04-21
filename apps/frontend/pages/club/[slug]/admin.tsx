import Head from 'next/head';
import NotFound from '../../../components/NotFound';

/**
 * Ruta obsoleta: el panel esta en /admin/agenda, /admin/canchas, etc.
 */
export default function ClubAdmin404() {
  return (
    <>
      <Head>
        <title>Ruta obsoleta | TuCancha</title>
      </Head>
      <NotFound message="Esta ruta ya no existe. Usa Inicio -> Gestion para ir al panel." />
    </>
  );
}
