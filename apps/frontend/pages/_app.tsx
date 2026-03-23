import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useEffect, useState } from 'react';
import { ActiveClubProvider } from '../contexts/ActiveClubContext';
import { AUTH_LOGOUT_EVENT } from '../services/AuthService';

// IMPORTANTE: Aquí buscamos el archivo en la carpeta styles
import '../styles/globals.css'; 

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || '';
const LOGO_PATH = '/logo1.svg';
const LOGO_URL = SITE_URL ? `${SITE_URL.replace(/\/+$/,'')}${LOGO_PATH}` : LOGO_PATH;

export default function MyApp({ Component, pageProps }: AppProps) {
  const [showLogoutNotice, setShowLogoutNotice] = useState(false);

  useEffect(() => {
    const preventNumberInputWheel = (event: WheelEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.type !== 'number') return;
      if (document.activeElement !== target) return;
      event.preventDefault();
    };

    window.addEventListener('wheel', preventNumberInputWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', preventNumberInputWheel);
    };
  }, []);

  useEffect(() => {
    let hideTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleLogout = () => {
      setShowLogoutNotice(true);
      if (hideTimeout) {
        clearTimeout(hideTimeout);
      }
      hideTimeout = setTimeout(() => {
        setShowLogoutNotice(false);
      }, 2600);
    };

    window.addEventListener(AUTH_LOGOUT_EVENT, handleLogout);
    return () => {
      window.removeEventListener(AUTH_LOGOUT_EVENT, handleLogout);
      if (hideTimeout) {
        clearTimeout(hideTimeout);
      }
    };
  }, []);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "TuCancha",
    "url": SITE_URL || undefined,
    "logo": LOGO_URL
  };

  return (
    <>
      <Head>
        <title>TuCancha</title>
        <link rel="icon" href="/Vector.svg" type="image/svg+xml" />
        <link rel="manifest" href="/site.webmanifest" />
        <link rel="apple-touch-icon" href={LOGO_PATH} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="TuCancha" />
        <meta property="og:title" content="TuCancha" />
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
      <ActiveClubProvider>
        <Component {...pageProps} />
      </ActiveClubProvider>
      {showLogoutNotice && (
        <div className="fixed bottom-5 left-1/2 z-[100000] -translate-x-1/2 rounded-xl border border-[#347048]/20 bg-[#EBE1D8] px-4 py-3 text-sm font-bold text-[#347048] shadow-xl">
          Sesion cerrada correctamente.
        </div>
      )}
      {/* Portal para react-datepicker - renderiza fuera del stacking context */}
      <div id="datepicker-portal" />
    </>
  );
}

