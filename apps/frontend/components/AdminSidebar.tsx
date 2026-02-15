import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Calendar, Users, Package, DollarSign, LayoutGrid, BarChart3, Settings, LogOut } from 'lucide-react';

interface AdminSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const AdminSidebar = ({ isOpen, onClose }: AdminSidebarProps) => {
  const router = useRouter();
  const hasMountedRef = useRef(false);

  // Cerrar el sidebar automáticamente cuando cambiamos de ruta
  useEffect(() => {
    if (hasMountedRef.current) {
      onClose();
    }
    hasMountedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.asPath]);

  const navItems = [
    { name: 'Turnos', path: '/admin/agenda', icon: <Calendar size={20} /> },
    { name: 'Clientes', path: '/admin/clientes', icon: <Users size={20} /> },
    { name: 'Productos & Stock', path: '/admin/products', icon: <Package size={20} /> },
    { name: 'Caja y Movimientos', path: '/admin/cash', icon: <DollarSign size={20} /> },
    { name: 'Canchas', path: '/admin/canchas', icon: <LayoutGrid size={20} /> },
    { name: 'Métricas', path: '/admin/metrics', icon: <BarChart3 size={20} /> }, 
    { name: 'Configuración', path: '/admin/settings', icon: <Settings size={20} /> },
  ];

  return (
    <>
      {/* 1. BACKDROP OSCURO (Fondo negro transparente) */}
      <div 
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* 2. EL PANEL LATERAL (Drawer) */}
      <aside
        className={`fixed top-0 left-0 h-full w-[280px] bg-[#EBE1D8] z-[70] shadow-2xl transform transition-transform duration-300 ease-out flex flex-col border-r-4 border-[#347048]/20 pt-16 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        
        {/* CABECERA */}
        <div className="p-6 flex justify-between items-center border-b border-[#347048]/10 bg-[#EBE1D8]">
          <div>
            <h2 className="text-2xl font-black text-[#926699] tracking-tighter italic uppercase">
                Panel Admin
            </h2>
            <p className="text-[#347048] text-[10px] font-bold uppercase tracking-widest opacity-60">
                Gestión del Club
            </p>
          </div>
        </div>

        {/* LISTA DE NAVEGACIÓN */}
        <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-2">
          {navItems.map((item) => {
            const isActive = router.pathname === item.path;
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 group ${
                  isActive
                    // ACTIVO: Fondo Verde Oscuro, Texto Lima, Sombra
                    ? 'bg-[#347048] text-[#B9CF32] font-black shadow-lg shadow-[#347048]/30 translate-x-1'
                    // INACTIVO: Texto Verde, Hover Fondo Blanco
                    : 'text-[#347048] hover:bg-white hover:text-[#347048] font-bold hover:shadow-sm'
                }`}
              >
                <span className={`${isActive ? 'text-[#B9CF32]' : 'text-[#347048]/60 group-hover:text-[#347048]'}`}>
                    {item.icon}
                </span>
                <span className="text-sm tracking-wide">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* FOOTER */}
        <div className="p-6 border-t border-[#347048]/10 bg-[#dcd0c5]/30">
            <div className="flex items-center gap-3 px-4 py-3 bg-[#347048]/5 rounded-xl border border-[#347048]/5">
                <div className="w-2 h-2 rounded-full bg-[#0bbd49] animate-pulse shrink-0" />
                <span className="text-xs font-bold text-[#347048]/60 uppercase tracking-wider">
                    Sistema Online
                </span>
            </div>
        </div>

      </aside>
    </>
  );
};

export default AdminSidebar;