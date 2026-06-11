# Auditoria legacy de WhatsApp

## Estado del documento

- Proyecto: `Pique`
- Dominio: notificaciones transaccionales legacy por WhatsApp
- Fecha de auditoria: `2026-06-01`
- Alcance: `PR 1 - Auditoria legacy + inventario de eventos`
- Fuente de verdad: codigo del repo
- Restriccion: sin cambios funcionales, sin schema, sin providers nuevos

## 1. Resumen ejecutivo

Hoy WhatsApp en Pique funciona sobre una combinacion de:

- `OutboxMessage` como cola persistente
- `OutboxWorker` como consumidor
- `WhatsappDeliveryService` como facade de entrega
- dos providers legacy:
  - `wpp_http` hacia `apps/wpp-service`
  - `local_browser` via `whatsapp-web.js` embebido en backend

La implementacion actual ya tiene piezas reutilizables:

- outbox persistente con `dedupeKey`
- worker asincrono
- separacion minima entre dominio y entrega
- normalizacion de telefono reusable

Pero tambien tiene limites fuertes:

- depende de `whatsapp-web.js`
- depende de browser / Chromium / QR / session local
- texto final se construye hoy dentro de `BookingService` y `PendingBookingAutoCancelService`
- no existe trazabilidad de entrega real mas alla de `OutboxMessage.status`
- no existe `providerMessageId`
- `SENT` hoy significa "el worker considero enviado", no "entregado"

Mensajes actuales que no se deben perder:

- `CUSTOMER`:
  - reserva creada
  - reserva cancelada
  - warning de reserva pendiente antes de auto-cancelacion
- `CLUB_STAFF`:
  - nueva reserva
  - reserva cancelada

Hallazgo clave:

- hoy no existe un WhatsApp staff equivalente para pending warning
- si existe una notificacion interna al usuario de booking en algunos casos
- por lo tanto `staff_booking_pending_warning_v1` no surge como paridad legacy estricta; requiere confirmacion funcional

## 2. Inventario de archivos

| Archivo | Responsabilidad actual | Riesgo | Reutilizable para V2 |
| --- | --- | --- | --- |
| `apps/backend/src/services/WhatsappService.ts` | cliente local `whatsapp-web.js` con `LocalAuth`, QR, headless, session local | alto | no para provider; si como referencia de rollback temporal |
| `apps/backend/src/services/WhatsappDeliveryService.ts` | facade que decide `wpp_http` vs `local_browser`, normaliza telefono, expone status/qr | medio | si, como punto de abstraccion a evolucionar |
| `apps/backend/src/services/OutboxWorker.ts` | reclama outbox, despacha `WHATSAPP_SEND` y `NOTIFICATION_CREATE`, marca `SENT/FAILED` | medio | si, como worker base |
| `apps/backend/src/services/OutboxService.ts` | encola `OutboxMessage` con `type`, `payload`, `dedupeKey` | bajo | si, muy reutilizable |
| `apps/backend/src/services/BookingService.ts` | arma mensajes WhatsApp de booking creado y cancelado, encola outbox | alto | parcialmente; debe dejar de construir texto final |
| `apps/backend/src/services/PendingBookingAutoCancelService.ts` | arma warning WhatsApp al cliente y notificacion interna, marca `autoCancelWarningSentAt` | medio | parcialmente; logica de trigger sirve, texto no |
| `apps/wpp-service/index.js` | microservicio HTTP legacy que usa `whatsapp-web.js` y expone `/send` y `/status` | alto | solo como fallback temporal |
| `apps/backend/src/utils/phone.ts` | normalizacion y conversion a telefono discable | bajo | si, muy reutilizable |
| `apps/backend/src/app.ts` | endpoints admin `/whatsapp/qr` y `/whatsapp/status` para provider local | medio | solo como soporte legacy / diagnostico |
| `apps/backend/prisma/schema.prisma` | define `OutboxMessage`, `OutboxStatus`, `autoCancelWarningSentAt` | medio | si, base de cola reutilizable |
| `apps/backend/src/config/featureFlags.ts` | flags `ENABLE_OUTBOX` y `ENABLE_WHATSAPP_WORKER` | bajo | si, extender sin romper |

## 3. Inventario de eventos actuales

