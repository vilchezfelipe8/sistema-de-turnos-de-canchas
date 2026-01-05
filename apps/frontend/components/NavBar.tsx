import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { logout } from '../services/AuthService';

export default function Navbar() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // Para móvil (opcional)

  useEffect(() => {
    const token = localStorage.getItem('token');
    setIsLoggedIn(!!token);
  }, []);

  const handleLogout = () => {
    logout();
    setIsLoggedIn(false);
    window.location.href = '/login';
  };

  return (
    <nav className="bg-slate-900 text-white shadow-lg sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        {/* LOGO */}
        <Link href="/" className="text-xl font-bold flex items-center gap-2 tracking-tight hover:text-blue-400 transition">
          <span className="text-2xl">🎾</span> 
          <span>Club<span className="text-blue-500">Deportivo</span></span>
        </Link>

        {/* MENÚ DE ESCRITORIO */}
        <div className="flex gap-6 items-center font-medium">
          {isLoggedIn ? (
            <>
              <Link href="/" className="hover:text-blue-400 transition-colors">
                Inicio
              </Link>
              <Link href="/mis-reservas" className="hover:text-blue-400 transition-colors">
                Mis Turnos
              </Link>
              <Link href="/admin" className="hover:text-blue-400 transition-colors">
                Admin
              </Link>
              
              <div className="h-6 w-px bg-slate-700 mx-2"></div> {/* Separador */}

              <button 
                onClick={handleLogout}
                className="bg-red-600/90 hover:bg-red-600 text-white px-4 py-2 rounded-full text-sm transition-all shadow-md hover:shadow-red-900/20"
              >
                Cerrar Sesión
              </button>
            </>
          ) : (
            <Link 
              href="/login" 
              className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-full font-bold transition-all shadow-lg shadow-blue-900/20"
            >
              Ingresar
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}