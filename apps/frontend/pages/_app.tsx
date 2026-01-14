import type { AppProps } from 'next/app';

// IMPORTANTE: Aquí buscamos el archivo en la carpeta styles
import '../styles/globals.css'; 

export default function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}

