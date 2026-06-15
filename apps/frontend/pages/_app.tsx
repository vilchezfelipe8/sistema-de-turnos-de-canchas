import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';
import Router from 'next/router';
import { ActiveClubProvider } from '../contexts/ActiveClubContext';
import { AuthProvider } from '../contexts/AuthContext';
import { UserThemeProvider, useUserTheme } from '../contexts/UserThemeContext';
import { AUTH_LOGOUT_EVENT, clearPendingLogoutRedirect, type AuthLogoutEventDetail } from '../services/AuthService';
import { isAuthSessionInvalidatedError } from '../utils/apiClient';

import '../styles/globals.css';
import '../styles/playground.css';
import '../styles/pique.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || '';
const LOGO_PATH = '/brand/pique-logo-horizontal.svg';
const MARK_PATH = '/brand/pique-isotipo.svg';
const APPLE_ICON_PATH = '/favicon-192.png';
const LOGO_URL = SITE_URL ? `${SITE_URL.replace(/\/+$/,'')}${LOGO_PATH}` : LOGO_PATH;
const OG_IMAGE_PATH = '/og-1200x630.png';
const OG_IMAGE_URL = SITE_URL ? `${SITE_URL.replace(/\/+$/,'')}${OG_IMAGE_PATH}` : OG_IMAGE_PATH;
export const APP_NOTICE_EVENT = 'app:notice';
const PENDING_APP_NOTICE_STORAGE_KEY = 'app:notice:pending';
const LOGOUT_NOTICE_COOLDOWN_MS = 6000;
type NoticeTone = 'success' | 'error' | 'info' | 'warning';
type AppNoticePayload = {
  message?: string;
  tone?: NoticeTone;
};

type NoticeWithPhase = {
  id: number;
  message: string;
  tone: NoticeTone;
  phase: 'entering' | 'visible' | 'leaving';
};

const NOTICE_TONES: Record<NoticeTone, { border: string; text: string; dot: string; glow: string }> = {
  success: {
    border: 'var(--accent-border-strong)',
    text: 'var(--positive-fg)',
    dot: 'var(--brand)',
    glow: 'var(--accent-bg-muted)'
  },
  error: {
    border: 'var(--danger-border)',
    text: 'var(--error-fg)',
    dot: 'var(--error-fg)',
    glow: 'var(--error-bg)'
  },
  warning: {
    border: 'var(--warn-fg)',
    text: 'var(--warn-fg)',
    dot: 'var(--warn-fg)',
    glow: 'var(--warn-bg)'
  },
  info: {
    border: 'var(--border-strong)',
    text: 'var(--info-fg)',
    dot: 'var(--info-fg)',
    glow: 'var(--info-bg)'
  }
};

