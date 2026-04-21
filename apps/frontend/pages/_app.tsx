import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';
import Router from 'next/router';
import { ActiveClubProvider } from '../contexts/ActiveClubContext';
import { AuthProvider } from '../contexts/AuthContext';
import { AUTH_LOGOUT_EVENT, clearPendingLogoutRedirect, type AuthLogoutEventDetail } from '../services/AuthService';
import { isAuthSessionInvalidatedError } from '../utils/apiClient';

// IMPORTANTE: Aqui buscamos el archivo en la carpeta styles
import '../styles/globals.css'; 

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || '';
const LOGO_PATH = '/logo1.svg';
const LOGO_URL = SITE_URL ? `${SITE_URL.replace(/\/+$/,'')}${LOGO_PATH}` : LOGO_PATH;
export const APP_NOTICE_EVENT = 'app:notice';
const PENDING_APP_NOTICE_STORAGE_KEY = 'app:notice:pending';
const LOGOUT_NOTICE_COOLDOWN_MS = 6000;
type AppNotice = {
  id: number;
  message: string;
  phase: 'entering' | 'visible' | 'leaving';
};

export default function MyApp({ Component, pageProps }: AppProps) {
  const [notices, setNotices] = useState<AppNotice[]>([]);
  const noticeIdRef = useRef(1);
  const noticeTimeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const lastLogoutNoticeAtRef = useRef(0);

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
    const consumePendingNotice = () => {
      if (typeof window === 'undefined') return null;
      const raw = sessionStorage.getItem(PENDING_APP_NOTICE_STORAGE_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(PENDING_APP_NOTICE_STORAGE_KEY);
      try {
        const parsed = JSON.parse(raw) as { message?: unknown; ts?: unknown };
        const message = String(parsed?.message || '').trim();
        const ts = Number(parsed?.ts || 0);
        if (!message) return null;
        if (!Number.isFinite(ts) || Date.now() - ts > 15000) return null;
        return message;
      } catch {
        return null;
      }
    };

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
      const now = Date.now();
      // Evita toasts duplicados cuando varias requests disparan logout casi al mismo tiempo.
      if (now - lastLogoutNoticeAtRef.current > LOGOUT_NOTICE_COOLDOWN_MS) {
        if (redirectTo) {
          // Solo persistimos cuando hay navegacion para mostrarlo en destino.
          sessionStorage.setItem(
            PENDING_APP_NOTICE_STORAGE_KEY,
            JSON.stringify({ message: 'Sesion cerrada correctamente.', ts: now })
          );
        } else {
          // Sin navegacion, mostrar una vez y no persistir para evitar duplicados.
          showNotice('Sesion cerrada correctamente.');
        }
        lastLogoutNoticeAtRef.current = now;
      }
      // La navegacion post-logout la orquesta AuthService.logout().
      // _app solo mantiene feedback UI y limpieza minima.
      if (!redirectTo) {
        sessionStorage.removeItem(PENDING_APP_NOTICE_STORAGE_KEY);
        clearPendingLogoutRedirect();
      }
    };
    const handleAppNotice = (event: Event) => {
      const custom = event as CustomEvent<{ message?: string }>;
      const message = String(custom?.detail?.message || '').trim();
      if (!message) return;
      showNotice(message);
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (isAuthSessionInvalidatedError(reason)) {
        event.preventDefault();
        return;
      }
      const message = String((reason as any)?.message || reason || '').toUpperCase();
      if (
        message.includes('AUTH_MISSING') ||
        message.includes('AUTH_INVALID') ||
        message.includes('AUTH_EXPIRED') ||
        message.includes('AUTH_REVOKED')
      ) {
        event.preventDefault();
      }
    };

    window.addEventListener(AUTH_LOGOUT_EVENT, handleLogout);
    window.addEventListener(APP_NOTICE_EVENT, handleAppNotice as EventListener);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    const consumeAndShowPendingNotice = () => {
      const pending = consumePendingNotice();
      if (pending) showNotice(pending);
    };
    consumeAndShowPendingNotice();
    Router.events.on('routeChangeComplete', consumeAndShowPendingNotice);

    return () => {
      window.removeEventListener(AUTH_LOGOUT_EVENT, handleLogout);
      window.removeEventListener(APP_NOTICE_EVENT, handleAppNotice as EventListener);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      Router.events.off('routeChangeComplete', consumeAndShowPendingNotice);
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
        <meta property="og:description" content="Reserva canchas y gestiona turnos facilmente." />
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
        <AuthProvider>
          <div className="density-compact">
            <Component {...pageProps} />
          </div>
        </AuthProvider>
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