| Evento actual | Destinatario | Rol futuro | Archivo origen | Momento en que se dispara | Payload actual | Equivalente V2 |
| --- | --- | --- | --- | --- | --- | --- |
| booking created whatsapp client | cliente / jugador | `CUSTOMER` | `BookingService.ts` | al crear reserva y encolar outbox | `{ phone, message }` | `customer_booking_created_v1` |
| booking created whatsapp club | telefono del club | `CLUB_STAFF` | `BookingService.ts` | al crear reserva web, salvo `suppressClubNotification` | `{ phone, message }` | `staff_booking_created_v1` |
| booking created internal notification | usuarios admin/owner del club | fuera de WhatsApp MVP | `BookingService.ts` | al crear reserva | `{ userId, clubId, title, message }` | no es WhatsApp; sigue como notificacion interna |
| booking cancelled whatsapp client | cliente / jugador | `CUSTOMER` | `BookingService.ts` | al cancelar reserva, manual o auto-cancel | `{ phone, message }` | `customer_booking_cancelled_v1` |
| booking cancelled whatsapp club | telefono del club | `CLUB_STAFF` | `BookingService.ts` | al cancelar reserva | `{ phone, message }` | `staff_booking_cancelled_v1` |
| booking cancelled internal notification | usuario owner de la reserva | fuera de WhatsApp MVP | `BookingService.ts` | al cancelar reserva | `{ userId, clubId, title, message }` | no es WhatsApp; sigue como notificacion interna |
| pending auto-cancel warning whatsapp client | cliente / jugador | `CUSTOMER` | `PendingBookingAutoCancelService.ts` | al entrar en ventana de warning y antes de auto-cancel | `{ phone, message }` | `customer_booking_pending_warning_v1` |
| pending auto-cancel warning internal notification | usuario owner de la reserva | fuera de WhatsApp MVP | `PendingBookingAutoCancelService.ts` | misma ventana de warning | `{ userId, clubId, title, message }` | no es WhatsApp; sigue como notificacion interna |

Notas de auditoria:

- `BOOKING_OWNER` no existe hoy como rol persistente de notificaciones; para esta auditoria equivale semanticamente a `CUSTOMER`
- no se encontro un WhatsApp actual para `CLUB_STAFF` en warning pendiente

## 4. Mensajes CUSTOMER

### 4.1 Reserva creada

- Archivo: `apps/backend/src/services/BookingService.ts`
- Metodo: `buildBookingCreatedOutboxMessages`
- Trigger: luego de crear reserva y antes de `enqueueMany`
- Numero destino: `resolvedClient?.phone || bookingOwnerUser?.phoneNumber`
- Normalizacion: `toDialablePhoneNumber`
- Dedupe actual: `booking-created:{bookingId}:client:{cleanClientPhone}`
- Texto actual:

```text
Reserva registrada en club
incluye fecha, hora, cancha, monto
incluye link wa.me del club
```

- Datos usados:
  - `clubName`
  - `clientName`
  - `date`
  - `time`
  - `courtName`
  - `amount`
  - `cleanClubPhone`
- Mantener en MVP: si
- Template futuro sugerido: `customer_booking_created_v1`

### 4.2 Reserva cancelada

- Archivo: `apps/backend/src/services/BookingService.ts`
- Metodo: `buildBookingCancelledOutboxMessages`
- Trigger: dentro de `cancelBooking`
- Numero destino: `currentBooking.user?.phoneNumber || currentBooking.client?.phone`
- Normalizacion: `toDialablePhoneNumber`
- Dedupe actual: `booking-cancelled:{bookingId}:client:{cleanClientPhone}`
- Texto actual:

```text
Reserva cancelada en club
si fue auto-cancel, lo aclara
incluye fecha, hora, cancha
incluye link wa.me del club
```

- Datos usados:
  - `clubName`
  - `clientName`
  - `date`
  - `time`
  - `courtName`
  - `cleanClubPhone`
  - `reason`
- Mantener en MVP: si
- Template futuro sugerido: `customer_booking_cancelled_v1`

### 4.3 Warning de reserva pendiente / auto-cancelacion

- Archivo: `apps/backend/src/services/PendingBookingAutoCancelService.ts`
- Metodo: `buildWarningMessage`
- Trigger: `processPendingBookingWarnings`
- Numero destino: `booking.user?.phoneNumber || booking.client?.phone`
- Normalizacion: `normalizeIdentityPhone` al leer, `OutboxWorker` y `WhatsappDeliveryService` vuelven a normalizar/convertir
- Dedupe actual: `booking-auto-cancel-warning:{bookingId}:client:{clientPhone}`
- Guard adicional: `booking.autoCancelWarningSentAt`
- Texto actual:

