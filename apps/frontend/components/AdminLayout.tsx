import { ReactNode } from 'react';
// 👇 IMPORTANTE: Importar los componentes de navegación
import NavBar from './NavBar'; 
import AdminSidebar from './AdminSidebar';

interface AdminLayoutProps {
  children: ReactNode;
}

const AdminLayout = ({ children }: AdminLayoutProps) => {
  return (
    <>
      {/* 1. Renderizamos el Sidebar y el Navbar para que se vean */}
      <AdminSidebar />
      <NavBar />

      {/* Fondo ambiental */}
      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden>
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full blur-[128px]" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 rounded-full blur-[128px]" style={{ backgroundColor: 'rgba(255,255,255,0.02)' }} />
      </div>

      {/* Contenido principal (respetando los márgenes del sidebar y navbar) */}
      <main className="relative z-10 md:ml-64 pt-28 px-6 pb-10 transition-all duration-300 min-h-screen">
        <div className="max-w-6xl mx-auto animate-fade-in">
          {children}
        </div>
      </main>
    </>
  );
};

export default AdminLayout;