import Head from 'next/head';
import NotFound from '../components/NotFound';

export default function Custom404() {
  return (
    <>
      <Head>
        <title>Página no encontrada | Pique</title>
      </Head>
      <NotFound title="Página no encontrada" message="La ruta que ingresaste no existe." />
    </>
  );
}
