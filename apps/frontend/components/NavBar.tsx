import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { logout } from '../services/AuthService';
import { getMyBookings } from '../services/BookingService';
import { ClubService } from '../services/ClubService';
import { NotificationService, NotificationItem } from '../services/NotificationService';
import { getActiveClubSlug, getLastClubSlug, hasAdminAccess, setLastClubSlug } from '../utils/session';
import { reportUiError } from '../utils/uiError';
import { useAuth } from '../contexts/AuthContext';
import { isAuthSessionInvalidatedError } from '../utils/apiClient';
import AppModal from './AppModal';
import { Menu, Home, Calendar, Settings, LogOut, Phone, Mail, Check, Lock, MapPin, Bell, User } from 'lucide-react'; 

interface NavbarProps {
  onMenuClick?: () => void;
  onNavClick?: () => void;
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

const Navbar = ({ onMenuClick, onNavClick }: NavbarProps) => {
  const router = useRouter();
  const { user } = useAuth();
  const [isScrolled, setIsScrolled] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [activeBookingsCount, setActiveBookingsCount] = useState(0);
  const [resolvedAdminClubSlug, setResolvedAdminClubSlug] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    if (user) return;
    setShowUserMenu(false);
    setShowNotifications(false);
    setActiveBookingsCount(0);
    setResolvedAdminClubSlug(null);
  }, [user]);


  useEffect(() => {
    setShowUserMenu(false);
  }, [router.asPath]);

  useEffect(() => {
    const loadActiveBookings = async () => {
      if (!user?.id) {
        setActiveBookingsCount(0);
        return;
      }
      try {
        const bookings = await getMyBookings(user.id);
        const active = Array.isArray(bookings) ? countActiveBookings(bookings) : 0;
        setActiveBookingsCount(active);
      } catch (error) {
        if (isAuthSessionInvalidatedError(error)) {
          return;
        }
        reportUiError({ area: 'NavBar', action: 'loadActiveBookings' }, error);
      }
    };
    loadActiveBookings();
  }, [user]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!showUserMenu && !showNotifications) return;
      const target = event.target as Node;
      if (navRef.current && !navRef.current.contains(target)) {
        setShowUserMenu(false);
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showUserMenu, showNotifications]);

  useEffect(() => {
    if (!showNotifications) return;

    const closeIfDialogOpen = () => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs.length > 0) {
        setShowNotifications(false);
      }
    };

    closeIfDialogOpen();
    const observer = new MutationObserver(closeIfDialogOpen);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [showNotifications]);

  const isAdmin = hasAdminAccess(user);

  const loadNotifications = useCallback(async () => {
    if (!isAdmin || !user?.id) {
      setNotifications([]);
      return;
    }
    try {
      const rows = await NotificationService.list(false, 20);
      setNotifications(Array.isArray(rows) ? rows : []);
    } catch {
      setNotifications([]);
    }
  }, [isAdmin, user?.id]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const unreadCount = notifications.filter((item) => !item.isRead).length;

  const extractBookingIdFromNotification = (item: NotificationItem) => {
    const raw = `${String(item?.title || '')} ${String(item?.message || '')}`;
    const match = raw.match(/#(\d+)/);
    if (!match) return null;
    const bookingId = Number(match[1]);
    return Number.isFinite(bookingId) && bookingId > 0 ? bookingId : null;
  };

  const handleNotificationClick = async (item: NotificationItem) => {
    const markAsRead = async () => {
      if (item.isRead) return;
      try {
        await NotificationService.markRead(item.id);
        setNotifications((prev) => prev.map((row) => (row.id === item.id ? { ...row, isRead: true } : row)));
      } catch {
      }
    };

    const bookingId = extractBookingIdFromNotification(item);
    if (bookingId) {
      setShowNotifications(false);
      setShowUserMenu(false);
      await router.push(`/admin/agenda?bookingId=${bookingId}`);
      await markAsRead();
      return;
    }
    await markAsRead();
    await loadNotifications();
  };

  const handleMarkAllRead = async () => {
    try {
      await NotificationService.markAllRead();
      await loadNotifications();
    } catch {
    }
  };

  const handleLogout = () => {
    setShowNotifications(false);
    setShowLogoutModal(true);
  };
  const isClubSlugView = router.pathname === '/club/[slug]';
  const isBookingsView = router.pathname === '/bookings';
  const isProfileView = router.pathname === '/perfil';
  const isAdminView = router.pathname.startsWith('/admin') || router.pathname === '/club/[slug]/admin';

  useEffect(() => {
    if (router.pathname !== '/club/[slug]') return;
    const slug = typeof router.query.slug === 'string' ? router.query.slug.trim() : '';
    if (!slug) return;
    setLastClubSlug(slug);
  }, [router.pathname, router.query.slug]);

  const userClubSlug = useMemo(() => {
    const activeSlug = user ? getActiveClubSlug(user) : null;
    if (activeSlug) return activeSlug;
    return getLastClubSlug();
  }, [user]);

  const adminClubSlug = useMemo(() => {
    if (!user || !isAdmin) return null;

    const activeSlug = getActiveClubSlug(user);
    if (activeSlug) {
      return activeSlug;
    }

    const routeSlug = router.query.slug;
    if (typeof routeSlug === 'string' && routeSlug.trim()) {
      return routeSlug.trim();
    }

    return null;
  }, [user, isAdmin, router.query.slug]);

  useEffect(() => {
    let isCancelled = false;

    const resolveAdminClubSlug = async () => {
      if (!isAdmin) {
        setResolvedAdminClubSlug(null);
        return;
      }

      if (adminClubSlug) {
        setResolvedAdminClubSlug(null);
        return;
      }

      const clubId = Number(user?.activeClubId || user?.clubId || user?.club?.id);
      if (!Number.isFinite(clubId) || clubId <= 0) {
        setResolvedAdminClubSlug(null);
        return;
      }

      try {
        const club = await ClubService.getClubById(clubId);
        if (!isCancelled && club?.slug) {
          setResolvedAdminClubSlug(club.slug);
        }
      } catch (error) {
        if (!isCancelled) {
          setResolvedAdminClubSlug(null);
        }
      }
    };

    resolveAdminClubSlug();

    return () => {
      isCancelled = true;
    };
  }, [isAdmin, user, adminClubSlug]);

  const effectiveAdminClubSlug = adminClubSlug || resolvedAdminClubSlug;

  const dropdownNavLinks = useMemo(() => {
    const links: Array<{ href: string; label: string; icon: any }> = [];
    if (!isProfileView) {
      links.push({ href: '/perfil', label: 'Mi Perfil', icon: <User size={18} strokeWidth={2.5} /> });
    }

    if (isProfileView) {
      links.push({ href: '/', label: 'Inicio', icon: <Home size={18} strokeWidth={2.5} /> });
      links.push({ href: '/bookings', label: 'Mis Reservas', icon: <Calendar size={18} strokeWidth={2.5} /> });
      if (isAdmin) {
        links.push({
          href: '/admin/agenda',
          label: 'Gestión',
          icon: <Settings size={18} strokeWidth={2.5} />
        });
        if (effectiveAdminClubSlug) {
          links.push({
            href: `/club/${effectiveAdminClubSlug}`,
            label: 'Mi Club',
            icon: <MapPin size={18} strokeWidth={2.5} />
          });
        }
      }
      return links;
    }

    if (isClubSlugView) {
      if (isAdmin) {
        links.push({
          href: '/admin/agenda',
          label: 'Gestión',
          icon: <Settings size={18} strokeWidth={2.5} />
        });
      }
      links.push({ href: '/', label: 'Inicio', icon: <Home size={18} strokeWidth={2.5} /> });
      links.push({ href: '/bookings', label: 'Mis Reservas', icon: <Calendar size={18} strokeWidth={2.5} /> });
      return links;
    }

    if (isBookingsView) {
      if (isAdmin) {
        links.push({
          href: '/admin/agenda',
          label: 'Gestión',
          icon: <Settings size={18} strokeWidth={2.5} />
        });
        if (effectiveAdminClubSlug) {
          links.push({
            href: `/club/${effectiveAdminClubSlug}`,
            label: 'Mi Club',
            icon: <MapPin size={18} strokeWidth={2.5} />
          });
        }
      }
      links.push({ href: '/', label: 'Inicio', icon: <Home size={18} strokeWidth={2.5} /> });
      return links;
    }

    if (isAdminView) {
      links.push({ href: '/', label: 'Inicio', icon: <Home size={18} strokeWidth={2.5} /> });
      if (effectiveAdminClubSlug) {
        links.push({
          href: `/club/${effectiveAdminClubSlug}`,
          label: 'Mi Club',
          icon: <MapPin size={18} strokeWidth={2.5} />
        });
      }
      links.push({ href: '/bookings', label: 'Mis Reservas', icon: <Calendar size={18} strokeWidth={2.5} /> });
      return links;
    }

    return links;
  }, [isClubSlugView, isAdmin, isBookingsView, isProfileView, isAdminView, effectiveAdminClubSlug]);

  const userInitials = useMemo(() => {
    if (!user) return 'TU';
    const first = (user.firstName || user.name || '').trim();
    const last = (user.lastName || '').trim();
    return `${first.charAt(0)}${last.charAt(0)}`.trim() || 'TU';
  }, [user]);

  const navbarGradientStyle = useMemo(
    () => ({
      backgroundImage:
        'radial-gradient(circle at 12% 18%, rgba(185, 207, 50, 0.12), transparent 40%), radial-gradient(circle at 88% 20%, rgba(146, 102, 153, 0.1), transparent 42%), linear-gradient(165deg, #2d6240 0%, #347048 48%, #2a5c3b 100%)'
    }),
    []
  );

  return (
    <>
      <nav
        ref={navRef}
        onClick={() => {
          if (showUserMenu) setShowUserMenu(false);
          if (showNotifications) setShowNotifications(false);
          onNavClick?.();
        }}
        className={`fixed top-0 left-0 right-0 z-[10000] transition-all duration-300 border-b border-[#EBE1D8]/10 h-16 md:h-[72px] ${
          isScrolled ? 'backdrop-blur-md shadow-lg' : ''
        }`}
        style={navbarGradientStyle}
      >
        {onMenuClick && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              setShowNotifications(false);
              setShowUserMenu(false);
              onMenuClick();
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-40 flex-shrink-0 p-2 text-[#EBE1D8] hover:bg-[#EBE1D8]/20 rounded-full transition-all active:scale-95"
            title="Abrir menú"
          >
            <Menu size={32} strokeWidth={2.5} />
          </button>
        )}
        <div className={`max-w-7xl mx-auto px-6 h-full flex justify-between items-center ${onMenuClick ? 'pl-16' : ''}`}>
          
          {/* --- IZQUIERDA: LOGO + MENÚ --- */}
          <div className="relative flex items-center gap-4">
          <Link href="/" aria-label="TuCancha - Inicio" className="relative z-20 group flex items-center gap-3 select-none min-w-0">
            
            {/* 1. ISOLOGO "TC" (Cuadrado Lima) */}
            <div className="bg-[#B9CF32] h-10 w-10 md:h-12 md:w-12 rounded-xl flex items-center justify-center text-[#347048] font-black italic text-xl md:text-2xl shadow-lg group-hover:scale-110 transition-transform shrink-0">
              TC
            </div>

            {/* 2. TEXTO "TUCANCHA" (Siempre fijo) */}
            <div className="flex flex-col leading-none min-w-0">
              <span className="hidden md:inline text-2xl md:text-3xl font-black tracking-tighter text-[#EBE1D8] italic drop-shadow-sm leading-none truncate">
                TuCancha<span className="text-[#B9CF32] opacity-80"></span>
              </span>
            </div>

          </Link>
        </div>

          {/* --- DERECHA: USUARIO / LOGIN --- */}
          <div className="flex items-center gap-2 sm:gap-4 relative">

              {isAdmin && (
                <div className="relative">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowUserMenu(false);
                      setShowNotifications((prev) => !prev);
                    }}
                    className="relative h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-[#EBE1D8] flex items-center justify-center transition-all"
                    title="Notificaciones"
                  >
                    <Bell size={18} strokeWidth={2.5} />
                    {unreadCount > 0 && (
                      <span className="absolute -right-1 -top-1 bg-[#B9CF32] text-[#347048] text-[9px] font-black rounded-full h-4 min-w-[16px] px-1 flex items-center justify-center border border-[#347048]/20">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </button>

                  {showNotifications && (
                    <div
                      className="absolute right-0 mt-4 w-[320px] bg-[#EBE1D8] rounded-3xl shadow-2xl shadow-[#347048]/50 border border-[#347048]/10 overflow-hidden z-[130]"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="px-5 py-4 border-b border-[#347048]/10 flex items-center justify-between">
                        <h3 className="text-sm font-black uppercase tracking-wider text-[#347048]">Notificaciones</h3>
                        <button
                          onClick={handleMarkAllRead}
                          className="text-[10px] font-black uppercase tracking-widest text-[#926699] hover:text-[#347048]"
                        >
                          Marcar todas
                        </button>
                      </div>

                      <div className="max-h-[320px] overflow-y-auto">
                        {notifications.length === 0 ? (
                          <div className="px-5 py-8 text-center text-[#347048]/50 text-xs font-bold uppercase tracking-wider">
                            Sin notificaciones
                          </div>
                        ) : (
                          notifications.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => handleNotificationClick(item)}
                              className={`w-full text-left px-5 py-4 border-b border-[#347048]/10 hover:bg-[#347048]/5 transition-colors ${
                                item.isRead ? 'opacity-70' : 'opacity-100'
                              }`}
                            >
                              <p className="text-xs font-black uppercase tracking-wider text-[#347048]">
                                {item.title}
                              </p>
                              <p className="text-xs text-[#347048]/70 mt-1">{item.message}</p>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Menú de Usuario (Separado y limpio) */}
              {user ? (
                <div className="relative">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowNotifications(false);
                      onNavClick?.();
                      setShowUserMenu((prev) => !prev);
                    }}
                    className="flex items-center gap-3 pl-1 pr-4 py-1 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 transition-all shadow-sm"
                  >
                    <div className="relative">
                      <div className="h-9 w-9 rounded-full bg-[#B9CF32] flex items-center justify-center text-[#347048] text-xs font-black shadow-inner">
                        {userInitials}
                      </div>
                      {activeBookingsCount > 0 && (
                          <span className="absolute -right-1 -top-1 bg-[#926699] text-white text-[9px] font-black rounded-full h-4 min-w-[16px] px-1 flex items-center justify-center shadow-md border-2 border-[#347048]">
                            {activeBookingsCount}
                          </span>
                      )}
                    </div>
                    <span className="text-[#EBE1D8] font-bold text-sm hidden md:inline">
                      {user.firstName || user.name || 'Usuario'}
                    </span>
                  </button>

                  {showUserMenu && (
                    <div
                      className="absolute right-0 mt-4 w-[280px] md:w-[320px] bg-[#EBE1D8] rounded-3xl shadow-2xl shadow-[#347048]/50 border border-[#347048]/10 overflow-hidden z-[120]"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="p-6 flex flex-col items-center text-center">
                        <div className="relative mb-4">
                          <div className="h-20 w-20 rounded-full bg-[#347048] flex items-center justify-center text-[#EBE1D8] text-xl font-black shadow-inner">
                            {userInitials}
                          </div>
                          <span className="absolute -right-1 -bottom-1 bg-[#B9CF32] text-[#347048] text-xs font-black rounded-full h-7 w-7 flex items-center justify-center border-4 border-[#EBE1D8]"><Check size={14} strokeWidth={4} /></span>
                        </div>
                        <h3 className="text-xl font-black text-[#347048] italic tracking-tight">{user.firstName || user.name || 'Usuario'}</h3>
                        <p className="text-[#347048]/60 text-xs font-bold uppercase tracking-widest mt-1">
                          TuCancha
                        </p>
                      </div>

                      <div className="border-t border-[#347048]/10 px-6 py-5 bg-[#347048]/5">
                        <p className="text-[#347048]/40 font-black text-[10px] uppercase tracking-widest mb-3">Mis Datos</p>
                        <div className="space-y-3 text-[#347048] text-sm font-bold">
                          <div className="flex items-center gap-3">
                            <Phone size={16} className="text-[#B9CF32]" strokeWidth={2.5} />
                            <span>{user.phoneNumber || user.phone || 'Sin teléfono'}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <Mail size={16} className="text-[#B9CF32]" strokeWidth={2.5} />
                            <span className="truncate">{user.email || 'Sin email'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-[#347048]/10 px-6 py-4 space-y-2 font-bold">
                        {dropdownNavLinks.map((link) => (
                          <Link
                            key={`${link.href}-${link.label}`}
                            href={link.href}
                            className="flex items-center justify-between gap-3 text-[#347048] hover:text-[#B9CF32] p-2 rounded-xl hover:bg-[#347048]/5 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <span className="flex items-center gap-3">
                              {link.icon} {link.label}
                            </span>
                            {link.href === '/bookings' && activeBookingsCount > 0 ? (
                              <span className="inline-flex items-center justify-center min-w-[22px] h-6 px-2 rounded-full bg-[#926699] text-white text-[10px] font-black">
                                {activeBookingsCount}
                              </span>
                            ) : null}
                          </Link>
                        ))}
                        
                        <button
                          type="button"
                          className="flex items-center gap-3 text-red-500 hover:text-red-600 w-full text-left p-2 rounded-xl hover:bg-red-50 transition-colors"
                          onClick={() => {
                            setShowUserMenu(false);
                            handleLogout();
                          }}
                        >
                          <LogOut size={18} strokeWidth={2.5} /> Cerrar sesión
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <Link href={`/login?from=${encodeURIComponent(router.asPath)}`} className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-black uppercase tracking-widest transition-all text-[#347048] bg-[#B9CF32] hover:bg-[#aebd2b] hover:shadow-lg shadow-[#B9CF32]/20">
                  <Lock size={16} strokeWidth={3} />
                  <span className="hidden sm:inline">Ingresar</span>
                </Link>
              )}
            </div>
        </div>
      </nav>
      
      <AppModal
        show={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        title="Cerrar sesión"
        message="¿Estás seguro de que quieres salir de tu cuenta?"
        cancelText="Cancelar"
        confirmText="Salir"
        isWarning={true}
        onConfirm={() => {
          const logoutRedirect = isAdminView && effectiveAdminClubSlug
            ? `/club/${effectiveAdminClubSlug}`
            : (isBookingsView || isProfileView) && userClubSlug
              ? `/club/${userClubSlug}`
              : null;

          logout({ redirectTo: logoutRedirect });
          setShowLogoutModal(false);
        }}
        closeOnBackdrop
        closeOnEscape
      />
    </>
  );
};

export default Navbar;