```text
Tu reserva sigue pendiente de confirmacion
incluye fecha, hora, cancha
opcionalmente informa monto faltante
incluye hora limite antes de cancelacion automatica
```

- Datos usados:
  - `clientName`
  - `clubName`
  - `courtName`
  - `date`
  - `time`
  - `insufficientAmount`
  - `cancelMinutesBefore`
  - `limitTime`
- Mantener en MVP: si
- Template futuro sugerido: `customer_booking_pending_warning_v1`

### 4.4 Otros mensajes CUSTOMER encontrados

No se encontraron otros `WHATSAPP_SEND` productivos en backend para cliente vinculados a booking fuera de:

- created
- cancelled
- pending warning

## 5. Mensajes CLUB_STAFF

### 5.1 Nueva reserva

- Archivo: `apps/backend/src/services/BookingService.ts`
- Metodo: `buildBookingCreatedOutboxMessages`
- Destino actual: `club.phone`
- Como se obtiene: `(court as any)?.club?.phone ?? null`
- Normalizacion: `toDialablePhoneNumber`
- Dedupe actual: `booking-created:{bookingId}:club:{cleanClubPhone}`
- Texto actual:

```text
Nueva reserva
incluye cliente, telefono cliente, fecha, hora, cancha y monto
```

- Datos usados:
  - `clubName`
  - `clientName`
  - `cleanClientPhone`
  - `date`
  - `time`
  - `courtName`
  - `amount`
- Mantener en MVP: si
- Template futuro sugerido: `staff_booking_created_v1`
- Clasificacion: mantener en MVP

Nota:

- si la reserva fue creada por admin (`createdByAdmin`), se pasa `suppressClubNotification: true`
- hoy ya existe criterio anti-ruido minimo para evitar auto-notificarse en ese caso

### 5.2 Reserva cancelada

- Archivo: `apps/backend/src/services/BookingService.ts`
- Metodo: `buildBookingCancelledOutboxMessages`
- Destino actual: `club.phone`
- Como se obtiene: `(booking.court.club as any)?.phone ?? null`
- Normalizacion: `toDialablePhoneNumber`
- Dedupe actual: `booking-cancelled:{bookingId}:club:{cleanClubPhone}`
- Texto actual:

```text
Turno cancelado
si fue auto-cancel, lo aclara
incluye cliente, telefono cliente, fecha, hora, cancha
aclara que la cancha vuelve a quedar disponible
```

- Datos usados:
  - `clubName`
  - `clientName`
  - `cleanClientPhone`
  - `date`
  - `time`
  - `courtName`
  - `reason`
- Mantener en MVP: si
- Template futuro sugerido: `staff_booking_cancelled_v1`
- Clasificacion: mantener en MVP

### 5.3 Warning pendiente / auto-cancelacion

- Estado actual: no se encontro `WHATSAPP_SEND` a `club.phone` o equivalente para warning pendiente
- Archivo relacionado: `apps/backend/src/services/PendingBookingAutoCancelService.ts`
- Comportamiento actual:
  - WhatsApp al cliente
  - notificacion interna solo al `booking.userId` si existe
- Template futuro sugerido: `staff_booking_pending_warning_v1`
- Clasificacion: migrar luego / requiere confirmacion manual

### 5.4 Mensajes staff fuera de WhatsApp

Hay notificaciones internas adicionales:

- nueva reserva -> `NOTIFICATION_CREATE` para users `OWNER` y `ADMIN` del club
- reserva cancelada -> `NOTIFICATION_CREATE` para `currentBooking.user?.id`

Conclusiones:

- el canal WhatsApp staff actual depende de `club.phone`
- el canal interno app depende de `userId`
- hoy no existe un modelo dedicado `staff notification phone`
- hoy tampoco existe lista de destinatarios staff

## 6. Outbox actual

### 6.1 Tipos existentes

`OutboxService` define hoy:

- `WHATSAPP_SEND`
- `NOTIFICATION_CREATE`

### 6.2 Persistencia

Tabla actual: `OutboxMessage`

Campos relevantes:

