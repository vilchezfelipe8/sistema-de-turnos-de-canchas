import { ReactNode } from 'react';
// Sidebar ahora se renderiza desde el NavBar para que quede anclado a la barra superior

interface AdminLayoutProps {
  children: ReactNode;
}

const AdminLayout = ({ children }: AdminLayoutProps) => {
  return (
    <div className="min-h-screen bg-background">
      {/* Contenedor Principal:
        md:ml-64: dejo margen a la izquierda para el Sidebar cuando exista (en desktop)
        pt-28: deja espacio arriba para el Navbar (que es fixed)
      */}
      <main className="md:ml-64 pt-28 px-6 pb-10 transition-all duration-300">
        <div className="max-w-6xl mx-auto animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;