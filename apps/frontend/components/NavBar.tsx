import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { logout } from '../services/AuthService';
import { getMyBookings } from '../services/BookingService';
import AppModal from './AppModal';
//import AdminSidebar from './AdminSidebar';
import { ClubService, Club } from '../services/ClubService';

const Navbar = () => {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [club, setClub] = useState<Club | null>(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [activeBookingsCount, setActiveBookingsCount] = useState(0);
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Verificar si hay usuario logueado
    const userStr = localStorage.getItem('user');
    if (userStr) {
      setUser(JSON.parse(userStr));
    }
    else {
      // Asegurarnos de que exista un guestId para sesiones de invitado
      let guestId = localStorage.getItem('guestId');
      if (!guestId) {
        try {
          guestId = (typeof crypto !== 'undefined' && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : `guest_${Math.random().toString(36).slice(2,10)}`;
          localStorage.setItem('guestId', guestId);
        } catch (e) {
          guestId = `guest_${Math.random().toString(36).slice(2,10)}`;
          localStorage.setItem('guestId', guestId);
        }
      }
      if (guestId) setIsGuest(true);
    }

    // Efecto de scroll para que la barra se oscurezca más al bajar
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const loadClub = async () => {
      try {
        const path = router.asPath;
        // Usar pathname para detectar home (pathname no incluye query params)
        const isHome = router.pathname === '/';

        // En la home mostramos siempre branding genérico (no es una página de club específico)
        if (isHome) {
          setClub(null);
          return;
        }

        const slugMatch = path.match(/\/club\/([^\/]+)/);
        if (slugMatch && slugMatch[1]) {
          const clubData = await ClubService.getClubBySlug(slugMatch[1]);
          setClub(clubData);
        } else {
          // En otras rutas sin slug (ej: /bookings), mostrar el club del usuario
          const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
          if (userStr) {
            try {
              const user = JSON.parse(userStr);
              if (user?.clubId) {
                const clubData = await ClubService.getClubById(user.clubId);
                setClub(clubData);
              } else {
                setClub(null);
              }
            } catch {
              setClub(null);
            }
          } else {
            setClub(null);
          }
        }
      } catch (error) {
        console.error('Error al cargar información del club:', error);
        setClub(null);
      }
    };

    loadClub();
  }, [router.asPath, router.pathname]);

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
        const active = Array.isArray(bookings)
          ? bookings.filter((booking: any) => !['CANCELLED', 'COMPLETED'].includes(booking.status)).length
          : 0;
        setActiveBookingsCount(active);
      } catch (error) {
        console.error('Error al cargar reservas activas:', error);
      }
    };

    loadActiveBookings();
  }, [user]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!showUserMenu) return;
      const target = event.target as Node;
      if (navRef.current && !navRef.current.contains(target)) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showUserMenu]);

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const isActive = (path: string) => router.pathname === path;
  const isAdmin = user?.role === 'ADMIN';

  const userInitials = useMemo(() => {
    if (!user) return 'TU';
    const first = (user.firstName || user.name || '').trim();
    const last = (user.lastName || '').trim();
    const initials = `${first.charAt(0)}${last.charAt(0)}`.trim();
    return initials || 'TU';
  }, [user]);

  const brandHref = router.pathname.startsWith('/club/') && club?.slug ? `/club/${club.slug}` : '/';

  return (
    <>
    <nav
      ref={navRef}
      className={`absolute top-0 left-0 right-0 z-50 transition-all duration-300 ${isScrolled ? 'py-3' : 'py-6'}`}
    >
      
      <div className="max-w-7xl mx-auto px-6 flex justify-between items-center">
        
        {/* Logo y Título Estilizado */}
  <Link href={brandHref} className="flex items-center gap-3 group">
          {club?.logoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src={club.logoUrl} 
                alt={club.name} 
                className="h-20 w-20 object-contain transition-transform group-hover:scale-110" 
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div className="flex flex-col leading-none max-[900px]:hidden">
                <span className="text-lg md:text-2xl lg:text-3xl font-black tracking-tighter text-[#D4C5B0] italic opacity-90 hover:opacity-100 transition-opacity">
                  {club.name}
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              {/* Solo mostramos logo genérico si no hay club asociado */}
              <div className="flex flex-col leading-none max-[900px]:hidden">
               <span className="text-lg md:text-2xl lg:text-3xl font-black tracking-tighter text-[#D4C5B0] italic opacity-90 hover:opacity-100 transition-opacity">
                  {club ? club.name : 'TuCancha'}
                </span>
              </div>
            </div>
          )}
        </Link>

        {/* Menú (si está logueado o es invitado) */}
        {(user || isGuest) && (
          <div className="flex items-center gap-1 p-1 rounded-full bg-white/10 relative">
            
            {!isAdmin && (
              <>
                <NavLink href={club ? `/club/${club.slug}` : '/'} icon="🏠" text="Inicio" active={router.asPath.startsWith('/club/') || router.asPath === '/'} />
                {user && <NavLink href="/bookings" icon="📅" text="Mis Turnos" active={isActive('/bookings')} />}
              </>
            )}

            {isAdmin && (
              <NavLink href="/admin/agenda" icon="⚙️" text="Gestión" active={router.asPath.startsWith('/admin')} />
            )}

            {user ? (
              <div className="relative ml-2">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowUserMenu((prev) => !prev);
                  }}
                  className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-all"
                >
                  <div className="relative">
                    <div className="h-8 w-8 rounded-full bg-black/70 border-2 border-white/60 flex items-center justify-center text-white text-xs font-black">
                      {userInitials}
                    </div>
                    <span className="absolute -right-1 -top-1 bg-[#0bbd49] text-white text-[10px] font-black rounded-full h-4 min-w-[16px] px-1 flex items-center justify-center">
                      {activeBookingsCount}
                    </span>
                  </div>
                  <span className="text-[#D4C5B0] font-bold text-sm hidden md:inline">
                    {user.firstName || user.name || 'Usuario'}
                  </span>
                </button>

                {showUserMenu && (
                  <div
                    className="absolute right-0 mt-4 w-[280px] md:w-[320px] bg-white rounded-3xl shadow-2xl border border-black/5 overflow-hidden z-[120]"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="p-6 flex flex-col items-center text-center">
                      <div className="relative mb-4">
                        <div className="h-20 w-20 rounded-full bg-black flex items-center justify-center text-white text-xl font-black">
                          {userInitials}
                        </div>
                        <span className="absolute -right-1 -top-1 bg-[#0bbd49] text-white text-xs font-black rounded-full h-6 w-6 flex items-center justify-center">✓</span>
                      </div>
                      <h3 className="text-lg font-black text-[#2b3a4a]">{user.firstName || user.name || 'Usuario'}</h3>
                      <p className="text-[#2b3a4a]/70 text-sm">Te uniste en {user.createdAt ? new Date(user.createdAt).getFullYear() : '2024'}</p>
                    </div>
                    <div className="border-t border-black/10 px-6 py-4">
                      <p className="text-[#2b3a4a] font-black text-base mb-4">Datos proporcionados</p>
                      <div className="space-y-3 text-[#2b3a4a]/70 text-sm">
                        <div className="flex items-center gap-3">
                          <span className="text-[#0bbd49]">✔</span>
                          <span>{user.phoneNumber || user.phone || 'Sin teléfono'}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[#0bbd49]">✉️</span>
                          <span>{user.email || 'Sin email'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-black/10 px-6 py-4 space-y-4 text-[#2b3a4a] font-semibold">
                      <Link href="/bookings" className="flex items-center gap-3 hover:text-[#0bbd49]" onClick={() => setShowUserMenu(false)}>
                        <span>�</span> Mis Reservas
                      </Link>
                      <button
                        type="button"
                        className="flex items-center gap-3 hover:text-[#0bbd49] w-full text-left"
                        onClick={() => setShowUserMenu(false)}
                      >
                        <span>👤</span> Mi Perfil
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-3 text-[#e66a2c] w-full text-left"
                        onClick={() => {
                          setShowUserMenu(false);
                          handleLogout();
                        }}
                      >
                        <span>↪</span> Cerrar sesión
                      </button>
                    </div>
                    <div className="border-t border-black/10 px-6 py-4 text-center text-[#2b3a4a]/70 text-sm">
                      Términos y Condiciones
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link href={`/login?from=${encodeURIComponent(router.asPath)}`} className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-bold transition-all text-[#D4C5B0] hover:bg-white/10 ml-2">
                <span>🔐</span>
                <span className="hidden sm:inline">Ingresar</span>
              </Link>
            )}
          </div>
        )}
      </div>
    </nav>
    {/* Renderizar el sidebar desde el NavBar para que quede anclado bajo la barra
        Solo mostrar en rutas de admin y para usuarios admin del club */}
    
    <AppModal
      show={showLogoutModal}
      onClose={() => setShowLogoutModal(false)}
      title="Cerrar sesión"
      message="¿Estás seguro de que quieres cerrar la sesión?"
      cancelText="Cancelar"
      confirmText="Salir"
      onConfirm={() => {
        logout();
        window.location.href = '/';
      }}
      closeOnBackdrop
      closeOnEscape
    />
    </>
  );
};

// Subcomponente para los enlaces del menú
const NavLink = ({ href, icon, text, active }: any) => (
  <Link href={href}
    className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-bold transition-all border ${
      active
        ? 'bg-[#D4C5B0] text-[#347048] border-[#D4C5B0]'
        : 'text-[#D4C5B0] border-transparent hover:bg-white/10'
    }`}
  >
    <span>{icon}</span>
    <span className="hidden sm:inline">{text}</span>
  </Link>
);

export default Navbar;