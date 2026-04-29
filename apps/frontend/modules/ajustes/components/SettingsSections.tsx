import AdminTabClub from '../../../components/admin/AdminTabClub';

export function SettingsClubIdentitySection() {
  return (
    <AdminTabClub
      forcedTab="identity"
      title="Club"
      subtitle="Datos base, identidad visual y contacto del establecimiento."
    />
  );
}

export function SettingsActivitiesSection() {
  return (
    <AdminTabClub
      forcedTab="agenda"
      title="Actividades"
      subtitle="Configuración operativa por actividad, turnos y disponibilidad."
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
