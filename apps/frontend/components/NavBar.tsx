import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { logout } from '../services/AuthService';
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
        // Obtener el slug de la URL actual
        const path = router.asPath;
        const slugMatch = path.match(/\/club\/([^\/]+)/);
        
        if (slugMatch && slugMatch[1]) {
          // Si estamos en una página de club, usar el slug de la URL
          const clubData = await ClubService.getClubBySlug(slugMatch[1]);
          setClub(clubData);
        } else {
          // Si no hay slug en la URL, intentar obtener el club del usuario
          const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
          if (userStr) {
            try {
              const user = JSON.parse(userStr);
              if (user?.clubId) {
                const clubData = await ClubService.getClubById(user.clubId);
                setClub(clubData);
              }
            } catch {
              // noop
            }
          }
        }
      } catch (error) {
        console.error('Error al cargar información del club:', error);
      }
    };

    loadClub();
  }, [router.asPath]);

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const isActive = (path: string) => router.pathname === path;
  const isAdmin = user?.role === 'ADMIN';

  return (
    <>
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b ${isScrolled ? 'py-2' : 'py-3'}`} style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
      
      <div className="container mx-auto px-4 flex justify-between items-center">
        
        {/* Logo y Título Estilizado */}
        <Link href={club ? `/club/${club.slug}` : '/'} className="flex items-center gap-3 group">
  
        {/* 1. LOGO (Se mantiene igual) */}
        <img 
          src={club?.logoUrl || '/logo1.svg'} 
          alt={club?.name || 'Logo'} 
          className="h-16 w-16 md:h-20 md:w-20 object-contain transition-transform group-hover:scale-110" 
          onError={(e) => { (e.target as HTMLImageElement).src = '/logo1.svg'; }}
        />

        {/* 2. TEXTO DINÁMICO (Ahora visible en celular) */}
        {/* 👇 CAMBIO: Se eliminó la clase 'max-[900px]:hidden' */}
        <div className="flex flex-col justify-center">
            
            {/* TÍTULO PRINCIPAL */}
            {/* 👇 CAMBIO: Tamaño base 'text-3xl' para celular. Luego crece en md y lg */}
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-extrabold text-white uppercase tracking-tighter leading-none whitespace-nowrap">
              {club?.name || 'LAS TEJAS'}
            </h1>
            
            {/* SUBTÍTULO (El tamaño pequeño está bien para celular) */}
            <span className="text-[9px] md:text-[11px] font-bold text-gray-300 uppercase tracking-[0.4em] leading-tight pl-0.5 mt-1">
              CLUB DE PADEL Y AMIGOS
            </span>

        </div>
      </Link>

        {/* Menú (si está logueado o es invitado) */}
        {(user || isGuest) && (
          <div className="flex items-center gap-1 p-1 rounded-full" style={{ backgroundColor: 'var(--surface)' }}>
            
            {!isAdmin && (
              <>
                <NavLink href={club ? `/club/${club.slug}` : '/'} icon="🏠" text="Inicio" active={router.asPath.startsWith('/club/') || router.asPath === '/'} />
                {user && <NavLink href="/bookings" icon="📅" text="Mis Turnos" active={isActive('/bookings')} />}
              </>
            )}

            {isAdmin && (
              <NavLink href="/admin/agenda" icon="⚙️" text="Gestión" active={router.asPath.startsWith('/admin')} />
            )}

            {/* Botón Cerrar Sesión (solo para usuarios autenticados) */}
            {user ? (
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-all text-text hover:bg-surface ml-2"
              >
                <span>🚪</span>
                <span className="hidden sm:inline">Salir</span>
              </button>
            ) : (
              <Link href={`/login?from=${encodeURIComponent(router.asPath)}`} className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-all text-text hover:bg-surface ml-2">
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
    className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-bold transition-all border ${active ? 'bg-surface text-text border-border' : 'text-muted border-transparent hover:bg-surface hover:text-text'}`}
  >
    <span>{icon}</span>
    <span className="hidden sm:inline">{text}</span>
  </Link>
);

export default Navbar;