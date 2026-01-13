import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { logout } from '../services/AuthService'; 

const Navbar = () => {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    // Verificar si hay usuario logueado
    const userStr = localStorage.getItem('user');
    if (userStr) {
      setUser(JSON.parse(userStr));
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
    window.location.href = '/login';
  };

  const isActive = (path: string) => router.pathname === path;

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b border-white/5
      ${isScrolled ? 'bg-slate-950/80 backdrop-blur-xl py-2 shadow-lg' : 'bg-slate-950/50 backdrop-blur-md py-3'}`}>
      
      <div className="container mx-auto px-4 flex justify-between items-center">
        
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <span className="text-2xl transition-transform group-hover:scale-110">🎾</span>
          <div className="flex flex-col leading-none">
            <span className="font-black text-lg text-white tracking-tight group-hover:text-lime-400 transition-colors">LAS TEJAS</span>
            <span className="text-[10px] font-bold text-lime-500 uppercase tracking-widest">Club & Amigos</span>
          </div>
        </Link>

        {/* Menú (Solo si está logueado) */}
        {user && (
          <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-full border border-white/10">
            
            <NavLink href="/" icon="🏠" text="Inicio" active={isActive('/')} />
            <NavLink href="/bookings" icon="📅" text="Mis Turnos" active={isActive('/bookings')} />
            
            {user.role === 'ADMIN' && (
              <NavLink href="/admin" icon="⚙️" text="Admin" active={isActive('/admin')} />
            )}

            {/* Botón Cerrar Sesión */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-all
                          text-red-400 hover:bg-red-950/50 hover:text-red-200 ml-2"
            >
              <span>🚪</span>
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
};

// Subcomponente para los enlaces del menú
const NavLink = ({ href, icon, text, active }: any) => (
  <Link href={href}
    className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-bold transition-all border
      ${active 
        ? 'bg-lime-500 text-slate-950 border-lime-400 shadow-[0_0_10px_rgba(132,204,22,0.3)]' 
        : 'text-slate-300 border-transparent hover:bg-slate-800 hover:text-lime-400'
      }`}
  >
    <span>{icon}</span>
    <span className="hidden sm:inline">{text}</span>
  </Link>
);

export default Navbar;