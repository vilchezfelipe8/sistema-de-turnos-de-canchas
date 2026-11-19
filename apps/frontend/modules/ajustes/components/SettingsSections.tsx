import AdminTabClub from '../../../components/admin/AdminTabClub';
import AdminTabFiscal from '../../../components/admin/AdminTabFiscal';
import SettingsIntegrationsSection from './SettingsIntegrationsSection';
import SettingsMembersSection from './SettingsMembersSection';

// Secciones de AdminTabClub agrupadas por página: cada página usa una sola
// instancia, así comparte la carga del club y la barra "Guardar cambios".

export function SettingsClubIdentitySection() {
  return <AdminTabClub forcedTab={['identity', 'reviews']} hideHeader />;
}

export function SettingsReservationsSection() {
  return <AdminTabClub forcedTab="reservations" hideHeader />;
}

export function SettingsSchedulesSection() {
  return <AdminTabClub forcedTab={['schedules', 'exceptions']} hideHeader />;
}

export function SettingsPricingSection() {
  return <AdminTabClub forcedTab={['pricing', 'cash']} hideHeader />;
}

export function SettingsAuditSection() {
  return <AdminTabClub forcedTab="audit" hideHeader />;
}

export function SettingsIntegrationsWorkspaceSection() {
  return <SettingsIntegrationsSection />;
}

export function SettingsFiscalSection() {
  return <AdminTabFiscal />;
}

export { SettingsMembersSection };
