import type { AppProps } from 'next/app';
import Head from 'next/head';

// IMPORTANTE: Aquí buscamos el archivo en la carpeta styles
import '../styles/globals.css'; 

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || '';
const LOGO_PATH = '/logo1.svg';
const LOGO_URL = SITE_URL ? `${SITE_URL.replace(/\/+$/,'')}${LOGO_PATH}` : LOGO_PATH;

export default function MyApp({ Component, pageProps }: AppProps) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "TuCancha App",
    "url": SITE_URL || undefined,
    "logo": LOGO_URL
  };

  return (
    <>
      <Head>
        <link rel="icon" href="/Vector.svg" type="image/svg+xml" />
        <link rel="manifest" href="/site.webmanifest" />
        <link rel="apple-touch-icon" href={LOGO_PATH} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="TuCancha App" />
        <meta property="og:title" content="TuCancha App" />
        <meta property="og:description" content="Reserva canchas y gestiona turnos fácilmente." />
        <meta property="og:image" content={LOGO_URL} />
        <meta property="og:image:width" content="512" />
        <meta property="og:image:height" content="512" />
        <meta name="twitter:image" content={LOGO_URL} />
        <meta name="theme-color" content="#ffffff" />
        <script
          type="application/ld+json"
          // JSON-LD must be a string
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </Head>
      <Component {...pageProps} />
      {/* Portal para react-datepicker - renderiza fuera del stacking context */}
      <div id="datepicker-portal" />
    </>
  );
}

