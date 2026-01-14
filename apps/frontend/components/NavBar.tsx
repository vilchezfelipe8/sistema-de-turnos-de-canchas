import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { logout } from '../services/AuthService'; 

const Navbar = () => {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

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

  const handleLogout = () => {
    logout();
    window.location.href = '/';
  };

  const isActive = (path: string) => router.pathname === path;

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b ${isScrolled ? 'py-2' : 'py-3'}`} style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
      
      <div className="container mx-auto px-4 flex justify-between items-center">
        
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <img src="/logo1.svg" alt="LAS TEJAS" className="h-20 w-20 object-contain transition-transform group-hover:scale-110" />
          <div className="flex flex-col leading-none">
            <img src="/LasTejasBlanco.svg" alt="LAS TEJAS" className="h-8 md:h-12 lg:h-16 object-contain max-[900px]:hidden" />
          </div>
        </Link>

        {/* Menú (si está logueado o es invitado) */}
        {(user || isGuest) && (
          <div className="flex items-center gap-1 p-1 rounded-full" style={{ backgroundColor: 'var(--surface)' }}>
            
            <NavLink href="/" icon="🏠" text="Inicio" active={isActive('/')} />
            {user && <NavLink href="/bookings" icon="📅" text="Mis Turnos" active={isActive('/bookings')} />}
            
            {user?.role === 'ADMIN' && (
              <NavLink href="/admin" icon="⚙️" text="Admin" active={isActive('/admin')} />
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
              <Link href="/login" className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-all text-text hover:bg-surface ml-2">
                <span>🔐</span>
                <span className="hidden sm:inline">Ingresar</span>
              </Link>
            )}
          </div>
        )}
      </div>
    </nav>
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