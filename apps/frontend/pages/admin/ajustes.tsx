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
  Repeat,
  Receipt,
  ScrollText,
  Star,
  Tag,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import AdminSettingsWorkspace, { type SettingsWorkspaceTab } from '../../modules/ajustes/components/AdminSettingsWorkspace';

type SettingsTab = SettingsWorkspaceTab;

const SETTINGS_TABS: Array<{ value: SettingsTab; label: string; comingSoon?: boolean }> = [
  { value: 'club', label: 'Club' },
  { value: 'canchas', label: 'Canchas' },
  { value: 'reservas', label: 'Reservas' },
  { value: 'horarios', label: 'Horarios' },
  { value: 'precios', label: 'Precios' },
  { value: 'facturacion', label: 'Facturación' },
  { value: 'integraciones', label: 'Integraciones' },
  { value: 'usuarios', label: 'Usuarios' },
  { value: 'socios', label: 'Socios' },
  { value: 'planes', label: 'Planes' },
  { value: 'caja', label: 'Caja' },
  { value: 'excepciones', label: 'Excepciones' },
  { value: 'auditoria', label: 'Auditoría' },
  { value: 'resenas', label: 'Reseñas' },
  { value: 'actividades', label: 'Actividades' },
  { value: 'notificaciones', label: 'Notificaciones', comingSoon: true },
];

const MOBILE_SETTINGS_GROUPS: Array<{
  title: string;
  items: Array<{ value: SettingsTab; description: string; icon: LucideIcon }>;
}> = [
  {
    title: 'El club',
    items: [
      { value: 'club', description: 'Nombre, logo, dirección y contacto', icon: Home },
      { value: 'canchas', description: 'Canchas, deportes y precio base', icon: LayoutGrid },
      { value: 'horarios', description: 'Cuándo abre cada deporte y modalidades', icon: CalendarClock },
      { value: 'excepciones', description: 'Feriados y cierres puntuales', icon: CalendarOff },
    ],
  },
  {
    title: 'Reservas y cobros',
    items: [
      { value: 'reservas', description: 'Confirmación, anticipación y seña', icon: CalendarCheck },
      { value: 'precios', description: 'Por cancha o por jugador, luces y descuentos', icon: Tag },
      { value: 'socios', description: 'Padrón y precios diferenciales', icon: Users },
      { value: 'planes', description: 'Abonos, cuotas y vencimientos', icon: Repeat },
      { value: 'caja', description: 'Reglas para cerrar la caja', icon: Wallet },
      { value: 'facturacion', description: 'Factura electrónica con ARCA', icon: Receipt },
    ],
  },
  {
    title: 'Equipo y sistema',
    items: [
      { value: 'usuarios', description: 'Quién entra al panel', icon: UserCog },
      { value: 'integraciones', description: 'Mercado Pago y otros servicios', icon: Plug },
      { value: 'resenas', description: 'Opiniones de los jugadores', icon: Star },
      { value: 'auditoria', description: 'Registro de cambios', icon: ScrollText },
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
  // Las modalidades viven ahora en Horarios.
  if (raw === 'actividades') return 'horarios';
  if (raw === 'reservas') return 'reservas';
  if (raw === 'horarios') return 'horarios';
  if (raw === 'precios') return 'precios';
  if (raw === 'integraciones') return 'integraciones';
  if (raw === 'usuarios') return 'usuarios';
  if (raw === 'socios' || raw === 'members') return 'socios';
  if (raw === 'planes' || raw === 'plans') return 'planes';
  if (raw === 'caja') return 'caja';
  if (raw === 'excepciones') return 'excepciones';
  if (raw === 'auditoria') return 'auditoria';
  if (raw === 'facturacion') return 'facturacion';
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
        <div className={`min-h-0 flex-1 gap-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] ${showMobileIndex ? 'max-lg:hidden' : ''}`}>
          <nav aria-label="Secciones de ajustes" className="hidden min-h-0 overflow-y-auto pb-6 lg:block">
            <h1 className="mb-4 text-[20px] font-bold tracking-tight text-p-text">Ajustes</h1>
            <div className="space-y-5">
              {MOBILE_SETTINGS_GROUPS.map((group) => (
                <div key={`desk-${group.title}`}>
                  <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">{group.title}</p>
                  <ul className="space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = item.value === activeTab;
                      return (
                        <li key={`desk-${item.value}`}>
                          <button
                            type="button"
                            aria-current={active ? 'page' : undefined}
                            onClick={() => handleChangeTab(item.value)}
                            className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] transition ${
                              active ? 'bg-p-surface-2 font-semibold text-p-text' : 'text-p-text-secondary hover:bg-p-surface-2 hover:text-p-text'
                            }`}
                          >
                            <Icon size={16} className={active ? 'text-p-accent' : 'text-p-text-muted'} />
                            {SETTINGS_TABS.find((tab) => tab.value === item.value)?.label || item.value}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </nav>
          <section className="h-full min-h-0 overflow-y-auto pb-6 lg:pb-8">
            <AdminSettingsWorkspace tab={activeTab} />
          </section>
        </div>
      </div>
    </AdminRouteShell>
  );
}
