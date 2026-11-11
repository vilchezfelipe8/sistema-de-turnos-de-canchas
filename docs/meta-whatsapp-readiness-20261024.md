# WhatsApp Meta — revisión del 24/10/2026

Consulta directa a Graph API v25.0 con el token configurado en producción:

- Cuenta `Pique Cloud API`: `account_review_status=APPROVED`.
- Número de Pique terminado en 4007: `CONNECTED`, `VERIFIED`, `CLOUD_API`.
- Nombre mostrado: `Pique`; `name_status=AVAILABLE_WITHOUT_REVIEW`.
- App Pique suscrita a la cuenta de WhatsApp.
- Seis plantillas `es_AR`, categoría `UTILITY`, aprobadas sin motivo de rechazo.

Plantillas aprobadas:

- `customer_booking_created_v2`
- `customer_booking_cancelled_v2`
- `customer_booking_pending_warning_v2`
- `staff_booking_created_v3`
- `staff_booking_cancelled_v2`
- `staff_booking_pending_warning_v2`

Pique todavía tenía sender `PENDING_SETUP` y seis mapeos `PENDING_APPROVAL`.
Se sincronizaron a `ACTIVE` en una transacción, verificando nombre, idioma y categoría
contra la respuesta de Meta. Auditoría `META_APPROVAL_SYNC` asociada al club 1.
Backup previo: `backup_20261024_232320.sql.gz`, descargado a la PC con sus secretos.

Pruebas realizadas:

- Resolución, construcción de parámetros y despacho en modo dry-run de las seis
  plantillas: correcto. Transacción revertida al terminar, sin mensajes externos.
- Verificación del challenge en el callback público
  `https://pique.ar/api/webhooks/meta/whatsapp`: HTTP 200 y challenge correcto.
- API de salud: OK.

Los envíos automáticos conservan sus flags apagadas: `DISABLE_WHATSAPP=true`,
`ENABLE_WHATSAPP_WORKER=false`, `ENABLE_WHATSAPP_SEND_V2=false`,
`ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2=false`, `ENABLE_WHATSAPP_STAFF_EVENTS_V2=false`
y `ENABLE_WHATSAPP_CLOUD_API=false`. El procesador de webhooks está encendido.

Prueba real pendiente del número de destino solicitado al operador. Debe usar un
único mensaje marcado como prueba, sin reservas reales, y registrar aceptación
de Meta y posterior entrega mediante webhook. La comprobación de aprobación
no demuestra por sí sola que el teléfono destinatario recibió un mensaje.

Evidencias y estado local previo a sincronizar, fuera del repositorio:
`C:/Users/franc/Backups/Pique/diagnosticos/meta-20261024/` y
`/var/backups/pique/meta/20261024/`. No incluyen los tokens de acceso.

Nota técnica: el preflight del backend actual compara los nombres literales `*_v1`.
Los mapeos aprobados actuales usan v2/v3; la resolución por evento/rol sí funciona
y fue la que se verificó en dry-run. Ese diagnóstico debe admitir los nombres
realmente configurados antes de usarlo como criterio de activación general.
