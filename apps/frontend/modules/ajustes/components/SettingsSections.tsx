import AdminTabClub from '../../../components/admin/AdminTabClub';
import SettingsIntegrationsSection from './SettingsIntegrationsSection';
import SettingsMembersSection from './SettingsMembersSection';

export function SettingsClubIdentitySection() {
  return (
    <AdminTabClub
      forcedTab="identity"
      title="Club"
      subtitle="Cómo te ven los jugadores en la app: nombre, fotos, dirección y contacto."
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
      subtitle="Qué días abre el club y en qué horarios se puede reservar cada deporte."
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
      subtitle="Feriados y días especiales en que el club cierra o cambia el horario."
    />
  );
}

export function SettingsAuditSection() {
  return (
    <AdminTabClub
      forcedTab="audit"
      title="Auditoría"
      subtitle="Quién cambió los ajustes del club y qué cambió."
    />
  );
}

export function SettingsReviewsSection() {
  return (
    <AdminTabClub
      forcedTab="reviews"
      title="Reseñas"
      subtitle="Elegí qué opiniones se ven en la app."
    />
  );
}

export function SettingsIntegrationsWorkspaceSection() {
  return <SettingsIntegrationsSection />;
}

export { SettingsMembersSection };
