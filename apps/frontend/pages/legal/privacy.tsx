import LegalDocumentPage from '../../components/LegalDocumentPage';

export default function PrivacyPolicyPage() {
  return (
    <LegalDocumentPage
      title="Política de privacidad | Pique"
      eyebrow="Legal"
      pageTitle="Política de privacidad"
      pageSubtitle="Cómo recopilamos, usamos y protegemos la información de jugadores, clientes y clubes dentro de Pique."
      effectiveDate="9 de junio de 2026"
      sections={[
        {
          title: '1. Quiénes somos',
          paragraphs: [
            'Pique es una plataforma web para la gestión de clubes, reservas, pagos, perfiles de jugadores y comunicación entre clubes y usuarios.',
            'Cuando en este documento hablamos de “Pique”, “nosotros” o “la plataforma”, nos referimos al servicio disponible en pique.ar y sus funcionalidades relacionadas.'
          ]
        },
        {
          title: '2. Qué datos recopilamos',
          paragraphs: [
            'Podemos recopilar datos de identificación y contacto, como nombre, apellido, correo electrónico, número de teléfono, DNI y los datos de acceso que el usuario decida conectar con su cuenta.',
            'También podemos almacenar información de uso de la plataforma, sesiones, reservas, pagos, historial de actividad y vínculos entre perfiles de usuario y perfiles de clientes dentro de clubes.'
          ]
        },
        {
          title: '3. Para qué usamos la información',
          paragraphs: [
            'Usamos la información para permitir el inicio de sesión, administrar cuentas, vincular perfiles, procesar reservas, gestionar operaciones de clubes, enviar comunicaciones necesarias y mejorar la seguridad del servicio.',
            'También usamos estos datos para prevenir fraudes, resolver conflictos de identidad, auditar acciones administrativas y brindar soporte cuando un usuario o un club lo solicita.'
          ]
        },
        {
          title: '4. Inicio de sesión con terceros',
          paragraphs: [
            'Pique puede permitir el acceso o la vinculación de cuenta mediante proveedores externos como Google, Apple o Facebook. En esos casos recibimos únicamente la información necesaria para autenticar al usuario y conectar su cuenta dentro de Pique.',
            'No publicamos en redes sociales en nombre del usuario ni usamos esas cuentas para fines distintos al acceso, la vinculación de identidad y la seguridad del perfil.'
          ]
        },
        {
          title: '5. Compartir datos con clubes y proveedores',
          paragraphs: [
            'Los datos del usuario pueden ser visibles para el club con el que interactúa cuando son necesarios para reservas, pagos, asistencia, soporte o administración de la relación comercial.',
            'También podemos trabajar con proveedores de infraestructura, correo electrónico, autenticación y pagos que procesan información en nuestro nombre bajo obligaciones de confidencialidad y seguridad.'
          ]
        },
        {
          title: '6. Conservación y seguridad',
          paragraphs: [
            'Conservamos la información durante el tiempo necesario para operar la cuenta, cumplir obligaciones contractuales o legales, mantener registros operativos y resolver incidentes o disputas.',
            'Aplicamos medidas técnicas y organizativas razonables para proteger la información, incluyendo controles de acceso, sesiones seguras y trazabilidad de acciones sensibles.'
          ]
        },
        {
          title: '7. Tus derechos',
          paragraphs: [
            'Podés solicitar acceso, rectificación, actualización o eliminación de tus datos personales, así como pedir la desvinculación de métodos de acceso conectados cuando corresponda.',
            'Para consultas relacionadas con privacidad o derechos sobre tus datos, escribinos a pique.soporte@gmail.com.'
          ]
        },
        {
          title: '8. Cambios en esta política',
          paragraphs: [
            'Podemos actualizar esta política para reflejar cambios operativos, legales o de producto. Cuando eso ocurra, publicaremos la versión actualizada en esta misma página con su fecha de vigencia.'
          ]
        }
      ]}
    />
  );
}
