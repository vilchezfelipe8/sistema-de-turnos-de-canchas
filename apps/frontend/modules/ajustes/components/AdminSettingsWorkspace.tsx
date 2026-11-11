import AdminComingSoonPanel from '../../../components/admin/AdminComingSoonPanel';
import AdminTabCourts from '../../../components/admin/AdminTabCourts';
import SettingsClubMembersSection from './SettingsClubMembersSection';
import SettingsSubscriptionPlansSection from './SettingsSubscriptionPlansSection';
import SettingsActivityFormatsSection from './SettingsActivityFormatsSection';
import SettingsPerPlayerPricingSection from './SettingsPerPlayerPricingSection';
import SettingsPaymentMethodDiscountSection from './SettingsPaymentMethodDiscountSection';
import SettingsOnlineDepositSection from './SettingsOnlineDepositSection';
import SettingsBookingWindowSection from './SettingsBookingWindowSection';
import {
  SettingsAuditSection,
  SettingsCashSection,
  SettingsClubIdentitySection,
  SettingsExceptionsSection,
  SettingsIntegrationsWorkspaceSection,
  SettingsMembersSection,
  SettingsPricingSection,
  SettingsReservationsSection,
  SettingsReviewsSection,
  SettingsSchedulesSection,
} from './SettingsSections';

export type SettingsWorkspaceTab =
  | 'club'
  | 'canchas'
  | 'actividades'
  | 'reservas'
  | 'horarios'
  | 'precios'
  | 'integraciones'
  | 'usuarios'
  | 'socios'
  | 'planes'
  | 'caja'
  | 'notificaciones'
  | 'excepciones'
  | 'auditoria'
  | 'resenas';

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
  if (tab === 'actividades') return <SettingsActivityFormatsSection />;
  if (tab === 'reservas') {
    return (
      <div className="space-y-4">
        <SettingsReservationsSection />
        <SettingsBookingWindowSection />
        <SettingsOnlineDepositSection />
      </div>
    );
  }
  if (tab === 'horarios') return <SettingsSchedulesSection />;
  if (tab === 'precios') {
    return (
      <div className="space-y-4">
        <SettingsPerPlayerPricingSection />
        <SettingsPaymentMethodDiscountSection />
        <SettingsPricingSection />
      </div>
    );
  }
  if (tab === 'integraciones') return <SettingsIntegrationsWorkspaceSection />;
  if (tab === 'usuarios') return <SettingsMembersSection />;
  if (tab === 'socios') return <SettingsClubMembersSection />;
  if (tab === 'planes') return <SettingsSubscriptionPlansSection />;
  if (tab === 'caja') return <SettingsCashSection />;
  if (tab === 'excepciones') return <SettingsExceptionsSection />;
  if (tab === 'auditoria') return <SettingsAuditSection />;
  if (tab === 'resenas') return <SettingsReviewsSection />;

  return (
    <AdminComingSoonPanel
      title={comingSoonLabelByTab[tab]}
      description="Esta configuración queda visible en roadmap y se migrará a panel lateral con componentes compartidos."
    />
  );
}
