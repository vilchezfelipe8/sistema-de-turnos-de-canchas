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
      title="Confirmación y cancelación"
      subtitle="Cómo se confirman las reservas, con cuánta anticipación se puede reservar y qué pasa con las que nadie confirma."
    />
  );
}

export function SettingsCashSection() {
  return (
    <AdminTabClub
      forcedTab="cash"
      title="Caja"
      subtitle="Reglas para abrir y cerrar la caja del día."
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
      title="Recargos y descuentos"
      subtitle="Extra por luces y descuentos para clientes puntuales."
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