function AppNoticeViewport({ notices }: { notices: NoticeWithPhase[] }) {
  const { isLight } = useUserTheme();
  if (notices.length === 0) return null;

  return (
    <div className="fixed bottom-5 left-1/2 z-[2147483600] -translate-x-1/2 pointer-events-none">
      {[...notices].slice(-3).reverse().map((notice, index) => {
        const depth = Math.min(index, 2);
        const baseOffsetY = depth * -9;
        const phaseOffsetY = notice.phase === 'visible' ? 0 : 20;
        const scale = 1 - depth * 0.025;
        const opacity = notice.phase === 'visible' ? 1 : 0;
        const toneStyle = NOTICE_TONES[notice.tone];
        return (
          <div
            key={notice.id}
            className="absolute left-1/2 w-max max-w-[92vw] rounded-2xl border px-4 py-3 text-sm font-semibold shadow-xl backdrop-blur-md transition-all duration-300"
            style={{
              bottom: 0,
              zIndex: 100 - depth,
              opacity,
              transform: `translate(-50%, ${baseOffsetY + phaseOffsetY}px) scale(${scale})`,
              background: 'linear-gradient(145deg, var(--surface-1), var(--surface-2))',
              borderColor: toneStyle.border,
              color: isLight ? 'var(--text-primary)' : toneStyle.text,
              boxShadow: `var(--shadow-lg), 0 0 0 1px ${toneStyle.glow} inset`
            }}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: toneStyle.dot, boxShadow: `0 0 12px ${toneStyle.dot}` }}
              />
              <span>{notice.message}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function MyApp({ Component, pageProps }: AppProps) {
  const [notices, setNotices] = useState<NoticeWithPhase[]>([]);
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
        const parsed = JSON.parse(raw) as { message?: unknown; ts?: unknown; tone?: unknown };
        const message = String(parsed?.message || '').trim();
        const ts = Number(parsed?.ts || 0);
        const tone = String(parsed?.tone || '').trim().toLowerCase();
        if (!message) return null;
        if (!Number.isFinite(ts) || Date.now() - ts > 15000) return null;
        return {
          message,
          tone: tone === 'success' || tone === 'error' || tone === 'info' || tone === 'warning'
            ? tone as NoticeTone
            : 'info' as NoticeTone
        };
      } catch {
        return null;
      }
    };

    const scheduleTimeout = (fn: () => void, delay: number) => {
      const timeout = setTimeout(fn, delay);
      noticeTimeoutsRef.current.push(timeout);
    };

    const showNotice = (message: string, tone: NoticeTone = 'info') => {
      const id = noticeIdRef.current++;
      setNotices((prev) => [...prev, { id, message, tone, phase: 'entering' }]);

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
      const reason = String(custom?.detail?.reason || 'manual').trim();
      const message =
        reason === 'manual'
          ? 'Sesión cerrada correctamente.'
          : 'Tu sesión expiró. Iniciá sesión nuevamente.';
      const now = Date.now();
      // Evita toasts duplicados cuando varias requests disparan logout casi al mismo tiempo.
      if (now - lastLogoutNoticeAtRef.current > LOGOUT_NOTICE_COOLDOWN_MS) {
        if (redirectTo) {
          // Solo persistimos cuando hay navegacion para mostrarlo en destino.
          sessionStorage.setItem(
            PENDING_APP_NOTICE_STORAGE_KEY,
            JSON.stringify({ message, tone: reason === 'manual' ? 'success' : 'warning', ts: now })
          );
        } else {
          // Sin navegacion, mostrar una vez y no persistir para evitar duplicados.
          showNotice(message, reason === 'manual' ? 'success' : 'warning');
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
      const custom = event as CustomEvent<AppNoticePayload>;
      const message = String(custom?.detail?.message || '').trim();
      if (!message) return;
      const tone = custom?.detail?.tone;
      const safeTone = tone === 'success' || tone === 'error' || tone === 'warning' || tone === 'info' ? tone : 'info';
      showNotice(message, safeTone);
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
      if (pending) showNotice(pending.message, pending.tone);
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
    "name": "Pique",
    "url": SITE_URL || undefined,
    "logo": LOGO_URL
  };

  return (
    <>
      <Head>
        <title>Pique</title>
        <link rel="icon" href={MARK_PATH} type="image/svg+xml" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="manifest" href="/site.webmanifest" />
        <link rel="apple-touch-icon" href={APPLE_ICON_PATH} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Pique" />
        <meta property="og:title" content="Pique" />
        <meta property="og:description" content="Reserva canchas y gestiona turnos fácilmente." />
        <meta property="og:image" content={OG_IMAGE_URL} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:image" content={OG_IMAGE_URL} />
        <meta name="theme-color" content="#B6F36A" />
        <script
          type="application/ld+json"
          // JSON-LD must be a string
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </Head>
      <ActiveClubProvider>
        <AuthProvider>
          <UserThemeProvider>
            <Component {...pageProps} />
            <AppNoticeViewport notices={notices} />
          </UserThemeProvider>
        </AuthProvider>
      </ActiveClubProvider>
      {/* Portal para react-datepicker - renderiza fuera del stacking context */}
      <div id="datepicker-portal" />
    </>
  );
}
