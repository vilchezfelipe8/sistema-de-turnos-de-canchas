import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { logout } from '../services/AuthService';
import { getMyBookings } from '../services/BookingService';
import AppModal from './AppModal';
import { ClubService, Club } from '../services/ClubService';
import { Menu } from 'lucide-react'; 

interface NavbarProps {
  onMenuClick?: () => void;
}

const Navbar = ({ onMenuClick }: NavbarProps) => {
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
    const userStr = localStorage.getItem('user');
    if (userStr) {
      setUser(JSON.parse(userStr));
    } else {
      let guestId = localStorage.getItem('guestId');
      if (!guestId) {
        try {
          guestId = (typeof crypto !== 'undefined' && (crypto as any).randomUUID) 
            ? (crypto as any).randomUUID() 
            : `guest_${Math.random().toString(36).slice(2, 10)}`;
          localStorage.setItem('guestId', guestId);
        } catch (e) {
          guestId = `guest_${Math.random().toString(36).slice(2, 10)}`;
          localStorage.setItem('guestId', guestId);
        }
      }
      if (guestId) setIsGuest(true);
    }

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
        const isHome = router.pathname === '/';

        if (isHome) {
          const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
          if (userStr) {
             const u = JSON.parse(userStr);
             if (u?.clubId) {
                const clubData = await ClubService.getClubById(u.clubId);
                setClub(clubData);
                return;
             }
          }
          setClub(null);
          return;
        }

        const slugMatch = path.match(/\/club\/([^\/]+)/);
        if (slugMatch && slugMatch[1]) {
          const clubData = await ClubService.getClubBySlug(slugMatch[1]);
          setClub(clubData);
        } else {
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

  const handleLogout = () => setShowLogoutModal(true);
  const isActive = (path: string) => router.pathname === path;
  const isAdmin = user?.role === 'ADMIN';

  const userInitials = useMemo(() => {
    if (!user) return 'TU';
    const first = (user.firstName || user.name || '').trim();
    const last = (user.lastName || '').trim();
    return `${first.charAt(0)}${last.charAt(0)}`.trim() || 'TU';
  }, [user]);

  const brandHref = router.pathname.startsWith('/club/') && club?.slug ? `/club/${club.slug}` : '/';

  return (
    <>
      <nav
        ref={navRef}
        // AJUSTE CLAVE: Reduje el padding vertical (py-3 en lugar de py-6)
        // Esto hace la barra más fina aunque el logo sea grande.
        className={`absolute top-0 left-0 right-0 z-50 transition-all duration-300 border-b border-[#EBE1D8]/10 ${
          isScrolled ? 'py-2 bg-[#347048]/95 backdrop-blur-md shadow-lg' : 'py-3 bg-[#347048]'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 flex justify-between items-center">
          
          {/* --- IZQUIERDA: LOGO + MENÚ --- */}
          <div className="flex items-center gap-4">
            
            {onMenuClick && (
              <button 
                onClick={onMenuClick}
                className="p-2 -ml-2 text-[#EBE1D8] hover:bg-[#EBE1D8]/20 rounded-full transition-all active:scale-95"
                title="Abrir menú"
              >
                <Menu size={32} strokeWidth={2.5} />
              </button>
            )}

            <Link href={brandHref} className="group flex items-center gap-3 select-none">
              {club?.logoUrl ? (
                // LOGO: Tamaño h-14 (grande pero controlado)
                // Usamos h-14 (56px) en vez de h-20 (80px) para que no empuje todo hacia abajo
                // eslint-disable-next-line @next/next/no-img-element
                <img 
                  src={club.logoUrl} 
                  alt={club.name} 
                  className="h-12 w-12 md:h-14 md:w-14 object-contain drop-shadow-md transition-transform group-hover:scale-105" 
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : null}
              
              <div className="flex flex-col leading-none">
                {/* NOMBRE: Texto grande (3xl) pero con interlineado ajustado (leading-none) */}
                <span className="text-xl md:text-3xl font-black tracking-tighter text-[#EBE1D8] italic drop-shadow-sm leading-none mt-1">
                  {club ? club.name : 'TuCancha'}
                </span>
              </div>
            </Link>
          </div>

          {/* --- DERECHA: USUARIO / LOGIN --- */}
          {(user || isGuest) && (
            <div className="flex items-center gap-1 p-1 rounded-full bg-[#EBE1D8]/10 relative">
              
              {!isAdmin && (
                <>
                  <NavLink href={club ? `/club/${club.slug}` : '/'} icon="🏠" text="Inicio" active={router.asPath === '/' || (club && router.asPath === `/club/${club.slug}`)} />
                  {user && <NavLink href="/bookings" icon="📅" text="Mis Turnos" active={isActive('/bookings')} />}
                </>
              )}

              {isAdmin && !onMenuClick && (
                <NavLink href="/admin/agenda" icon="⚙️" text="Gestión" active={router.asPath.startsWith('/admin')} />
              )}

              {user ? (
                <div className="relative ml-2">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowUserMenu((prev) => !prev);
                    }}
                    className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-[#EBE1D8]/10 hover:bg-[#EBE1D8]/20 transition-all"
                  >
                    <div className="relative">
                      <div className="h-9 w-9 rounded-full bg-[#347048] border-2 border-[#EBE1D8]/60 flex items-center justify-center text-[#EBE1D8] text-xs font-black">
                        {userInitials}
                      </div>
                      <span className="absolute -right-1 -top-1 bg-[#B9CF32] text-[#347048] text-[10px] font-black rounded-full h-4 min-w-[16px] px-1 flex items-center justify-center shadow-sm">
                        {activeBookingsCount}
                      </span>
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
                          <span className="absolute -right-1 -top-1 bg-[#B9CF32] text-[#347048] text-xs font-black rounded-full h-6 w-6 flex items-center justify-center border-2 border-[#EBE1D8]">✓</span>
                        </div>
                        <h3 className="text-lg font-black text-[#347048]">{user.firstName || user.name || 'Usuario'}</h3>
                        <p className="text-[#347048]/60 text-xs font-bold uppercase tracking-widest mt-1">
                          {club ? club.name : 'Miembro'}
                        </p>
                      </div>

                      <div className="border-t border-[#347048]/10 px-6 py-4 bg-[#347048]/5">
                        <p className="text-[#347048] font-black text-xs uppercase tracking-wider mb-3">Mis Datos</p>
                        <div className="space-y-3 text-[#347048] text-sm font-medium">
                          <div className="flex items-center gap-3">
                            <span className="text-[#B9CF32]">📱</span>
                            <span>{user.phoneNumber || user.phone || 'Sin teléfono'}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[#B9CF32]">✉️</span>
                            <span className="truncate">{user.email || 'Sin email'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-[#347048]/10 px-6 py-4 space-y-2 font-bold">
                        <Link href="/bookings" className="flex items-center gap-3 text-[#347048] hover:text-[#B9CF32] p-2 rounded-lg hover:bg-[#347048]/5 transition-colors" onClick={() => setShowUserMenu(false)}>
                          <span>📅</span> Mis Reservas
                        </Link>
                        
                        <button
                          type="button"
                          className="flex items-center gap-3 text-[#926699] hover:text-[#7a5580] w-full text-left p-2 rounded-lg hover:bg-[#926699]/10 transition-colors"
                          onClick={() => {
                            setShowUserMenu(false);
                            handleLogout();
                          }}
                        >
                          <span>↪</span> Cerrar sesión
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <Link href={`/login?from=${encodeURIComponent(router.asPath)}`} className="flex items-center gap-1 px-4 py-2 rounded-full text-sm font-bold transition-all text-[#347048] bg-[#B9CF32] hover:bg-[#aebd2b] hover:shadow-lg ml-2">
                  <span>🔐</span>
                  <span className="hidden sm:inline">Ingresar</span>
                </Link>
              )}
            </div>
          )}
        </div>
      </nav>
      
      <AppModal
        show={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        title="Cerrar sesión"
        message="¿Estás seguro de que quieres salir?"
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

const NavLink = ({ href, icon, text, active }: any) => (
  <Link href={href}
    className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-bold transition-all border ${
      active
        ? 'bg-[#EBE1D8] text-[#347048] border-[#EBE1D8]'
        : 'text-[#EBE1D8] border-transparent hover:bg-[#EBE1D8]/10 hover:text-[#B9CF32]'
    }`}
  >
    <span>{icon}</span>
    <span className="hidden sm:inline">{text}</span>
  </Link>
);

export default Navbar;