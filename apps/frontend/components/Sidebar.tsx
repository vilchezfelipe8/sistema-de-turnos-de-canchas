import { useRouter } from 'next/router';
import Link from 'next/link';
import { Calendar, Activity, Settings } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab }) => {
  const router = useRouter();

  const menuItems = [
    {
      id: 'agenda',
      label: 'Gestión de Turnos',
      icon: <Calendar size={18} strokeWidth={2.5} />,
      href: '/admin/agenda',
    },
    {
      id: 'canchas',
      label: 'Gestión de Canchas',
      icon: <Activity size={18} strokeWidth={2.5} />,
      href: '/admin/canchas',
    },
    {
      id: 'settings',
      label: 'Configuración',
      icon: <Settings size={18} strokeWidth={2.5} />,
      href: '/admin/settings',
    },
  ];

  return (
    <aside className="w-56 bg-gradient-to-b from-surface-80 to-surface-90 backdrop-blur-lg border-r border-border/50 shadow-xl fixed left-0 top-0 h-full z-40">
      <div className="p-6">
        <h2 className="text-xl font-bold text-text mb-8">Panel Admin</h2>
        <nav className="space-y-2">
          {menuItems.map((item) => (
            <Link key={item.id} href={item.href}>
              <a
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === item.id
                    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 shadow-lg'
                    : 'text-muted hover:bg-surface-70 hover:text-text'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </a>
            </Link>
          ))}
        </nav>
      </div>
      {/* Opcional: Footer con info del usuario o logo */}
      <div className="absolute bottom-6 left-6 right-6">
        <p className="text-xs text-muted">Sistema Turnos v1.0</p>
      </div>
    </aside>
  );
};

export default Sidebar;