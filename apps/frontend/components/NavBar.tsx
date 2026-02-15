import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { logout } from '../services/AuthService';
import { getMyBookings } from '../services/BookingService';
import AppModal from './AppModal';
import { Menu, Home, Calendar, Settings, LogOut, Phone, Mail, Check, Lock } from 'lucide-react'; 

interface NavbarProps {
  onMenuClick?: () => void;
  onNavClick?: () => void;
}

const Navbar = ({ onMenuClick, onNavClick }: NavbarProps) => {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
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


  return (
    <>
      <nav
        ref={navRef}
        onClick={() => {
          if (showUserMenu) setShowUserMenu(false);
          onNavClick?.();
        }}
        className={`fixed top-0 left-0 right-0 z-[10000] transition-all duration-300 border-b border-[#EBE1D8]/10 ${
          isScrolled ? 'py-2 bg-[#347048]/95 backdrop-blur-md shadow-lg' : 'py-3 bg-[#347048]'
        }`}
      >
        {onMenuClick && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              setShowUserMenu(false);
              onMenuClick();
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-30 flex-shrink-0 p-2 text-[#EBE1D8] hover:bg-[#EBE1D8]/20 rounded-full transition-all active:scale-95"
            title="Abrir menú"
          >
            <Menu size={32} strokeWidth={2.5} />
          </button>
        )}
        <div className={`max-w-7xl mx-auto px-6 flex justify-between items-center ${onMenuClick ? 'pl-10' : ''}`}>
          
          {/* --- IZQUIERDA: LOGO + MENÚ --- */}
          <div className="relative flex items-center gap-4">
          <Link href="/" className="relative z-10 group flex items-center gap-3 select-none min-w-0">
            
            {/* 1. ISOLOGO "TC" (Cuadrado Lima) */}
            <div className="bg-[#B9CF32] h-10 w-10 md:h-12 md:w-12 rounded-xl flex items-center justify-center text-[#347048] font-black italic text-xl md:text-2xl shadow-lg group-hover:scale-110 transition-transform shrink-0">
              TC
            </div>

            {/* 2. TEXTO "TUCANCHA" (Siempre fijo) */}
            <div className="flex flex-col leading-none min-w-0">
              <span className="text-2xl md:text-3xl font-black tracking-tighter text-[#EBE1D8] italic drop-shadow-sm leading-none mt-1 truncate">
                TuCancha<span className="text-[#B9CF32] opacity-80"></span>
              </span>
            </div>

          </Link>
        </div>

          {/* --- DERECHA: USUARIO / LOGIN --- */}
          {(user || isGuest) && (
            <div className="flex items-center gap-2 sm:gap-4 relative">
              
              {/* 👇 Botones de Navegación 👇 */}
              <div className="hidden sm:flex items-center gap-1 p-1 rounded-full bg-[#EBE1D8]/10">
                
                {/* 1. INICIO: Visible para TODOS (Admins y Clientes). Lleva a la vista pública del club */}
                <NavLink 
                  href="/" 
                  icon={<Home size={16} strokeWidth={2.5} />} 
                  text="Inicio" 
                  active={router.asPath === '/'} 
                />

                {/* 2. MIS TURNOS: Solo para clientes (NO admins) */}
                {!isAdmin && user && (
                  <NavLink 
                    href="/bookings" 
                    icon={<Calendar size={16} strokeWidth={2.5} />} 
                    text="Mis Turnos" 
                    active={isActive('/bookings')} 
                  />
                )}

                {/* 3. GESTIÓN: Para admins tanto en vista pública como en el panel */}
                {isAdmin && (
                  <NavLink 
                    href="/admin/agenda" 
                    icon={<Settings size={16} strokeWidth={2.5} />} 
                    text="Gestión" 
                    active={router.asPath.startsWith('/admin')} 
                  />
                )}
              </div>

              {/* Menú de Usuario (Separado y limpio) */}
              {user ? (
                <div className="relative">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
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
                        <Link href="/bookings" className="flex items-center gap-3 text-[#347048] hover:text-[#B9CF32] p-2 rounded-xl hover:bg-[#347048]/5 transition-colors" onClick={() => setShowUserMenu(false)}>
                          <Calendar size={18} strokeWidth={2.5} /> Mis Reservas
                        </Link>
                        
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
          )}
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
    className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest transition-all border-2 ${
      active
        ? 'bg-[#EBE1D8] text-[#347048] border-[#EBE1D8]'
        : 'text-[#EBE1D8] border-transparent hover:bg-white/20 hover:text-white'
    }`}
  >
    {icon}
    <span className="hidden sm:inline mt-[1px]">{text}</span>
  </Link>
);

export default Navbar;