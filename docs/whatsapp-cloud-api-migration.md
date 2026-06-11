# Migracion a WhatsApp Cloud API

## Estado del documento

- Proyecto: `Pique`
- Dominio: mensajeria transaccional por WhatsApp
- Fecha de revision: `2026-06-01`
- Estado: decision de arquitectura + spec implementable de MVP

## 1. Resumen ejecutivo

Pique debe migrar de la automatizacion actual basada en WhatsApp Web hacia la `WhatsApp Cloud API` oficial de Meta.

La decision busca reducir el riesgo operativo sobre el numero de WhatsApp, mejorar trazabilidad de entrega, evitar dependencias en QR/sesiones de navegador y dejar la plataforma preparada para una evolucion futura hacia multiples senders.

Decision central:

- migrar a `WhatsApp Cloud API`
- usar en el MVP un numero central de `Pique`
- modelar desde el inicio una arquitectura `multi-sender ready`
- mantener en el MVP los mensajes transaccionales ya existentes tanto hacia clientes como hacia el club/staff

## 2. Diagnostico del estado actual

Hoy el repo ya tiene una capa de abstraccion minima y un flujo async reutilizable, pero el transporte real depende de una implementacion no oficial.

### Evidencia en el codigo actual

- `apps/wpp-service/index.js`: servicio Express separado con `whatsapp-web.js`, QR y Chromium
- `apps/backend/src/services/WhatsappService.ts`: cliente local con `LocalAuth`, QR, `webVersionCache` remoto y manejo de errores de navegador
- `apps/backend/src/services/WhatsappDeliveryService.ts`: abstraccion backend que decide el provider
- `apps/backend/src/services/OutboxWorker.ts`: worker que consume `WHATSAPP_SEND`
- `apps/backend/src/services/BookingService.ts`: genera mensajes de reserva creada y cancelada tanto para cliente como para club
- `apps/backend/src/services/PendingBookingAutoCancelService.ts`: genera warning previo a autocancelacion para cliente

### Limitaciones del enfoque actual

- depende de una sesion de WhatsApp Web autenticada por QR
- depende de Chromium/Puppeteer y de estabilidad de `whatsapp-web.js`
- no usa la plataforma oficial de business messaging
- mezcla preocupaciones de sesion de navegador con mensajeria de producto
- no expone estados oficiales de entrega y lectura via webhooks del proveedor
- deja a Pique expuesto a roturas por cambios de WhatsApp Web

## 3. Objetivos de la migracion

- usar la API oficial soportada por Meta
- conservar la funcionalidad transaccional ya existente
- evitar perder mensajes al cliente y al club durante la transicion
- desacoplar el dominio de reservas del proveedor concreto
- dejar listo el modelo para soportar senders por club en el futuro
- registrar estados de envio, entrega, lectura y fallo de forma auditable

## 4. No objetivos del MVP

- inbox conversacional dentro de Pique
- bot de atencion
- respuestas inbound procesadas por negocio
- campanas o marketing masivo
- flows avanzados
- numero propio por club
- bandeja compartida de agentes

## 5. Decision de producto y arquitectura

### 5.1 Decision principal

El MVP debe usar un numero central de `Pique` sobre `WhatsApp Cloud API`.

### 5.2 Decision de evolucion

Aunque el MVP use un unico sender central, el modelo de datos y contratos deben soportar que en el futuro un club pueda operar con su propio numero sin reescribir el flujo principal.

### 5.3 Decision sobre alcance funcional

No se deben quitar mensajes existentes al club/staff.

El MVP debe cubrir:

- mensajes transaccionales a clientes/jugadores
- mensajes transaccionales al club/staff cuando hoy ya existen

Queda explicitamente fuera del MVP el uso de WhatsApp como canal operativo conversacional del staff.

## 6. Cobertura funcional del MVP

### 6.1 Destinatarios

Definir al menos estos roles:

- `CUSTOMER`
- `CLUB_STAFF`

### 6.2 Eventos cubiertos

Mensajes a `CUSTOMER`:

- reserva registrada/creada
- reserva cancelada
- warning de reserva pendiente/autocancelacion

Mensajes a `CLUB_STAFF`:

- nueva reserva creada
- reserva cancelada
- solo alertas operativas equivalentes a las existentes hoy

Regla MVP:

- `BOOKING_CREATED / CLUB_STAFF`: incluido
- `BOOKING_CANCELLED / CLUB_STAFF`: incluido
- `BOOKING_PENDING_WARNING / CLUB_STAFF`: incluido bajo `ENABLE_WHATSAPP_STAFF_EVENTS_V2`

### 6.3 Fuera de alcance funcional

- mensajes de soporte humano bidireccional
- mensajes manuales arbitrarios desde admin
- recordatorios comerciales o promocionales
- campanas de reactivacion

## 7. Modelo de sender

### 7.1 MVP

En el MVP, todos los mensajes salen por un sender central de `Pique`.

Propuesta de clave de sender:

```text
PIQUE_DEFAULT
```

### 7.2 Futuro

Un club podra tener un sender propio mas adelante.

Por eso, ningun mensaje debe depender implicitamente de “el numero global actual”. El sender debe resolverse por politica.

### 7.3 Regla de resolucion inicial

Para v1:

- siempre resolver `senderKey = PIQUE_DEFAULT`

Para v2 futura:

- si el club tiene sender propio activo, usarlo
- si no, usar `PIQUE_DEFAULT`

### 7.4 Destinatarios del club en MVP

Para no perder funcionalidad existente ni forzar una migracion de configuracion paralela, el MVP debe respetar el esquema simple actual:

```text
club.whatsappNotificationPhone
```

Regla MVP:

- si el club tiene `whatsappNotificationPhone`, los mensajes `CLUB_STAFF` se envian ahi
- si el club no tiene numero configurado, el evento `CLUB_STAFF` no debe bloquear la operacion principal
- la ausencia de destinatario staff debe registrarse como condicion operativa visible

### 7.5 Evolucion prevista para staff

La spec debe dejar previsto un modelo mas prolijo para futura expansion a multiples destinatarios por club:

```prisma
model ClubNotificationRecipient {
  id                        String   @id @default(cuid())
  clubId                    Int
  name                      String
  phone                     String
  role                      String?
  enabled                   Boolean  @default(true)
  receivesBookingCreated    Boolean  @default(true)
  receivesBookingCancelled  Boolean  @default(true)
  receivesPendingWarning    Boolean  @default(true)
  createdAt                 DateTime @default(now()) @db.Timestamptz(3)
  updatedAt                 DateTime @updatedAt @db.Timestamptz(3)
}
```

Decision:

- no implementar esta tabla en el MVP si hoy ya existe un numero unico por club
- si se implementa despues, debe convivir con migracion desde `club.whatsappNotificationPhone`

## 8. Integracion oficial objetivo

La integracion debe modelarse sobre los conceptos oficiales de Meta/WhatsApp Business Platform:

- `WABA`
- business phone number
- `phone_number_id`
- token de acceso
- permiso `whatsapp_business_messaging`
- endpoint `/{phone_number_id}/messages`
- templates
- webhooks de mensajes y estados

## 9. Estrategia de mensajeria para MVP

### 9.1 Regla principal

Para reducir ambiguedad operativa y de compliance, el MVP debe tratar todos los mensajes automatizados salientes como mensajes template.

Esto aplica tanto a `CUSTOMER` como a `CLUB_STAFF`.

### 9.2 Motivo

- simplifica el comportamiento del sistema
- evita depender de la ventana conversacional para notificaciones automaticas
- facilita trazabilidad y aprobacion previa
- reduce decisiones ad hoc por tipo de evento

### 9.3 Optimizacion futura

Mas adelante se podra optimizar y usar mensajes libres dentro de la ventana de servicio si hay un caso claro y medible. No es necesario para el MVP.

## 10. Templates iniciales del MVP

Propuesta de templates utility iniciales:

| Template key | Destinatario | Evento |
| --- | --- | --- |
| `customer_booking_created_v1` | `CUSTOMER` | reserva creada |
| `customer_booking_cancelled_v1` | `CUSTOMER` | reserva cancelada |
| `customer_booking_pending_warning_v1` | `CUSTOMER` | warning pre autocancelacion |
| `staff_booking_created_v1` | `CLUB_STAFF` | nueva reserva |
| `staff_booking_cancelled_v1` | `CLUB_STAFF` | reserva cancelada |
| `staff_booking_pending_warning_v1` | `CLUB_STAFF` | warning operativo previo a autocancelación |

Regla:

- no usar un template generico compartido entre cliente y staff
- aunque el texto sea parecido, cada template representa una intencion distinta de producto
- `CUSTOMER` recibe confirmaciones y avisos
- `CLUB_STAFF` recibe alertas operativas

### 10.1 Variables sugeridas

`customer_booking_created_v1`:

- `club_name`
- `client_name`
- `date`
- `time`
- `court_name`
- `amount`
- `club_whatsapp_url`

`staff_booking_created_v1`:

- `club_name`
- `client_name`
- `client_phone`
- `date`
- `time`
- `court_name`
- `amount`

`customer_booking_cancelled_v1`:

- `club_name`
- `client_name`
- `date`
- `time`
- `court_name`
- `club_whatsapp_url`
- `cancel_reason_label`

`staff_booking_cancelled_v1`:

- `club_name`
- `client_name`
- `client_phone`
- `date`
- `time`
- `court_name`
- `cancel_reason_label`

`customer_booking_pending_warning_v1`:

- `club_name`
- `client_name`
- `date`
- `time`
- `court_name`
- `cancel_minutes_before`
- `insufficient_amount`

`staff_booking_pending_warning_v1`:

- `club_name`
- `client_name`
- `client_phone`
- `date`
- `time`
- `court_name`
- `cancel_minutes_before`
- `insufficient_amount`

Regla:

- mismo contrato de variables que el payload V2 real de staff pending warning
- puede quedar apagado por flag si negocio no quiere usarlo en un rollout puntual

## 11. Regla de versionado de templates

Los templates deben versionarse en la clave y no mutarse silenciosamente.

Ejemplo:

```text
customer_booking_created_v1
customer_booking_created_v2
```

## 12. Arquitectura objetivo

### 12.1 Capas

- dominio: decide que mensaje hay que enviar
- outbox: persiste la intencion de envio
- policy: resuelve sender, template y locale
- provider gateway: habla con `WhatsApp Cloud API`
- webhook processor: recibe estados del proveedor

### 12.2 Regla de desacople

`BookingService` y servicios de negocio no deben conocer:

- `phone_number_id`
- tokens
- endpoints HTTP de Meta
- payloads crudos del proveedor

Solo deben producir una intencion de mensaje.

## 13. Modelo de datos propuesto

### 13.1 Sender

```prisma
model WhatsappSender {
  id                    String   @id @default(cuid())
  key                   String   @unique
  scopeType             String   // PLATFORM | CLUB
  clubId                Int?
  displayName           String
  phoneNumber           String
  phoneNumberId         String
  wabaId                String
  businessAccountId     String?
  provider              String   @default("META_CLOUD_API")
  status                String   // DRAFT | ACTIVE | PAUSED | DISABLED
  isDefault             Boolean  @default(false)
  accessTokenRef        String?
  webhookVerifyTokenRef String?
  createdAt             DateTime @default(now()) @db.Timestamptz(3)
  updatedAt             DateTime @updatedAt @db.Timestamptz(3)
}
```

