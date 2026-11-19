import AdminTabCourts from '../../../components/admin/AdminTabCourts';
import { getSettingsTabMeta, type SettingsTab } from '../settingsNav';
import SettingsClubMembersSection from './SettingsClubMembersSection';
import SettingsSubscriptionPlansSection from './SettingsSubscriptionPlansSection';
import SettingsTurnSchedulesSection from './SettingsTurnSchedulesSection';
import SettingsPerPlayerPricingSection from './SettingsPerPlayerPricingSection';
import SettingsPaymentMethodDiscountSection from './SettingsPaymentMethodDiscountSection';
import SettingsOnlineDepositSection from './SettingsOnlineDepositSection';
import SettingsBookingWindowSection from './SettingsBookingWindowSection';
import {
  SettingsAuditSection,
  SettingsClubIdentitySection,
  SettingsFiscalSection,
  SettingsIntegrationsWorkspaceSection,
  SettingsMembersSection,
  SettingsPricingSection,
  SettingsReservationsSection,
  SettingsSchedulesSection,
} from './SettingsSections';

export type SettingsWorkspaceTab = SettingsTab;

function SettingsTabContent({ tab }: { tab: SettingsTab }) {
  switch (tab) {
    case 'club':
      return <SettingsClubIdentitySection />;
    case 'canchas':
      return <AdminTabCourts />;
    case 'horarios':
      return <SettingsSchedulesSection />;
    case 'reservas':
      return (
        <div className="space-y-4">
          <SettingsReservationsSection />
          <SettingsOnlineDepositSection />
          <SettingsBookingWindowSection />
        </div>
      );
    case 'precios':
      return (
        <div className="space-y-4">
          <SettingsPerPlayerPricingSection />
          <SettingsPaymentMethodDiscountSection />
          <SettingsPricingSection />
        </div>
      );
    case 'facturacion':
      return <SettingsFiscalSection />;
    case 'socios':
      return <SettingsClubMembersSection />;
    case 'planes':
      return <SettingsSubscriptionPlansSection />;
    case 'turnero':
      return <SettingsTurnSchedulesSection />;
    case 'usuarios':
      return <SettingsMembersSection />;
    case 'integraciones':
      return <SettingsIntegrationsWorkspaceSection />;
    case 'auditoria':
      return <SettingsAuditSection />;
    default:
      return null;
  }
}

type AdminSettingsWorkspaceProps = {
  tab: SettingsWorkspaceTab;
};

export default function AdminSettingsWorkspace({ tab }: AdminSettingsWorkspaceProps) {
  const meta = getSettingsTabMeta(tab);
  const Icon = meta.icon;
  return (
    <div className="mx-auto w-full max-w-[920px]">
      <header className="mb-5 hidden items-start gap-3 lg:flex">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-p-surface-2 text-p-accent">
          <Icon size={19} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold tracking-[-0.02em] text-p-text">{meta.label}</h2>
          <p className="mt-0.5 text-[13px] text-p-text-muted">{meta.description}</p>
        </div>
      </header>
      <p className="mb-4 text-[12px] text-p-text-muted lg:hidden">{meta.description}</p>
      <SettingsTabContent key={tab} tab={tab} />
    </div>
  );
}
