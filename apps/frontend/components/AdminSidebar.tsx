import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { PanelLeftClose, PanelRight } from 'lucide-react';

const STORAGE_KEY = 'adminSidebarCollapsed';
const TRANSITION = 'transition-all duration-300 ease-in-out';

const AdminSidebar = () => {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  const navItems = [
    { name: 'Turnos', path: '/admin/agenda', icon: '📅' },
    { name: 'Clientes', path: '/admin/clientes', icon: '👥' },
    { name: 'Productos & Stock', path: '/admin/products', icon: '📦' },
    { name: 'Caja y Movimientos', path: '/admin/cash', icon: '💰' },
    { name: 'Canchas', path: '/admin/canchas', icon: '🏓' },
    { name: 'Métricas', path: '/admin/metrics', icon: '📊' }, 
    { name: 'Configuración', path: '/admin/settings', icon: '⚙️' },
  ];

  return (
    <aside
      className={`fixed left-0 top-0 h-full z-40 hidden md:flex flex-col pt-32 border-r border-gray-800 select-none ${TRANSITION} ${
        scrolled ? '-translate-y-1 shadow-2xl bg-gray-800/95' : 'translate-y-0 bg-gray-900'
      } ${collapsed ? 'w-16 pr-2' : 'w-64'}`}
      style={{ overflowX: 'hidden', overflowY: 'auto', boxSizing: 'border-box' }}
    >
      {/* Header: título + botón toggle (botón siempre a la derecha) */}
      <div className="flex items-center justify-between shrink-0 border-b border-gray-800/50 gap-2 px-4 py-4 min-w-0">
        <div
          className={`overflow-hidden whitespace-nowrap min-w-0 ${TRANSITION} ${
            collapsed ? 'max-w-0 opacity-0' : 'max-w-[11rem] opacity-100'
          }`}
        >
          <h2 className="text-xl font-bold text-white tracking-tight">Panel Admin</h2>
          <p className="text-gray-400 text-xs uppercase tracking-wider mt-0.5">Administración del Club</p>
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="p-2 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white shrink-0"
          title={collapsed ? 'Expandir menú' : 'Ocultar menú'}
          aria-label={collapsed ? 'Expandir menú' : 'Ocultar menú'}
        >
          {collapsed ? <PanelRight className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>
      </div>

      <nav className={`flex-1 min-w-0 py-2 overflow-x-hidden overflow-y-auto ${collapsed ? 'pr-3' : ''}`}>
        <div className={`space-y-1 ${collapsed ? 'pl-3 pr-0' : 'px-4'}`}>
          {navItems.map((item) => {
            const isActive = router.pathname === item.path;
            return (
              <Link
                key={item.path}
                href={item.path}
                title={item.name}
                className={`flex items-center rounded-lg py-3 px-2 group ${
                  collapsed ? 'w-fit mr-2' : 'w-full'
                } ${
                  isActive
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span
                  className={`shrink-0 w-6 text-lg text-center group-hover:scale-110 ${
                    isActive ? 'scale-110' : ''
                  }`}
                >
                  {item.icon}
                </span>
                <span
                  className={`ml-3 font-medium text-sm overflow-hidden whitespace-nowrap ${TRANSITION} ${
                    collapsed ? 'max-w-0 opacity-0 min-w-0' : 'max-w-[10rem] opacity-100'
                  }`}
                >
                  {item.name}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer: altura fija, icono siempre en la misma posición */}
      <div className="shrink-0 border-t border-gray-800 flex items-center min-h-[3.25rem] px-4 py-3">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
        <span
          className={`ml-2 text-xs text-gray-500 overflow-hidden whitespace-nowrap ${TRANSITION} ${
            collapsed ? 'max-w-0 opacity-0 min-w-0' : 'max-w-[8rem] opacity-100'
          }`}
        >
          Sistema Online
        </span>
      </div>
    </aside>
  );
};

export default AdminSidebar;