### 13.2 Template catalog

```prisma
model WhatsappTemplate {
  id              String   @id @default(cuid())
  senderId        String?
  sender          WhatsappSender? @relation(fields: [senderId], references: [id], onDelete: SetNull)
  key             String
  providerName    String
  language        String
  category        String   // UTILITY | MARKETING | AUTHENTICATION
  status          String   // DRAFT | PENDING | APPROVED | REJECTED | PAUSED
  bodyPreview     String?
  createdAt       DateTime @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime @updatedAt @db.Timestamptz(3)

  @@unique([senderId, key, language])
}
```

### 13.3 Message log

```prisma
model WhatsappMessage {
  id                   String   @id @default(cuid())
  clubId               Int?
  senderId             String
  sender               WhatsappSender @relation(fields: [senderId], references: [id], onDelete: Restrict)
  recipientRole        String   // CUSTOMER | CLUB_STAFF
  recipientPhone       String
  templateKey          String?
  locale               String?
  messageType          String   // TEMPLATE | TEXT
  direction            String   @default("OUTBOUND")
  conversationCategory String?  // UTILITY | MARKETING | AUTHENTICATION | SERVICE
  status               String   // QUEUED | ACCEPTED | SENT | DELIVERED | READ | FAILED | DROPPED
  providerMessageId    String?  @unique
  dedupeKey            String?
  referenceType        String?  // BOOKING | ACCOUNT | SYSTEM
  referenceId          String?
  requestPayload       Json?
  responsePayload      Json?
  lastWebhookPayload   Json?
  errorCode            String?
  errorMessage         String?
  createdAt            DateTime @default(now()) @db.Timestamptz(3)
  sentAt               DateTime? @db.Timestamptz(3)
  deliveredAt          DateTime? @db.Timestamptz(3)
  readAt               DateTime? @db.Timestamptz(3)
  failedAt             DateTime? @db.Timestamptz(3)
  updatedAt            DateTime @updatedAt @db.Timestamptz(3)

  @@index([clubId, status, createdAt])
  @@index([referenceType, referenceId])
  @@index([recipientRole, recipientPhone])
}
```

### 13.4 Webhook events

```prisma
model WhatsappWebhookEvent {
  id                String   @id @default(cuid())
  senderId          String?
  providerEventId   String?
  eventType         String
  payload           Json
  processedAt       DateTime?
  processingStatus  String   // PENDING | PROCESSED | IGNORED | FAILED
  errorMessage      String?
  createdAt         DateTime @default(now()) @db.Timestamptz(3)

  @@index([processingStatus, createdAt])
  @@index([providerEventId])
}
```

## 14. Contrato de outbox propuesto

El evento viejo `WHATSAPP_SEND` hoy transporta solo:

```ts
{ phone, message }
```

Eso no alcanza para Cloud API.

### 14.1 Nuevo tipo sugerido

```text
WHATSAPP_SEND_V2
```

### 14.2 Payload sugerido

```ts
type WhatsappSendV2Payload = {
  clubId?: number | null;
  senderKey: string;
  recipientRole: 'CUSTOMER' | 'CLUB_STAFF';
  to: string;
  messageIntent:
    | {
        kind: 'TEMPLATE';
        templateKey: string;
        locale: string;
        variables: Record<string, string>;
      }
    | {
        kind: 'TEXT';
        text: string;
      };
  referenceType: 'BOOKING' | 'ACCOUNT' | 'SYSTEM';
  referenceId: string;
  dedupeKey: string;
};
```

### 14.3 Decision de MVP

Para MVP, `messageIntent.kind` debe ser `TEMPLATE` para todos los mensajes automaticos.

## 15. Adaptacion del flujo actual

### 15.1 Booking created

El flujo actual genera:

- mensaje al cliente
- mensaje al club
- notificacion interna

En la migracion debe conservarse la misma semantica, pero transformar los mensajes en templates aprobados.

### 15.2 Booking cancelled

Debe mantener:

- mensaje al cliente
- mensaje al club
- notificacion interna

### 15.3 Pending warning

Debe mantener:

- warning por WhatsApp al cliente
- notificacion interna si ya existe el caso de uso

## 16. Provider gateway

### 16.1 Servicio sugerido

```ts
export interface WhatsappProviderGateway {
  sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendTemplateMessageResult>;
  sendTextMessage(input: SendTextMessageInput): Promise<SendTextMessageResult>;
}
```

### 16.2 Implementacion concreta de MVP

```ts
export class MetaCloudWhatsappProvider implements WhatsappProviderGateway {
  // resuelve sender
  // llama POST /{phone_number_id}/messages
  // persiste request/response
}
```

## 17. Webhooks

### 17.1 Objetivo

Recibir desde Meta:

- aceptacion del mensaje
- enviado
- entregado
- leido
- fallo

### 17.2 Endpoint sugerido

```text
GET  /api/whatsapp/webhooks/meta
POST /api/whatsapp/webhooks/meta
```

### 17.3 Reglas

- validar token de verificacion
- persistir payload crudo
- procesar idempotentemente
- actualizar `WhatsappMessage.status`
- no asumir orden perfecto de llegada

## 18. Estados internos recomendados

| Estado | Significado |
| --- | --- |
| `QUEUED` | encolado localmente |
| `ACCEPTED` | estado interno luego de que la API de Meta responde OK al request inicial |
| `SENT` | estado posterior que indica que el mensaje fue procesado/enviado por el proveedor |
| `DELIVERED` | entregado al destinatario |
| `READ` | leido por el destinatario |
| `FAILED` | fallo terminal |
| `DROPPED` | expirado o descartado |

Regla importante:

- `ACCEPTED` no debe modelarse como si fuera necesariamente un webhook del proveedor
- `ACCEPTED` representa aceptacion tecnica del request por la API
- `SENT`, `DELIVERED`, `READ` y `FAILED` pueden provenir del procesamiento posterior y/o de webhooks

## 19. Politica de errores

Clasificaciones minimas:

- error de configuracion
- error de validacion de payload
- rate limit
- template inexistente o no aprobado
- numero invalido
- provider unavailable
- webhook no procesado

### Reglas

- no reintentar ciegamente errores funcionales
- reintentar con backoff errores transitorios
- exponer `errorCode` y `errorMessage`
- permitir desactivar el canal sin romper el negocio principal

## 20. Feature flags sugeridas

```text
ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2=false
ENABLE_WHATSAPP_STAFF_EVENTS_V2=false
ENABLE_WHATSAPP_SEND_V2=false
ENABLE_WHATSAPP_CLOUD_API=false
ENABLE_WHATSAPP_WEBHOOK_PROCESSOR=false
ENABLE_WHATSAPP_V2_DRY_RUN=false
```

### Regla de rollout

Durante la migracion:

- mantener `legacy` y `cloud` coexistiendo por feature flag
- nunca activar ambos para el mismo flujo sin estrategia de deduplicacion explicita
- `CUSTOMER` y `CLUB_STAFF` se prenden por separado
- `ENABLE_WHATSAPP_SEND_V2` y `ENABLE_WHATSAPP_CLOUD_API` no implican por si solos cutover de dominio
- `ENABLE_WHATSAPP_V2_DRY_RUN=true` tiene prioridad y bloquea envio real

## 21. Variables de entorno futuras sugeridas

Variables globales MVP:

- `WHATSAPP_PROVIDER=wpp_http` o provider legacy actual hasta cutover controlado
- `WHATSAPP_META_GRAPH_API_BASE_URL=https://graph.facebook.com`
- `WHATSAPP_META_GRAPH_API_VERSION=v19.0` o version vigente
- `WHATSAPP_META_REQUEST_TIMEOUT_MS=10000`
- `WHATSAPP_META_ACCESS_TOKEN=<env backend>`
- `WHATSAPP_META_WEBHOOK_VERIFY_TOKEN=<env backend>`
- `WHATSAPP_META_RECIPIENT_ALLOWLIST=`
- `ENABLE_WHATSAPP_CLOUD_API=false`
- `ENABLE_WHATSAPP_SEND_V2=false`
- `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2=false`
- `ENABLE_WHATSAPP_STAFF_EVENTS_V2=false`
- `ENABLE_WHATSAPP_V2_DRY_RUN=false`
- `ENABLE_WHATSAPP_WEBHOOK_PROCESSOR=false`

Estas variables representan la direccion objetivo. No deben sobreescribir silenciosamente la operacion actual hasta que exista implementacion real.

## 22. Observabilidad

Medir al menos:

- mensajes encolados
- mensajes aceptados
- entregados
- leidos
- fallidos
- latencia `queue -> accepted`
- latencia `accepted -> delivered`
- fallos por template
- fallos por sender

## 23. Seguridad y compliance

- no loguear access tokens
- no loguear payloads sensibles completos en texto plano
- cifrar referencias secretas si se persisten
- separar secretos de sender del dominio de reservas
- guardar solo lo necesario para auditoria

## 24. Plan de rollout

### Etapa 1. Documentacion y contratos

- cerrar decision de producto
- crear schema futuro
- crear contratos `WHATSAPP_SEND_V2`

### Etapa 2. Infraestructura provider

- implementar `MetaCloudWhatsappProvider`
- alta de sender central
- webhook verification

### Etapa 3. Templates

- registrar y aprobar templates MVP
- validar variables

### Etapa 4. Integracion backend

- generar `WHATSAPP_SEND_V2`
- mantener fallback legacy bajo flag

### Etapa 5. Shadow mode

- enviar a cloud en entorno controlado
- verificar accepted/delivered/read
- no cortar funcionalidad existente hasta estabilizar

### Etapa 6. Cutover

- activar `ENABLE_WHATSAPP_CLOUD_API`
- apagar `wpp-service` para esos flujos
- mantener rollback simple

## 25. Rollback

Si la salida a Cloud API falla:

- desactivar `ENABLE_WHATSAPP_CLOUD_API`
- reactivar provider legacy solo si sigue siendo operable y aceptable para contingencia
- si no, dejar el canal WhatsApp apagado y conservar notificaciones internas

## 26. Riesgos principales

- templates no aprobados a tiempo
- sender mal configurado
- numeros mal normalizados
- falsa asuncion de que todos los mensajes se comportan igual
- dependencia de mensajes al staff no modelada correctamente
- duplicados si conviven dos providers sin estrategia clara

## 27. Decisiones futuras ya previstas

- sender propio por club
- mensajes inbound
- inbox operacional
- bot y automatizaciones conversacionales
- campanas y marketing
- localizacion por idioma
- soporte multimedia

## 28. Criterio de listo para implementar

La documentacion se considera suficientemente cerrada cuando:

- el MVP conserva mensajes a cliente y al club ya existentes
- `BOOKING_PENDING_WARNING / CLUB_STAFF` puede encenderse por flag sin depender de legacy
- el contrato de outbox ya no depende de `phone + message`
- hay un modelo de sender y message log definidos
- hay templates iniciales identificados
- hay webhook y estados internos definidos
- existe estrategia de rollout y rollback
- existe preflight operativo
- existe backoffice read-only minimo

## 29. Fuentes oficiales

