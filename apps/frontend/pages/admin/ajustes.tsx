import { useRouter } from 'next/router';
import {
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Home,
  LayoutGrid,
  Plug,
  ScrollText,
  Star,
  Tag,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import { AdminSegmentedControl } from '../../components/admin/ui';
import AdminSettingsWorkspace, { type SettingsWorkspaceTab } from '../../modules/ajustes/components/AdminSettingsWorkspace';

type SettingsTab = SettingsWorkspaceTab;

const SETTINGS_TABS: Array<{ value: SettingsTab; label: string; comingSoon?: boolean }> = [
  { value: 'club', label: 'Club' },
  { value: 'canchas', label: 'Canchas' },
  { value: 'reservas', label: 'Reservas' },
  { value: 'horarios', label: 'Horarios' },
  { value: 'precios', label: 'Precios' },
  { value: 'integraciones', label: 'Integraciones' },
  { value: 'usuarios', label: 'Usuarios' },
  { value: 'socios', label: 'Socios' },
  { value: 'excepciones', label: 'Excepciones' },
  { value: 'auditoria', label: 'Auditoría' },
  { value: 'resenas', label: 'Reseñas' },
  { value: 'actividades', label: 'Actividades' },
  { value: 'notificaciones', label: 'Notificaciones', comingSoon: true },
];

const orderedSettingsTabs = [
  ...SETTINGS_TABS.filter((tab) => !tab.comingSoon),
  ...SETTINGS_TABS.filter((tab) => tab.comingSoon),
];

const MOBILE_SETTINGS_GROUPS: Array<{
  title: string;
  items: Array<{ value: SettingsTab; description: string; icon: LucideIcon }>;
}> = [
  {
    title: 'Club',
    items: [
      { value: 'club', description: 'Nombre, logo, dirección y contacto', icon: Home },
      { value: 'canchas', description: 'Canchas, deportes y duración', icon: LayoutGrid },
      { value: 'actividades', description: 'Actividades del club', icon: Dumbbell },
      { value: 'horarios', description: 'Apertura y cierre por día', icon: CalendarClock },
      { value: 'excepciones', description: 'Feriados y cierres puntuales', icon: CalendarOff },
    ],
  },
  {
    title: 'Reservas y cobros',
    items: [
      { value: 'reservas', description: 'Reglas y ventana de reserva', icon: CalendarCheck },
      { value: 'precios', description: 'Tarifas y descuentos', icon: Tag },
      { value: 'socios', description: 'Padrón y precios diferenciales', icon: Users },
      { value: 'resenas', description: 'Opiniones de los jugadores', icon: Star },
    ],
  },
  {
    title: 'Equipo y sistema',
    items: [
      { value: 'usuarios', description: 'Administradores y permisos', icon: UserCog },
      { value: 'integraciones', description: 'Servicios conectados', icon: Plug },
      { value: 'auditoria', description: 'Registro de cambios', icon: ScrollText },
      { value: 'notificaciones', description: 'Avisos automáticos', icon: Bell },
    ],
  },
];

const parseSettingsTab = (value: unknown): SettingsTab => {
  const raw = String(value || '').toLowerCase();
  if (raw === 'identity') return 'club';
  if (raw === 'operation') return 'reservas';
  if (raw === 'agenda') return 'horarios';
  if (raw === 'discounts') return 'precios';
  if (raw === 'audit') return 'auditoria';
  if (raw === 'canchas') return 'canchas';
  if (raw === 'actividades') return 'actividades';
  if (raw === 'reservas') return 'reservas';
  if (raw === 'horarios') return 'horarios';
  if (raw === 'precios') return 'precios';
  if (raw === 'integraciones') return 'integraciones';
  if (raw === 'usuarios') return 'usuarios';
  if (raw === 'socios' || raw === 'members') return 'socios';
  if (raw === 'notificaciones') return 'notificaciones';
  if (raw === 'excepciones') return 'excepciones';
  if (raw === 'auditoria') return 'auditoria';
  if (raw === 'resenas' || raw === 'reseñas' || raw === 'reviews' || raw === 'review') return 'resenas';
  return 'club';
};

export default function AdminSettingsV2Page() {
  const router = useRouter();
  const activeTab = parseSettingsTab(router.query.tab);
  const hasExplicitTab = typeof router.query.tab === 'string' && router.query.tab.trim() !== '';
  const showMobileIndex = router.isReady && !hasExplicitTab;
  const activeTabLabel = SETTINGS_TABS.find((tab) => tab.value === activeTab)?.label || 'Ajustes';

  const handleBackToMobileIndex = () => {
    const restQuery = { ...router.query };
    delete restQuery.tab;
    void router.replace({ pathname: '/admin/ajustes', query: restQuery }, undefined, { shallow: true });
  };

  const handleChangeTab = (nextTab: SettingsTab) => {
    if (nextTab === activeTab) return;
    void router.replace(
      {
        pathname: '/admin/ajustes',
        query: { ...router.query, tab: nextTab },
      },
      undefined,
      { shallow: true }
    );
  };

  return (
    <AdminRouteShell title="Ajustes | Pique Admin" activeItem="Ajustes" fromPath="/admin/ajustes">
      <div className="flex h-full min-h-0 flex-col gap-3 p-3.5 pb-0 lg:gap-4 lg:p-6 lg:pb-0">
        {showMobileIndex ? (
          <h1 className="text-[22px] font-extrabold tracking-[-0.03em] text-p-text lg:hidden">Ajustes</h1>
        ) : (
          <div className="flex items-center gap-2.5 lg:hidden">
            <button
              type="button"
              onClick={handleBackToMobileIndex}
              aria-label="Volver a ajustes"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-p-border bg-p-surface text-p-text-secondary"
            >
              <ChevronLeft size={17} />
            </button>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-p-text-muted">Ajustes</p>
              <h1 className="truncate text-[18px] font-extrabold tracking-[-0.02em] text-p-text">{activeTabLabel}</h1>
            </div>
          </div>
        )}
        <AdminSegmentedControl
          options={orderedSettingsTabs.map((tab) => ({ value: tab.value, label: tab.label }))}
          value={activeTab}
          onChange={(value) => handleChangeTab(value as SettingsTab)}
          ariaLabel="Subnavegacion de ajustes"
          className="w-fit max-lg:hidden"
        />
        {showMobileIndex && (
          <section className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-6 lg:hidden">
            {MOBILE_SETTINGS_GROUPS.map((group) => (
              <div key={group.title}>
                <p className="mb-2 text-[11px] font-bold text-p-text-muted">{group.title}</p>
                <div className="overflow-hidden rounded-2xl border border-p-border bg-p-surface">
                  {group.items.map((item, index) => {
                    const tabMeta = SETTINGS_TABS.find((tab) => tab.value === item.value);
                    const Icon = item.icon;
                    const isComingSoon = Boolean(tabMeta?.comingSoon);
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => handleChangeTab(item.value)}
                        className={`flex min-h-[54px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-p-surface-2 ${
                          index < group.items.length - 1 ? 'border-b border-p-border' : ''
                        }`}
                      >
                        <Icon size={18} className={isComingSoon ? 'shrink-0 text-p-text-muted' : 'shrink-0 text-p-accent'} />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[14px] font-semibold ${isComingSoon ? 'text-p-text-muted' : 'text-p-text'}`}>
                            {tabMeta?.label || item.value}
                          </span>
                          <span className="block truncate text-[11px] text-p-text-muted">{item.description}</span>
                        </span>
                        {isComingSoon ? (
                          <span className="shrink-0 rounded-full bg-p-surface-2 px-2 py-0.5 text-[10px] font-bold text-p-text-muted">
                            Próximamente
                          </span>
                        ) : (
                          <ChevronRight size={16} className="shrink-0 text-p-text-muted" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}
        <section className={`min-h-0 flex-1 overflow-y-auto pb-6 lg:pb-8 ${showMobileIndex ? 'max-lg:hidden' : ''}`}>
          <AdminSettingsWorkspace tab={activeTab} />
        </section>
      </div>
    </AdminRouteShell>
  );
}
