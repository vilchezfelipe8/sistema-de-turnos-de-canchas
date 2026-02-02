import React, { useEffect, useState } from 'react';
import Link from 'next/link'; 
import { useRouter } from 'next/router'; 
import { Package } from 'lucide-react';

const AdminSidebar = () => {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 👇 AQUÍ SOLO AGREGUÉ LA LÍNEA DE CLIENTES (tab: 'clients')
  // El resto de los estilos y lógica son EXACTAMENTE los tuyos.
  const navItems = [
    { name: 'Gestión de Canchas', path: '/admin/canchas', icon: '🏓', tab: 'courts' },
    { name: 'Gestión de Turnos', path: '/admin/agenda', icon: '📅', tab: 'bookings' },
    { name: 'Gestión de Clientes', path: '/admin/clientes', icon: '👥', tab: 'clients' }, 
    { name: 'Gestión de Stock', path: `/admin/products`, icon: '📦', tab: 'products'},
    { name: 'Configuración', path: '/admin/settings', icon: '⚙️', tab: 'club' },
  ];

  return (
    // z-40: Para que quede POR DEBAJO del Navbar (que suele tener z-50)
    <aside className={`fixed left-0 top-0 h-full w-64 z-40 hidden md:block overflow-y-auto transform transition-transform duration-300 pt-32 ${scrolled ? '-translate-y-1 shadow-2xl bg-gray-800/95 border-gray-700' : 'translate-y-0 bg-gray-900 border-gray-800'}`}>
      <div className="px-4 mb-8">
        <h2 className="text-xl font-bold text-white tracking-tight">Panel Admin</h2>
        <p className="text-gray-400 text-xs uppercase tracking-wider mt-1">Administración del Club</p>
      </div>

      <nav className="space-y-1 px-2">
        {navItems.map((item) => {
          const isClubAdmin = /\/club\/[^\/]+\/admin/.test(router.asPath);

          if (isClubAdmin) {
            // Lógica original para cambiar de pestaña sin recargar
            const isActive = router.query.tab === item.tab || (!router.query.tab && item.tab === 'courts' && router.asPath.endsWith('/admin'));

            const handleClick = (e: React.MouseEvent) => {
              e.preventDefault();
              const slugMatch = router.asPath.match(/\/club\/([^\/]+)\/admin/);
              const slug = slugMatch ? slugMatch[1] : undefined;
              if (slug) {
                router.push({ pathname: `/club/${slug}/admin`, query: { tab: item.tab } }, undefined, { shallow: true });
              }
            };

            return (
              <button
                key={item.path}
                onClick={handleClick}
                className={`w-full text-left flex items-center px-4 py-3 rounded-lg transition-all duration-200 group ${
                  isActive
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span className={`mr-3 text-lg transition-transform group-hover:scale-110 ${isActive ? 'scale-110' : ''}`}>
                  {item.icon}
                </span>
                <span className="font-medium text-sm">{item.name}</span>
              </button>
            );
          }

          // Enlaces normales
          const isActive = router.asPath.startsWith(item.path);
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex items-center px-4 py-3 rounded-lg transition-all duration-200 group ${
                isActive
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <span className={`mr-3 text-lg transition-transform group-hover:scale-110 ${isActive ? 'scale-110' : ''}`}>
                {item.icon}
              </span>
              <span className="font-medium text-sm">{item.name}</span>
            </Link>
          );
        })}
      </nav>
      
      <div className="absolute bottom-0 left-0 w-full p-4 border-t border-gray-800">
        <div className="flex items-center gap-2 text-xs text-gray-500">
           <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
           <span>Sistema Online</span>
        </div>
      </div>
    </aside>
  );
};

export default AdminSidebar;