- [WhatsApp Cloud API Overview](https://meta-preview.mintlify.io/docs/whatsapp/cloud-api/overview)
- [WhatsApp Cloud API Get Started](https://meta-preview.mintlify.io/docs/whatsapp/cloud-api/get-started)
- [Add a Phone Number](https://meta-preview.mintlify.io/docs/whatsapp/cloud-api/get-started/add-a-phone-number)
- [Sending Messages](https://meta-preview.mintlify.io/docs/whatsapp/cloud-api/guides/send-messages)
- [Send Message Templates](https://meta-preview.mintlify.io/docs/whatsapp/cloud-api/guides/send-message-templates)
- [WhatsApp message templates overview](https://developers.facebook.com/docs/whatsapp/message-templates/)

## 30. Cierre

La migracion recomendada para `Pique` es hacia `WhatsApp Cloud API` oficial, con numero central de plataforma en el MVP y arquitectura lista para evolucionar a multi-sender. La migracion no debe quitar mensajes transaccionales existentes al club/staff. El diseño debe conservar la abstraccion y el outbox actuales, pero reemplazar el transporte legado por un provider oficial, con templates, webhooks y trazabilidad completa.

## 31. Ejemplos reales de texto por template

Los textos de ejemplo siguientes son base funcional para negocio y producto. Antes de produccion deben adaptarse al naming y copy final aprobado en WhatsApp Manager.

### 31.1 `customer_booking_created_v1`

```text
Hola {{client_name}}, tu reserva en {{club_name}} quedó confirmada.
Dia: {{date}}
Hora: {{time}}
Cancha: {{court_name}}
Importe: {{amount}}
Si necesitás ayuda, escribinos acá: {{club_whatsapp_url}}
```

### 31.2 `customer_booking_cancelled_v1`

```text
Hola {{client_name}}, tu reserva en {{club_name}} fue cancelada.
Dia: {{date}}
Hora: {{time}}
Cancha: {{court_name}}
Motivo: {{cancel_reason_label}}
Si necesitás ayuda, escribinos acá: {{club_whatsapp_url}}
```

### 31.3 `customer_booking_pending_warning_v1`

```text
Hola {{client_name}}, tu reserva en {{club_name}} sigue pendiente.
Dia: {{date}}
Hora: {{time}}
Cancha: {{court_name}}
Importe pendiente: {{insufficient_amount}}
Si no se completa el pago, puede cancelarse en {{cancel_minutes_before}} minutos.
```

### 31.4 `staff_booking_created_v1`

```text
Nueva reserva en {{club_name}}.
Cliente: {{client_name}}
Telefono: {{client_phone}}
Dia: {{date}}
Hora: {{time}}
Cancha: {{court_name}}
Importe: {{amount}}
```

### 31.5 `staff_booking_cancelled_v1`

```text
Reserva cancelada en {{club_name}}.
Cliente: {{client_name}}
Telefono: {{client_phone}}
Dia: {{date}}
Hora: {{time}}
Cancha: {{court_name}}
Motivo: {{cancel_reason_label}}
```

### 31.6 `staff_booking_pending_warning_v1`

Estado:

- implementado en V2
- controlado por `ENABLE_WHATSAPP_STAFF_EVENTS_V2`
- sin canal legacy paralelo

```text
Reserva pendiente por revisar en {{club_name}}.
Cliente: {{client_name}}
Telefono: {{client_phone}}
Dia: {{date}}
Hora: {{time}}
Cancha: {{court_name}}
Importe pendiente: {{insufficient_amount}}
Autocancelacion estimada en {{cancel_minutes_before}} minutos.
```

## 32. Ejemplos JSON request/response de Meta

Los ejemplos siguientes son representativos del shape esperado segun la documentacion oficial de `Cloud API`. Deben ajustarse a la version real del Graph API y al nombre exacto del template aprobado.

### 32.1 Request de envio template

```json
POST /v19.0/{phone_number_id}/messages
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "5491123456789",
  "type": "template",
  "template": {
    "name": "customer_booking_created_v1",
    "language": {
      "code": "es_AR"
    },
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "Juan" },
          { "type": "text", "text": "Pique Club" },
          { "type": "text", "text": "2026-06-03" },
          { "type": "text", "text": "19:00" },
          { "type": "text", "text": "Cancha 2" },
          { "type": "text", "text": "$18.000" },
          { "type": "text", "text": "https://wa.me/5491100000000" }
        ]
      }
    ]
  }
}
```

### 32.2 Response inicial aceptada por API

```json
{
  "messaging_product": "whatsapp",
  "contacts": [
    {
      "input": "5491123456789",
      "wa_id": "5491123456789"
    }
  ],
  "messages": [
    {
      "id": "wamid.HBgL..."
    }
  ]
}
```

Interpretacion:

- si la API responde OK y devuelve `messages[0].id`, Pique debe pasar el mensaje a estado `ACCEPTED`
- `ACCEPTED` no implica todavia `DELIVERED`

### 32.3 Ejemplo de webhook de status

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "WABA_ID",
      "changes": [
        {
          "field": "messages",
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "phone_number_id": "PHONE_NUMBER_ID"
            },
            "statuses": [
              {
                "id": "wamid.HBgL...",
                "status": "delivered",
                "timestamp": "1717200000",
                "recipient_id": "5491123456789"
              }
            ]
          }
        }
      ]
    }
  ]
}
```

Interpretacion:

- buscar `WhatsappMessage.providerMessageId = statuses[].id`
- mapear `status` a estado interno
- persistir payload crudo para auditoria

## 33. Secuencia end-to-end

### 33.1 Flujo narrado

1. `BookingService` confirma o actualiza una reserva.
2. Servicio de negocio decide que corresponde mensaje a `CUSTOMER`, `CLUB_STAFF` o ambos.
3. Backend persiste eventos `WHATSAPP_SEND_V2` en outbox.
4. `OutboxWorker` consume evento y resuelve `senderKey`.
5. `WhatsappPolicyService` define `templateKey`, `locale` y variables.
6. `MetaCloudWhatsappProvider` normaliza telefono y llama `POST /{phone_number_id}/messages`.
7. Si la API responde OK, Pique crea/actualiza `WhatsappMessage` en `ACCEPTED`.
8. Meta envia webhooks de estado.
9. `WhatsappWebhookProcessor` resuelve `providerMessageId` y actualiza `SENT`, `DELIVERED`, `READ` o `FAILED`.
10. Backoffice y observabilidad muestran trazabilidad completa.

### 33.2 Diagrama de secuencia

```mermaid
sequenceDiagram
    participant BS as BookingService
    participant OB as Outbox
    participant WK as OutboxWorker
    participant PO as WhatsappPolicyService
    participant PR as MetaCloudWhatsappProvider
    participant ME as Meta Cloud API
    participant WH as Webhook Processor
    participant DB as WhatsappMessage

    BS->>OB: create WHATSAPP_SEND_V2
    WK->>PO: resolve intent
    PO-->>WK: sender + template + vars
    WK->>PR: sendTemplateMessage()
    PR->>ME: POST /{phone_number_id}/messages
    ME-->>PR: 200 OK + wamid
    PR->>DB: status = ACCEPTED
    ME-->>WH: webhook status update
    WH->>DB: map wamid -> SENT/DELIVERED/READ/FAILED
```

## 34. Matriz evento -> destinatario -> template -> variables

| Evento | Destinatario | Template | Variables minimas |
| --- | --- | --- | --- |
| `BOOKING_CREATED` | `CUSTOMER` | `customer_booking_created_v1` | `client_name`, `club_name`, `date`, `time`, `court_name`, `amount`, `club_whatsapp_url` |
| `BOOKING_CREATED` | `CLUB_STAFF` | `staff_booking_created_v1` | `club_name`, `client_name`, `client_phone`, `date`, `time`, `court_name`, `amount` |
| `BOOKING_CANCELLED` | `CUSTOMER` | `customer_booking_cancelled_v1` | `client_name`, `club_name`, `date`, `time`, `court_name`, `club_whatsapp_url`, `cancel_reason_label` |
| `BOOKING_CANCELLED` | `CLUB_STAFF` | `staff_booking_cancelled_v1` | `club_name`, `client_name`, `client_phone`, `date`, `time`, `court_name`, `cancel_reason_label` |
| `BOOKING_PENDING_WARNING` | `CUSTOMER` | `customer_booking_pending_warning_v1` | `client_name`, `club_name`, `date`, `time`, `court_name`, `cancel_minutes_before`, `insufficient_amount` |
| `BOOKING_PENDING_WARNING` | `CLUB_STAFF` | `staff_booking_pending_warning_v1` | `ENABLE_WHATSAPP_STAFF_EVENTS_V2`; sin legacy paralelo |

## 35. Checklist operativo de onboarding de sender central

### 35.1 Alta tecnica

- crear o identificar `WABA` de Pique
- registrar business phone number
- obtener `phone_number_id`
- obtener `WHATSAPP_META_ACCESS_TOKEN`
- configurar `WHATSAPP_META_WEBHOOK_VERIFY_TOKEN`
- configurar webhook en app de Meta
- suscribirse a eventos de mensajes

### 35.2 Alta funcional

- definir display name final
- aprobar templates MVP
- validar idioma `es_AR` o locale definitivo
- validar textos legales/comerciales
- definir owner operativo del numero

### 35.3 Validacion previa

- enviar template test a numero interno
- validar `ACCEPTED`
- validar webhook `SENT`
- validar webhook `DELIVERED`
- validar webhook `READ`
- validar fallback de `FAILED`
- validar visibilidad de estado en backoffice

## 36. Catalogo de errores Meta -> accion interna

La fuente de verdad tecnica siempre debe ser `errorCode`, `errorMessage` y payload real del proveedor. La tabla siguiente define la accion esperada de Pique por categoria.

| Categoria | Ejemplo de situacion | Accion interna |
| --- | --- | --- |
| auth invalid | token vencido, token invalido, permiso faltante | marcar `FAILED`, generar incidente tecnico, bloquear nuevos envios hasta corregir credencial |
| sender invalid | `phone_number_id` inexistente o no asociado | marcar `FAILED`, incidente de configuracion, no reintentar ciegamente |
| template invalid | template inexistente, pausado, rechazado o locale no aprobado | marcar `FAILED`, incidente funcional, corregir catalogo/template |
| recipient invalid | numero mal formado, no valido, no WhatsApp | marcar `FAILED`, registrar causa visible, no reintentar automaticamente |
| rate limit | limite temporal del proveedor | reintentar con backoff, emitir metrica y alerta si persiste |
| provider unavailable | timeout, `5xx`, indisponibilidad temporal | reintentar con backoff, mantener trazabilidad |
| webhook validation failed | verify token incorrecto o payload invalido | incidente tecnico critico, no avanzar rollout |
| duplicate send risk | mismo evento emitido dos veces | usar `dedupeKey`, no duplicar `WhatsappMessage`, auditar conflicto |

## 37. Policy de normalizacion de telefonos

### 37.1 Regla general

Todos los telefonos deben persistirse y enviarse en formato `E.164` sin espacios ni separadores visuales.

Ejemplo:

```text
5491123456789
```

### 37.2 Pipeline sugerido

1. trim del input
2. remover espacios, parentesis y guiones
3. convertir `00` internacional inicial a formato sin prefijo visual
4. resolver codigo de pais por default del club si el numero viene local
5. validar largo minimo y maximo
6. persistir:
   - `rawPhoneInput`
   - `normalizedPhoneE164`

### 37.3 Regla para Argentina

Si el producto hoy opera principalmente en Argentina:

- usar `54` como country code por default cuando aplique
- contemplar moviles con `9`
- no hardcodear reglas irreversibles dentro del dominio de reservas
- encapsular normalizacion en `PhoneNormalizationService`

## 38. Diagrama de tablas y relaciones

```mermaid
erDiagram
    Club ||--o{ WhatsappMessage : has
    Club ||--o| WhatsappSender : may_own
    Club ||--o| ClubNotificationRecipient : may_define
    WhatsappSender ||--o{ WhatsappTemplate : scopes
    WhatsappSender ||--o{ WhatsappMessage : sends
    WhatsappMessage ||--o{ WhatsappWebhookEvent : receives
```

Lectura:

- `WhatsappSender` define origen de salida
- `WhatsappTemplate` define catalogo utilizable por sender
- `WhatsappMessage` registra intento, respuesta y estados
- `WhatsappWebhookEvent` guarda trazabilidad cruda del proveedor
- `ClubNotificationRecipient` queda documentado como evolucion futura

## 39. Shadow mode plan con metricas objetivo

### 39.1 Objetivo

Validar provider oficial sin cortar operacion existente hasta comprobar estabilidad.

### 39.2 Regla de operacion

- generar eventos `WHATSAPP_SEND_V2`
- enviar por Cloud API solo para numeros internos o entorno controlado
- mantener canal legacy o canal manual como respaldo
- no activar rollout masivo si faltan webhooks estables

### 39.3 Metricas objetivo iniciales

- `api_acceptance_rate >= 99%`
- `webhook_match_rate >= 99%`
- `delivered_rate` consistente con baseline real del negocio
- `failed_rate < 2%` por causas no funcionales
- `duplicate_rate = 0`
- `orphan_webhook_rate = 0`

### 39.4 Criterio de salida de shadow mode

- templates MVP aprobados
- sender central estable
- phone normalization estable
- match confiable por `providerMessageId`
- panel operativo usable para soporte

## 40. Smoke test checklist para QA

### 40.1 Booking created

- crear reserva confirmada
- verificar outbox `WHATSAPP_SEND_V2`
- verificar `customer_booking_created_v1`
- verificar `staff_booking_created_v1`
- verificar `ACCEPTED`
- verificar webhook posterior

### 40.2 Booking cancelled

- cancelar reserva existente
- verificar `customer_booking_cancelled_v1`
- verificar `staff_booking_cancelled_v1`
- verificar deduplicacion si hay retry manual

### 40.3 Pending warning

- generar caso de reserva pendiente
- verificar `customer_booking_pending_warning_v1`
- verificar `staff_booking_pending_warning_v1` solo si negocio lo habilita
- verificar que warning no bloquee flujo principal

### 40.4 Errores y contingencia

- template faltante
- numero invalido
- sender deshabilitado
- webhook con token invalido
- timeout del provider
- rollback por feature flag

### 40.5 Validaciones de trazabilidad

- un `WhatsappMessage` por envio efectivo
- `providerMessageId` persistido
- timestamps `accepted/sent/delivered/read/failed` coherentes
- payload crudo disponible para auditoria
- dedupeKey respetado

## 41. Principios de experiencia WhatsApp

La migracion no debe pensarse solo como reemplazo tecnico del transporte. Debe elevar la experiencia percibida por clientes y clubes.

Principios rectores:

- rapidez: el mensaje debe llegar cerca del momento relevante
- claridad: el texto debe decir que paso, cuando, donde y que hacer
- accionabilidad: cada mensaje debe orientar a una accion concreta o dejar claro que no hace falta actuar
- contexto: incluir datos suficientes para evitar preguntas innecesarias
- bajo ruido: no mandar mas mensajes de los necesarios
- consistencia: mismo evento, mismo criterio, mismo tono

## 42. Diseño conversacional por evento

### 42.1 Cliente

Tono esperado:

- claro
- confiable
- corto
- amable
- orientado a resolver

Reglas:

- abrir con el hecho principal
- poner fecha/hora/cancha en bloques faciles de leer
- cerrar con CTA o canal de ayuda
- no usar texto legal o tecnico innecesario

### 42.2 Staff del club

Tono esperado:

- operativo
- rapido
- directo
- escaneable

Reglas:

- poner primero el tipo de evento
- incluir cliente y telefono
- evitar texto de marketing
- facilitar accion inmediata

## 43. CTAs y deep links

Cada mensaje importante debe evaluar CTA util. No todos los templates necesitan boton, pero todos deben pensarse con accion de siguiente paso.

CTAs sugeridos:

- `Ver reserva`
- `Pagar saldo`
- `Contactar al club`
- `Abrir panel`

Deep links sugeridos:

- link a detalle de reserva del cliente
- link a checkout o saldo pendiente
- `wa.me` del club
- link interno del admin para staff

Regla:

- no mandar links rotos o genericos
- todo CTA debe medirse

## 44. Fallback multicanal

Si WhatsApp falla, experiencia no debe romperse.

Fallbacks posibles:

- email transaccional
- push notification
- notificacion in-app
- alerta interna en backoffice

Politica recomendada:

- cliente: intentar fallback segun preferencia y criticidad
- staff: fallback minimo a notificacion interna/backoffice
- incidentes criticos: crear incidente visible aunque falle todo canal saliente

## 45. Preferencias del usuario

Para elevar valor real, el sistema debe poder evolucionar a preferencias por usuario y por club.

Campos futuros sugeridos:

```text
UserNotificationPreference {
  userId
  whatsappEnabled
  emailEnabled
  pushEnabled
  preferredChannel
  locale
  timezone
  quietHoursStart
  quietHoursEnd
}
```

Uso esperado:

- respetar idioma preferido
- evitar mensajes en horarios no deseados
- elegir fallback correcto
- personalizar experiencia sin reescribir negocio

## 46. Reglas de frecuencia y anti-spam

WhatsApp valioso requiere disciplina. No solo entregar. No molestar.

Reglas base:

- no mandar dos confirmaciones por mismo evento
- no mandar warning repetido sin cambio material
- no reenviar cancelacion salvo accion humana o cambio real
- agrupar eventos menores si aparecen en ventana corta
- respetar `dedupeKey` funcional y tambien dedupe UX

Ejemplos:

- si booking cambia dos veces en 30 segundos, consolidar
- si warning ya fue enviado para misma reserva y mismo umbral, no repetir
- si staff ya fue alertado, no spamear multiples destinatarios sin criterio

## 47. Métricas de experiencia

No alcanza con medir `delivery`.

Métricas UX sugeridas:

- tiempo desde evento hasta `ACCEPTED`
- tiempo desde evento hasta `DELIVERED`
- tasa de lectura
- tasa de accion post mensaje
- tasa de pago luego de warning
- tasa de contacto al club luego de cancelacion
- reducción de soporte manual
- reducción de no-shows
- satisfacción operativa del club

Métricas de producto premium:

- reservas salvadas por warning
- cobranzas recuperadas
- tiempo ahorrado al staff
- tasa de adopcion del canal

## 48. Escalamiento a humano

Cuando mensaje automatico no alcanza, sistema debe saber salir elegantemente.

Casos:

- cliente responde por otro canal
- cliente no paga luego de warning
- staff necesita intervenir manualmente
- hay conflicto o duda con reserva

Acciones sugeridas:

- crear tarea o incidente interno
- mostrar banner en panel
- ofrecer CTA a contacto humano
- registrar que automatizacion no resolvio el caso

## 49. Política de branding y confianza

La percepcion del mensaje cambia mucho segun sender, display name y consistencia visual/textual.

Definir:

- display name oficial de `Pique`
- convención de firma de mensajes
- convención de naming de templates
- lineamientos de tono
- reglas de uso de nombre del club dentro del cuerpo

Objetivo:

- que el cliente entienda rapido que mensaje es legitimo
- que el club sienta que el sistema le agrega valor, no ruido

## 50. Backoffice de operación humana

Para experiencia premium, staff necesita control.

Capacidades futuras sugeridas:

- ver historial de mensajes por reserva
- ver estado por destinatario
- reenviar manualmente con permiso
- ver error legible
- cambiar numero staff del club
- pausar canal por club
- ver métricas de entregabilidad y lectura

## 51. Roadmap premium de alto valor

Una vez estable el MVP transaccional, la capa premium puede crecer sobre misma arquitectura.

Items de mayor valor:

- reminder pre-reserva
- link de pago de saldo pendiente
- aviso de liberacion de cancha
- post-partido con feedback
- recuperacion de reserva caida
- inbox operativo del club
- campañas utiles no invasivas
- automatizaciones por clima o cierre del club
- AI assistant para staff

## 52. Criterio de experiencia 100000%

La experiencia puede considerarse realmente excelente cuando:

- mensaje correcto llega a persona correcta en momento correcto
- texto se entiende en segundos
- usuario sabe que hacer despues
- club reduce trabajo manual
- sistema no genera ruido ni duplicados
- fallos no dejan al usuario sin contexto
- soporte tiene trazabilidad completa
- negocio puede medir impacto real del canal

## 53. Vision del modulo: Pique Notification Platform

Este documento no debe leerse solo como una migracion de `whatsapp-web.js` hacia `WhatsApp Cloud API`.

Debe leerse como la base del modulo:

```text
Pique Notification Platform
```

Vision:

- el dominio emite intenciones de notificacion
- la plataforma procesa esas intenciones asincronicamente
- la plataforma resuelve destinatario, canal, sender y template
- la plataforma ejecuta envio, registra estado y audita resultado
- la plataforma recibe webhooks y consolida trazabilidad
- la plataforma permite fallback, apagado controlado y operacion humana

Decision de diseño:

- `WhatsApp Cloud API` es el primer canal fuerte
- el diseño no debe quedar atado a WhatsApp como unica posibilidad futura
- el modulo debe poder crecer a otros canales sin reescribir el dominio de reservas

## 54. Principios rectores del modulo

- una reserva nunca falla porque fallo una notificacion
- el dominio no manda WhatsApps; emite eventos o intenciones
- no se duplican mensajes
- no se mandan mensajes sin contexto
- no se molesta al usuario
- todo envio debe tener trazabilidad
- todo envio debe ser idempotente
- todo canal debe poder apagarse por feature flag
- no se hardcodea `PIQUE_DEFAULT` como unica posibilidad futura
- no se mezclan mensajes a clientes con mensajes a staff
- no se construyen features nuevas sobre `WhatsApp Web` legacy
- no se asume que `SENT` significa `DELIVERED`
- no se convierte WhatsApp en CRM dentro de este alcance

## 55. Limites que el agente no debe cruzar

Durante esta migracion, el agente no debe:

- implementar inbox conversacional
- implementar bot de reservas
- implementar campañas
- implementar marketing
- implementar AI assistant
- implementar WhatsApp Flows
- implementar numero propio por club visible en UI
- implementar onboarding self-service de `WABA` por club
- eliminar mensajes existentes al staff
- bloquear reservas si falla WhatsApp
- hardcodear textos finales en `BookingService`
- guardar tokens planos en base
- mezclar templates de `CUSTOMER` con `CLUB_STAFF`
- asumir que `SENT` significa `DELIVERED`
- crear logica nueva sobre `whatsapp-web.js`
- modificar reglas de negocio de reservas salvo lo necesario para emitir eventos
- automatizar linking `Client -> User`
- hacer merge automatico de clientes
- agregar pagos por WhatsApp dentro de esta migracion
- agregar funcionalidades premium como parte del MVP

## 56. Matriz de alcance: MVP / V1 / Future / Out of scope

### 56.1 MVP

- sender central `PIQUE_DEFAULT`
- `WHATSAPP_SEND_V2`
- `CUSTOMER` notifications
- `CLUB_STAFF` notifications existentes
- templates utility iniciales
- resolver de sender preparado para futuro
- resolver de template
- webhooks minimos
- estados internos
- feature flags
- rollout controlado
- rollback
- trazabilidad
- idempotencia
- smoke tests

### 56.2 V1 / Soon

- UI interna/admin para ver ultimos envios
- errores por club
- reenvio manual controlado
- configuracion simple por club para activar/desactivar WhatsApp
- numero operativo staff editable
- metricas basicas por club
- health check del canal

### 56.3 Future / Premium

- sender propio por club
- onboarding de `WABA` por club
- lista configurable de destinatarios staff
- preferencias de canal por usuario
- recordatorios avanzados
- links de pago
- feedback post-partido
- recuperacion de reservas caidas
- inbox staff
- bot
- AI assistant
- WhatsApp Flows

### 56.4 Out of scope

- campañas
- marketing
- CRM
- soporte conversacional
- inbox
- bot
- AI assistant
- pagos por WhatsApp
- numero propio visible por club en MVP
- automatizaciones conversacionales

## 57. Roles destinatarios: actuales y futuros

Separar roles evita mezclar tono, templates, permisos, fallback y trazabilidad.

### 57.1 Roles MVP

- `CUSTOMER`
- `BOOKING_OWNER` como alias semantico futuro del customer responsable de la reserva, sin obligar implementacion separada en MVP
- `CLUB_STAFF`

### 57.2 Roles futuros

- `BOOKING_PARTICIPANT`
- `CLUB_OWNER`
- `PROFESSOR`
- `PIQUE_ADMIN`

Regla:

- documentar roles futuros no implica implementarlos ahora
- MVP puede seguir resolviendo sobre `CUSTOMER` y `CLUB_STAFF`

## 58. Staff notifications

Los mensajes a staff no se eliminan. Hoy ya existen en el sistema y el MVP debe migrarlos.

Definicion:

- mensajes a `CLUB_STAFF` son alertas operativas
- no son mensajes al cliente
- deben tener templates separados
- deben mantener trazabilidad propia

Reglas MVP:

- pueden enviarse a un unico numero operativo del club si ese es el modelo actual
- deben poder desactivarse por club o por evento
- no deben bloquear reservas si fallan
- no deben dispararse por micro-ediciones menores

Futuro:

- lista configurable de destinatarios por club
- reglas por evento
- reglas por rol interno
- umbrales anti-ruido para clubes de alto volumen

Modelo futuro sugerido:

```ts
type ClubNotificationRecipient = {
  clubId: number;
  name: string;
  phone: string;
  role?: string;
  enabled: boolean;
  receivesBookingCreated: boolean;
  receivesBookingCancelled: boolean;
  receivesPendingWarning: boolean;
};
```

## 59. Matriz de experiencia por evento

| Event | Recipient role | Emotion | Objective | CTA | Fallback | Tone |
| --- | --- | --- | --- | --- | --- | --- |
| `BOOKING_CREATED` | `CUSTOMER` | tranquilidad | confirmar que la reserva quedo registrada o confirmada | ver reserva | email / in-app / sin fallback si no hay canal valido | claro, corto, transaccional |
| `BOOKING_CREATED` | `CLUB_STAFF` | control | avisar que entro una nueva reserva | abrir reserva en admin | notificacion interna | operativo |
| `BOOKING_CANCELLED` | `CUSTOMER` | certeza | avisar que la reserva fue cancelada | ver detalle / contactar club | email / in-app | claro |
| `BOOKING_CANCELLED` | `CLUB_STAFF` | control operativo | avisar que se libero un turno | abrir agenda / admin | notificacion interna | directo |
| `BOOKING_PENDING_WARNING` | `CUSTOMER` | urgencia moderada | avisar que la reserva puede autocancelarse | confirmar / pagar / ver reserva | no duplicar warning | corto y util |
| `BOOKING_PENDING_WARNING` | `CLUB_STAFF` | prevencion | avisar que una reserva pendiente esta por caer | abrir reserva / admin | dashboard / in-app | operativo |

## 60. Politica anti-ruido / anti-spam

Reglas obligatorias:

- no mandar dos mensajes por el mismo evento logico
- no mandar warning mas de una vez por reserva
- no mandar mensajes por cambios menores que no afectan al destinatario
- no mandar mensajes al staff por cada micro-edicion
- no duplicar mensajes entre legacy y Cloud API
- no enviar mensajes de marketing desde templates utility
- no enviar fuera de horarios razonables salvo eventos criticos, cuando en el futuro exista configuracion horaria
- permitir desactivar notificaciones por club, canal o evento
- para staff de clubes con mucho volumen, priorizar eventos importantes
- toda notificacion debe poder justificarse por un evento del sistema

## 61. Timeline de notificaciones por reserva

Vision:

- el detalle futuro de una reserva deberia poder mostrar historial de notificaciones
- esto no implica UI MVP obligatoria
- si implica guardar datos suficientes desde ahora

Ejemplo:

```text
Notificaciones

10:00 - WhatsApp CUSTOMER - reserva registrada - accepted
10:00 - WhatsApp CLUB_STAFF - nueva reserva - delivered
10:05 - WhatsApp CUSTOMER - warning pendiente - read
10:15 - WhatsApp CUSTOMER - reserva cancelada - sent
```

Decision:

- el modelo debe conservar datos para soportar esta vista en `V1` o `Future`

## 62. Backoffice operativo

### 62.1 MVP

- logs
- base de datos
- trazabilidad tecnica

### 62.2 V1 / Future

- ver ultimos envios
- ver errores
- reenviar manualmente una notificacion fallida
- desactivar WhatsApp para un club
- cambiar numero operativo del staff
- ver estado de templates
- ver estado del sender
- ver health del webhook

Regla:

- el reenvio manual debe ser controlado
- nunca debe generar spam accidental

## 63. Estado de salud del canal

Vision futura:

```text
WhatsApp: activo
Sender: PIQUE_DEFAULT
Ultimo envio exitoso: hace 4 min
Errores ultimas 24h: 2
Templates activos: 6/6
Webhook: OK
```

MVP:

- puede limitarse a logs y metricas internas

Norte futuro:

- health por canal
- health por sender
- health por club

## 64. Fallback multicanal como diseño de modulo

### 64.1 MVP

- si WhatsApp falla, no se bloquea la operacion
- se registra error
- se puede reintentar si corresponde
- se puede apagar el canal por feature flag
- staff puede ver la reserva igualmente en el sistema

### 64.2 Futuro

- WhatsApp -> Email -> Push -> In-app
- preferencia de canal por usuario
- fallback por tipo de evento
- fallback distinto para `CUSTOMER` y `CLUB_STAFF`

## 65. Fuente de verdad documental

La fuente de verdad de este modulo es el repo.

Regla:

- `docs/whatsapp-cloud-api-migration.md` es documento fuente
- Notion funciona como copia, espejo o superficie de lectura compartida
- si aparece diferencia entre repo y Notion, prevalece repo hasta resincronizar

## 66. Criterios de experiencia 100000% del modulo

El modulo alcanza experiencia excelente cuando:

- el jugador recibe confirmaciones claras y utiles
- el club recibe alertas operativas sin ruido
- los mensajes tienen contexto y CTA
- los errores no rompen reservas
- el staff puede entender que paso con cada mensaje
- Pique puede apagar, reintentar o auditar el canal
- el sistema puede crecer a otros canales
- el sistema puede crecer a sender propio por club
- el usuario no siente spam
- el club percibe mas control y menos trabajo manual

## 67. Estado de implementacion PR 2

Alcance:

- `PR 2` solo prepara schema, enums y contratos base
- `OutboxMessage` sigue siendo la queue actual
- las tablas nuevas agregan configuracion, delivery, webhook y trazabilidad

Fuera de alcance de `PR 2`:

- no manda mensajes por `Meta Cloud API`
- no agrega provider HTTP real
- no agrega webhook funcional
- no migra eventos `CUSTOMER`
- no migra eventos `CLUB_STAFF`
- no modifica `BookingService`
- no modifica `PendingBookingAutoCancelService`
- no cambia comportamiento productivo

Objetivo del corte:

- dejar lista la base persistente para `WHATSAPP_SEND_V2`
- dejar listos estados `ACCEPTED`, `SENT`, `DELIVERED`, `READ`, `FAILED`
- dejar listo `providerMessageId`
- dejar preparada la trazabilidad real para `PR 3`

Validacion y decision de modelado:

- `OutboxMessage` sigue siendo la unica queue
- no se creo una segunda cola paralela
- `WhatsappDelivery` se modela 1:1 con `OutboxMessage`
- en este corte, `WhatsappDelivery` representa el estado agregado actual del envio para ese outbox message
- no representa todavia el historial de cada retry individual
- si en el futuro hiciera falta historico por intento, eso debe modelarse con una tabla especifica y no rompiendo esta semantica

Estado de validacion:

- `prisma validate`: OK
- `prisma generate`: OK
- migracion SQL manual revisada contra `schema.prisma`
- `prisma migrate deploy`: OK sobre DB disposable limpia `tucancha_migration_smoke`
- `prisma migrate status`: OK sobre DB disposable limpia `tucancha_migration_smoke`
- el `P3005` visto sobre la DB local historica corresponde a falta de baseline de ese entorno, no a mismatch del `PR 2`
- no hubo cambios funcionales

## 68. Estado de implementacion PR 3

Alcance:

- se agrego `WHATSAPP_SEND_V2` como tipo de outbox
- se agrego policy layer para validar intenciones V2 antes de encolarlas
- se agrego servicio de enqueue V2
- `OutboxMessage` sigue siendo la queue
- `WhatsappDelivery` sigue siendo estado agregado 1:1 del outbox message

Comportamiento de este corte:

- al encolar `WHATSAPP_SEND_V2` se crea `OutboxMessage`
- al encolar `WHATSAPP_SEND_V2` se crea `WhatsappDelivery` inicial en estado `QUEUED`
- no se resuelve sender todavia
- no se resuelve template todavia
- no se envia nada a `Meta Cloud API`
- no se agregan webhooks
- no se migran eventos reales de reservas
- `WHATSAPP_SEND` legacy sigue intacto

Worker:

- si aparece `WHATSAPP_SEND_V2`, el worker no despacha a Meta
- con flag apagada lo procesa en modo controlado y marca `WhatsappDelivery` como `SKIPPED`
- con flag encendida, mientras no exista provider real, sigue en stub controlado y no envia nada
- esto evita loops infinitos y no altera el comportamiento de `WHATSAPP_SEND`

Pendiente para `PR 4`:

- resolver sender
- resolver template
- conectar `PIQUE_DEFAULT`

## 69. Estado de implementacion PR 4

Alcance:

- se creo `WhatsappSenderResolver`
- se creo `WhatsappTemplateResolver`
- se agrego helper semantico para tratar `BOOKING_OWNER` como alias de `CUSTOMER`
- no se toco `BookingService`
- no se toco `PendingBookingAutoCancelService`

Decisiones cerradas:

- si existe sender `CLUB_OWN` activo para el club, se prioriza
- si no existe, se usa `PIQUE_DEFAULT`
- templates de `CUSTOMER` y `CLUB_STAFF` quedan separados
- `BOOKING_OWNER` no existe como rol persistente
- `BOOKING_OWNER` solo puede vivir en helpers semanticos y se normaliza a `CUSTOMER`

Bootstrap/configuracion:

- existe bootstrap operativo por script para `PIQUE_DEFAULT` y templates MVP
- `PIQUE_DEFAULT` debe existir en DB antes del cutover real
- el resolver falla de forma controlada si `PIQUE_DEFAULT` no existe, esta deshabilitado o esta invalido
- `tokenSecretRef` sigue siendo referencia a secreto; no se guardan access tokens planos

Fuera de alcance:

- no hay provider Meta
- no hay webhooks
- no se migran eventos reales
- no se cambia enqueue V2
- no se cambia worker stub salvo la documentacion de su rol temporal

Pendiente para `PR 5`:

- implementar provider `Meta Cloud API`
- usar sender resuelto
- usar template resuelto

## 70. Estado de implementacion PR 5

Alcance:

- se creo `MetaCloudWhatsappProvider`
- el provider recibe `SendTemplateMessageInput`
- construye payload template para `Meta Cloud API`
- resuelve token por `tokenSecretRef -> process.env[...]`
- no guarda tokens planos
- no loguea tokens

Comportamiento:

- respuesta HTTP exitosa de Meta => `status = ACCEPTED`
- `providerMessageId` se extrae de `messages[0].id` si existe
- `ACCEPTED` sigue significando aceptacion inicial de API
- `SENT/DELIVERED/READ/FAILED` quedan para webhooks en `PR 6`

Seguridad/configuracion:

- `PIQUE_DEFAULT` sigue viniendo desde DB
- `tokenSecretRef` apunta a variable de entorno del backend
- no hay requests reales desde reservas
- no se tocaron `BookingService` ni `PendingBookingAutoCancelService`
- no se tocaron eventos reales `CUSTOMER` ni `CLUB_STAFF`

Decisiones:

- provider queda puro
- no actualiza `WhatsappDelivery` por si solo
- no se conecta todavia al `OutboxWorker`
- `ENABLE_WHATSAPP_CLOUD_API` queda apagada por default
- el orden de parametros de template puede venir explicito en `templateParameterOrder`
- si no viene, se usa orden alfabetico estable de keys

Pendiente para `PR 6`:

- webhooks de Meta
- mapping de `SENT/DELIVERED/READ/FAILED`
- persistencia de eventos webhook

## 71. Estado de implementacion PR 6

Alcance:

- se creo endpoint `GET /api/webhooks/meta/whatsapp` para verificacion de Meta
- se creo endpoint `POST /api/webhooks/meta/whatsapp` para recepcion de payloads
- se creo `WhatsappWebhookProcessor`
- se agrego `ENABLE_WHATSAPP_WEBHOOK_PROCESSOR`
- se agrego `WHATSAPP_META_WEBHOOK_VERIFY_TOKEN`

Comportamiento:

- `GET` valida `hub.mode`, `hub.verify_token` y devuelve `hub.challenge`
- `POST` responde rapido con `200`
- si la flag esta apagada, el `POST` devuelve `OK` controlado y no procesa funcionalmente
- si la flag esta prendida, el processor persiste eventos raw en `WhatsappWebhookEvent`
- los estados Meta se mapean a:
  - `sent -> SENT`
  - `delivered -> DELIVERED`
  - `read -> READ`
  - `failed -> FAILED`
- `ACCEPTED` sigue siendo solo estado inicial del provider, no estado de webhook

Idempotencia y orden:

- `providerMessageId` sigue siendo la clave principal para vincular webhooks con deliveries
- `providerEventId` se calcula como hash estable por status event
- `providerEventId` queda unico para evitar reprocesamiento duplicado
- no se baja de `READ` a `DELIVERED`
- no se baja de `DELIVERED` a `SENT`
- `FAILED` puede aplicarse salvo que el delivery ya este en `READ`
- si llega un success avanzado despues de `FAILED`, solo `DELIVERED` o `READ` pueden corregirlo

Fuera de alcance:

- no se conecto `OutboxWorker` al provider Meta
- no hay dispatch real de `WHATSAPP_SEND_V2`
- no se migraron eventos reales `CUSTOMER`
- no se migraron eventos reales `CLUB_STAFF`
- no hay inbox
- no hay bot
- no hay inbound funcional de producto

Inbound y eventos huerfanos:

- si llegan mensajes inbound, se persisten como raw event y se ignoran funcionalmente
- si llega un status sin `WhatsappDelivery`, el evento se guarda igual como huerfano
- los webhooks desconocidos se guardan como raw event y no rompen el endpoint

Pendiente para `PR 7`:

- conectar provider al worker de forma controlada
- empezar a poblar `providerMessageId` desde envios reales
- migrar eventos `CUSTOMER` cuando corresponda

## 72. Estado de implementacion PR 7

Alcance:

- se creo `WhatsappSendV2Dispatcher`
- `OutboxWorker` ya puede procesar `WHATSAPP_SEND_V2` con pipeline real
- el pipeline conectado es:
  - `OutboxWorker`
  - `WhatsappNotificationPolicyService`
  - `WhatsappSenderResolver`
  - `WhatsappTemplateResolver`
  - `MetaCloudWhatsappProvider`
  - `WhatsappDelivery`

Flags:

- si `ENABLE_WHATSAPP_SEND_V2=false`, sigue el stub seguro y el delivery queda `SKIPPED`
- si `ENABLE_WHATSAPP_SEND_V2=true` pero `ENABLE_WHATSAPP_CLOUD_API=false`, no se llama provider y el delivery queda `SKIPPED` con error controlado
- solo hay dispatch real si:
  - `ENABLE_WHATSAPP_SEND_V2=true`
  - `ENABLE_WHATSAPP_CLOUD_API=true`

Comportamiento del dispatch:

- el payload V2 se valida antes de despachar
- `PIQUE_DEFAULT` se resuelve desde DB por `WhatsappSenderResolver`
- el template se resuelve por sender + evento + rol + idioma
- no se mezclan templates `CUSTOMER` y `CLUB_STAFF`
- si Meta acepta el request inicial:
  - `WhatsappDelivery.status = ACCEPTED`
  - se guarda `providerMessageId`
  - se guarda `rawRequest`
  - se guarda `rawResponse`
- si el provider falla en el request inicial:
  - `WhatsappDelivery.status = FAILED`
  - se guarda `errorCode`
  - se guarda `errorMessage`
  - se guarda `rawRequest`
  - se guarda `rawResponse` si existe

Semantica de estados:

- `ACCEPTED` sigue significando solo aceptacion inicial de API
- `SENT`, `DELIVERED`, `READ` y `FAILED` por entrega final siguen viviendo en webhooks
- `OutboxMessage.status` solo expresa que la queue ya proceso el item
- el estado real del delivery vive en `WhatsappDelivery`

Retries:

- errores retryable del provider hacen que el worker deje `OutboxMessage` en `FAILED` para retry
- errores no retryable dejan `OutboxMessage` procesado y el detalle de falla queda en `WhatsappDelivery`
- no se cambia la semantica legacy del worker

Fuera de alcance:

- no se tocaron `BookingService`
- no se tocaron `PendingBookingAutoCancelService`
- no se migraron eventos reales `CUSTOMER`
- no se migraron eventos reales `CLUB_STAFF`
- no se agrego inbox
- no se agrego bot
- no se agrego inbound funcional
- no se agrego sender propio por club

Pendiente para `PR 8`:

- migrar eventos reales `CUSTOMER`
- empezar el cutover controlado de reservas hacia `WHATSAPP_SEND_V2`
- decidir rollout progresivo y shadow mode operativo

## 73. Estado de implementacion PR 8

Alcance:

- se agrego `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2`
- se creo `BookingCustomerWhatsappNotificationService`
- se migraron solo eventos reales `CUSTOMER`:
  - `BOOKING_CREATED`
  - `BOOKING_CANCELLED`
  - `BOOKING_PENDING_WARNING`
- `CLUB_STAFF` queda legacy en este PR

Comportamiento:

- si `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2=false`:
  - `BookingService` sigue encolando el WhatsApp legacy del cliente como hoy
  - `PendingBookingAutoCancelService` sigue encolando el warning legacy del cliente como hoy
- si `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2=true`:
  - `BookingService` filtra el `WHATSAPP_SEND` legacy solo del cliente
  - `BookingService` encola `WHATSAPP_SEND_V2` para cliente creado/cancelado
  - `PendingBookingAutoCancelService` encola `WHATSAPP_SEND_V2` para warning del cliente
  - no hay fallback automatico a legacy si el enqueue V2 falla

Templates y orden explicito:

- `customer_booking_created_v1`
  - `client_name`
  - `club_name`
  - `date`
  - `time`
  - `court_name`
  - `amount`
  - `club_whatsapp_url`
- `customer_booking_cancelled_v1`
  - `client_name`
  - `club_name`
  - `date`
  - `time`
  - `court_name`
  - `club_whatsapp_url`
  - `cancel_reason_label`
- `customer_booking_pending_warning_v1`
  - `client_name`
  - `club_name`
  - `date`
  - `time`
  - `court_name`
  - `cancel_minutes_before`
  - `insufficient_amount`

Reglas importantes:

- no se elimina `WHATSAPP_SEND` legacy
- no se migran mensajes `CLUB_STAFF` en este PR
- no se hace doble envio cliente legacy + V2
- si falla el enqueue V2, la reserva o el job siguen igual
- no se hace fallback legacy automatico

Pendiente para `PR 9`:

- shadow mode y rollout controlado por entorno
- observabilidad comparativa de deliveries legacy vs V2
- arranque progresivo del cutover real

## 74. Estado de implementacion PR 9

Alcance:

- se agrego `ENABLE_WHATSAPP_STAFF_EVENTS_V2`
- se creo `BookingStaffWhatsappNotificationService`
- se migraron eventos `CLUB_STAFF` de booking:
  - `BOOKING_CREATED / CLUB_STAFF`
  - `BOOKING_CANCELLED / CLUB_STAFF`
  - `BOOKING_PENDING_WARNING / CLUB_STAFF`

Comportamiento:

- si `ENABLE_WHATSAPP_STAFF_EVENTS_V2=false`:
  - el club/staff sigue usando `WHATSAPP_SEND` legacy como hoy
- si `ENABLE_WHATSAPP_STAFF_EVENTS_V2=true`:
  - `BookingService` filtra solo el WhatsApp legacy de staff
  - `BookingService` encola `WHATSAPP_SEND_V2` solo para staff created/cancelled
  - no hay doble envio entre legacy y V2 para staff

Templates y orden explicito:

- `staff_booking_created_v1`
  - `club_name`
  - `client_name`
  - `client_phone`
  - `date`
  - `time`
  - `court_name`
  - `amount`
- `staff_booking_cancelled_v1`
  - `club_name`
  - `client_name`
  - `client_phone`
  - `date`
  - `time`
  - `court_name`
  - `cancel_reason_label`

Reglas operativas:

- `club.phone` sigue siendo el destinatario staff MVP
- si falta `club.phone`, el envio staff se omite sin romper la operacion
- si falla el enqueue V2 staff, no falla la reserva ni la cancelacion
- no hay fallback legacy automatico ante error de enqueue V2
- el rollback operativo sigue siendo apagar `ENABLE_WHATSAPP_STAFF_EVENTS_V2`

Compatibilidad con customer:

- `CUSTOMER` no cambia en este PR
- `CUSTOMER` puede quedar legacy o V2 de forma independiente de staff
- matriz valida:
  - customer false + staff false -> ambos legacy
  - customer true + staff false -> customer V2, staff legacy
  - customer false + staff true -> customer legacy, staff V2
  - customer true + staff true -> ambos V2 sin mezclar roles

Pendiente para `PR 10`:

- shadow mode operativo
- metricas comparativas y rollout progresivo
- pasos de rollback/cutover mas finos por entorno

## 75. Estado de implementacion PR 10

Alcance:

- se agrego `ENABLE_WHATSAPP_V2_DRY_RUN`
- se agrego `WHATSAPP_META_RECIPIENT_ALLOWLIST`
- se creo `WhatsappV2PreflightService`
- se agrego precedence operativa en `WhatsappSendV2Dispatcher`
- se reforzo el rollout seguro sin cambiar defaults productivos

Precedence de flags:

1. si `ENABLE_WHATSAPP_V2_DRY_RUN=true`, no se llama a Meta
2. si hay allowlist y el destinatario no esta incluido, no se llama a Meta
3. si `ENABLE_WHATSAPP_SEND_V2=false`, no hay dispatch real
4. si `ENABLE_WHATSAPP_CLOUD_API=false`, no hay provider real
5. solo con flags correctas + no dry-run + allowlist OK se llama a Meta

Dry-run:

- el dispatcher construye `rawRequest`
- no llama provider
- no setea `ACCEPTED`
- `WhatsappDelivery` queda `SKIPPED`
- usa `errorCode = WHATSAPP_V2_DRY_RUN`
- no genera retry infinito

Allowlist:

- si `WHATSAPP_META_RECIPIENT_ALLOWLIST` esta vacia, no bloquea
- si tiene valores, solo esos telefonos pueden salir por Cloud API
- destinatario fuera de allowlist:
  - no llama a Meta
  - `WhatsappDelivery` queda `SKIPPED`
  - `errorCode = WHATSAPP_RECIPIENT_NOT_ALLOWLISTED`
  - no rompe reservas
  - no reintenta infinito

Preflight:

- valida `PIQUE_DEFAULT`
- valida status `ACTIVE`
- valida `phoneNumberId`
- valida `wabaId`
- valida `tokenSecretRef`
- valida que exista env para el token
- valida templates activos requeridos:
  - `customer_booking_created_v1`
  - `customer_booking_cancelled_v1`
  - `customer_booking_pending_warning_v1`
  - `staff_booking_created_v1`
  - `staff_booking_cancelled_v1`
- valida verify token si webhook processor esta activo
- reporta warnings por combinaciones inconsistentes de flags

Observabilidad minima:

- `dry-run skip`
- `allowlist blocked recipient`
- `dispatching to provider`
- mantiene IDs utiles:
  - `outboxMessageId`
  - `whatsappDeliveryId`
  - `eventType`
  - `recipientRole`
  - `clubId`
- el telefono solo se loguea enmascarado
- no se loguean tokens ni authorization headers

Rollout recomendado:

Paso 0: Preflight

- validar DB migrada
- configurar `PIQUE_DEFAULT`
- configurar template mappings
- configurar envs
- correr preflight

Paso 1: Dry-run

- `ENABLE_WHATSAPP_SEND_V2=true`
- `ENABLE_WHATSAPP_V2_DRY_RUN=true`
- `ENABLE_WHATSAPP_CLOUD_API=false`
- activar `CUSTOMER` o `CLUB_STAFF` V2 segun prueba

Paso 2: Allowlist interna

- `ENABLE_WHATSAPP_SEND_V2=true`
- `ENABLE_WHATSAPP_CLOUD_API=true`
- `ENABLE_WHATSAPP_V2_DRY_RUN=false`
- `WHATSAPP_META_RECIPIENT_ALLOWLIST=...`

Paso 3: Customer piloto

- `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2=true`
- `ENABLE_WHATSAPP_STAFF_EVENTS_V2=false`

Paso 4: Staff piloto

- `ENABLE_WHATSAPP_STAFF_EVENTS_V2=true`

Paso 5: Rollback

- apagar `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2`
- apagar `ENABLE_WHATSAPP_STAFF_EVENTS_V2`
- apagar `ENABLE_WHATSAPP_SEND_V2`
- apagar `ENABLE_WHATSAPP_CLOUD_API`
- legacy sigue disponible

Smoke checklist:

- crear reserva customer legacy
- crear reserva customer V2 dry-run
- crear reserva customer V2 allowlist
- cancelar reserva customer V2
- pending warning customer V2 dry-run
- crear reserva staff legacy
- crear reserva staff V2 dry-run
- cancelar reserva staff V2
- verificar `WhatsappDelivery`
- verificar `providerMessageId` en envio real allowlisted
- simular webhook delivered/read con payload mock
- confirmar que no hay doble envio
- confirmar rollback por flags

Pendiente para `PR 11`:

- backoffice/logs minimos para soporte
- inspeccion operativa de deliveries desde UI/admin si corresponde

## 76. Estado de implementacion PR 11

PR11 agrega visibilidad operativa minima read-only para soporte/admin.

### Incluido

- service interno `WhatsappOperationsService`
- endpoints admin read-only en `/api/admin/whatsapp`
- listado de deliveries
- detalle de delivery
- listado de webhook events
- summary operativo simple
- preflight expuesto por endpoint admin
- sanitizacion obligatoria de payloads/raw

### Endpoints

- `GET /api/admin/whatsapp/deliveries`
- `GET /api/admin/whatsapp/deliveries/:id`
- `GET /api/admin/whatsapp/webhook-events`
- `GET /api/admin/whatsapp/summary`
- `GET /api/admin/whatsapp/preflight`

### Seguridad

- endpoints no publicos
- protegidos por `authMiddleware + requireGlobalRole('ADMIN')`
- sin exposicion de tokens
- sin exposicion de `Authorization`
- telefonos enmascarados en respuestas operativas

### Alcance funcional

- consultar ultimos deliveries
- filtrar por `clubId`, `status`, `eventType`, `recipientRole`, `providerMessageId`, `outboxMessageId`
- ver outbox minimo asociado
- ver sender/template asociados
- ver webhooks asociados
- ver huerfanos
- ver errores recientes
- ver preflight actual

### No incluido

- resend manual
- inbox
- CRM
- bot
- campanas
- marketing
- UI premium

### Sanitizacion

- helper dedicado para payloads WhatsApp
- remueve `Authorization`, `access_token`, bearer tokens y referencias sensibles
- enmascara telefonos en request, response y webhook payloads

### Rollback

- no cambia defaults productivos
- no cambia dispatch
- rollback sigue siendo por flags ya existentes

## 77. Estado final PR 12 / Production readiness

PR12 cierra la migracion como modulo listo para rollout controlado. No agrega features nuevas de producto. No activa cutover por default.

### 77.1 Estado del modulo

| Capability | Estado | Flag | Comentario |
| --- | --- | --- | --- |
| `BOOKING_CREATED / CUSTOMER` V2 | Implementado | `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2` | filtra legacy customer cuando se activa |
| `BOOKING_CANCELLED / CUSTOMER` V2 | Implementado | `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2` | sin doble envio |
| `BOOKING_PENDING_WARNING / CUSTOMER` V2 | Implementado | `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2` | warning real migrado |
| `BOOKING_CREATED / CLUB_STAFF` V2 | Implementado | `ENABLE_WHATSAPP_STAFF_EVENTS_V2` | usa `club.phone` actual |
| `BOOKING_CANCELLED / CLUB_STAFF` V2 | Implementado | `ENABLE_WHATSAPP_STAFF_EVENTS_V2` | usa `club.phone` actual |
| `BOOKING_PENDING_WARNING / CLUB_STAFF` V2 | Implementado | `ENABLE_WHATSAPP_STAFF_EVENTS_V2` | suma prevención staff sin legacy paralelo |
| Dispatch V2 | Implementado | `ENABLE_WHATSAPP_SEND_V2` + `ENABLE_WHATSAPP_CLOUD_API` | requiere sender + template + envs |
| Webhooks | Implementado | `ENABLE_WHATSAPP_WEBHOOK_PROCESSOR` | `ACCEPTED` sigue siendo estado interno, no webhook |
| Dry-run | Implementado | `ENABLE_WHATSAPP_V2_DRY_RUN` | no llama a Meta |
| Allowlist | Implementado | `WHATSAPP_META_RECIPIENT_ALLOWLIST` | protege piloto real |
| Preflight | Implementado | endpoint admin | correr antes de rollout |
| Backoffice operativo | Implementado | auth admin | read-only |
| Resend manual | Implementado | auth admin | reencola `WHATSAPP_SEND_V2` con nueva `dedupeKey` |
| Inbox | Fuera de alcance | N/A | no implementar en esta etapa |
| Sender propio por club | Implementado | configuracion DB | resolver prioriza `CLUB_OWN` y cae a `PIQUE_DEFAULT` |

### 77.2 Guia operativa de `PIQUE_DEFAULT`

Configuracion requerida en `WhatsappSender`:

- `code = PIQUE_DEFAULT`
- `mode = PIQUE_DEFAULT`
- `provider = META_CLOUD_API`
- `status = ACTIVE`
- `clubId = null`
- `phoneNumberId = <META_PHONE_NUMBER_ID>`
- `wabaId = <META_WABA_ID>`
- `tokenSecretRef = WHATSAPP_META_ACCESS_TOKEN`

Reglas:

- el token real vive solo en env backend
- no guardar access token plano en DB
- no hardcodear secretos en seed
- `tokenSecretRef` es referencia, no secreto usable

Ejemplo conceptual seguro:

```sql
insert into "WhatsappSender" (
  "id",
  "clubId",
  "code",
  "mode",
  "provider",
  "displayName",
  "wabaId",
  "phoneNumberId",
  "businessPhone",
  "tokenSecretRef",
  "status",
  "createdAt",
  "updatedAt"
) values (
  '<CUID>',
  null,
  'PIQUE_DEFAULT',
  'PIQUE_DEFAULT',
  'META_CLOUD_API',
  'Pique',
  '<META_WABA_ID>',
  '<META_PHONE_NUMBER_ID>',
  '<META_BUSINESS_PHONE>',
  'WHATSAPP_META_ACCESS_TOKEN',
  'ACTIVE',
  now(),
  now()
);
```

### 77.3 Templates requeridos para rollout MVP

| Template | EventType | RecipientRole | Language | Category | Estado esperado | Variables | Template parameter order |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `customer_booking_created_v1` | `BOOKING_CREATED` | `CUSTOMER` | `es_AR` | `UTILITY` | `ACTIVE` | `client_name`, `club_name`, `date`, `time`, `court_name`, `amount`, `club_whatsapp_url` | `client_name`, `club_name`, `date`, `time`, `court_name`, `amount`, `club_whatsapp_url` |
| `customer_booking_cancelled_v1` | `BOOKING_CANCELLED` | `CUSTOMER` | `es_AR` | `UTILITY` | `ACTIVE` | `client_name`, `club_name`, `date`, `time`, `court_name`, `club_whatsapp_url`, `cancel_reason_label` | `client_name`, `club_name`, `date`, `time`, `court_name`, `club_whatsapp_url`, `cancel_reason_label` |
| `customer_booking_pending_warning_v1` | `BOOKING_PENDING_WARNING` | `CUSTOMER` | `es_AR` | `UTILITY` | `ACTIVE` | `client_name`, `club_name`, `date`, `time`, `court_name`, `cancel_minutes_before`, `insufficient_amount` | `client_name`, `club_name`, `date`, `time`, `court_name`, `cancel_minutes_before`, `insufficient_amount` |
| `staff_booking_created_v1` | `BOOKING_CREATED` | `CLUB_STAFF` | `es_AR` | `UTILITY` | `ACTIVE` | `club_name`, `client_name`, `client_phone`, `date`, `time`, `court_name`, `amount` | `club_name`, `client_name`, `client_phone`, `date`, `time`, `court_name`, `amount` |
| `staff_booking_cancelled_v1` | `BOOKING_CANCELLED` | `CLUB_STAFF` | `es_AR` | `UTILITY` | `ACTIVE` | `club_name`, `client_name`, `client_phone`, `date`, `time`, `court_name`, `cancel_reason_label` | `club_name`, `client_name`, `client_phone`, `date`, `time`, `court_name`, `cancel_reason_label` |
| `staff_booking_pending_warning_v1` | `BOOKING_PENDING_WARNING` | `CLUB_STAFF` | `es_AR` | `UTILITY` | `ACTIVE` | `club_name`, `client_name`, `client_phone`, `date`, `time`, `court_name`, `cancel_minutes_before`, `insufficient_amount` | `club_name`, `client_name`, `client_phone`, `date`, `time`, `court_name`, `cancel_minutes_before`, `insufficient_amount` |

### 77.4 Matriz definitiva de flags

| Variable | Default recomendado | Entorno | Riesgo si se activa mal | Relacion |
| --- | --- | --- | --- | --- |
| `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2` | `false` | staging/piloto/prod controlado | duplica o reemplaza customer legacy antes de tiempo | decide que produce dominio customer |
| `ENABLE_WHATSAPP_STAFF_EVENTS_V2` | `false` | staging/piloto/prod controlado | duplica o reemplaza staff legacy antes de tiempo | decide que produce dominio staff |
| `ENABLE_WHATSAPP_SEND_V2` | `false` | staging/piloto/prod controlado | dominio produce V2 pero worker no deberia despachar si queda mal combinado | gate del pipeline V2 |
| `ENABLE_WHATSAPP_CLOUD_API` | `false` | staging/piloto/prod controlado | llama provider real sin dry-run/allowlist listos | gate del provider |
| `ENABLE_WHATSAPP_WEBHOOK_PROCESSOR` | `false` | staging/piloto/prod controlado | ruido de webhooks si verify/config faltan | independiente del dispatch |
| `ENABLE_WHATSAPP_V2_DRY_RUN` | `false` | staging/piloto | falsa sensacion de envio real si no se entiende | gana prioridad y no llama a Meta |
| `WHATSAPP_META_RECIPIENT_ALLOWLIST` | vacia | staging/piloto/prod controlado | si se omite en piloto real abre mas alcance del deseado | bloquea destinatarios no permitidos |
| `WHATSAPP_META_GRAPH_API_BASE_URL` | `https://graph.facebook.com` | todos | endpoint incorrecto | usado por provider |
| `WHATSAPP_META_GRAPH_API_VERSION` | `v19.0` | todos | payload/endpoint incompatibles | usado por provider |
| `WHATSAPP_META_REQUEST_TIMEOUT_MS` | `10000` | todos | timeout demasiado bajo o alto | usado por provider |
| `WHATSAPP_META_ACCESS_TOKEN` | sin default | staging/prod | auth fail o fuga si se maneja mal | referenciado por `tokenSecretRef` |
| `WHATSAPP_META_WEBHOOK_VERIFY_TOKEN` | sin default | staging/prod | verify falla o se expone secreto | requerido si webhook esta activo |

Precedence final:

1. `ENABLE_WHATSAPP_V2_DRY_RUN=true` gana y evita llamar a Meta.
2. `WHATSAPP_META_RECIPIENT_ALLOWLIST` bloquea envios no permitidos si tiene valores.
3. `ENABLE_WHATSAPP_SEND_V2=false` impide dispatch V2.
4. `ENABLE_WHATSAPP_CLOUD_API=false` impide provider real.
5. `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2` y `ENABLE_WHATSAPP_STAFF_EVENTS_V2` solo deciden que produce dominio.
6. `ENABLE_WHATSAPP_WEBHOOK_PROCESSOR` es independiente del dispatch.

### 77.5 Go / no-go checklist

Go si:

- DB migrada
- `PIQUE_DEFAULT` existe y esta `ACTIVE`
- `phoneNumberId`, `wabaId` y `tokenSecretRef` configurados
- env real del token cargada
- template mappings requeridos en `ACTIVE`
- preflight `OK` o `WARN` entendido
- dry-run validado
- allowlist validada
- no hay doble envio
- rollback por flags probado
- backoffice admin operativo responde
- webhook verify token listo si se prende webhook
- tests focalizados OK

No-go si:

- falta `PIQUE_DEFAULT`
- falta env del token
- faltan templates requeridos
- preflight `FAIL`
- dry-run genera payloads incorrectos
- allowlist no bloquea
- hay doble envio
- no se puede rollback por flags
- el delivery entra en loop
- aparecen fallas nuevas en tests focalizados

### 77.6 Rollout plan final

Paso 0:

- deploy con defaults apagados
- validar migracion
- validar backoffice admin

Paso 1:

- configurar `PIQUE_DEFAULT`
- configurar template mappings
- configurar envs
- correr preflight

Paso 2:

- activar `ENABLE_WHATSAPP_SEND_V2=true`
- activar `ENABLE_WHATSAPP_V2_DRY_RUN=true`
- mantener `ENABLE_WHATSAPP_CLOUD_API=false`
- activar solo `CUSTOMER` V2 si se quiere primer piloto

Paso 3:

- apagar dry-run
- configurar `WHATSAPP_META_RECIPIENT_ALLOWLIST`
- prender `ENABLE_WHATSAPP_CLOUD_API=true`
- probar solo numeros internos permitidos

Paso 4:

- piloto `CUSTOMER`
- `CLUB_STAFF` puede seguir apagado por flag o probarse en dry-run separado

Paso 5:

- piloto `CLUB_STAFF`
- monitorear ruido y errores operativos

Paso 6:

- ampliar por entorno/club controlado

Paso 7:

- mantener legacy como rollback hasta estabilizacion

### 77.7 Rollback plan final

- apagar `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2`
- apagar `ENABLE_WHATSAPP_STAFF_EVENTS_V2`
- apagar `ENABLE_WHATSAPP_SEND_V2`
- apagar `ENABLE_WHATSAPP_CLOUD_API`
- mantener `WHATSAPP_SEND` legacy para nuevos eventos
- no borrar `WhatsappDelivery`
- no borrar `WhatsappWebhookEvent`
- no resetear migraciones
- no tocar reservas

Reglas:

- mensajes ya `ACCEPTED` por Meta siguen trazables por webhook si webhook sigue activo
- mensajes V2 futuros dejan de despacharse si flags se apagan
- el rollback principal es por flags, no por cambios de schema

### 77.8 Smoke test final

- created customer legacy
- created customer dry-run
- created customer allowlist
- cancelled customer dry-run o allowlist
- pending warning customer dry-run
- created staff legacy
- created staff dry-run
- cancelled staff dry-run
- pending warning staff dry-run
- pending warning staff allowlist o real controlado
- webhook verify
- webhook delivered/read mock
- backoffice delivery list
- backoffice delivery detail
- backoffice summary
- backoffice preflight
- rollback de flags
- confirmar que no hay doble envio

### 77.9 Fuera de alcance confirmado

- no inbox conversacional
- no CRM
- no bot
- no campanas
- no marketing
- no WhatsApp Flows
- no AI assistant
- no pagos por WhatsApp
- no onboarding WABA por club
- no `ClubNotificationRecipient`

### 77.10 Estado de validación local con Meta (`2026-06-06`)

Validado en entorno local:

- `PIQUE_DEFAULT` bootstrapeado correctamente con `phoneNumberId`, `wabaId` y `tokenSecretRef`.
- preflight admin `OK`.
- el pipeline `BOOKING_CREATED / CUSTOMER` genera `WHATSAPP_SEND_V2` real desde Pique.
- Meta recibió requests reales del provider Cloud API.
- el sandbox de Meta aceptó el número emisor de prueba y el destinatario verificado.

Bloqueos observados durante la prueba:

- primero hubo rechazo por `Recipient phone number not in allowed list` hasta alinear recipient list de Meta + `WHATSAPP_META_RECIPIENT_ALLOWLIST` + teléfono real usado por la reserva.
- una vez resuelta la allowlist, Meta devolvió `template name does not exist in es_AR`, consistente con templates todavía `In review` o no disponibles todavía en la WABA/translation efectiva.

Conclusión operativa:

- a la fecha de esta validación, el cuello de botella ya no está en Pique sino en la aprobación/disponibilidad de templates en Meta.
- no tiene sentido seguir rotando tokens o cambiando flags mientras el template base siga `In review`.
- alcanza con que `customer_booking_created_v1` pase a `Approved` para ejecutar la siguiente validación real.

Siguiente paso recomendado cuando haya aprobación:

1. reenviar un delivery `BOOKING_CREATED / CUSTOMER`;
2. confirmar transición a `ACCEPTED`;
3. recién después configurar webhook público y prender `ENABLE_WHATSAPP_WEBHOOK_PROCESSOR=true` para validar `SENT / DELIVERED / READ`.

Decisión sobre webhooks en esta etapa:

- los webhooks quedan preparados pero diferidos.
- no bloquean la validación actual del pipeline `Pique -> Meta`.
- se retoman apenas exista al menos un template aprobado y reusable para envío real.
- no eliminacion de legacy en esta etapa

### 77.10 Fuente de verdad final

- repo = fuente de verdad
- Notion = espejo
- si hay diferencia, prevalece repo hasta resincronizar

### 77.11 Script de preflight

No se agrega script nuevo en PR12.

Decision:

- ya existe endpoint admin seguro `GET /api/admin/whatsapp/preflight`
- suficiente para readiness actual
- evita scope extra en scripts/CLI en este cierre
