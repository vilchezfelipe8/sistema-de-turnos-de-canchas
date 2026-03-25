import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';
import Router from 'next/router';
import { ActiveClubProvider } from '../contexts/ActiveClubContext';
import { AUTH_LOGOUT_EVENT, clearPendingLogoutRedirect, type AuthLogoutEventDetail } from '../services/AuthService';

// IMPORTANTE: Aquí buscamos el archivo en la carpeta styles
import '../styles/globals.css'; 

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || '';
const LOGO_PATH = '/logo1.svg';
const LOGO_URL = SITE_URL ? `${SITE_URL.replace(/\/+$/,'')}${LOGO_PATH}` : LOGO_PATH;
export const APP_NOTICE_EVENT = 'app:notice';
type AppNotice = {
  id: number;
  message: string;
  phase: 'entering' | 'visible' | 'leaving';
};

export default function MyApp({ Component, pageProps }: AppProps) {
  const [notices, setNotices] = useState<AppNotice[]>([]);
  const noticeIdRef = useRef(1);
  const noticeTimeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

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
    const scheduleTimeout = (fn: () => void, delay: number) => {
      const timeout = setTimeout(fn, delay);
      noticeTimeoutsRef.current.push(timeout);
    };

    const showNotice = (message: string) => {
      const id = noticeIdRef.current++;
      setNotices((prev) => [...prev, { id, message, phase: 'entering' }]);

      scheduleTimeout(() => {
        setNotices((prev) => prev.map((notice) => (notice.id === id ? { ...notice, phase: 'visible' } : notice)));
      }, 24);

      scheduleTimeout(() => {
        setNotices((prev) => prev.map((notice) => (notice.id === id ? { ...notice, phase: 'leaving' } : notice)));
      }, 1400);

      scheduleTimeout(() => {
        setNotices((prev) => prev.filter((notice) => notice.id !== id));
      }, 1720);
    };

    const handleLogout = (event: Event) => {
      const custom = event as CustomEvent<AuthLogoutEventDetail>;
      const redirectTo = String(custom?.detail?.redirectTo || '').trim();
      showNotice('Sesion cerrada correctamente.');
      if (redirectTo) {
        void Router.replace(redirectTo).finally(() => {
          clearPendingLogoutRedirect();
        });
        return;
      }
      clearPendingLogoutRedirect();
    };
    const handleAppNotice = (event: Event) => {
      const custom = event as CustomEvent<{ message?: string }>;
      const message = String(custom?.detail?.message || '').trim();
      if (!message) return;
      showNotice(message);
    };

    window.addEventListener(AUTH_LOGOUT_EVENT, handleLogout);
    window.addEventListener(APP_NOTICE_EVENT, handleAppNotice as EventListener);
    return () => {
      window.removeEventListener(AUTH_LOGOUT_EVENT, handleLogout);
      window.removeEventListener(APP_NOTICE_EVENT, handleAppNotice as EventListener);
      noticeTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      noticeTimeoutsRef.current = [];
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
      {notices.length > 0 && (
        <div className="fixed bottom-5 left-1/2 z-[100000] -translate-x-1/2 pointer-events-none">
          {[...notices].slice(-3).reverse().map((notice, index) => {
            const depth = Math.min(index, 2);
            const baseOffsetY = depth * -9;
            const phaseOffsetY = notice.phase === 'visible' ? 0 : 20;
            const scale = 1 - depth * 0.025;
            const opacity = notice.phase === 'visible' ? 1 : 0;
            return (
              <div
                key={notice.id}
                className="absolute left-1/2 w-max max-w-[92vw] rounded-xl border border-[#347048]/20 bg-[#EBE1D8] px-4 py-3 text-sm font-bold text-[#347048] shadow-xl transition-all duration-300"
                style={{
                  bottom: 0,
                  zIndex: 100 - depth,
                  opacity,
                  transform: `translate(-50%, ${baseOffsetY + phaseOffsetY}px) scale(${scale})`
                }}
              >
                {notice.message}
              </div>
            );
          })}
        </div>
      )}
      {/* Portal para react-datepicker - renderiza fuera del stacking context */}
      <div id="datepicker-portal" />
    </>
  );
}
