import { ReactNode, useState } from 'react';
import NavBar from './NavBar'; 
import AdminSidebar from './AdminSidebar';

interface AdminLayoutProps {
  children: ReactNode;
}

const AdminLayout = ({ children }: AdminLayoutProps) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    // "min-h-screen" asegura el mínimo, pero el color viene del bg-fixed de abajo
    <div className="relative min-h-screen w-full text-[#EBE1D8] selection:bg-[#B9CF32] selection:text-[#347048]">
      
      {/* CAPA DE FONDO FIJA E INFINITA */}
      <div className="fixed inset-0 z-0 bg-[#347048] pointer-events-none">
        {/* Blobs de luz */}
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[128px] opacity-20" style={{ backgroundColor: '#B9CF32' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full blur-[128px] opacity-30" style={{ backgroundColor: '#926699' }} />
      </div>

      {/* Navegación */}
      <div className="relative z-50">
        <NavBar onMenuClick={() => setIsSidebarOpen((prev) => !prev)} />
        <AdminSidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      </div>

      {/* Contenido: z-10 para estar sobre el fondo fijo */}
      <main className="relative z-10 pt-28 px-6 pb-20 transition-all duration-300">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;