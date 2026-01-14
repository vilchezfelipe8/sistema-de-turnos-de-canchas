import type { AppProps } from 'next/app';
import Head from 'next/head';

// IMPORTANTE: Aquí buscamos el archivo en la carpeta styles
import '../styles/globals.css'; 

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <link rel="icon" href="/Vector.svg" type="image/svg+xml" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}

