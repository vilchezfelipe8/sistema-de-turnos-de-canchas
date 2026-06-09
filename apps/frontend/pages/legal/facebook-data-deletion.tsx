import LegalDocumentPage from '../../components/LegalDocumentPage';

export default function FacebookDataDeletionPage() {
  return (
    <LegalDocumentPage
      title="Eliminación de datos de Facebook | Pique"
      eyebrow="Legal"
      pageTitle="Eliminación de datos vinculados a Facebook"
      pageSubtitle="Cómo solicitar la desvinculación o eliminación de la información relacionada con Facebook Login en Pique."
      effectiveDate="9 de junio de 2026"
      sections={[
        {
          title: '1. Cómo pedir la eliminación',
          paragraphs: [
            'Si usaste Facebook Login con tu cuenta de Pique y querés solicitar la eliminación o desvinculación de esos datos, escribinos a pique.soporte@gmail.com con el asunto “Facebook Data Deletion Request”.',
            'Para poder ubicar la cuenta, te pedimos incluir el correo electrónico asociado a Pique y cualquier dato adicional que nos ayude a identificar el perfil correcto.'
          ]
        },
        {
          title: '2. Qué información podemos eliminar o desvincular',
          paragraphs: [
            'Podemos eliminar o desvincular la identidad externa conectada con Facebook Login dentro de Pique, incluyendo el vínculo entre tu cuenta de Pique y tu cuenta de Facebook.',
            'Cuando corresponda, también podremos eliminar datos asociados al método de acceso y actualizar nuestros registros internos para reflejar que la vinculación fue removida.'
          ]
        },
        {
          title: '3. Información que puede conservarse',
          paragraphs: [
            'Determinados registros operativos, legales o de seguridad pueden mantenerse durante el tiempo necesario para auditoría, prevención de fraude, resolución de disputas o cumplimiento normativo.',
            'Esto puede incluir trazabilidad de acciones, historial de reservas, movimientos operativos o registros mínimos necesarios para preservar la integridad del sistema.'
          ]
        },
        {
          title: '4. Plazo de respuesta',
          paragraphs: [
            'Intentamos responder las solicitudes de eliminación dentro de un plazo razonable y, cuando sea posible, confirmar el resultado por correo electrónico.',
            'Si necesitamos más información para validar la identidad del solicitante o ubicar la cuenta correcta, nos pondremos en contacto antes de completar la solicitud.'
          ]
        },
        {
          title: '5. Soporte',
          paragraphs: [
            'Para cualquier consulta sobre privacidad, autenticación social o datos vinculados a Facebook, podés escribir a pique.soporte@gmail.com.'
          ]
        }
      ]}
    />
  );
}
