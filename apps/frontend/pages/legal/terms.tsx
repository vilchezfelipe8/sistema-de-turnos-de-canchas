import LegalDocumentPage from '../../components/LegalDocumentPage';

export default function TermsOfServicePage() {
  return (
    <LegalDocumentPage
      title="Términos y condiciones | Pique"
      eyebrow="Legal"
      pageTitle="Términos y condiciones"
      pageSubtitle="Las reglas generales para usar Pique como jugador, cliente o club."
      effectiveDate="9 de junio de 2026"
      sections={[
        {
          title: '1. Aceptación',
          paragraphs: [
            'Al crear una cuenta, iniciar sesión o usar cualquier parte de Pique, aceptás estos términos y condiciones.',
            'Si usás Pique en representación de un club, organización o comercio, declarás que tenés autorización suficiente para hacerlo.'
          ]
        },
        {
          title: '2. Uso del servicio',
          paragraphs: [
            'Pique ofrece herramientas para reservas, pagos, gestión de clientes, identidad digital y operación diaria de clubes. El servicio puede evolucionar con el tiempo y algunas funciones pueden variar según el tipo de usuario o el club.',
            'Te comprometés a usar la plataforma de forma lícita, sin interferir con su funcionamiento ni intentar acceder a información o cuentas ajenas sin autorización.'
          ]
        },
        {
          title: '3. Cuentas y seguridad',
          paragraphs: [
            'Cada usuario es responsable por la veracidad de los datos que carga y por mantener la confidencialidad de sus métodos de acceso.',
            'Pique puede permitir inicio de sesión o conexión de cuenta mediante Google, Apple, Facebook o correo electrónico. También puede limitar o revocar accesos cuando existan razones de seguridad, fraude o uso indebido.'
          ]
        },
        {
          title: '4. Contenido y datos operativos',
          paragraphs: [
            'Los clubes y usuarios son responsables de la información que cargan en la plataforma, incluyendo perfiles, reservas, cobros, mensajes y observaciones operativas.',
            'Pique puede conservar registros y auditorías internas necesarios para seguridad, soporte, conciliación operativa y mejora del servicio.'
          ]
        },
        {
          title: '5. Pagos, reservas y relaciones con clubes',
          paragraphs: [
            'Las reservas, pagos y condiciones comerciales pueden depender del club que ofrece la actividad, cancha, clase o servicio correspondiente. Pique actúa como plataforma de gestión y no reemplaza las reglas comerciales particulares de cada club.',
            'En caso de cancelaciones, devoluciones o conflictos sobre una operación, el tratamiento puede depender de las políticas del club y de los medios de pago involucrados.'
          ]
        },
        {
          title: '6. Suspensión o baja',
          paragraphs: [
            'Podemos suspender, limitar o cerrar cuentas cuando sea necesario para proteger la seguridad del servicio, cumplir la ley, prevenir abusos o responder a un incumplimiento de estos términos.',
            'También podés dejar de usar el servicio en cualquier momento y solicitar la eliminación o revisión de tus datos conforme a nuestra política de privacidad.'
          ]
        },
        {
          title: '7. Limitación de responsabilidad',
          paragraphs: [
            'Pique se presta sobre una base razonable de disponibilidad y mejora continua. Aunque trabajamos para mantenerlo estable y seguro, no garantizamos ausencia total de errores, interrupciones o indisponibilidades.',
            'En la medida permitida por la ley aplicable, Pique no será responsable por daños indirectos, incidentales o consecuentes derivados del uso o imposibilidad de uso del servicio.'
          ]
        },
        {
          title: '8. Modificaciones',
          paragraphs: [
            'Podemos actualizar estos términos para reflejar cambios legales, técnicos u operativos. La versión vigente será la publicada en esta página.'
          ]
        }
      ]}
    />
  );
}
