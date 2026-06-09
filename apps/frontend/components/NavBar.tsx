import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Calendar, LogOut, MapPin, Moon, ShieldCheck, Sun, User, Users } from 'lucide-react';
import { logout } from '../services/AuthService';
import { getMyBookings } from '../services/BookingService';
import { useAuth } from '../contexts/AuthContext';
import { useUserTheme } from '../contexts/UserThemeContext';
import { getActiveClubSlug, getLastClubSlug, hasOperatorAccess, normalizeSessionUser } from '../utils/session';
import { reportUiError } from '../utils/uiError';
import { isAuthSessionInvalidatedError } from '../utils/apiClient';
import AppModal from './AppModal';
import PiqueLogo from './PiqueLogo';

interface NavbarProps {
  onContactClick?: () => void;
  onNavbarInteract?: () => void;
  hideOnScroll?: boolean;
  showContactLink?: boolean;
  showHomeShortcuts?: boolean;
}

const HOME_SHORTCUTS = [
  { id: 'deportes', label: 'Deportes' },
  { id: 'por-que-pique', label: 'Por qué Pique' },
  { id: 'para-complejos', label: 'Para complejos' },
  { id: 'faq', label: 'FAQ' },
] as const;

const countActiveBookings = (rows: any[]): number => {
  const now = Date.now();
  return rows.filter((booking: any) => {
    const status = String(booking?.status || '').toUpperCase();
    if (status === 'CANCELLED' || status === 'COMPLETED') return false;
    const endValue = booking?.endDateTime || booking?.startDateTime;
    const endTs = new Date(endValue).getTime();
    if (!Number.isFinite(endTs)) return true;
    return endTs >= now;
  }).length;
};

