import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import PiqueLogo from './PiqueLogo';
import NavBar from './NavBar';
import { X, Phone, Mail, Instagram } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useUserTheme } from '../contexts/UserThemeContext';
import { reportUiError } from '../utils/uiError';


// Extra scoped styles for layout internals that can't easily use Tailwind
const LAYOUT_CSS = `
  .pique-layout { min-height:100dvh; box-sizing:border-box; display:flex; flex-direction:column; background:var(--bg); color:var(--text-primary); font-family:var(--font-sans); -webkit-font-smoothing:antialiased; overflow-x:hidden; padding-top:64px; }
  .pique-layout *,.pique-layout *::before,.pique-layout *::after { box-sizing:border-box; }
  .pique-layout a { color:inherit; text-decoration:none; }
  .pique-layout ::selection { background:var(--brand); color:var(--brand-on); }
  .pique-layout .p-footer { margin-top:auto; }
  .p-legal-footer { border-top:1px solid var(--border); background:var(--surface-1); }
  .p-legal-footer-inner { max-width:1360px; margin:0 auto; padding:22px 24px 24px; display:flex; align-items:flex-start; justify-content:space-between; gap:22px; flex-wrap:wrap; }
  .p-legal-footer-brand { display:flex; flex-direction:column; gap:8px; min-width:220px; }
  .p-legal-footer-copy { margin:0; color:var(--text-muted); font-size:12px; line-height:1.6; font-weight:600; max-width:340px; }
  .p-legal-footer-groups { display:flex; align-items:flex-start; justify-content:flex-end; gap:28px; flex-wrap:wrap; }
  .p-legal-footer-group { display:flex; flex-direction:column; gap:10px; min-width:120px; }
  .p-legal-footer-title { margin:0; color:var(--text-muted); font-size:10px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
  .p-legal-footer-links { display:flex; flex-direction:column; gap:8px; }
  .p-legal-footer-link { color:var(--text-primary); font-size:13px; font-weight:700; line-height:1.4; transition:color .15s; }
  .p-legal-footer-link:hover { color:var(--accent-fg); }
  .p-legal-footer-meta { width:100%; padding-top:14px; border-top:1px solid var(--border-subtle); color:var(--text-muted); font-size:11px; font-weight:700; letter-spacing:.02em; }
  @media (max-width: 720px) {
    .p-legal-footer-inner { padding:18px 20px 20px; gap:18px; }
    .p-legal-footer-brand { min-width:0; width:100%; }
    .p-legal-footer-groups { width:100%; justify-content:flex-start; gap:20px; }
    .p-legal-footer-group { min-width:110px; }
    .p-legal-footer-meta { padding-top:12px; }
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
  const { user } = useAuth();
  const { isLight } = useUserTheme();

  const [showContact, setShowContact] = useState(false);
  const [contactMenu, setContactMenu] = useState<{ type: 'whatsapp' | 'email' | 'instagram'; top: number; left: number; href: string; copyText: string } | null>(null);

  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    if (!contactMenu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContactMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContactMenu(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [contactMenu]);

  useEffect(() => {
    const closeTransientPanels = () => {
      setShowContact(false);
      setContactMenu(null);
    };
    router.events.on('routeChangeStart', closeTransientPanels);
    return () => router.events.off('routeChangeStart', closeTransientPanels);
  }, [router.events]);

  const openContactMenu = (e: React.MouseEvent, type: 'whatsapp' | 'email' | 'instagram') => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    let top = rect.height + 8;
    let left = 0;
    if (sidebarRef.current) {
      const sidebarRect = sidebarRef.current.getBoundingClientRect();
      top = rect.bottom - sidebarRect.top + 8;
      left = rect.left - sidebarRect.left;
    }
    const map: Record<string, { href: string; copyText: string }> = {
      whatsapp: { href: 'https://wa.me/5493513436163', copyText: '+54 351 343 6163' },
      email:    { href: 'mailto:soporte.pique@gmail.com', copyText: 'soporte.pique@gmail.com' },
      instagram: { href: 'https://instagram.com/pique.app_', copyText: '@pique.app_' },
    };
    setContactMenu({ type, top: Math.max(top, 10), left: Math.max(left, 10), ...map[type] });
  };

  const handleOpenHref = (href: string) => {
    window.open(href, '_blank', 'noopener,noreferrer');
    setContactMenu(null);
  };

  const handleCopy = async (text: string) => {
    setContactMenu(null);
    try {
      await navigator.clipboard.writeText(text);
      window.dispatchEvent(new CustomEvent('app:notice', { detail: { message: `¡Copiado! ${text}`, tone: 'success' } }));
    } catch {
      reportUiError({ area: 'DarkPageLayout', action: 'copyContact' }, new Error('clipboard error'));
    }
  };

  const handleNavbarInteract = () => {
    setShowContact(false);
    setContactMenu(null);
  };

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <style dangerouslySetInnerHTML={{ __html: LAYOUT_CSS + (extraCss ? '\n' + extraCss : '') }} />

      <div className={`pique-layout pique-root p-public-root${isLight ? ' p-public-theme-light' : ''}`}>
        <NavBar onContactClick={() => setShowContact(true)} onNavbarInteract={handleNavbarInteract} showContactLink={false} />

        {/* Breadcrumbs */}
        {breadcrumbs.length > 0 && (
          <nav className="p-breadcrumbs-wrap" aria-label="Breadcrumb">
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
            </div>
          </nav>
        )}

        {/* ── PAGE CONTENT ── */}
        {children}

        {/* ── FOOTER ── */}
        <footer className="p-legal-footer">
          <div className="p-legal-footer-inner">
            <div className="p-legal-footer-brand">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <PiqueLogo variant={isLight ? 'horizontal' : 'horizontalDark'} style={{ width: 82, height: 'auto', display: 'block' }} />
              </span>
              <p className="p-legal-footer-copy">
                Reservas, identidad y gestión deportiva en un solo lugar.
              </p>
            </div>

            <div className="p-legal-footer-groups">
              <div className="p-legal-footer-group">
                <p className="p-legal-footer-title">Explorar</p>
                <nav className="p-legal-footer-links" aria-label="Explorar Pique">
                  <Link href="/" className="p-legal-footer-link">Inicio</Link>
                  <Link href="/complejos" className="p-legal-footer-link">Complejos</Link>
                </nav>
              </div>

              <div className="p-legal-footer-group">
                <p className="p-legal-footer-title">Legal</p>
                <nav className="p-legal-footer-links" aria-label="Legal">
                  <Link href="/legal/privacy" className="p-legal-footer-link">Privacidad</Link>
                  <Link href="/legal/terms" className="p-legal-footer-link">Términos</Link>
                </nav>
              </div>

              <div className="p-legal-footer-group">
                <p className="p-legal-footer-title">Cuenta</p>
                <nav className="p-legal-footer-links" aria-label="Cuenta">
                  {user ? (
                    <>
                      <Link href="/bookings" className="p-legal-footer-link">Mis reservas</Link>
                      <Link href="/perfil" className="p-legal-footer-link">Mi perfil</Link>
                    </>
                  ) : (
                    <Link href="/login" className="p-legal-footer-link">Ingresar</Link>
                  )}
                </nav>
              </div>
            </div>

            <div className="p-legal-footer-meta">
              © {currentYear} Pique
            </div>
          </div>
        </footer>

        {/* ── CONTACT SIDEBAR OVERLAY ── */}
        <div
          className="p-contact-overlay"
          style={{ opacity: showContact ? 1 : 0, pointerEvents: showContact ? 'auto' : 'none' }}
          onClick={() => setShowContact(false)}
        />
        <div
          className={`p-contact-panel${showContact ? ' p-open' : ''}`}
          style={{
            transform: showContact ? 'translateX(0)' : 'translateX(100%)',
            visibility: showContact ? 'visible' : 'hidden',
            pointerEvents: showContact ? 'auto' : 'none',
          }}
          aria-hidden={!showContact}
        >
          {/* Panel header */}
          <div style={{ padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-fg)', margin: 0 }}>Contacto</h2>
            <button className="p-close-btn" onClick={() => setShowContact(false)} aria-label="Cerrar">
              <X size={15} />
            </button>
          </div>

          <div ref={sidebarRef} style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
              ¿Tenés dudas o querés dar de alta tu club? Escribinos.
            </p>

            {([
              { type: 'whatsapp' as const, label: 'WhatsApp', value: '+54 351 343 6163', icon: <Phone size={16} /> },
              { type: 'email'    as const, label: 'Email',    value: 'soporte.pique@gmail.com', icon: <Mail size={16} /> },
            ]).map(c => (
              <button
                key={c.type}
                type="button"
                onClick={e => openContactMenu(e, c.type)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '12px 14px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)',
                  cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  textAlign: 'left', transition: 'border-color .15s', width: '100%'
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-fg)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--r-md)',
                    background: 'var(--positive-bg)',
                    border: '1px solid var(--accent-border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent-fg)',
                    flexShrink: 0
                  }}
                >
                  {c.icon}
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: 'var(--text-muted)' }}>{c.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{c.value}</div>
                </div>
              </button>
            ))}

            <div style={{ marginTop: 8, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={e => openContactMenu(e, 'instagram')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 10,
                  padding: '9px 14px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)',
                  cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600
                }}
              >
                <Instagram size={15} /> @pique.app_
              </button>
            </div>

            {/* Contact context menu */}
            {contactMenu && (
              <div
                ref={menuRef}
                role="dialog"
                style={{
                  position: 'absolute', top: contactMenu.top, left: contactMenu.left,
                  zIndex: 90,
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)',
                  padding: 6, minWidth: 150,
                  boxShadow: 'var(--shadow-md)'
                }}
              >
                {[
                  { label: 'Abrir', action: () => handleOpenHref(contactMenu.href) },
                  { label: 'Copiar', action: () => handleCopy(contactMenu.copyText) },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={item.action}
                    className="pique-menu-item"
                    style={{ borderRadius: 'var(--r-md)', fontSize: 13 }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </>
  );
}
