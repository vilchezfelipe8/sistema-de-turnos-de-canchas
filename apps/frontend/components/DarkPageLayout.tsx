import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import NavBar from './NavBar';
import PublicFooter from './PublicFooter';
import ContactPanel from './ContactPanel';
import { ChevronLeft } from 'lucide-react';
import { useUserTheme } from '../contexts/UserThemeContext';
import { useClubApp } from '../hooks/useClubApp';
import ClubAppTabBar from './clubApp/ClubAppTabBar';


// Extra scoped styles for layout internals that can't easily use Tailwind
// (el footer y el panel de contacto son compartidos: sus estilos están en pique.css)
const LAYOUT_CSS = `
  .pique-layout { min-height:100dvh; box-sizing:border-box; display:flex; flex-direction:column; background:var(--bg); color:var(--text-primary); font-family:var(--font-sans); -webkit-font-smoothing:antialiased; overflow-x:hidden; padding-top:64px; }
  .pique-layout *,.pique-layout *::before,.pique-layout *::after { box-sizing:border-box; }
  .pique-layout a { color:inherit; text-decoration:none; }
  .pique-layout ::selection { background:var(--brand); color:var(--brand-on); }
  .pique-layout .p-legal-footer { margin-top:auto; }
  /* App instalada del club: espacio para la barra de pestañas de abajo */
  .pique-layout.pique-layout-clubapp { padding-bottom:calc(84px + env(safe-area-inset-bottom)); }
  .p-breadcrumbs-mobile-back { display:none; }
  @media (max-width: 720px) {
    .p-breadcrumbs-wrap.p-breadcrumbs-shallow { display:none; }
    .p-breadcrumbs-wrap:not(.p-breadcrumbs-shallow) .p-breadcrumbs-cloud { display:none; }
    .p-breadcrumbs-mobile-back { min-height:40px; display:inline-flex; align-items:center; gap:8px; padding:0 4px; color:var(--text-secondary); font-size:13px; font-weight:750; }
    .p-breadcrumbs-mobile-back svg { flex:none; color:var(--accent-fg); }
  }
  /* User menu link/button hover */
  .pique-menu-item { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:var(--r-md); color:var(--text-secondary); font-size:13px; font-weight:600; background:none; border:none; width:100%; cursor:pointer; font-family:var(--font-sans); text-align:left; transition:background .15s,color .15s; }
  .pique-menu-item:hover { background:var(--surface-2); color:var(--text-primary); }
  .pique-menu-item-danger { color:var(--error-fg); }
  .pique-menu-item-danger:hover { background:var(--error-bg); }
`;

interface DarkPageLayoutProps {
  title: string;
  children: React.ReactNode;
  extraCss?: string;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}

export default function DarkPageLayout({ title, children, extraCss = '', breadcrumbs = [] }: DarkPageLayoutProps) {
  const router = useRouter();
  const { isLight } = useUserTheme();
  const mobileBackBreadcrumb = [...breadcrumbs].reverse().find((item, index) => index > 0 && item.href);
  // App instalada del club: sin migas ni footer, con pestañas abajo (salvo en el checkout, para no distraer).
  const clubApp = useClubApp();
  const showClubAppTabBar = Boolean(clubApp) && router.pathname !== '/checkout';

  const [showContact, setShowContact] = useState(false);
  const closeContact = useCallback(() => setShowContact(false), []);

  useEffect(() => {
    router.events.on('routeChangeStart', closeContact);
    return () => router.events.off('routeChangeStart', closeContact);
  }, [router.events, closeContact]);

  return (
    <>
      <Head>
        <title>{title}</title>
        {/* App del club: la franja del sistema (hora, batería) toma el color de la barra de arriba. */}
        {clubApp ? <meta name="theme-color" content={isLight ? '#FFFFFF' : '#161A21'} key="theme-color" /> : null}
      </Head>
      <style dangerouslySetInnerHTML={{ __html: LAYOUT_CSS + (extraCss ? '\n' + extraCss : '') }} />

      <div className={`pique-layout pique-root p-public-root${isLight ? ' p-public-theme-light' : ''}${showClubAppTabBar ? ' pique-layout-clubapp' : ''}`}>
        <NavBar onContactClick={() => setShowContact(true)} onNavbarInteract={closeContact} showContactLink={false} />

        {/* Breadcrumbs */}
        {!clubApp && breadcrumbs.length > 0 && (
          <nav className={`p-breadcrumbs-wrap${breadcrumbs.length <= 2 ? ' p-breadcrumbs-shallow' : ''}`} aria-label="Breadcrumb">
            <div className="p-breadcrumbs">
              <div className="p-breadcrumbs-cloud">
                {breadcrumbs.map((item, index) => {
                  const isLast = index === breadcrumbs.length - 1;
                  return (
                    <div key={`${item.label}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {item.href && !isLast ? (
                        <Link href={item.href} className="p-breadcrumb-link">{item.label}</Link>
                      ) : (
                        <span className="p-breadcrumb-current">{item.label}</span>
                      )}
                      {!isLast && <span className="p-breadcrumb-sep">/</span>}
                    </div>
                  );
                })}
              </div>
              {mobileBackBreadcrumb?.href ? (
                <Link href={mobileBackBreadcrumb.href} className="p-breadcrumbs-mobile-back">
                  <ChevronLeft size={17} strokeWidth={2.5} aria-hidden="true" />
                  {mobileBackBreadcrumb.label}
                </Link>
              ) : null}
            </div>
          </nav>
        )}

        {/* ── PAGE CONTENT ── */}
        {children}

        {/* ── FOOTER ── */}
        {clubApp ? null : <PublicFooter onContactClick={() => setShowContact(true)} />}

        {showClubAppTabBar && clubApp ? <ClubAppTabBar slug={clubApp.slug} /> : null}

        <ContactPanel open={showContact} onClose={closeContact} />
      </div>
    </>
  );
}
