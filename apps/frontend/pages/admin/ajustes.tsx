import { useRouter } from 'next/router';
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
  { value: 'excepciones', label: 'Excepciones' },
  { value: 'auditoria', label: 'Auditoría' },
  { value: 'resenas', label: 'Reseñas' },
  { value: 'actividades', label: 'Actividades', comingSoon: true },
  { value: 'notificaciones', label: 'Notificaciones', comingSoon: true },
];

const orderedSettingsTabs = [
  ...SETTINGS_TABS.filter((tab) => !tab.comingSoon),
  ...SETTINGS_TABS.filter((tab) => tab.comingSoon),
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
  if (raw === 'notificaciones') return 'notificaciones';
  if (raw === 'excepciones') return 'excepciones';
  if (raw === 'auditoria') return 'auditoria';
  if (raw === 'resenas' || raw === 'reseñas' || raw === 'reviews' || raw === 'review') return 'resenas';
  return 'club';
};

export default function AdminSettingsV2Page() {
  const router = useRouter();
  const activeTab = parseSettingsTab(router.query.tab);

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
      <div className="flex h-full min-h-0 flex-col gap-4 p-4 pb-0 lg:p-6 lg:pb-0">
        <AdminSegmentedControl
          options={orderedSettingsTabs.map((tab) => ({ value: tab.value, label: tab.label }))}
          value={activeTab}
          onChange={(value) => handleChangeTab(value as SettingsTab)}
          ariaLabel="Subnavegacion de ajustes"
          className="w-fit"
        />
        <section className="min-h-0 flex-1 overflow-y-auto pb-6 lg:pb-8">
          <AdminSettingsWorkspace tab={activeTab} />
        </section>
      </div>
    </AdminRouteShell>
  );
}