const NAV_CSS = `
  .p-player-nav {
    position:fixed;
    top:0;
    left:0;
    right:0;
    z-index:10000;
    background:var(--surface-1);
    border-bottom:1px solid var(--border);
    box-shadow:0 10px 28px var(--border-subtle);
    backdrop-filter:blur(16px);
    -webkit-backdrop-filter:blur(16px);
    transform:translateY(0);
    transition:transform .38s cubic-bezier(.4,0,.2,1);
  }
  .p-player-nav.p-header-hidden { transform:translateY(-110%); }
  .p-player-nav .p-header-inner {
    max-width:1360px;
    margin:0 auto;
    padding:0 24px;
    min-height:68px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:16px;
    position:relative;
  }
  .p-player-brand { display:flex; align-items:center; gap:10px; min-width:0; }
  .p-player-shortcuts-wrap { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); display:flex; justify-content:center; pointer-events:none; z-index:1; }
  .p-player-shortcuts { display:flex; align-items:center; gap:6px; min-width:0; justify-content:center; pointer-events:auto; }
  .p-player-shortcut { display:inline-flex; align-items:center; justify-content:center; min-height:34px; padding:8px 12px; border-radius:999px; color:var(--text-muted); font-family:var(--font-sans); font-size:12px; font-weight:700; letter-spacing:.01em; text-decoration:none; background:transparent; border:1px solid transparent; cursor:pointer; transition:background .15s,border-color .15s,color .15s; white-space:nowrap; }
  .p-player-shortcut:hover { background:var(--surface-2); border-color:var(--border); color:var(--text-primary); }
  .p-player-shortcut.p-player-shortcut-active { background:var(--surface-2); border-color:var(--accent-border-subtle); color:var(--text-primary); }
  .p-player-actions { display:flex; align-items:center; gap:8px; position:relative; }
  .p-player-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:38px; padding:8px 14px; border-radius:var(--r-pill); border:1px solid var(--border); background:var(--surface-1); color:var(--text-primary); font-family:var(--font-sans); font-size:12px; font-weight:800; letter-spacing:.01em; cursor:pointer; text-decoration:none; transition:background .15s,border-color .15s,transform .15s; }
  .p-player-btn:hover { background:var(--surface-2); border-color:var(--border-strong); transform:translateY(-1px); }
  .p-player-btn-accent { background:var(--brand); color:var(--brand-on); border-color:var(--accent-border); text-shadow:none; box-shadow:none; }
  .p-player-btn-accent:hover { background:var(--brand-hover); border-color:var(--accent-border-strong); color:var(--brand-on); }
  .p-player-btn-accent span { color:var(--brand-on); }
  .p-player-btn-accent:hover span { color:var(--brand-on); }
  .p-player-theme { width:38px; padding-inline:0; flex-shrink:0; }
  .p-player-theme svg { width:14px; height:14px; }
  .p-player-login { white-space:nowrap; line-height:1; min-height:40px; padding:11px 16px; font-size:12px; font-weight:800; letter-spacing:.01em; color:var(--brand-on); min-width:104px; }
  .p-player-menu-meta { padding:18px 18px 16px; text-align:center; border-bottom:1px solid var(--border); }
  .p-player-menu-role { margin-top:4px; color:var(--text-muted); font-size:10px; font-weight:700; letter-spacing:.03em; }
  .p-player-menu-body { padding:8px; display:flex; flex-direction:column; gap:4px; }
  .p-player-menu-badge { display:inline-flex; align-items:center; justify-content:center; min-width:22px; height:22px; padding:0 7px; border-radius:var(--r-pill); background:var(--brand); color:var(--brand-on); font-size:10px; font-weight:900; }
  .p-player-avatar-badge { position:absolute; top:-6px; right:-9px; min-width:20px; height:20px; padding:0 6px; border-radius:999px; border:2px solid var(--surface-1); box-shadow:0 4px 12px var(--border-subtle); font-size:10px; font-weight:900; line-height:1; }
  .p-player-user-name { font-size:13px; font-weight:700; color:var(--text-primary); max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .p-player-user-btn { display:flex; align-items:center; gap:10px; min-height:40px; padding:4px 13px 4px 4px; border:1px solid var(--border); border-radius:var(--r-pill); background:var(--surface-2); color:var(--text-primary); font-family:var(--font-sans); cursor:pointer; transition:background .15s,border-color .15s; }
  .p-player-user-btn:hover { background:var(--surface-3); border-color:var(--border-strong); }
  .p-player-avatar { width:34px; height:34px; border-radius:50%; background:var(--brand); color:var(--brand-on); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900; position:relative; flex-shrink:0; }
  .p-player-menu { position:absolute; right:0; top:calc(100% + 10px); width:260px; background:var(--surface-1); border:1px solid var(--border); border-radius:var(--r-xl); overflow:hidden; box-shadow:var(--shadow-lg); z-index:120; }
  .p-player-menu-item { display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; padding:10px 12px; border:0; border-radius:var(--r-md); background:transparent; color:var(--text-secondary); font-family:var(--font-sans); font-size:13px; font-weight:700; text-align:left; text-decoration:none; cursor:pointer; transition:background .15s,color .15s; }
  .p-player-menu-item:hover { background:var(--surface-2); color:var(--text-primary); }
  .p-player-menu-item-main { display:inline-flex; align-items:center; gap:10px; min-width:0; }
  .p-player-menu-danger { color:var(--error-fg); }
  .p-player-menu-danger:hover { background:var(--error-bg); color:var(--error-fg); }
  @media(max-width:760px){
    .p-player-nav .p-header-inner { padding-inline:16px; }
    .p-player-shortcuts-wrap { display:none; }
    .p-player-contact { display:none; }
    .p-player-user-name { display:none; }
    .p-player-user-btn { gap:0; padding:3px; min-height:40px; }
    .p-player-login { min-width:96px; padding-inline:14px; font-size:11px; letter-spacing:.04em; }
  }
  @media(max-width:1080px){
    .p-player-shortcuts { gap:2px; }
    .p-player-shortcut { padding-inline:10px; font-size:11px; }
  }
  @media(max-width:1200px){
    .p-player-shortcuts-wrap { display:none; }
  }
`;

