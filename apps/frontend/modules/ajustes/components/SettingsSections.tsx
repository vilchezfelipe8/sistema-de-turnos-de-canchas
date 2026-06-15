import AdminTabClub from '../../../components/admin/AdminTabClub';
import SettingsIntegrationsSection from './SettingsIntegrationsSection';
import SettingsMembersSection from './SettingsMembersSection';

export function SettingsClubIdentitySection() {
  return (
    <AdminTabClub
      forcedTab="identity"
      title="Club"
      subtitle="Perfil público, identidad visual, contacto y estado general del establecimiento."
    />
  );
}

export function SettingsReservationsSection() {
  return (
    <AdminTabClub
      forcedTab="reservations"
      title="Reservas"
      subtitle="Confirmación, seña, auto-cancelación y límites operativos del flujo de reservas."
    />
  );
}

export function SettingsSchedulesSection() {
  return (
    <AdminTabClub
      forcedTab="schedules"
      title="Horarios"
      subtitle="Disponibilidad base del club, agenda por actividad y generación de turnos."
    />
  );
}

export function SettingsPricingSection() {
  return (
    <AdminTabClub
      forcedTab="pricing"
      title="Precios"
      subtitle="Recargos, descuentos y reglas comerciales que impactan en el cobro."
    />
  );
}

export function SettingsExceptionsSection() {
  return (
    <AdminTabClub
      forcedTab="exceptions"
      title="Excepciones"
      subtitle="Cierres puntuales y cambios excepcionales de agenda por fecha o actividad."
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

export function SettingsReviewsSection() {
  return (
    <AdminTabClub
      forcedTab="reviews"
      title="Reseñas"
      subtitle="Moderación de reseñas públicas y gestión de contenido visible del club."
    />
  );
}

export function SettingsIntegrationsWorkspaceSection() {
  return <SettingsIntegrationsSection />;
}

export { SettingsMembersSection };
