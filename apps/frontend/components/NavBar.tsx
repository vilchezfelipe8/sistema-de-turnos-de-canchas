import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { logout } from '../services/AuthService';

export default function Navbar() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [menuOpen, setMenuOpen] = useState(false); // Para móvil (opcional)

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    setIsLoggedIn(!!token);
    if (userData) {
      setUser(JSON.parse(userData));
    }
  }, []);

  const handleLogout = () => {
    logout();
    setIsLoggedIn(false);
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <nav className="bg-gradient-to-r from-orange-700 via-orange-600 to-amber-700 text-white shadow-xl sticky top-0 z-50 border-b-4 border-orange-800/30">
      <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4">
        <div className="flex justify-between items-center">
          {/* LOGO */}
          <Link href="/" className="flex items-center gap-2 sm:gap-3 tracking-tight hover:scale-105 transition-transform">
            <span className="text-2xl sm:text-3xl drop-shadow-lg">🏓</span> 
            <div className="flex flex-col">
              <span className="text-white drop-shadow-md text-lg sm:text-2xl font-black leading-tight">
                LAS TEJAS
              </span>
              <span className="text-orange-100 text-[10px] sm:text-xs font-medium tracking-wider hidden sm:block">
                CLUB DE PADEL Y AMIGOS
              </span>
            </div>
          </Link>

          {/* MENÚ DE ESCRITORIO */}
          <div className="hidden md:flex gap-3 lg:gap-4 items-center font-bold">
            {isLoggedIn ? (
              <>
                <Link 
                  href="/" 
                  className="px-3 lg:px-4 py-2 rounded-xl hover:bg-white/20 transition-all backdrop-blur-sm border border-white/20 hover:scale-105 text-sm lg:text-base"
                >
                  🏠 Inicio
                </Link>
                <Link 
                  href="/mis-reservas" 
                  className="px-3 lg:px-4 py-2 rounded-xl hover:bg-white/20 transition-all backdrop-blur-sm border border-white/20 hover:scale-105 text-sm lg:text-base"
                >
                  📅 Mis Turnos
                </Link>
                {user && user.role === 'ADMIN' && (
                  <Link 
                    href="/admin" 
                    className="px-3 lg:px-4 py-2 rounded-xl hover:bg-white/20 transition-all backdrop-blur-sm border border-white/20 hover:scale-105 text-sm lg:text-base"
                  >
                    ⚙️ Admin
                  </Link>
                )}
                
                <div className="h-8 w-px bg-white/30 mx-2"></div>

                <button 
                  onClick={handleLogout}
                  className="bg-red-500 hover:bg-red-600 text-white px-4 lg:px-5 py-2 rounded-xl font-bold transition-all shadow-lg hover:shadow-red-900/50 transform hover:scale-105 flex items-center gap-2 border-2 border-red-400 text-sm lg:text-base"
                >
                  <span>🚪</span>
                  <span className="hidden lg:inline">Cerrar Sesión</span>
                  <span className="lg:hidden">Salir</span>
                </button>
              </>
            ) : (
              <Link 
                href="/login" 
                className="bg-white/20 backdrop-blur-lg hover:bg-white/30 text-white px-4 lg:px-6 py-2 lg:py-2.5 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl border-2 border-white/30 hover:scale-105 flex items-center gap-2 text-sm lg:text-base"
              >
                <span>🔐</span>
                <span>Ingresar</span>
              </Link>
            )}
          </div>

          {/* BOTÓN HAMBURGUESA PARA MÓVIL */}
          <div className="md:hidden">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 rounded-lg hover:bg-white/20 transition-colors"
              aria-label="Menú"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {menuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* MENÚ MÓVIL */}
        {menuOpen && (
          <div className="md:hidden mt-4 pb-4 border-t border-white/20 pt-4">
            <div className="flex flex-col gap-3">
              {isLoggedIn ? (
                <>
                  <Link 
                    href="/" 
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-3 rounded-xl hover:bg-white/20 transition-all backdrop-blur-sm border border-white/20 text-center"
                  >
                    🏠 Inicio
                  </Link>
                  <Link 
                    href="/mis-reservas" 
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-3 rounded-xl hover:bg-white/20 transition-all backdrop-blur-sm border border-white/20 text-center"
                  >
                    📅 Mis Turnos
                  </Link>
                  {user && user.role === 'ADMIN' && (
                    <Link 
                      href="/admin" 
                      onClick={() => setMenuOpen(false)}
                      className="px-4 py-3 rounded-xl hover:bg-white/20 transition-all backdrop-blur-sm border border-white/20 text-center"
                    >
                      ⚙️ Admin
                    </Link>
                  )}
                  <button 
                    onClick={() => {
                      setMenuOpen(false);
                      handleLogout();
                    }}
                    className="bg-red-500 hover:bg-red-600 text-white px-4 py-3 rounded-xl font-bold transition-all shadow-lg border-2 border-red-400 w-full"
                  >
                    🚪 Cerrar Sesión
                  </button>
                </>
              ) : (
                <Link 
                  href="/login" 
                  onClick={() => setMenuOpen(false)}
                  className="bg-white/20 backdrop-blur-lg hover:bg-white/30 text-white px-4 py-3 rounded-xl font-bold transition-all shadow-lg border-2 border-white/30 text-center"
                >
                  🔐 Ingresar
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}