export default function Navbar({
  onContactClick,
  onNavbarInteract,
  hideOnScroll = true,
  showContactLink = false,
  showHomeShortcuts = false,
}: NavbarProps) {
  const router = useRouter();
  const { user: rawUser } = useAuth();
  const { isLight, toggleTheme } = useUserTheme();
  const user = rawUser ? normalizeSessionUser(rawUser as any) : null;
  const isAdmin = user ? hasOperatorAccess(user) : false;
  const [navHidden, setNavHidden] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [activeBookingsCount, setActiveBookingsCount] = useState(0);
  const navRef = useRef<HTMLElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const userButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!hideOnScroll) return;
    let lastY = window.scrollY;
    const movementThreshold = 4;
    const handleScroll = () => {
      const y = window.scrollY;
      const delta = Math.abs(y - lastY);
      if (y < 80) {
        if (delta >= movementThreshold) setShowUserMenu(false);
        setNavHidden(false);
        lastY = y;
        return;
      }
      if (delta < movementThreshold) return;
      setShowUserMenu(false);
      setNavHidden(y > lastY);
      lastY = y;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [hideOnScroll]);

  useEffect(() => {
    setShowUserMenu(false);
  }, [router.asPath]);

  useEffect(() => {
    if (!showUserMenu) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showUserMenu]);

  useEffect(() => {
    const loadActiveBookings = async () => {
      if (!user?.id) {
        setActiveBookingsCount(0);
        return;
      }
      try {
        const rows = await getMyBookings(user.id);
        setActiveBookingsCount(Array.isArray(rows) ? countActiveBookings(rows) : 0);
      } catch (error) {
        if (!isAuthSessionInvalidatedError(error)) {
          reportUiError({ area: 'NavBar', action: 'loadActiveBookings' }, error);
        }
      }
    };
    void loadActiveBookings();
  }, [user?.id]);

  const adminClubSlug = useMemo(() => {
    if (!user || !isAdmin) return null;
    return getActiveClubSlug(user as any) || getLastClubSlug();
  }, [isAdmin, user]);

  const userInitials = useMemo(() => {
    if (!user) return 'U';
    const first = (user.firstName || user.name || '').trim();
    const last = (user.lastName || '').trim();
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase().trim() || 'U';
  }, [user]);

  const menuLinks = useMemo(() => {
    const rows: Array<{ href: string; label: string; icon: React.ReactNode; badge?: number }> = [
      { href: '/perfil', label: 'Mi perfil', icon: <User size={15} /> },
      { href: '/bookings', label: 'Mis reservas', icon: <Calendar size={15} />, badge: activeBookingsCount },
    ];
    if (isAdmin) {
      rows.unshift({ href: '/admin/agenda', label: 'Gestión', icon: <ShieldCheck size={15} /> });
      if (adminClubSlug) rows.splice(1, 0, { href: `/club/${adminClubSlug}`, label: 'Mi club', icon: <Users size={15} /> });
    }
    return rows;
  }, [activeBookingsCount, adminClubSlug, isAdmin]);

  const handleContact = () => {
    setShowUserMenu(false);
    if (onContactClick) {
      onContactClick();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.href = 'mailto:soporte.pique@gmail.com';
    }
  };

  const handleLogout = () => {
    setShowLogoutModal(false);
    setShowUserMenu(false);
    logout();
  };

  const handleHomeShortcut = async (sectionId: string) => {
    setShowUserMenu(false);
    onNavbarInteract?.();

    if (typeof window === 'undefined') {
      await router.push(`/#${sectionId}`);
      return;
    }

    if (router.pathname === '/') {
      const section = document.getElementById(sectionId);
      if (section) {
        window.history.replaceState(null, '', `/#${sectionId}`);
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }

    await router.push(`/#${sectionId}`);
  };

  const handleLogoClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    setShowUserMenu(false);
    onNavbarInteract?.();
    if (typeof window === 'undefined' || router.pathname !== '/') return;

    event.preventDefault();

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const startY = window.scrollY;
    if (startY <= 4) {
      window.history.replaceState(null, '', '/');
      return;
    }

    window.history.replaceState(null, '', '/');

    if (prefersReducedMotion) {
      window.scrollTo(0, 0);
      return;
    }

    const duration = Math.min(900, Math.max(420, startY * 0.32));
    const startTime = performance.now();
    const easeOutQuart = (value: number) => 1 - Math.pow(1 - value, 4);

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutQuart(progress);
      window.scrollTo(0, Math.round(startY * (1 - easedProgress)));
      if (progress < 1) {
        window.requestAnimationFrame(animate);
      }
    };

    window.requestAnimationFrame(animate);
  };

  const handleNavMouseDownCapture = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as Node | null;
    if (!target) return;
    const targetElement = target instanceof Element ? target : null;
    const clickedContactToggle = Boolean(targetElement?.closest('[data-contact-toggle="true"]'));

    const clickedInsideMenu = Boolean(userMenuRef.current?.contains(target));
    const clickedUserButton = Boolean(userButtonRef.current?.contains(target));

    if (!clickedInsideMenu && !clickedUserButton) {
      setShowUserMenu(false);
    }

    if (!clickedContactToggle) {
      onNavbarInteract?.();
    }
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: NAV_CSS }} />
      <header
        ref={navRef}
        className={`p-header p-player-nav${navHidden ? ' p-header-hidden' : ''}`}
        onMouseDownCapture={handleNavMouseDownCapture}
      >
        <div className="p-header-inner">
          <div className="p-player-brand">
            <Link href="/" aria-label="Pique - Inicio" onClick={handleLogoClick} style={{ display: 'flex', alignItems: 'center' }}>
              <PiqueLogo
                variant={isLight ? 'horizontal' : 'horizontalDark'}
                style={{ width: 123, height: 'auto', display: 'block' }}
              />
            </Link>
          </div>

          {showHomeShortcuts && (
            <div className="p-player-shortcuts-wrap">
              <nav className="p-player-shortcuts" aria-label="Secciones principales">
                {HOME_SHORTCUTS.map((shortcut) => {
                  const isActive = router.asPath === `/#${shortcut.id}` || router.asPath.endsWith(`#${shortcut.id}`);
                  return (
                    <button
                      key={shortcut.id}
                      type="button"
                      className={`p-player-shortcut${isActive ? ' p-player-shortcut-active' : ''}`}
                      onClick={() => { void handleHomeShortcut(shortcut.id); }}
                    >
                      {shortcut.label}
                    </button>
                  );
                })}
              </nav>
            </div>
          )}

          <div className="p-player-actions">
            {showContactLink && (
              <button type="button" data-contact-toggle="true" className="p-player-btn p-player-contact" onClick={handleContact}>
                Contacto
              </button>
            )}
            <button
              type="button"
              className="p-player-btn p-player-theme"
              onClick={toggleTheme}
              aria-label={isLight ? 'Activar modo oscuro' : 'Activar modo claro'}
              title={isLight ? 'Activar modo oscuro' : 'Activar modo claro'}
            >
              {isLight ? <Moon size={14} /> : <Sun size={14} />}
            </button>

            {user ? (
              <div style={{ position: 'relative' }}>
                <button
                  ref={userButtonRef}
                  type="button"
                  className="p-player-user-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowUserMenu((prev) => !prev);
                  }}
                  aria-expanded={showUserMenu}
                >
                  <div className="p-player-avatar">
                    {userInitials}
                    {activeBookingsCount > 0 && (
                      <span
                        className="p-player-menu-badge p-player-avatar-badge"
                        style={{
                          background: isLight ? 'var(--surface-2)' : 'var(--text-primary)',
                          color: isLight ? 'var(--text-primary)' : 'var(--surface-1)',
                          boxShadow: isLight
                            ? '0 4px 12px var(--border), 0 0 0 1px var(--border-subtle) inset'
                            : '0 4px 12px var(--border-subtle)',
                        }}
                      >
                        {activeBookingsCount > 99 ? '99+' : activeBookingsCount}
                      </span>
                    )}
                  </div>
                  <span className="p-player-user-name">{user.firstName || user.name || 'Usuario'}</span>
                </button>

                {showUserMenu && (
                  <div ref={userMenuRef} className="p-player-menu" onClick={(event) => event.stopPropagation()}>
                    <div className="p-player-menu-meta">
                      <div className="p-player-avatar" style={{ width: 52, height: 52, margin: '0 auto 10px', fontSize: 16 }}>
                        {userInitials}
                      </div>
                      <div style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 900 }}>
                        {user.firstName || user.name || 'Usuario'}
                      </div>
                      <div className="p-player-menu-role">{isAdmin ? 'Administrador' : 'Jugador'}</div>
                    </div>
                    <div className="p-player-menu-body">
                      {menuLinks.map((link) => (
                        <Link
                          key={`${link.href}-${link.label}`}
                          href={link.href}
                          className="p-player-menu-item"
                          onClick={() => setShowUserMenu(false)}
                        >
                          <span className="p-player-menu-item-main">
                            {link.icon}
                            {link.label}
                          </span>
                          {link.badge ? <span className="p-player-menu-badge">{link.badge}</span> : null}
                        </Link>
                      ))}
                      <button
                        type="button"
                        className="p-player-menu-item p-player-menu-danger"
                        onClick={() => setShowLogoutModal(true)}
                      >
                        <span className="p-player-menu-item-main"><LogOut size={15} /> Cerrar sesión</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link href={`/login?from=${encodeURIComponent(router.asPath)}`} className="p-player-btn p-player-btn-accent p-player-login">
                <User size={14} style={{ color: 'var(--brand-on)' }} />
                <span>Ingresar</span>
              </Link>
            )}
          </div>
        </div>
      </header>

      <AppModal
        show={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        title="Cerrar sesión"
        message="Estas seguro que queres salir de tu cuenta?"
        cancelText="Cancelar"
        confirmText="Salir"
        isWarning
        onConfirm={handleLogout}
        closeOnBackdrop
        closeOnEscape
      />
    </>
  );
}
