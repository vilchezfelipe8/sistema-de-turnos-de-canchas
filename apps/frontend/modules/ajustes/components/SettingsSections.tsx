import AdminTabClub from '../../../components/admin/AdminTabClub';
import AdminTabFiscal from '../../../components/admin/AdminTabFiscal';
import SettingsIntegrationsSection from './SettingsIntegrationsSection';
import SettingsMembersSection from './SettingsMembersSection';

export function SettingsClubIdentitySection() {
  return (
    <AdminTabClub
      forcedTab="identity"
      title="Club"
      subtitle="Datos base, identidad visual y contacto del establecimiento."
    />
  );
}

export function SettingsSchedulesSection() {
  return (
    <AdminTabClub
      forcedTab="operation"
      title="Horarios"
      subtitle="Reglas de operación y límites de reserva del club."
    />
  );
}

export function SettingsPricingSection() {
  return (
    <AdminTabClub
      forcedTab="discounts"
      title="Precios"
      subtitle="Descuentos, reglas comerciales y políticas de cobro."
    />
  );
}

export function SettingsExceptionsSection() {
  return (
    <AdminTabClub
      forcedTab="agenda"
      title="Excepciones"
      subtitle="Excepciones de agenda por fecha y configuración puntual."
    />
  );
}

export function SettingsAuditSection() {
  return (
    <AdminTabClub
      forcedTab="audit"
      title="Auditoría"
      subtitle="Registro de cambios y trazabilidad de configuración."
    />
  );
}

export function SettingsIntegrationsWorkspaceSection() {
  return <SettingsIntegrationsSection />;
}

export function SettingsFiscalSection() {
  return <AdminTabFiscal />;
}

export { SettingsMembersSection };
