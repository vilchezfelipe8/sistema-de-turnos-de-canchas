import AdminComingSoonPanel from '../../../components/admin/AdminComingSoonPanel';
import AdminTabCourts from '../../../components/admin/AdminTabCourts';
import {
  SettingsAuditSection,
  SettingsClubIdentitySection,
  SettingsExceptionsSection,
  SettingsPricingSection,
  SettingsSchedulesSection,
} from './SettingsSections';

export type SettingsWorkspaceTab =
  | 'club'
  | 'canchas'
  | 'actividades'
  | 'horarios'
  | 'precios'
  | 'usuarios'
  | 'notificaciones'
  | 'excepciones'
  | 'auditoria';

const comingSoonLabelByTab: Record<Extract<SettingsWorkspaceTab, 'usuarios' | 'notificaciones' | 'actividades'>, string> = {
  actividades: 'Actividades',
  usuarios: 'Usuarios administradores',
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
  if (tab === 'excepciones') return <SettingsExceptionsSection />;
  if (tab === 'auditoria') return <SettingsAuditSection />;

  return (
    <AdminComingSoonPanel
      title={comingSoonLabelByTab[tab]}
      description="Esta configuracion queda visible en roadmap y se migrara a panel lateral con componentes compartidos."
    />
  );
}
