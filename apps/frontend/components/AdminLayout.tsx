import { ReactNode } from 'react';
// Sidebar ahora se renderiza desde el NavBar para que quede anclado a la barra superior

interface AdminLayoutProps {
  children: ReactNode;
}

const AdminLayout = ({ children }: AdminLayoutProps) => {
  return (
    <>
      {/* Fondo ambiental (mismo que en el resto del sistema) */}
      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden>
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full blur-[128px]" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 rounded-full blur-[128px]" style={{ backgroundColor: 'rgba(255,255,255,0.02)' }} />
      </div>
      <main className="relative z-10 md:ml-64 pt-28 px-6 pb-10 transition-all duration-300 min-h-screen">
        <div className="max-w-6xl mx-auto animate-fade-in">
          {children}
        </div>
      </main>
    </>
  );
};

export default AdminLayout;