- `type`
- `aggregateType`
- `aggregateId`
- `payload`
- `dedupeKey`
- `status`
- `attempts`
- `availableAt`
- `claimedAt`
- `claimedBy`
- `processedAt`
- `lastError`

Estado actual:

- `PENDING`
- `PROCESSING`
- `SENT`
- `FAILED`

### 6.3 Formato actual del payload WhatsApp

```json
{
  "phone": "549...",
  "message": "texto final"
}
```

Limitacion:

- no contiene `recipientRole`
- no contiene `templateKey`
- no contiene `providerMessageId`
- no contiene `senderKey`
- no contiene `referenceType` explicito mas alla de `aggregateType`

### 6.4 Procesamiento en OutboxWorker

Flujo actual:

1. reclama mensajes `PENDING` o `FAILED`
2. los marca `PROCESSING`
3. si `type === WHATSAPP_SEND`:
   - valida `payload.phone`
   - valida `payload.message`
   - llama `WhatsappDeliveryService.sendMessage`
4. si no hay excepcion:
   - marca `SENT`
5. si hay error:
   - incrementa `attempts`
   - marca `FAILED`
   - reprograma `availableAt`

### 6.5 Idempotencia

Si:

- existe `dedupeKey` unica en `OutboxMessage`
- booking created / cancelled y pending warning la usan

Limitaciones:

- dedupe es de queue, no de entrega del provider
- no hay `providerMessageId`
- no hay reconciliacion por webhook

### 6.6 Reintentos

Si:

- hay reintento simple por worker
- delay actual: `attempts * 5000ms`, capped en `60000ms`

Limitaciones:

- no hay max attempts explicito
- no hay clasificacion fina por tipo de error
- `false` sin throw del provider puede terminar como `SENT` funcionalmente ambiguo si no se maneja bien aguas arriba

### 6.7 Errores manejados

`OutboxWorker` captura excepciones y guarda:

- `status = FAILED`
- `attempts`
- `lastError`

`WhatsappService` maneja internamente:

- no ready
- `detached Frame`
- `Target closed`
- `Session closed`
- timeout de envio

## 7. WhatsApp Web legacy

### 7.1 Dependencias actuales

- `whatsapp-web.js`
- Chromium / Puppeteer
- QR
- session local
- `LocalAuth`

### 7.2 Modalidades legacy detectadas

#### `local_browser`

- corre dentro del backend
- usa `WhatsappService.ts`
- expone QR via `/whatsapp/qr`
- expone estado via `/whatsapp/status`

#### `wpp_http`

- corre como servicio separado `apps/wpp-service`
- backend le pega a `/send` y `/status`
- igual depende de `whatsapp-web.js`

### 7.3 Riesgos de estabilidad

- session invalidada
- necesidad de QR
- dependencia de browser
- dependencia de Chromium en host/contenedor
- errores de frame desconectado
- timeout de envio
- no hay garantia de entrega real

### 7.4 Rollback mientras exista legacy

Hoy rollback posible:

- mantener `WHATSAPP_SEND`
- mantener `WhatsappDeliveryService`
- elegir provider `wpp_http` o `local_browser`
- apagar worker via `ENABLE_WHATSAPP_WORKER`
- apagar WhatsApp via `DISABLE_WHATSAPP`

Conclusiones:

- rollback legacy existe
- no debe expandirse con features nuevas
- debe quedar solo como contingencia temporal

## 8. Duplicados y riesgos

### 8.1 Riesgos de duplicado

- doble envio si en futura migracion conviven `WHATSAPP_SEND` y `WHATSAPP_SEND_V2` sin estrategia clara
- dedupe actual protege queue, no provider delivery
- no existe `providerMessageId`

### 8.2 Texto final en dominio

Puntos donde hoy se arma texto final dentro de dominio / servicios de negocio:

- `BookingService.buildBookingCreatedOutboxMessages`
- `BookingService.buildBookingCancelledOutboxMessages`
- `PendingBookingAutoCancelService.buildWarningMessage`

Riesgo:

- migracion puede quedar acoplada a copy hardcodeado si no se extrae a policy/template layer

### 8.3 Mezcla customer / staff

No se mezclan en un mismo payload, pero si conviven en:

- mismo metodo constructor
- mismo tipo de outbox `WHATSAPP_SEND`
- mismo provider legacy

Riesgo:

