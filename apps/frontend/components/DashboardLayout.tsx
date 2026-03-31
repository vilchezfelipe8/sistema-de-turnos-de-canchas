import { ReactNode } from 'react';
import Sidebar from './Sidebar';

interface DashboardLayoutProps {
  children: ReactNode;
  activeTab: string; // Para resaltar el item activo en la sidebar
}

const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children, activeTab }) => {
  return (
    <div className="flex min-h-screen bg-surface-90">
      {/* Sidebar fija */}
      <Sidebar activeTab={activeTab} />
      
      {/* Área de contenido principal */}
      <main className="density-compact flex-1 ml-56 p-6 lg:p-8 bg-surface-95">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

export default DashboardLayout;