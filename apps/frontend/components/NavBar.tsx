import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  hideOnScroll?: boolean;
  showContactLink?: boolean;
}

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
  }
  .p-player-brand { display:flex; align-items:center; gap:10px; min-width:0; }
  .p-player-actions { display:flex; align-items:center; gap:8px; position:relative; }
  .p-player-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:38px; padding:8px 14px; border-radius:var(--r-pill); border:1px solid var(--border); background:var(--surface-1); color:var(--text-primary); font-family:var(--font-sans); font-size:12px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; cursor:pointer; text-decoration:none; transition:background .15s,border-color .15s,transform .15s; }
  .p-player-btn:hover { background:var(--surface-2); border-color:var(--border-strong); transform:translateY(-1px); }
  .p-player-btn-accent { background:var(--brand); color:var(--brand-on); border-color:var(--accent-fg); }
  .p-player-btn-accent:hover { background:var(--brand-hover); }
  .p-player-theme svg { width:14px; height:14px; }
  .p-player-login { white-space:nowrap; }
  .p-player-menu-meta { padding:18px 18px 16px; text-align:center; border-bottom:1px solid var(--border); }
  .p-player-menu-role { margin-top:4px; color:var(--text-muted); font-size:10px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
  .p-player-menu-body { padding:8px; display:flex; flex-direction:column; gap:4px; }
  .p-player-menu-badge { display:inline-flex; align-items:center; justify-content:center; min-width:22px; height:22px; padding:0 7px; border-radius:var(--r-pill); background:var(--brand); color:var(--brand-on); font-size:10px; font-weight:900; }
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
    .p-player-contact { display:none; }
    .p-player-user-name { display:none; }
    .p-player-login span { display:none; }
  }
`;

export default function Navbar({
  onContactClick,
  hideOnScroll = true,
  showContactLink = true,
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

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: NAV_CSS }} />
      <header ref={navRef} className={`p-header p-player-nav${navHidden ? ' p-header-hidden' : ''}`}>
        <div className="p-header-inner">
          <div className="p-player-brand">
            <Link href="/" aria-label="Pique - Inicio" style={{ display: 'flex', alignItems: 'center' }}>
              <PiqueLogo
                variant={isLight ? 'horizontal' : 'horizontalDark'}
                style={{ width: 123, height: 'auto', display: 'block' }}
              />
            </Link>
          </div>

          <div className="p-player-actions">
            {showContactLink && (
              <button type="button" className="p-player-btn p-player-contact" onClick={handleContact}>
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
              <span>{isLight ? 'Oscuro' : 'Claro'}</span>
            </button>

            {user ? (
              <div style={{ position: 'relative' }}>
                <button
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
                      <span className="p-player-menu-badge" style={{ position: 'absolute', top: -5, right: -8, minWidth: 18, height: 18, fontSize: 9, padding: '0 5px' }}>
                        {activeBookingsCount > 99 ? '99+' : activeBookingsCount}
                      </span>
                    )}
                  </div>
                  <span className="p-player-user-name">{user.firstName || user.name || 'Usuario'}</span>
                </button>

                {showUserMenu && (
                  <div className="p-player-menu" onClick={(event) => event.stopPropagation()}>
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