- migrar solo customer y olvidar staff

### 8.4 Ausencia de trazabilidad real

- `OutboxMessage.status=SENT` no significa entrega real
- no hay `DELIVERED`
- no hay `READ`
- no hay `FAILED` del provider con semantica rica

### 8.5 Dependencia fuerte de browser/session

- `local_browser` depende de `LocalAuth`
- `wpp_http` depende de session del servicio separado
- ambos dependen de `whatsapp-web.js`

### 8.6 Riesgos de bloqueo funcional

Hallazgo positivo:

- reservas no quedan transaccionalmente bloqueadas por WhatsApp
- envio se hace por outbox asincrono

Riesgo residual:

- si futura migracion mete envio sync, se romperia esta propiedad

### 8.7 Riesgo staff

- si solo se migra customer, se pierden:
  - nueva reserva al club
  - cancelacion al club

### 8.8 Riesgo de modelo staff

- numero staff actual no es un campo dedicado
- hoy se usa `club.phone`
- puede no representar al staff operativo real

## 9. Recomendacion para PR 2

Antes de definir modelos nuevos, conviene distinguir:

- queue de intenciones
- registro de entrega / trazabilidad

### Opcion A: extender outbox actual

Idea:

- seguir usando `OutboxMessage` como unica tabla
- agregarle mas metadata

Ventajas:

- menor cantidad de tablas nuevas
- aprovecha dedupe y claim actuales
- menos cambios iniciales

Desventajas:

- mezcla queue y delivery log en una sola entidad
- `OutboxStatus` actual es demasiado pobre para delivery real
- quedaria forzado a modelar provider/webhook en una tabla pensada para cola
- complica historico y observabilidad fina

Archivos afectados:

- `schema.prisma`
- `OutboxService.ts`
- `OutboxWorker.ts`
- queries futuras de admin/logs

### Opcion B: crear tablas nuevas y reutilizar outbox como queue

Idea:

- conservar `OutboxMessage` como cola
- crear tablas de trazabilidad / configuracion separadas

Shape conceptual recomendado:

- `WhatsappMessage`
- `WhatsappWebhookEvent`
- `WhatsappSender`
- `WhatsappTemplateMapping` o `WhatsappTemplate`

Ventajas:

- separa bien queue de delivery
- permite `providerMessageId`
- permite webhooks y estados ricos
- permite audit trail sin deformar outbox actual
- prepara multi-sender futuro sin agrandar MVP funcional

Desventajas:

- mas tablas
- mas migraciones iniciales
- mas trabajo de wiring

Archivos afectados:

- `schema.prisma`
- nueva migracion
- `OutboxWorker.ts`
- nuevos services de policy / provider / webhook

### Recomendacion

Recomiendo `Opcion B` con criterio hibrido:

- mantener `OutboxMessage` como queue
- no usar `OutboxMessage` como unica fuente de verdad de entrega
- crear tablas nuevas para delivery y webhook

Motivo:

- el repo ya tiene una cola reutilizable bastante buena
- lo que falta no es otra cola; falta trazabilidad de proveedor
- extender solo outbox deja muy justo el modelo para `ACCEPTED/SENT/DELIVERED/READ/FAILED`

## 10. Definition of Done global sugerida

- no queda ningun flujo productivo dependiendo obligatoriamente de QR / browser / session
- `WhatsApp Cloud API` puede apagarse sin romper reservas
- legacy puede apagarse por flag
- no hay doble envio entre legacy y Cloud
- `CUSTOMER` y `CLUB_STAFF` estan cubiertos
- cada mensaje tiene `dedupeKey`
- cada mensaje tiene `providerMessageId` cuando Meta acepta
- webhooks actualizan estados sin asumir orden
- no se loguean tokens
- no se hardcodean textos finales en `BookingService`
- reservas nunca fallan porque falle WhatsApp

## 11. Hallazgos concretos para siguientes PRs

- `club.phone` hoy actua como telefono staff de facto
- `PendingBookingAutoCancelService` hoy solo manda WhatsApp a cliente
- `BookingService` ya tiene semantica separada customer/club, aunque todavia construye texto final
- `OutboxMessage` ya aporta `dedupeKey`, retries y claim seguro
- `WhatsappDeliveryService` ya es punto natural para esconder providers
- `OutboxWorker` hoy marca `SENT` sin tener confirmacion real del proveedor
