# WhatsApp: bloqueo de Meta confirmado el 28/10/2026

Diagnóstico de solo lectura en producción y panel de Meta. No se modificaron
configuraciones ni se enviaron nuevos mensajes de prueba.

## Evidencia actual

- El envío V2 y los eventos de clientes/personal están habilitados; dry-run está
  apagado. Los flags de desactivación del worker antiguo no explican este fallo.
- Los intentos recientes llegan a Meta, que los rechaza con código `131037`:
  `WhatsApp provided number needs display name approval before message can be sent.`
  Últimos dos rechazos comprobados: 28/10/2026 16:31:41 UTC.
- Las seis plantillas están APPROVED en Meta y ACTIVE en Pique.
- WABA `1060143490396790`: account_review_status=APPROVED.
- Teléfono `1342815855588100`, +1 711-613-4007: CONNECTED, GREEN, VERIFIED.
- Consultas a Graph v25.0 y v26.0 devuelven verified_name=Pique,
  name_status=AVAILABLE_WITHOUT_REVIEW y new_name_status=NONE.
- health_status del teléfono sigue indicando que el nombre no está aprobado.
- La verificación del negocio sigue limitada (141010); es un estado distinto de
  la aprobación de WABA y del rechazo concreto de envío 131037.
- Correos de WhatsApp Business Team confirman aprobación de Pique el 27/10 a las
  21:40 ART y de Pique Turnos a las 23:16 ART, ambos para Pique Cloud API.

## Soporte

Caso 28848292454822342:
https://business.facebook.com/direct-support/case-detail/28848292454822342/

El panel muestra CLOSED y que no puede reabrirse. Solo aparecen las dos respuestas
automáticas de Meta AI Agent. En Gmail existe un pedido de escalamiento enviado
el 27/10 a las 21:52 ART, pero no figura incorporado en el expediente del panel.
No hay respuesta humana visible. No dar por hecho que el pedido está en revisión.

El registro posterior a la aprobación inicial ya se había intentado, según el
correo saliente del caso, con éxito HTTP 200 pero sin resolver el rechazo.
La consulta actual no expone un nuevo nombre pendiente para aplicar.

## Reclamo enviado

El operador autorizó el envío y confirmó expresamente aceptar los Meta AI terms
exigidos por el formulario. Enviado el 28/10/2026 a las 13:52 ART.
Nuevo caso: **39490073023969820**.
https://business.facebook.com/direct-support/case-detail/39490073023969820/

Recepción verificada en el panel: Status=Open, Question Type=Dev: Cloud API,
Request Type=Messages API and Webhook. Se solicitó revisión humana y mantener
abierto el caso. La interfaz inicialmente muestra al asistente de Meta revisando
los detalles; no se ha confirmado asignación a una persona ni resolución.

Subject: Closed case 28848292454822342 — approved display name still blocked by 131037

Please route this issue to a human WhatsApp Business Platform engineer. The prior
case was closed after automated replies; production messaging remains blocked.

Business portfolio: 1381889500656243. WABA: 1060143490396790.
Phone number ID: 1342815855588100. Meta-provided number: +1 711-613-4007.
App ID: 1351490566870692.

WhatsApp Business Team emailed approval of Pique on October 27, 2026 at 21:40
Argentina time, then Pique Turnos at 23:16. Nevertheless, live Graph API v25.0 and
v26.0 queries on October 28 still return verified_name=Pique,
name_status=AVAILABLE_WITHOUT_REVIEW, new_name_status=NONE and status=CONNECTED.
Phone health_status still says the display name has not been approved.

Two production template attempts on October 28 at 16:31:41 UTC were rejected with
131037: WhatsApp provided number needs display name approval before message can
be sent. The WABA review is APPROVED and all six utility templates are APPROVED.

Please reconcile the approval notifications with the phone's messaging eligibility
and explain the concrete corrective action. Generic instructions to update the
display name have already been followed and have not resolved the discrepancy.
Please keep this case open for human investigation.

## Próximo paso

Consultar la respuesta del nuevo caso antes de realizar otros cambios.
No repetir cambios de nombre, registros o reintentos masivos sin una razón nueva.
Una vez corregida la elegibilidad, probar con un único destino autorizado y
confirmar entrega por webhook; la aceptación HTTP por sí sola no confirma entrega.

## Nueva consulta del panel (28/10/2026, después del envío)

El caso 39490073023969820 también pasó a Status=Closed y fue reclasificado como
Dev: Onboarding. No asumir que sigue abierto ni que se asignó a una persona.

Security Center muestra Verification for Francisco López Mora, iniciada el
26/10/2026, con estado Pending submission y botón Continue. La introducción pide
verificar los datos del negocio, confirmar la conexión con el titular y, si es
necesario, aportar documentos aceptados. Se abrió el flujo para inspeccionarlo,
sin enviar datos ni documentos. Priorizar completar esta verificación y revisar
la relación del titular con pique.ar; no hay garantía de que eso por sí solo
resuelva el rechazo 131037.
