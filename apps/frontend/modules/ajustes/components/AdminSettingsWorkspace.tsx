import AdminComingSoonPanel from '../../../components/admin/AdminComingSoonPanel';
import AdminTabCourts from '../../../components/admin/AdminTabCourts';
import {
  SettingsAuditSection,
  SettingsClubIdentitySection,
  SettingsExceptionsSection,
  SettingsFiscalSection,
  SettingsIntegrationsWorkspaceSection,
  SettingsMembersSection,
  SettingsPricingSection,
  SettingsSchedulesSection,
} from './SettingsSections';

export type SettingsWorkspaceTab =
  | 'club'
  | 'canchas'
  | 'actividades'
  | 'horarios'
  | 'precios'
  | 'integraciones'
  | 'usuarios'
  | 'notificaciones'
  | 'excepciones'
  | 'auditoria'
  | 'facturacion';

const comingSoonLabelByTab: Record<Extract<SettingsWorkspaceTab, 'notificaciones' | 'actividades'>, string> = {
  actividades: 'Actividades',
  notificaciones: 'Notificaciones automaticas',
};

type AdminSettingsWorkspaceProps = {
  tab: SettingsWorkspaceTab;
};

export default function AdminSettingsWorkspace({ tab }: AdminSettingsWorkspaceProps) {
  if (tab === 'club') return <SettingsClubIdentitySection />;
  if (tab === 'canchas') return <AdminTabCourts />;
  if (tab === 'actividades') {
    return (
      <AdminComingSoonPanel
        title={comingSoonLabelByTab.actividades}
        description="La separación de actividades va a consolidarse como módulo propio, desacoplado de excepciones de agenda."
      />
    );
  }
  if (tab === 'horarios') return <SettingsSchedulesSection />;
  if (tab === 'precios') return <SettingsPricingSection />;
  if (tab === 'integraciones') return <SettingsIntegrationsWorkspaceSection />;
  if (tab === 'usuarios') return <SettingsMembersSection />;
  if (tab === 'excepciones') return <SettingsExceptionsSection />;
  if (tab === 'auditoria') return <SettingsAuditSection />;
  if (tab === 'facturacion') return <SettingsFiscalSection />;

  return (
    <AdminComingSoonPanel
      title={comingSoonLabelByTab[tab]}
      description="Esta configuración queda visible en roadmap y se migrará a panel lateral con componentes compartidos."
    />
  );
}
