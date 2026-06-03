# Modulo de Facturacion Electronica ARCA

## Estado del documento

- Proyecto: `Pique`
- Dominio: facturacion electronica ARCA/AFIP para clubes deportivos
- Stack actual: `Node.js`, `Express`, `Prisma`, `PostgreSQL`, `Redis`
- Arquitectura base del repo: multi-tenant por `Club`, cuentas por `Account`, reserva por `Booking`, procesamiento async por `OutboxMessage`/worker
- Ultima revision funcional: `2026-06-01`

## 1. Objetivo

Implementar un modulo de facturacion electronica para ARCA que permita a cada club emitir comprobantes fiscales validos desde Pique sin bloquear el flujo operativo del punto de venta ni comprometer el aislamiento multi-tenant.

El modulo debe cubrir:

- Facturas electronicas para operaciones B2C y B2B.
- Notas de credito asociadas a comprobantes originales.
- Emision para alquiler de canchas, cantina y tickets mixtos.
- Generacion de QR reglamentario para ticket/PDF.
- Trazabilidad completa del ciclo de emision.
- Reintentos tecnicos sin duplicar comprobantes.

## 2. Alcance funcional

### Incluido en esta etapa

- Integracion con `WSAA` para autenticacion.
- Integracion con `WSFEv1` para solicitud de `CAE`.
- Emision de comprobantes clases `A`, `B`, `C` y variantes vigentes de comprobante `A` cuando correspondan.
- Soporte de conceptos:
  - `1 = Productos`
  - `2 = Servicios`
  - `3 = Productos y Servicios`
- Facturacion desde ventas originadas en:
  - `Booking`
  - `Account`
  - `AccountItem`
  - ventas manuales de mostrador
- Emision asincrona mediante outbox/worker.
- Cache de `Token` y `Sign` por tenant.
- Registro persistente de payloads, respuesta y errores.

### Fuera de alcance inicial

- `wsmtxca` con detalle de items a nivel fiscal.
- Factura de exportacion `E`.
- Factura de credito electronica MiPyME `FCE`.
- Libros IVA, percepciones, retenciones o liquidaciones contables avanzadas.
- Conciliacion bancaria automatica.

## 3. Contexto de negocio

Pique es un SaaS multi-tenant para clubes deportivos. Cada club:

- tiene su propia razon social, CUIT y condicion fiscal,
- administra uno o mas puntos de venta,
- emite comprobantes con certificados propios,
- puede vender servicios, productos o ambos en una misma cuenta.

Casos tipicos:

1. Reserva de cancha facturada como servicio.
2. Venta de bebidas o alquiler de paletas facturada como producto.
3. Cuenta unificada de cancha + cantina facturada como productos y servicios.
4. Cancelacion o reintegro parcial resuelto con nota de credito.

## 4. Requisitos regulatorios y operativos

### Requisitos regulatorios a respetar

- El modulo debe reutilizar el `Ticket de Acceso` del `WSAA` mientras siga vigente.
- El modulo debe garantizar correlatividad numerica por `CUIT emisor + punto de venta + tipo de comprobante`.
- Para concepto `2` o `3` deben enviarse los datos de servicio exigidos por ARCA cuando correspondan.
- La representacion grafica final del comprobante debe incorporar el QR reglamentario.
- El sistema debe distinguir entre rechazo tecnico, rechazo funcional y aprobacion con observaciones.

### Requisitos operativos internos

- El cajero no debe esperar a ARCA para cerrar una venta local.
- Debe existir una vista administrativa para detectar facturas pendientes, rechazadas y reintentables.
- El sistema no debe emitir duplicados aunque haya reintentos, timeouts o reinicios del worker.
- El vencimiento de certificados debe monitorearse de forma proactiva.

## 5. Arquitectura de alto nivel

## Flujo general

1. La operacion comercial se registra localmente en Pique.
2. Se genera una intencion de facturacion en base de datos.
3. Se publica un evento en `OutboxMessage`.
4. Un worker toma el evento y resuelve autenticacion WSAA.
5. El worker calcula el siguiente numero de comprobante de forma segura.
6. El worker arma el payload y llama a `WSFEv1`.
7. La respuesta se persiste en el modulo fiscal.
8. Si el comprobante fue aprobado, queda disponible para ticket/PDF y auditoria.

## Componentes

- `ConfiguracionFiscal` por club.
- `Factura` o `FiscalVoucher` como entidad principal del comprobante.
- `FacturaIntent` o estado interno de emision.
- `ArcaAuthCache` para token/sign vigentes.
- `ArcaService` para WSAA + WSFEv1.
- `ArcaWorker` para proceso asincrono.
- `ArcaQrService` para QR reglamentario.
- `ArcaAdminView` para monitoreo y reproceso.

## Integracion con componentes existentes del repo

- `Club`: tenant emisor.
- `Booking`: origen de facturacion de alquileres.
- `Account`: cuenta comercial consolidada.
- `AccountItem`: detalle operativo del consumo interno.
- `Payment`: cobros locales, independientes del estado de autorizacion fiscal.
- `OutboxService` y `OutboxWorker`: mecanismo recomendado para disparar la emision asincrona.
- `RedisService`: cache recomendado para `Token`/`Sign`, locks de correlatividad e idempotencia distribuida.

## 6. Modelo multi-tenant

La frontera de tenancy es `Club`.

Cada club debe tener:

- su `CUIT`,
- su condicion frente al IVA,
- sus certificados,
- su configuracion fiscal,
- su o sus puntos de venta habilitados,
- su cache de autenticacion aislado,
- su numeracion propia por tipo de comprobante.

Nunca se deben compartir entre clubes:

- certificados,
- claves privadas,
- tokens WSAA,
- numeracion interna,
- logs sensibles.

## 7. Autenticacion con WSAA

## Objetivo

Obtener y reutilizar `Token` y `Sign` para el servicio `wsfe`.

## Reglas

- El cache debe estar particionado por `clubId` y por `serviceName`.
- El ticket debe renovarse antes del vencimiento, con margen de seguridad.
- Se recomienda renovar si restan menos de `15` a `30` minutos de vigencia.
- Si Redis no esta disponible, se debe poder usar base de datos como fallback.

## Estrategia recomendada

- Cache primario en `Redis`.
- Persistencia opcional en tabla para auditoria y fallback.
- Lock por `clubId + wsfe` al refrescar el ticket para evitar tormenta de requests.

## Claves sugeridas en Redis

```text
arca:wsaa:club:{clubId}:service:wsfe
arca:wsaa:club:{clubId}:service:wsfe:refresh-lock
```

## Contenido sugerido del cache

```json
{
  "token": "....",
  "sign": "....",
  "generationTime": "2026-05-31T10:00:00.000Z",
  "expirationTime": "2026-05-31T22:00:00.000Z",
  "source": "redis"
}
```

## 8. Credenciales y seguridad

## Almacenamiento de secretos

Los certificados y claves privadas no deben depender de archivos locales del servidor.

Se recomienda almacenar:

- certificado en formato PEM,
- clave privada en formato PEM,
- passphrase si existiera,
- metadata de vigencia y version.

## Recomendaciones de seguridad

- Encriptar en reposo los campos sensibles.
- Desencriptar solo en memoria durante la llamada al WS.
- Nunca loguear el contenido completo de la clave privada.
- Enmascarar `Token`, `Sign`, `CAE` y payloads sensibles en logs de aplicacion.
- Limitar acceso administrativo a configuracion fiscal.
- Auditar cambios de certificados, CUIT, puntos de venta y condicion fiscal.

## Monitoreo de certificados

Agregar alertas:

- `90` dias antes del vencimiento,
- `30` dias antes,
- `7` dias antes,
- bloqueo preventivo o banner critico si esta vencido.

## 9. Tipos de comprobantes soportados

El tipo de comprobante final depende de:

- condicion fiscal del emisor,
- condicion fiscal del receptor,
- naturaleza de la operacion,
- punto de venta habilitado.

Version inicial recomendada:

- Factura `A`
- Factura `B`
- Factura `C`
- Nota de Credito `A`
- Nota de Credito `B`
- Nota de Credito `C`

Soporte opcional futuro:

- Nota de Debito
- Recibo fiscal
- CAEA

## 10. Conceptos ARCA

### Concepto 1 - Productos

Usar para:

- bebidas,
- snacks,
- paletas,
- pelotas,
- otros items de cantina o mostrador.

### Concepto 2 - Servicios

Usar para:

- alquiler de canchas,
- clases,
- servicios deportivos puros.

Campos obligatorios funcionales:

- `FchServDesde`
- `FchServHasta`
- `FchVtoPago`

### Concepto 3 - Productos y Servicios

Usar cuando una misma cuenta incluye:

- items de cancha o clases,
- y ademas productos.

## 11. Flujos de negocio soportados

### 11.1 Facturacion de booking

1. Se confirma o cobra una reserva.
2. Se identifica la `Account` asociada a la reserva.
3. Se construye el comprobante en base al monto fiscalizable.
4. Se emite como `servicio` o `mixto`.

### 11.2 Facturacion de cantina o mostrador

1. Se crea una `Account` de tipo `BAR` o `MANUAL`.
2. Se registran `AccountItem` de producto.
3. Se emite comprobante de `productos`.

### 11.3 Facturacion de cuenta consolidada

1. Una `Account` contiene items de `BOOKING`, `PRODUCT` y/o `SERVICE`.
2. El builder determina concepto `3`.
3. Se calculan subtotales, IVA y total fiscal.

### 11.4 Nota de credito

Usar para:

- devolucion por lluvia,
- cancelacion posterior,
- error de caja,
- ajuste parcial o total.

Debe:

- referenciar el comprobante original,
- respetar la clase del comprobante,
- guardar motivo interno y usuario responsable.

## 12. Ejecucion asincrona

## Motivo

No acoplar la experiencia del cajero a la disponibilidad de ARCA.

## Patron recomendado

Usar `OutboxMessage` existente en el sistema.

### Tipo sugerido de evento

```text
ARCA_INVOICE_REQUESTED
ARCA_CREDIT_NOTE_REQUESTED
```

### Payload sugerido del outbox

```json
{
  "clubId": 12,
  "fiscalVoucherId": "cuid",
  "originType": "ACCOUNT",
  "originId": "acc_123",
  "attempt": 1
}
```

## Reglas del worker

- Procesamiento idempotente.
- Reintentos con backoff para errores tecnicos.
- Sin reintentos automaticos ciegos ante rechazos funcionales.
- Lock distribuido por `clubId + ptoVta + cbteTipo`.
- Registro del resultado de cada intento.

## 13. Correlatividad e idempotencia

Este es uno de los puntos mas criticos del modulo.

## Riesgo

Si dos workers emiten al mismo tiempo para el mismo club, punto de venta y tipo de comprobante, ambos pueden intentar usar el mismo numero.

## Reglas obligatorias

- Lock por `clubId + puntoDeVenta + tipoComprobante`.
- Una sola emision en vuelo por esa combinacion.
- Antes de emitir, consultar `FECompUltimoAutorizado`.
- El numero local a solicitar debe ser `ultimo + 1`.

## Clave sugerida de lock

```text
arca:seq-lock:club:{clubId}:pto:{ptoVta}:cbte:{cbteTipo}
```

## Idempotencia funcional

Cada solicitud local debe tener una `idempotencyKey` estable, por ejemplo:

```text
club:{clubId}:origin:{originType}:{originId}:kind:{voucherKind}
```

Esto evita:

- crear dos comprobantes fiscales para la misma venta,
- reemitir por timeout del frontend,
- reprocesar dos veces el mismo outbox.

## 14. Estados del comprobante

Estados sugeridos para la entidad fiscal:

- `PENDING`
- `QUEUED`
- `PROCESSING`
- `APPROVED`
- `APPROVED_WITH_OBSERVATIONS`
- `REJECTED`
- `TECHNICAL_ERROR`
- `CANCELLED`

### Semantica

- `PENDING`: creado localmente, aun no encolado.
- `QUEUED`: listo para worker.
- `PROCESSING`: tomado por worker.
- `APPROVED`: ARCA devolvio CAE sin observaciones bloqueantes.
- `APPROVED_WITH_OBSERVATIONS`: aprobado pero con observaciones.
- `REJECTED`: error funcional o validacion ARCA.
- `TECHNICAL_ERROR`: timeout, caida de red, SOAP invalido, WS no disponible.
- `CANCELLED`: solicitud interna anulada antes de la emision.

## 15. Modelo de datos propuesto

Se recomienda agregar al menos estas entidades nuevas en Prisma.

## 15.1 ConfiguracionFiscal

Representa la configuracion fiscal por club.

```prisma
enum FiscalCondition {
  RESPONSABLE_INSCRIPTO
  MONOTRIBUTO
  EXENTO
  CONSUMIDOR_FINAL
  OTRO
}

model ConfiguracionFiscal {
  id                    String   @id @default(cuid())
  clubId                Int      @unique
  club                  Club     @relation(fields: [clubId], references: [id], onDelete: Cascade)

  razonSocial           String
  cuit                  String
  condicionIva          FiscalCondition
  ingresosBrutos        String?
  inicioActividadesAt   DateTime? @db.Timestamptz(3)

  usaHomologacion       Boolean   @default(true)
  activo                Boolean   @default(true)

  certificadoPem        String
  clavePrivadaPem       String
  clavePrivadaPassphrase String?
  certificadoSerial     String?
  certificadoSubject    String?
  vencimientoCertificado DateTime? @db.Timestamptz(3)

  ultimoHealthcheckAt   DateTime? @db.Timestamptz(3)
  ultimoHealthcheckOk   Boolean?
  observaciones         String?

  createdAt             DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt             DateTime  @updatedAt @db.Timestamptz(3)

  facturas              Factura[]
  puntosDeVenta         PuntoDeVentaFiscal[]

  @@index([activo])
  @@index([cuit])
}
```

## 15.1.b PuntoDeVentaFiscal

Representa un punto de venta fiscal habilitado para un club. Se separa de `ConfiguracionFiscal` porque un club puede operar con multiples cajas y necesitar multiples puntos de venta fiscales.

```prisma
model PuntoDeVentaFiscal {
  id                    String   @id @default(cuid())
  clubId                Int
  club                  Club     @relation(fields: [clubId], references: [id], onDelete: Cascade)

  configuracionFiscalId String
  configuracionFiscal   ConfiguracionFiscal @relation(fields: [configuracionFiscalId], references: [id], onDelete: Cascade)

  codigo                Int
  nombre                String
  descripcion           String?
  activo                Boolean  @default(true)
  esDefault             Boolean  @default(false)
  usaHomologacion       Boolean  @default(true)

  createdAt             DateTime @default(now()) @db.Timestamptz(3)
  updatedAt             DateTime @updatedAt @db.Timestamptz(3)

  facturas              Factura[]

  @@unique([clubId, codigo])
  @@index([clubId, activo])
  @@index([clubId, esDefault])
}
```

## 15.2 Factura

Entidad principal del comprobante fiscal emitido o a emitir.

```prisma
enum FiscalVoucherKind {
  INVOICE
  CREDIT_NOTE
}

enum FiscalVoucherClass {
  A
  B
  C
}

enum FiscalVoucherVariant {
  STANDARD
  PAGO_EN_CBU_INFORMADA
  OPERACION_SUJETA_A_RETENCION
}

enum FiscalVoucherStatus {
  PENDING
  QUEUED
  PROCESSING
  APPROVED
  APPROVED_WITH_OBSERVATIONS
  REJECTED
  TECHNICAL_ERROR
  CANCELLED
}

enum FiscalOriginType {
  BOOKING
  ACCOUNT
  ACCOUNT_ITEM
  MANUAL
  REFUND
}

model Factura {
  id                    String   @id @default(cuid())
  clubId                Int
  club                  Club     @relation(fields: [clubId], references: [id], onDelete: Restrict)

  configuracionFiscalId String
  configuracionFiscal   ConfiguracionFiscal @relation(fields: [configuracionFiscalId], references: [id], onDelete: Restrict)

  kind                  FiscalVoucherKind
  status                FiscalVoucherStatus @default(PENDING)
  originType            FiscalOriginType
  originId              String
  idempotencyKey        String

  bookingId             Int?
  booking               Booking? @relation(fields: [bookingId], references: [id], onDelete: SetNull)

  accountId             String?
  account               Account? @relation(fields: [accountId], references: [id], onDelete: SetNull)

  puntoDeVentaFiscalId  String?
  puntoDeVentaFiscal    PuntoDeVentaFiscal? @relation(fields: [puntoDeVentaFiscalId], references: [id], onDelete: SetNull)

  voucherClass          FiscalVoucherClass
  voucherVariant        FiscalVoucherVariant @default(STANDARD)
  comprobanteTipo       Int
  comprobanteDescripcion String?
  puntoDeVenta          Int
  numeroComprobante     Int?

  concepto              Int
  fechaEmision          DateTime @db.Timestamptz(3)
  fechaServicioDesde    DateTime? @db.Timestamptz(3)
  fechaServicioHasta    DateTime? @db.Timestamptz(3)
  fechaVencimientoPago  DateTime? @db.Timestamptz(3)

  receptorDocTipo       Int
  receptorDocNumero     String
  receptorNombre        String?
  receptorDomicilio     String?
  receptorCondicionIva  FiscalCondition?
  receptorCondicionIvaArcaId Int?

  monedaCodigo          String   @default("PES")
  monedaCotizacion      Decimal  @default(1) @db.Decimal(12, 6)

  importeNeto           Decimal  @db.Decimal(12, 2)
  importeIva            Decimal  @db.Decimal(12, 2)
  importeExento         Decimal  @default(0) @db.Decimal(12, 2)
  importeTributos       Decimal  @default(0) @db.Decimal(12, 2)
  importeTotal          Decimal  @db.Decimal(12, 2)

  cae                   String?
  caeVencimiento        DateTime? @db.Timestamptz(3)
  resultadoArca         String?

  qrPayloadBase64       String?
  qrUrl                 String?

  requestPayload        Json?
  responsePayload       Json?
  observacionesArca     Json?
  erroresArca           Json?
  mensajeError          String?
  intentoActual         Int      @default(0)
  ultimoIntentoAt       DateTime? @db.Timestamptz(3)

  comprobanteAsociadoId String?
  comprobanteAsociado   Factura?  @relation("FacturaAsociada", fields: [comprobanteAsociadoId], references: [id], onDelete: SetNull)
  notasCreditoAsociadas Factura[] @relation("FacturaAsociada")

  createdAt             DateTime @default(now()) @db.Timestamptz(3)
  updatedAt             DateTime @updatedAt @db.Timestamptz(3)

  @@unique([clubId, idempotencyKey])
  @@index([clubId, status, createdAt])
  @@index([clubId, originType, originId])
  @@index([clubId, puntoDeVenta, comprobanteTipo, numeroComprobante])
  @@index([puntoDeVentaFiscalId])
  @@index([bookingId])
  @@index([accountId])
}
```

## 15.3 Tabla opcional de cache persistente WSAA

Si se desea fallback a base:

```prisma
model FiscalAuthTicket {
  id              String   @id @default(cuid())
  clubId          Int
  service         String
  token           String
  sign            String
  generationTime  DateTime @db.Timestamptz(3)
  expirationTime  DateTime @db.Timestamptz(3)
  createdAt       DateTime @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime @updatedAt @db.Timestamptz(3)

  @@unique([clubId, service])
  @@index([expirationTime])
}
```

## 16. Servicios de aplicacion propuestos

### ArcaAuthService

Responsabilidades:

- obtener `Token` y `Sign`,
- consultar cache,
- refrescar ticket si expira,
- encapsular WSAA.

Metodos sugeridos:

- `getValidAuth(clubId)`
- `refreshAuth(clubId)`
- `invalidateAuth(clubId)`

### ArcaInvoiceBuilderService

Responsabilidades:

- traducir `Account`, `Booking` y datos del receptor al payload ARCA,
- resolver `concepto`,
- calcular importes fiscales,
- validar campos obligatorios antes del WS.

Metodos sugeridos:

- `buildInvoicePayload(facturaId)`
- `buildCreditNotePayload(facturaId)`
- `validateDraft(facturaId)`

### ArcaVoucherService

Responsabilidades:

- consultar ultimo comprobante autorizado,
- emitir contra `WSFEv1`,
- procesar respuesta,
- persistir CAE, errores y observaciones.

Metodos sugeridos:

- `getLastAuthorizedNumber(clubId, ptoVta, cbteTipo)`
- `authorizeVoucher(facturaId)`
- `handleAuthorizationResponse(facturaId, response)`

### ArcaQrService

Responsabilidades:

- construir JSON reglamentario,
- codificar Base64,
- armar URL final del QR.

### ArcaWorker

Responsabilidades:

- consumir outbox,
- aplicar locks,
- manejar reintentos,
- actualizar estados.

## 17. Flujo detallado de emision

### Paso 1. Registro local

Cuando una venta queda lista para ser facturada:

- se crea la `Account` si no existe,
- se crea el registro `Factura` en estado `PENDING`,
- se genera `idempotencyKey`,
- se encola evento de outbox,
- la UI puede continuar.

### Paso 2. Toma por worker

El worker:

- cambia estado a `PROCESSING`,
- incrementa contador de intentos,
- resuelve `ConfiguracionFiscal`,
- obtiene auth WSAA.

### Paso 3. Lock de secuencia

Antes de consultar/emitir:

- toma lock distribuido por `clubId + ptoVta + cbteTipo`,
- valida que no exista otro worker emitiendo esa combinacion.

### Paso 4. Determinacion de numero

- llama `FECompUltimoAutorizado`,
- calcula `proximo = ultimo + 1`,
- inserta el numero en el draft si aun no estaba asignado.

### Paso 5. Emision

- arma el payload,
- llama `FECAESolicitar`,
- registra request y response.

### Paso 6. Cierre

Si `aprobado`:

- guarda `CAE`,
- guarda vencimiento `CAE`,
- guarda numero definitivo,
- genera QR,
- marca `APPROVED` o `APPROVED_WITH_OBSERVATIONS`.

Si `rechazado`:

- persiste codigos,
- persiste mensaje,
- marca `REJECTED`.

Si `error tecnico`:

- persiste detalle tecnico,
- marca `TECHNICAL_ERROR`,
- programa retry segun politica.

## 18. Reglas de validacion previas al WS

Antes de invocar ARCA, validar localmente:

- `ConfiguracionFiscal` activa.
- Certificado vigente.
- Punto de venta informado.
- Tipo de comprobante permitido para la condicion fiscal del club.
- Receptor consistente con el tipo de comprobante.
- Importes mayores o iguales a cero y sumas consistentes.
- Fechas de servicio completas si concepto `2` o `3`.
- Existencia del comprobante asociado en notas de credito.
- Moneda y cotizacion validas.
- Idempotencia no consumida por otro comprobante.

## 19. Regla de consumidor final

El modulo debe contemplar reglas particulares para `Consumidor Final`.

Minimo funcional:

- soportar receptor generico consumidor final,
- permitir datos reducidos cuando la normativa lo permita,
- exigir identificacion del receptor cuando el monto obligue a ello,
- guardar en documento interno los datos efectivamente enviados.

La tabla de reglas monetarias y umbrales debe ser parametrizable para evitar hardcodear normativa sensible al tiempo.

## 20. QR reglamentario

El QR debe representarse como:

```text
https://www.arca.gob.ar/fe/qr/?p={JSON_BASE64}
```

### JSON base sugerido

```json
{
  "ver": 1,
  "fecha": "2026-05-31",
  "cuit": 30712345678,
  "ptoVta": 3,
  "tipoCmp": 6,
  "nroCmp": 1234,
  "importe": 25000.0,
  "moneda": "PES",
  "ctz": 1,
  "tipoDocRec": 99,
  "nroDocRec": 0,
  "tipoCodAut": "E",
  "codAut": 75123456789012
}
```

## 21. Manejo de errores

## Clasificacion

### Error tecnico

Ejemplos:

- timeout,
- DNS,
- SSL,
- respuesta SOAP invalida,
- Redis caido,
- problema de serializacion.

Accion:

- `TECHNICAL_ERROR`,
- retry automatico con backoff,
- alerta si supera umbral.

### Error funcional ARCA

Ejemplos:

- punto de venta invalido,
- receptor inconsistente,
- importe mal calculado,
- certificado no autorizado,
- concepto/fecha incompatibles.

Accion:

- `REJECTED`,
- no retry automatico ciego,
- exponer detalle en admin.

### Observacion

Ejemplos:

- respuesta aprobada con mensajes no bloqueantes.

Accion:

- persistir observaciones,
- marcar `APPROVED_WITH_OBSERVATIONS`.

## 22. Politica de reintentos

Recomendacion inicial:

- intento inmediato: `1`
- retry 1: `+1 min`
- retry 2: `+5 min`
- retry 3: `+15 min`
- retry 4: `+60 min`

Luego:

- pasar a cola manual,
- notificar al panel administrativo.

Nunca reintentar automaticamente:

- errores de validacion fiscal,
- certificado vencido,
- punto de venta no habilitado,
- configuracion fiscal faltante.

## 23. Observabilidad y auditoria

Registrar:

- `clubId`
- `facturaId`
- `originType`
- `originId`
- `ptoVta`
- `cbteTipo`
- `numeroComprobante`
- estado previo y nuevo
- `attempt`
- timestamp
- duracion de request
- codigos y mensajes ARCA

Metricas recomendadas:

- comprobantes emitidos por hora
- tasa de aprobacion
- tasa de rechazo
- latencia promedio ARCA
- tickets WSAA refrescados
- retries por club
- certificados proximos a vencer

## 24. Panel administrativo minimo

Vista recomendada para backoffice:

- filtro por club
- filtro por estado
- filtro por fecha
- filtro por tipo de comprobante
- busqueda por CAE o numero
- busqueda por `Booking` o `Account`

Acciones recomendadas:

- reintentar
- ver request/response
- descargar representacion
- emitir nota de credito
- invalidar cache WSAA
- probar configuracion fiscal

## 25. Ambientes

El modulo debe soportar:

- `homologacion`
- `produccion`

Cada `ConfiguracionFiscal` debe conocer:

- endpoint activo,
- certificado correspondiente,
- punto de venta habilitado,
- banderas de sandbox.

No mezclar:

- certificados de homologacion en produccion,
- numeracion productiva con homologacion,
- caches de auth entre ambientes.

## 26. Decision sobre libreria

Se puede evaluar `@afipsdk/afip.js`, pero la integracion no debe quedar acoplada a una libreria sin wrapper propio.

Decision recomendada:

- crear una abstraccion interna `ArcaGateway`,
- encapsular dentro de ella cualquier dependencia externa,
- evitar propagar tipos o supuestos de la libreria por todo el dominio.

Ventajas:

- facilita testing,
- facilita swap de libreria,
- reduce lock-in tecnico,
- permite inyectar certificados desde memoria.

## 27. Contratos internos recomendados

### DTO de solicitud interna

```ts
type CreateFiscalVoucherInput = {
  clubId: number;
  originType: 'BOOKING' | 'ACCOUNT' | 'ACCOUNT_ITEM' | 'MANUAL' | 'REFUND';
  originId: string;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  receiver: {
    docType: number;
    docNumber: string;
    name?: string;
    address?: string;
    ivaCondition?: string;
  };
  requestedByUserId?: number;
};
```

### DTO de resultado interno

```ts
type FiscalVoucherResult = {
  facturaId: string;
  status: 'APPROVED' | 'APPROVED_WITH_OBSERVATIONS' | 'REJECTED' | 'TECHNICAL_ERROR';
  cae?: string;
  caeDueDate?: string;
  voucherNumber?: number;
  arcaResult?: string;
  errorCode?: string;
  errorMessage?: string;
};
```

## 28. Testing

### Unit tests

- resolver concepto segun items
- builder de importes
- builder de QR
- renovacion de token con margen de expiracion
- idempotencia de creacion
- mapeo de respuestas ARCA a estados internos

### Integration tests

- emision aprobada en homologacion
- rechazo por datos invalidos
- nota de credito asociada
- reintento por timeout
- lock concurrente para la misma secuencia

### E2E internos

- venta de booking -> encolado -> emision -> ticket final
- venta mixta -> concepto `3`
- cancelacion por lluvia -> nota de credito

## 29. Checklist de implementacion

### Fase 1 - base de datos

- crear `ConfiguracionFiscal`
- crear `Factura`
- crear enums fiscales
- agregar relaciones con `Club`, `Booking`, `Account`

### Fase 2 - autenticacion

- implementar `ArcaAuthService`
- implementar cache Redis
- implementar lock de refresh WSAA

### Fase 3 - emision

- implementar `ArcaInvoiceBuilderService`
- implementar `ArcaVoucherService`
- implementar `ArcaQrService`

### Fase 4 - asincronia

- agregar nuevos tipos a `OutboxMessage`
- implementar `ArcaWorker`
- configurar retries e idempotencia

### Fase 5 - observabilidad y backoffice

- logs estructurados
- metricas
- pantalla de monitoreo
- accion de reproceso manual

## 30. Riesgos principales

- certificados vencidos o mal cargados
- caidas intermitentes de ARCA
- concurrencia que rompa correlatividad
- acople excesivo a una libreria externa
- diferencias entre importes operativos y fiscales
- cambios normativos en umbrales o representacion

## 31. Decisiones de arquitectura recomendadas

1. Mantener la venta operativa desacoplada de la autorizacion fiscal.
2. Usar `OutboxMessage` del sistema antes que una cola paralela nueva.
3. Usar `Redis` para cache y locks, con fallback razonable.
4. Implementar wrapper interno de ARCA aunque se use una libreria de terceros.
5. Persistir request/response con sanitizacion para auditoria.
6. Tratar correlatividad e idempotencia como requisitos de primer nivel.

## 32. Proximas tareas de desarrollo

Orden sugerido:

1. Definir esquema Prisma final.
2. Crear migracion.
3. Implementar `ArcaAuthService`.
4. Implementar `ArcaInvoiceBuilderService`.
5. Implementar `ArcaVoucherService`.
6. Integrar con `OutboxService`.
7. Agregar admin de configuracion fiscal.
8. Agregar pantalla de estado y reproceso.

## 33. Convenciones de naming sugeridas en codigo

- `ConfiguracionFiscal`
- `Factura`
- `ArcaAuthService`
- `ArcaVoucherService`
- `ArcaInvoiceBuilderService`
- `ArcaQrService`
- `ArcaWorker`

Si el equipo prefiere nombres en ingles, mantener consistencia total:

- `FiscalConfig`
- `FiscalVoucher`
- `ArcaAuthService`
- `ArcaVoucherService`
- `ArcaInvoiceBuilderService`

No mezclar ambos estilos en las entidades principales.

## 34. Resumen ejecutivo

El modulo de facturacion electronica ARCA para Pique debe construirse como una capacidad fiscal multi-tenant, asincrona, auditable e idempotente. La unidad de aislamiento es `Club`; la unidad operativa de origen es `Account`/`Booking`; y la unidad fiscal a persistir es `Factura`. La implementacion debe apoyarse en `Redis` para cache y locks, y en el outbox existente para el procesamiento en background. La correlatividad, el manejo de certificados y la separacion entre errores tecnicos y funcionales son los ejes que determinan si el modulo sera estable en produccion.

## Onboarding fiscal de un club

Para activar la facturacion electronica de un club en `Pique`, la conexion tecnica con `ARCA` la realiza la plataforma, pero la identidad fiscal y la habilitacion operativa deben pertenecer al club emisor.

### Objetivo

Estandarizar el alta de nuevos tenants para que cada club pueda emitir comprobantes validos desde `Pique` con su propio `CUIT`, su propio punto de venta y sus propias credenciales fiscales.

### Principio de arquitectura

`Pique` centraliza la integracion tecnica, pero no centraliza la identidad fiscal.

Esto implica que:

- `Pique` realiza las llamadas a `WSAA` y `WSFEv1`.
- cada club emite comprobantes en nombre propio.
- cada club debe contar con su propia configuracion fiscal.
- no debe existir una unica credencial fiscal compartida para todos los tenants.

### Informacion que debe entregar el club

Cada club debe proveer como minimo:

- `CUIT`
- `Razon Social`
- condicion frente al IVA
- domicilio fiscal o comercial, si corresponde informarlo
- `Punto de Venta` habilitado para web service
- certificado digital vigente
- clave privada asociada al certificado
- passphrase de la clave privada, si aplica
- confirmacion de ambiente: `homologacion` o `produccion`

### Requisitos previos en ARCA

Antes de operar desde `Pique`, el club debe tener resuelto en `ARCA`:

- `CUIT` activo
- clave fiscal habilitada
- representacion legal o administrativa vigente
- alta de `Punto de Venta` para facturacion por web service
- certificado digital emitido y vigente
- autorizacion del certificado para consumir los web services de factura electronica

### Responsabilidades del club

Son responsabilidad del club:

- la validez de su identidad fiscal
- la vigencia del certificado
- la correcta habilitacion del punto de venta
- la actualizacion de credenciales si vencen o se reemplazan
- la coherencia entre su condicion fiscal y el tipo de comprobantes que desea emitir

### Responsabilidades de Pique

Son responsabilidad de `Pique`:

- almacenar la configuracion fiscal del club de forma segura
- cifrar o proteger certificado y clave privada en reposo
- autenticar contra `WSAA` en nombre del club
- reutilizar `Token` y `Sign` mientras sigan vigentes
- emitir comprobantes en `WSFEv1` usando el `CUIT` del club
- mantener aislada la numeracion y trazabilidad de cada tenant
- registrar `CAE`, vencimiento, QR, errores y observaciones

### Validaciones previas a la activacion

Antes de marcar un club como operativo, el sistema debe validar:

- que la configuracion fiscal este completa
- que el certificado no este vencido
- que la clave privada corresponda al certificado
- que se pueda autenticar correctamente contra `WSAA`
- que el punto de venta sea valido para el club
- que la emision de prueba en `homologacion` sea exitosa

### Estados sugeridos del onboarding fiscal

Se recomienda modelar el alta fiscal del club con estados internos:

- `BORRADOR`
- `PENDIENTE_VALIDACION`
- `HOMOLOGACION_OK`
- `LISTO_PARA_PRODUCCION`
- `ACTIVO`
- `BLOQUEADO`

### Motivos de bloqueo posibles

Un club no debe quedar activo si ocurre alguno de estos casos:

- certificado vencido
- clave privada invalida
- punto de venta no habilitado
- autenticacion `WSAA` fallida
- rechazo de pruebas en homologacion
- inconsistencia entre `CUIT`, razon social y configuracion fiscal

### Recomendacion operativa

El onboarding fiscal deberia resolverse con un checklist administrable desde backoffice, de modo que el alta de un club no dependa de configuracion manual dispersa ni de conocimiento operativo informal.

### Resumen

La integracion con `ARCA` es centralizada desde `Pique`, pero cada club debe operar con su propia identidad fiscal. Por lo tanto, cada tenant debe contar con su propio `CUIT`, punto de venta habilitado, certificado digital, clave privada y autorizacion correspondiente. `Pique` no factura con una credencial fiscal unica de plataforma, sino en nombre de cada club emisor.

## Facturacion opcional por club

La facturacion fiscal no debe ser un requisito obligatorio para operar `Pique`. El sistema debe permitir que cada club defina si emite comprobantes fiscales, si opera con un proveedor fiscal especifico o si trabaja sin integracion fiscal activa.

### Objetivo

Desacoplar la operacion comercial del sistema respecto de una reglamentacion fiscal puntual, permitiendo que `Pique` funcione tanto para clubes argentinos con `ARCA` como para clubes de otros paises o clubes que todavia no hayan activado su configuracion fiscal.

### Principio funcional

Las operaciones comerciales del sistema deben poder existir independientemente de la emision fiscal.

Esto implica que un club debe poder:

- registrar reservas
- generar cuentas
- cobrar pagos
- cerrar ventas
- emitir comprobantes internos o tickets no fiscales

sin necesidad de emitir comprobantes electronicos fiscales.

### Casos en los que aplica

Este modo resulta util para:

- clubes de otros paises
- clubes argentinos que aun no configuraron `ARCA`
- clubes en etapa de onboarding
- clubes que solo necesitan control operativo interno
- entornos de prueba o demo

### Configuracion sugerida por club

Se recomienda que la configuracion fiscal del club contemple al menos estos campos:

- `facturacionHabilitada: Boolean`
- `paisFiscal: String`
- `proveedorFiscal: ARCA | NONE | OTRO`
- `modoFacturacion: OBLIGATORIA | OPCIONAL | DESHABILITADA`

### Semantica sugerida

#### `facturacionHabilitada = false`

- el club opera normalmente a nivel comercial
- no se encolan eventos de facturacion fiscal
- no se invoca `WSAA`
- no se invoca `WSFEv1`
- no se exige configuracion de certificados
- se puede emitir comprobante interno no fiscal si el producto lo ofrece

#### `facturacionHabilitada = true`

- el club puede emitir comprobantes fiscales segun su proveedor configurado
- la venta puede disparar el flujo fiscal en segundo plano
- el sistema valida la configuracion antes de emitir

#### `modoFacturacion = OBLIGATORIA`

- determinadas operaciones deben generar comprobante fiscal
- si la emision falla, el sistema debe marcar el incidente para resolucion administrativa

#### `modoFacturacion = OPCIONAL`

- el usuario puede decidir si desea emitir comprobante fiscal para una venta determinada
- el sistema debe permitir cerrar la operacion aunque no se facture fiscalmente

#### `modoFacturacion = DESHABILITADA`

- no se permite iniciar flujo fiscal
- todas las ventas quedan en modo operativo no fiscal

### Recomendacion de arquitectura

La facturacion fiscal debe modelarse como una capacidad adicional del dominio, no como una dependencia del flujo de cobro.

Por lo tanto:

- `Booking`, `Account` y `Payment` no deben depender estructuralmente de `ARCA`
- la emision fiscal debe dispararse solo si la configuracion del club lo requiere
- la ausencia de configuracion fiscal no debe bloquear la operacion comercial del club

### Comprobante interno no fiscal

Cuando la facturacion fiscal este deshabilitada, el sistema puede ofrecer igualmente:

- ticket interno
- recibo interno
- comprobante de pago
- resumen de cuenta
- detalle de reserva

Estos documentos no deben presentarse como factura fiscal ni incluir datos regulatorios que no correspondan.

### Beneficio de producto

Este enfoque permite que `Pique`:

- soporte clubes argentinos con integracion `ARCA`
- soporte clubes de otros paises con otra normativa
- soporte clubes sin integracion fiscal
- mantenga un nucleo operativo comun para todos los tenants

### Regla de negocio recomendada

La emision fiscal debe depender de la configuracion del tenant y no del hecho de que exista una venta o un cobro.

### Resumen

La facturacion electronica debe ser opcional y configurable por club. El sistema debe permitir operar reservas, cuentas y pagos aun cuando la integracion fiscal este deshabilitada. Esto vuelve a `Pique` mas flexible, mas internacionalizable y menos acoplado a una unica normativa tributaria.

## 35. Matriz de reglas fiscales

Para minimizar ambiguedades, el modulo debe definir una matriz de decision explicita por tenant.

Variables minimas a evaluar:

- pais fiscal del club
- proveedor fiscal activo
- condicion fiscal del emisor
- condicion fiscal del receptor
- tipo de operacion
- concepto ARCA
- modo de facturacion del club
- tipo de documento disponible del receptor

### Tabla base de decision sugerida

| Escenario | Emisor | Receptor | Operacion | Resultado esperado |
| --- | --- | --- | --- | --- |
| Reserva de cancha local | club ARCA | consumidor final | servicio | factura `B` o `C` segun condicion fiscal del emisor |
| Venta de cantina | club ARCA | consumidor final | producto | factura `B` o `C` |
| Cuenta mixta | club ARCA | consumidor final | productos + servicios | comprobante con concepto `3` |
| Venta a empresa con CUIT | responsable inscripto | responsable inscripto | servicio o producto | factura `A` si corresponde normativamente |
| Reintegro parcial | mismo emisor | mismo receptor | devolucion | nota de credito asociada al comprobante origen |
| Club sin fiscalidad activa | proveedor `NONE` | cualquiera | cualquier venta | solo comprobante interno no fiscal |

### Reglas obligatorias de la matriz

- Toda combinacion valida debe terminar en un tipo de comprobante concreto o en una salida explicita de `no emitir fiscalmente`.
- Toda combinacion invalida debe producir una razon de rechazo entendible por soporte y por backoffice.
- La matriz no debe estar hardcodeada en multiples servicios; debe centralizarse en una capa de politicas fiscales.
- La matriz debe ser parametrizable por pais y proveedor para soportar futuros conectores.

### Salidas esperadas de la evaluacion

La resolucion de la matriz deberia devolver al menos:

- `shouldIssueFiscalVoucher`
- `voucherKind`
- `comprobanteTipo`
- `concepto`
- `requiresReceiverTaxData`
- `requiresAssociatedVoucher`
- `allowsInternalReceiptOnly`
- `blockingReason` si no aplica emision

## 36. Motor de calculo fiscal

La emision fiscal no debe depender de montos ya redondeados por la UI o por caja. Debe existir un motor interno que calcule la base imponible, impuestos y total fiscal a partir del detalle de la venta.

### Capacidades minimas del motor

- soportar precio con IVA incluido y precio sin IVA incluido
- soportar items gravados, exentos y no gravados
- soportar descuentos por item y descuentos globales
- soportar recargos manuales si el negocio los necesita
- soportar cantidades, unidades y subtotales con precision controlada
- soportar cuentas mixtas con productos y servicios

### Reglas de redondeo

Definir explicitamente:

- precision interna de calculo
- precision de persistencia
- precision de presentacion
- momento exacto del redondeo
- criterio de distribucion de diferencias de centavos

### Alícuotas y clasificacion de items

El sistema deberia modelar por item o categoria:

- tipo fiscal del item
- alicuota de IVA
- si el item es producto o servicio
- si el item participa del QR y del comprobante fiscal

### Casos de calculo a explicitar

- descuento aplicado antes de impuestos
- descuento aplicado sobre total
- devolucion parcial de una cuenta mixta
- venta con items exentos y gravados
- diferencias entre importe operativo y fiscal
- recalculo de importes ante nota de credito parcial

### Persistencia recomendada

No alcanza con guardar solo totales finales. Conviene persistir:

- snapshot fiscal de cada item
- reglas aplicadas
- version del motor de calculo
- redondeos realizados
- diferencia final distribuida

## 37. Contingencia operativa y degradacion

El modulo debe contemplar operacion degradada cuando el proveedor fiscal no esta disponible o cuando la emision no puede completarse en tiempo razonable.

### Escenarios de contingencia

- caida total de `ARCA`
- latencia extrema de `WSAA`
- latencia extrema de `WSFEv1`
- certificado vencido o revocado
- Redis no disponible
- base operativa disponible pero worker fiscal caido
- problema de red local o DNS

### Modos de respuesta recomendados

- `DEFERRED_FISCAL`: la venta cierra y la emision queda pendiente
- `INTERNAL_RECEIPT_ONLY`: la venta cierra solo con comprobante interno
- `BLOCK_SALE_FOR_FISCAL_POLICY`: no se permite cerrar si el club exige facturacion obligatoria
- `MANUAL_REVIEW_REQUIRED`: la venta queda cerrada pero requiere intervencion administrativa

### Politica sugerida por modo de facturacion

- `OBLIGATORIA`: permitir cerrar la venta solo si el producto acepta emision diferida controlada; si no, bloquear con motivo visible
- `OPCIONAL`: permitir cerrar siempre y registrar que el usuario omitio o postergó la emision
- `DESHABILITADA`: no intentar flujo fiscal

### Recuperacion posterior

Definir un proceso batch o manual para:

- reintentar comprobantes pendientes
- detectar duplicados potenciales antes de reemitir
- conciliar ventas cerradas sin comprobante fiscal
- escalar incidentes viejos

### Comunicacion operativa

El sistema debe mostrar mensajes distintos para:

- error tecnico transitorio
- bloqueo por configuracion
- bloqueo normativo
- venta cerrada con emision diferida

## 38. Documentos emitidos y representacion final

El modulo debe definir con precision que documentos produce el sistema y en que contexto.

### Tipos de salida

- factura fiscal PDF
- ticket fiscal simplificado
- nota de credito PDF
- comprobante interno no fiscal
- recibo interno de pago
- reimpresion o reenvio de comprobante ya emitido

### Campos minimos del documento fiscal

- razon social del club
- CUIT del emisor
- condicion fiscal del emisor
- punto de venta
- numero de comprobante
- fecha de emision
- datos del receptor
- detalle o resumen segun politica del comprobante
- importes fiscales
- CAE
- vencimiento de CAE
- QR reglamentario
- leyendas obligatorias

### Campos minimos del comprobante no fiscal

- identificador interno
- club emisor
- fecha y hora
- detalle comercial
- total cobrado
- referencia a `Booking` o `Account`
- leyenda visible de `documento no fiscal`

### Canales de entrega

Definir si el sistema soporta:

- impresion en caja
- descarga PDF
- envio por email
- envio por WhatsApp u otro canal

### Versionado de plantilla

La plantilla de salida deberia tener:

- version
- fecha de vigencia
- branding configurable por club
- soporte de idiomas si aplica internacionalizacion

## 39. Estados cruzados de venta, pago y fiscalidad

La documentacion actual define estados del comprobante fiscal, pero conviene modelar explicitamente la relacion entre operacion comercial y emision fiscal.

### Entidades con ciclo propio

- `Booking`
- `Account`
- `Payment`
- `Factura` o `FiscalVoucher`
- comprobante interno

### Principios

- una venta puede existir sin factura fiscal
- un pago puede existir sin factura fiscal inmediata
- una factura fiscal puede referenciar una venta ya cerrada
- un comprobante interno no reemplaza una factura fiscal si el club esta obligado a emitirla

### Escenarios que deben documentarse

- venta abierta sin cobro ni factura
- venta cerrada con cobro total y factura pendiente
- venta cerrada con cobro parcial y factura diferida
- venta anulada antes de emitir
- venta facturada y luego parcialmente reintegrada
- venta con comprobante interno y posterior emision fiscal

### Tabla conceptual sugerida

| Estado comercial | Estado de cobro | Estado fiscal | Resultado operativo |
| --- | --- | --- | --- |
| abierta | no cobrada | no emitida | sin accion fiscal |
| cerrada | cobrada | pendiente | esperar worker o panel admin |
| cerrada | cobrada | aprobada | flujo normal cerrado |
| cerrada | cobrada | error tecnico | retry o intervencion |
| cerrada | cobrada | rechazada | correccion administrativa |
| anulada | reintegrada | nota de credito emitida | ciclo compensado |

## 40. Casos borde y escenarios de validacion

Para reducir riesgo de huecos funcionales, el documento debe enumerar escenarios de prueba y de negocio concretos.

### Casos borde recomendados

- doble click de emision desde UI
- reentrega del mismo mensaje de outbox
- timeout despues de enviar a `WSFEv1` pero antes de persistir respuesta
- respuesta aprobada con observaciones
- venta cerrada mientras el certificado vence ese mismo dia
- cambio de condicion fiscal del club entre la venta y la emision
- cambio de punto de venta entre reintentos
- cuenta con items de distinta naturaleza fiscal
- descuento global que afecta items gravados y exentos
- nota de credito parcial sobre un comprobante mixto
- club migrando de `NONE` a `ARCA`
- club cambiando de homologacion a produccion

### Escenarios E2E recomendados

1. Club con `facturacionHabilitada = false` vende y emite comprobante interno.
2. Club ARCA en `OPCIONAL` vende, cobra y decide no emitir fiscalmente.
3. Club ARCA en `OBLIGATORIA` vende, cobra y emite en segundo plano sin errores.
4. Club ARCA en `OBLIGATORIA` vende, cobra y la emision falla por error tecnico recuperable.
5. Club ARCA emite factura aprobada y luego genera nota de credito parcial.
6. Club con cuenta mixta emite comprobante con concepto `3`.

### Criterios de aceptacion para considerar el modulo listo

- no duplica comprobantes ante concurrencia o retry
- distingue correctamente bloqueo normativo, error tecnico y observacion
- soporta operacion sin fiscalidad activa
- soporta onboarding y activacion gradual por club
- produce documentos fiscales y no fiscales claramente diferenciados
- deja trazabilidad suficiente para soporte, auditoria y backoffice

## 41. Matriz concreta emisor/receptor a comprobante

La siguiente matriz propone un criterio operativo inicial para implementar la resolucion de comprobante. Debe tratarse como politica versionada y no como conocimiento disperso.

### Variables de entrada

- condicion fiscal del emisor
- condicion fiscal del receptor
- existencia y validez del documento del receptor
- naturaleza de la operacion
- politica fiscal del club
- punto de venta fiscal resuelto para la operacion

### Matriz inicial sugerida

| Emisor | Receptor | Doc receptor | Operacion | Comprobante sugerido | Observaciones |
| --- | --- | --- | --- | --- | --- |
| RESPONSABLE_INSCRIPTO | CONSUMIDOR_FINAL | DNI/CF | producto | Factura `B` | usar identificacion segun umbral parametrizable |
| RESPONSABLE_INSCRIPTO | CONSUMIDOR_FINAL | DNI/CF | servicio | Factura `B` | completar fechas de servicio |
| RESPONSABLE_INSCRIPTO | CONSUMIDOR_FINAL | DNI/CF | mixta | Factura `B` | concepto `3` |
| RESPONSABLE_INSCRIPTO | RESPONSABLE_INSCRIPTO | CUIT valido | producto | Factura `A` | validar condicion fiscal y datos receptor |
| RESPONSABLE_INSCRIPTO | RESPONSABLE_INSCRIPTO | CUIT valido | servicio | Factura `A` | completar fechas de servicio |
| RESPONSABLE_INSCRIPTO | RESPONSABLE_INSCRIPTO | CUIT valido | mixta | Factura `A` | concepto `3` |
| MONOTRIBUTO | CONSUMIDOR_FINAL | DNI/CF | producto o servicio | Factura `C` | no discrimina IVA |
| MONOTRIBUTO | RESPONSABLE_INSCRIPTO | CUIT valido | producto o servicio | Factura `C` | validar si la operacion admite ese esquema |
| EXENTO | cualquiera local permitido | doc segun regla | producto o servicio | Factura `C` o politica especifica | confirmar con normativa vigente del emisor |
| cualquiera | cualquiera | doc invalido | cualquier venta | no emitir | bloquear o pasar a correccion segun modo |
| cualquiera | cualquiera | doc valido | devolucion parcial o total | Nota de Credito de la misma clase | requiere comprobante asociado |

### Reglas ejecutables derivadas

- Si `kind = CREDIT_NOTE`, la clase del comprobante debe heredar la del comprobante origen.
- Si `concepto = 2` o `3`, exigir `fechaServicioDesde`, `fechaServicioHasta` y `fechaVencimientoPago`.
- Si el emisor no tiene fiscalidad activa, la salida debe ser `INTERNAL_ONLY`.
- Si faltan datos obligatorios del receptor y la politica del club no permite consumidor final generico, bloquear emision.

### Enum funcional sugerido

```ts
type FiscalResolution =
  | { mode: 'INTERNAL_ONLY'; reason: string }
  | {
      mode: 'ISSUE_FISCAL';
      voucherClass: 'A' | 'B' | 'C';
      voucherVariant:
        | 'STANDARD'
        | 'PAGO_EN_CBU_INFORMADA'
        | 'OPERACION_SUJETA_A_RETENCION';
      voucherKind: 'INVOICE' | 'CREDIT_NOTE';
      comprobanteTipo: number;
      concept: 1 | 2 | 3;
      requiresReceiverDoc: boolean;
      requiresServiceDates: boolean;
      requiresAssociatedVoucher: boolean;
    };
```

## 42. Ejemplos numericos cerrados

El objetivo de este apendice es eliminar ambiguedades de calculo antes de implementar el builder fiscal.

### Ejemplo 1. Reserva de cancha como servicio B2C

Supuestos:

- emisor: responsable inscripto
- receptor: consumidor final
- operacion: servicio
- precio final cobrado: `12100.00`
- IVA aplicable: `21%`
- precio informado al usuario: IVA incluido

Calculo:

- neto gravado = `10000.00`
- IVA = `2100.00`
- total = `12100.00`
- concepto = `2`
- comprobante sugerido = factura `B`

### Ejemplo 2. Venta de cantina B2C

Supuestos:

- 2 bebidas a `2420.00` final cada una
- IVA `21%`
- total final cobrado: `4840.00`

Calculo:

- neto gravado total = `4000.00`
- IVA total = `840.00`
- total = `4840.00`
- concepto = `1`
- comprobante sugerido = factura `B`

### Ejemplo 3. Cuenta mixta con servicio y productos

Supuestos:

- reserva de cancha: `12100.00` final
- bebidas: `4840.00` final
- ambos con IVA `21%`

Calculo:

- neto servicio = `10000.00`
- IVA servicio = `2100.00`
- neto productos = `4000.00`
- IVA productos = `840.00`
- neto total = `14000.00`
- IVA total = `2940.00`
- total = `16940.00`
- concepto = `3`
- comprobante sugerido = factura `B`

### Ejemplo 4. Monotributista emisor

Supuestos:

- emisor: monotributo
- receptor: consumidor final
- total final cobrado: `15000.00`

Calculo:

- total comprobante = `15000.00`
- comprobante sugerido = factura `C`
- no se discrimina IVA en la representacion final

### Ejemplo 5. Nota de credito parcial

Supuestos:

- factura original total: `16940.00`
- devolucion parcial de cantina: `2420.00` final

Calculo:

- neto a devolver = `2000.00`
- IVA a devolver = `420.00`
- total nota de credito = `2420.00`
- clase de nota = misma clase del comprobante origen

### Ejemplo 6. Descuento global sobre cuenta mixta

Supuestos:

- subtotal final antes de descuento: `16940.00`
- descuento global final: `1694.00` (`10%`)

Calculo sugerido:

- distribuir descuento proporcionalmente entre componentes gravados
- neto original = `14000.00`
- IVA original = `2940.00`
- neto descontado = `12600.00`
- IVA descontado = `2646.00`
- total descontado = `15246.00`

### Regla de implementacion

Los ejemplos anteriores deben convertirse en tests automáticos de snapshot o de precision para el motor fiscal.

## 43. Contratos tecnicos de payload y respuesta

Para evitar acoplamiento accidental, el sistema debe distinguir entre:

- DTO interno del dominio
- payload normalizado del gateway fiscal
- request especifica del proveedor
- respuesta cruda del proveedor
- respuesta interpretada del dominio

### DTO interno de draft fiscal

```ts
type FiscalVoucherDraft = {
  fiscalVoucherId: string;
  clubId: number;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  voucherClass: 'A' | 'B' | 'C';
  voucherVariant:
    | 'STANDARD'
    | 'PAGO_EN_CBU_INFORMADA'
    | 'OPERACION_SUJETA_A_RETENCION';
  concept: 1 | 2 | 3;
  pointOfSale: number;
  currencyCode: 'PES';
  currencyRate: number;
  issuedAt: string;
  serviceDateFrom?: string;
  serviceDateTo?: string;
  paymentDueDate?: string;
  receiver: {
    docType: number;
    docNumber: string;
    name?: string;
    address?: string;
    ivaCondition?: string;
    ivaConditionArcaId: number;
  };
  amounts: {
    netTaxed: string;
    vatAmount: string;
    exemptAmount: string;
    otherTaxesAmount: string;
    totalAmount: string;
  };
  items: Array<{
    code: string;
    description: string;
    quantity: string;
    unitPrice: string;
    discountAmount: string;
    taxableBase: string;
    vatRate: string;
    vatAmount: string;
    itemType: 'PRODUCT' | 'SERVICE';
  }>;
  associatedVoucher?: {
    pointOfSale: number;
    voucherType: number;
    voucherNumber: number;
  };
};
```

### Contrato interno hacia gateway

```ts
type ArcaAuthorizeVoucherInput = {
  auth: {
    token: string;
    sign: string;
    cuit: string;
  };
  voucher: FiscalVoucherDraft;
};
```

### Respuesta cruda esperable del proveedor

```ts
type ArcaRawAuthorizationResponse = {
  rawResult: unknown;
  environment: 'homologacion' | 'produccion';
  requestId?: string;
  observedAt: string;
};
```

### Respuesta interpretada al dominio

```ts
type FiscalAuthorizationResult = {
  status:
    | 'APPROVED'
    | 'APPROVED_WITH_OBSERVATIONS'
    | 'REJECTED'
    | 'TECHNICAL_ERROR';
  arcaResult?: 'A' | 'R' | 'O';
  cae?: string;
  caeDueDate?: string;
  voucherNumber?: number;
  observations?: Array<{
    code: string;
    message: string;
  }>;
  errors?: Array<{
    code: string;
    message: string;
    type: 'TECHNICAL' | 'FUNCTIONAL';
  }>;
};
```

### Regla de persistencia

Persistir en forma separada:

- `requestPayload`
- `responsePayload`
- `normalizedResult`
- `fiscalCalculationSnapshot`

## 44. Catalogo de errores ARCA mapeado a acciones

La capa de integracion debe traducir errores tecnicos y funcionales del proveedor a acciones operativas concretas.

### Categorias recomendadas

| Categoria | Ejemplo | Estado interno | Accion |
| --- | --- | --- | --- |
| NETWORK_TIMEOUT | timeout HTTP/SOAP | `TECHNICAL_ERROR` | retry automatico con backoff |
| AUTH_EXPIRED | token/sign vencido | `TECHNICAL_ERROR` | invalidar cache y refrescar auth |
| INVALID_CERTIFICATE | certificado invalido o revocado | `REJECTED` o bloqueo de tenant | frenar emision y escalar admin |
| INVALID_POINT_OF_SALE | punto de venta no habilitado | `REJECTED` | corregir configuracion del club |
| INVALID_RECEIVER_DOC | CUIT/DNI inconsistente | `REJECTED` | pedir correccion de datos |
| INVALID_AMOUNT | total o IVA inconsistente | `REJECTED` | revisar motor fiscal |
| DUPLICATE_RISK | secuencia ya usada o dudosa | `TECHNICAL_ERROR` | conciliar antes de reintentar |
| APPROVED_WITH_NOTICE | aprobado con observaciones | `APPROVED_WITH_OBSERVATIONS` | persistir y exponer aviso |

### Decision table de acciones

```ts
type FiscalErrorAction =
  | 'RETRY_AUTOMATICALLY'
  | 'REFRESH_AUTH_AND_RETRY'
  | 'REQUIRE_ADMIN_CONFIGURATION_FIX'
  | 'REQUIRE_RECEIVER_DATA_FIX'
  | 'REQUIRE_ENGINEERING_REVIEW'
  | 'REQUIRE_MANUAL_RECONCILIATION'
  | 'STORE_NOTICE_ONLY';
```

### Politicas obligatorias

- No reintentar ciegamente errores funcionales del proveedor.
- No reintentar sin conciliacion previa si existe riesgo de duplicado.
- Exponer en admin tanto el codigo bruto como la accion sugerida.
- Registrar metrica por categoria de error.

## 45. UI y backoffice pantalla por pantalla

Para que la implementacion no tenga zonas grises, conviene definir las vistas minimas y sus responsabilidades.

### 45.1 Pantalla de configuracion fiscal del club

Objetivo:

- dar de alta o editar la configuracion fiscal del tenant

Campos minimos:

- `facturacionHabilitada`
- `modoFacturacion`
- `paisFiscal`
- `proveedorFiscal`
- `condicionIva`
- `razonSocial`
- `cuit`
- `usaHomologacion`
- certificado
- clave privada
- passphrase

Acciones:

- guardar configuracion
- probar autenticacion `WSAA`
- validar certificado
- emitir prueba en homologacion
- invalidar cache de auth

Estados visuales:

- configuracion incompleta
- lista para homologacion
- homologacion exitosa
- lista para produccion
- bloqueada

### 45.1.b Pantalla de puntos de venta fiscales

Objetivo:

- administrar los puntos de venta fiscales de cada club

Campos minimos:

- `codigo`
- `nombre`
- `descripcion`
- `activo`
- `esDefault`
- `usaHomologacion`

Acciones:

- crear punto de venta fiscal
- editar punto de venta fiscal
- marcar como default
- activar/desactivar
- validar disponibilidad para emision

### 45.1.c Asignacion de cajas a puntos de venta fiscales

Objetivo:

- vincular cada `CashRegister` del sistema a un `PuntoDeVentaFiscal`

Reglas:

- una caja puede tener `0..1` punto de venta fiscal asignado
- un punto de venta fiscal puede estar asociado a muchas cajas
- si una caja no tiene asignacion propia, puede usar el punto de venta fiscal default del club
- si no existe asignacion propia ni default, la venta POS no debe emitir fiscalmente

### 45.2 Pantalla de emision desde venta/caja

Objetivo:

- permitir cerrar una venta y decidir si dispara emision fiscal

Elementos:

- resumen de venta
- estado de fiscalidad del club
- selector o indicador de emitir/no emitir cuando el modo sea `OPCIONAL`
- mensaje de bloqueo si el modo es `OBLIGATORIA` y faltan datos
- preview del receptor fiscal

Resultados posibles:

- venta cerrada con emision pendiente
- venta cerrada sin emision fiscal
- venta bloqueada por regla fiscal

### 45.3 Pantalla de detalle del comprobante fiscal

Objetivo:

- mostrar trazabilidad completa del comprobante

Secciones minimas:

- estado actual
- datos del emisor
- datos del receptor
- importes
- CAE y vencimiento
- QR
- request/response sanitizados
- historial de intentos
- errores u observaciones

Acciones:

- reimprimir
- descargar PDF
- reenviar
- reintentar si aplica
- emitir nota de credito

### 45.4 Bandeja administrativa de comprobantes

Objetivo:

- operar excepciones y monitorear salud del modulo

Filtros:

- club
- fecha
- estado
- tipo de comprobante
- numero
- CAE
- origen `Booking` / `Account`
- categoria de error

Columnas minimas:

- fecha
- club
- origen
- comprobante
- estado
- total
- intentos
- ultima accion
- accion sugerida

### 45.5 Pantalla de incidencias fiscales

Objetivo:

- centralizar casos que requieren intervencion humana

Tipos de incidencia:

- configuracion faltante
- certificado vencido
- error funcional ARCA
- riesgo de duplicado
- venta cerrada sin emision obligatoria resuelta

Acciones:

- asignar responsable
- agregar nota interna
- cambiar prioridad
- marcar resuelta
- disparar reproceso

### 45.6 Pantalla de auditoria por club

Objetivo:

- ver eventos criticos para soporte y compliance

Eventos minimos:

- alta o cambio de configuracion fiscal
- carga o reemplazo de certificado
- invalidacion de cache
- intento de emision
- reintento manual
- nota de credito emitida
- cambio de modo de facturacion

## 46. Plan tecnico por capas

El objetivo es que el equipo pueda implementar sin ambiguedad y en orden estable.

### Capa 1. Modelo y persistencia

Entregables:

- enums finales
- tablas `ConfiguracionFiscal`, `Factura`, `FiscalAuthTicket`
- tabla `PuntoDeVentaFiscal`
- snapshots de calculo fiscal
- campos para comprobante interno si aplica

### Capa 2. Politicas fiscales

Entregables:

- resolvedor `emisor/receptor -> comprobante`
- reglas por modo de facturacion
- reglas de datos obligatorios del receptor
- reglas de concepto `1/2/3`

### Capa 3. Motor de calculo

Entregables:

- builder de importes
- redondeo consistente
- distribucion de descuentos
- snapshot fiscal por item

### Capa 4. Integracion ARCA

Entregables:

- `ArcaAuthService`
- `ArcaGateway`
- `ArcaVoucherService`
- parser de respuestas
- catalogo de errores traducidos

### Capa 5. Orquestacion async

Entregables:

- eventos de outbox
- worker fiscal
- locks distribuidos
- retries seguros
- conciliacion ante dudas de duplicado

### Capa 6. Representacion documental

Entregables:

- generacion de QR
- PDF fiscal
- comprobante interno no fiscal
- reimpresion y reenvio

### Capa 7. UI operacional

Entregables:

- configuracion fiscal del club
- emision desde caja
- bandeja admin
- detalle de comprobante
- incidencias fiscales

### Capa 8. Observabilidad y rollout

Entregables:

- logs estructurados
- metricas y alertas
- checklist de activacion por club
- rollout por feature flag
- tablero de salud del modulo

### Definition of done sugerida

Un club piloto deberia poder:

1. configurar su identidad fiscal,
2. validar homologacion,
3. emitir facturas `B` y `C`,
4. emitir una nota de credito,
5. operar temporalmente sin facturacion ante una contingencia controlada,
6. y resolver incidencias desde backoffice sin soporte de ingenieria en casos comunes.

## 47. Schema Prisma final propuesto

Esta seccion busca dejar una base suficientemente concreta para iniciar la migracion sin reinterpretaciones grandes.

### Enums propuestos

```prisma
enum FiscalCondition {
  RESPONSABLE_INSCRIPTO
  MONOTRIBUTO
  EXENTO
  CONSUMIDOR_FINAL
  OTRO
}

enum FiscalProvider {
  ARCA
  NONE
  OTRO
}

enum FiscalMode {
  OBLIGATORIA
  OPCIONAL
  DESHABILITADA
}

enum FiscalVoucherKind {
  INVOICE
  CREDIT_NOTE
}

enum FiscalVoucherClass {
  A
  B
  C
}

enum FiscalVoucherVariant {
  STANDARD
  PAGO_EN_CBU_INFORMADA
  OPERACION_SUJETA_A_RETENCION
}

enum FiscalVoucherStatus {
  PENDING
  QUEUED
  PROCESSING
  APPROVED
  APPROVED_WITH_OBSERVATIONS
  REJECTED
  TECHNICAL_ERROR
  CANCELLED
}

enum FiscalOriginType {
  BOOKING
  ACCOUNT
  ACCOUNT_ITEM
  MANUAL
  REFUND
}

enum FiscalItemType {
  PRODUCT
  SERVICE
}

enum FiscalIncidentStatus {
  OPEN
  IN_PROGRESS
  RESOLVED
  IGNORED
}
```

### Configuracion fiscal final sugerida

```prisma
model ConfiguracionFiscal {
  id                      String          @id @default(cuid())
  clubId                  Int             @unique
  club                    Club            @relation(fields: [clubId], references: [id], onDelete: Cascade)

  facturacionHabilitada   Boolean         @default(false)
  proveedorFiscal         FiscalProvider  @default(NONE)
  modoFacturacion         FiscalMode      @default(DESHABILITADA)
  paisFiscal              String          @default("AR")

  razonSocial             String?
  cuit                    String?
  condicionIva            FiscalCondition?
  ingresosBrutos          String?
  inicioActividadesAt     DateTime?       @db.Timestamptz(3)

  usaHomologacion         Boolean         @default(true)
  activo                  Boolean         @default(true)

  certificadoPem          String?
  clavePrivadaPem         String?
  clavePrivadaPassphrase  String?
  certificadoSerial       String?
  certificadoSubject      String?
  vencimientoCertificado  DateTime?       @db.Timestamptz(3)

  onboardingStatus        String?         // BORRADOR, PENDIENTE_VALIDACION, HOMOLOGACION_OK, etc.
  ultimoHealthcheckAt     DateTime?       @db.Timestamptz(3)
  ultimoHealthcheckOk     Boolean?
  observaciones           String?

  createdAt               DateTime        @default(now()) @db.Timestamptz(3)
  updatedAt               DateTime        @updatedAt @db.Timestamptz(3)

  facturas                Factura[]
  puntosDeVenta           PuntoDeVentaFiscal[]
  authTickets             FiscalAuthTicket[]
  incidents               FiscalIncident[]

  @@index([activo])
  @@index([proveedorFiscal, modoFacturacion])
  @@index([paisFiscal])
}
```

### Punto de venta fiscal final sugerido

```prisma
model PuntoDeVentaFiscal {
  id                      String          @id @default(cuid())
  clubId                  Int
  club                    Club            @relation(fields: [clubId], references: [id], onDelete: Cascade)

  configuracionFiscalId   String
  configuracionFiscal     ConfiguracionFiscal @relation(fields: [configuracionFiscalId], references: [id], onDelete: Cascade)

  codigo                  Int
  nombre                  String
  descripcion             String?
  activo                  Boolean         @default(true)
  esDefault               Boolean         @default(false)
  usaHomologacion         Boolean         @default(true)

  createdAt               DateTime        @default(now()) @db.Timestamptz(3)
  updatedAt               DateTime        @updatedAt @db.Timestamptz(3)

  facturas                Factura[]

  @@unique([clubId, codigo])
  @@index([clubId, activo])
  @@index([clubId, esDefault])
}
```

### Comprobante fiscal final sugerido

```prisma
model Factura {
  id                      String              @id @default(cuid())
  clubId                  Int
  club                    Club                @relation(fields: [clubId], references: [id], onDelete: Restrict)

  configuracionFiscalId   String
  configuracionFiscal     ConfiguracionFiscal @relation(fields: [configuracionFiscalId], references: [id], onDelete: Restrict)

  kind                    FiscalVoucherKind
  status                  FiscalVoucherStatus @default(PENDING)
  originType              FiscalOriginType
  originId                String
  idempotencyKey          String

  bookingId               Int?
  booking                 Booking?            @relation(fields: [bookingId], references: [id], onDelete: SetNull)

  accountId               String?
  account                 Account?            @relation(fields: [accountId], references: [id], onDelete: SetNull)

  puntoDeVentaFiscalId    String?
  puntoDeVentaFiscal      PuntoDeVentaFiscal? @relation(fields: [puntoDeVentaFiscalId], references: [id], onDelete: SetNull)

  voucherClass            FiscalVoucherClass?
  voucherVariant          FiscalVoucherVariant @default(STANDARD)
  comprobanteTipo         Int?
  comprobanteDescripcion  String?
  puntoDeVenta            Int?
  numeroComprobante       Int?

  concepto                Int?
  fechaEmision            DateTime            @db.Timestamptz(3)
  fechaServicioDesde      DateTime?           @db.Timestamptz(3)
  fechaServicioHasta      DateTime?           @db.Timestamptz(3)
  fechaVencimientoPago    DateTime?           @db.Timestamptz(3)

  receptorDocTipo         Int?
  receptorDocNumero       String?
  receptorNombre          String?
  receptorDomicilio       String?
  receptorCondicionIva    FiscalCondition?
  receptorCondicionIvaArcaId Int?

  monedaCodigo            String              @default("PES")
  monedaCotizacion        Decimal             @default(1) @db.Decimal(12, 6)

  importeNeto             Decimal             @default(0) @db.Decimal(12, 2)
  importeIva              Decimal             @default(0) @db.Decimal(12, 2)
  importeExento           Decimal             @default(0) @db.Decimal(12, 2)
  importeTributos         Decimal             @default(0) @db.Decimal(12, 2)
  importeTotal            Decimal             @default(0) @db.Decimal(12, 2)

  cae                     String?
  caeVencimiento          DateTime?           @db.Timestamptz(3)
  resultadoArca           String?

  qrPayloadBase64         String?
  qrUrl                   String?
  pdfUrl                  String?
  internalReceiptUrl      String?

  requestPayload          Json?
  responsePayload         Json?
  normalizedResult        Json?
  fiscalCalculationSnapshot Json?
  observacionesArca       Json?
  erroresArca             Json?
  mensajeError            String?
  suggestedAction         String?
  intentoActual           Int                 @default(0)
  ultimoIntentoAt         DateTime?           @db.Timestamptz(3)

  comprobanteAsociadoId   String?
  comprobanteAsociado     Factura?            @relation("FacturaAsociada", fields: [comprobanteAsociadoId], references: [id], onDelete: SetNull)
  notasCreditoAsociadas   Factura[]           @relation("FacturaAsociada")

  createdAt               DateTime            @default(now()) @db.Timestamptz(3)
  updatedAt               DateTime            @updatedAt @db.Timestamptz(3)

  items                   FiscalVoucherItem[]
  incidents               FiscalIncident[]

  @@unique([clubId, idempotencyKey])
  @@index([clubId, status, createdAt])
  @@index([clubId, originType, originId])
  @@index([clubId, puntoDeVenta, comprobanteTipo, numeroComprobante])
  @@index([puntoDeVentaFiscalId])
}
```

### Items fiscales y tickets de auth

```prisma
model FiscalVoucherItem {
  id                      String          @id @default(cuid())
  facturaId               String
  factura                 Factura         @relation(fields: [facturaId], references: [id], onDelete: Cascade)

  originType              FiscalOriginType?
  originId                String?
  itemType                FiscalItemType
  code                    String?
  description             String
  quantity                Decimal         @db.Decimal(12, 3)
  unitPrice               Decimal         @db.Decimal(12, 2)
  discountAmount          Decimal         @default(0) @db.Decimal(12, 2)
  taxableBase             Decimal         @default(0) @db.Decimal(12, 2)
  vatRate                 Decimal         @default(0) @db.Decimal(5, 2)
  vatAmount               Decimal         @default(0) @db.Decimal(12, 2)
  totalAmount             Decimal         @default(0) @db.Decimal(12, 2)

  snapshot                Json?

  createdAt               DateTime        @default(now()) @db.Timestamptz(3)
  updatedAt               DateTime        @updatedAt @db.Timestamptz(3)

  @@index([facturaId])
}

model FiscalAuthTicket {
  id                      String          @id @default(cuid())
  clubId                  Int
  configuracionFiscalId   String?
  service                 String
  token                   String
  sign                    String
  generationTime          DateTime        @db.Timestamptz(3)
  expirationTime          DateTime        @db.Timestamptz(3)
  createdAt               DateTime        @default(now()) @db.Timestamptz(3)
  updatedAt               DateTime        @updatedAt @db.Timestamptz(3)

  configuracionFiscal     ConfiguracionFiscal? @relation(fields: [configuracionFiscalId], references: [id], onDelete: SetNull)

  @@unique([clubId, service])
  @@index([expirationTime])
}
```

### Incidencias fiscales

```prisma
model FiscalIncident {
  id                      String               @id @default(cuid())
  clubId                  Int
  configuracionFiscalId   String?
  facturaId               String?
  status                  FiscalIncidentStatus @default(OPEN)
  type                    String
  title                   String
  detail                  String?
  priority                String?
  assignedToUserId        Int?
  resolvedAt              DateTime?            @db.Timestamptz(3)

  configuracionFiscal     ConfiguracionFiscal? @relation(fields: [configuracionFiscalId], references: [id], onDelete: SetNull)
  factura                 Factura?             @relation(fields: [facturaId], references: [id], onDelete: SetNull)

  createdAt               DateTime             @default(now()) @db.Timestamptz(3)
  updatedAt               DateTime             @updatedAt @db.Timestamptz(3)

  @@index([clubId, status, createdAt])
  @@index([facturaId])
}
```

## 48. Interfaces TypeScript finales sugeridas

Estas interfaces ya apuntan a ser usadas en codigo real y no solo como ejemplos de concepto.

### Politicas fiscales

```ts
export type VoucherClass = 'A' | 'B' | 'C';
export type VoucherVariant =
  | 'STANDARD'
  | 'PAGO_EN_CBU_INFORMADA'
  | 'OPERACION_SUJETA_A_RETENCION';
export type FiscalMode = 'OBLIGATORIA' | 'OPCIONAL' | 'DESHABILITADA';
export type FiscalProvider = 'ARCA' | 'NONE' | 'OTRO';
export type FiscalResolution =
  | {
      mode: 'INTERNAL_ONLY';
      reason: string;
    }
  | {
      mode: 'ISSUE_FISCAL';
      voucherKind: 'INVOICE' | 'CREDIT_NOTE';
      voucherClass: VoucherClass;
      voucherVariant: VoucherVariant;
      comprobanteTipo: number;
      concept: 1 | 2 | 3;
      requiresReceiverDoc: boolean;
      requiresServiceDates: boolean;
      requiresAssociatedVoucher: boolean;
    };

export interface ResolveFiscalPolicyInput {
  clubId: number;
  fiscalPointOfSaleId?: string | null;
  provider: FiscalProvider;
  fiscalMode: FiscalMode;
  issuerFiscalCondition: string | null;
  receiverFiscalCondition?: string | null;
  receiverFiscalConditionArcaId?: number | null;
  receiverDocType?: number | null;
  receiverDocNumber?: string | null;
  operationKind: 'PRODUCT' | 'SERVICE' | 'MIXED';
  voucherKind: 'INVOICE' | 'CREDIT_NOTE';
}

export interface FiscalPolicyService {
  resolve(input: ResolveFiscalPolicyInput): FiscalResolution;
}
```

### Calculo fiscal

```ts
export interface CalculateFiscalTotalsInput {
  clubId: number;
  currencyCode: string;
  items: Array<{
    code?: string;
    description: string;
    quantity: string;
    unitPrice: string;
    discountAmount?: string;
    vatRate: string;
    itemType: 'PRODUCT' | 'SERVICE';
    priceIncludesVat: boolean;
  }>;
  globalDiscountAmount?: string;
}

export interface CalculateFiscalTotalsResult {
  concept: 1 | 2 | 3;
  netTaxed: string;
  vatAmount: string;
  exemptAmount: string;
  otherTaxesAmount: string;
  totalAmount: string;
  items: Array<{
    taxableBase: string;
    vatAmount: string;
    totalAmount: string;
  }>;
  snapshot: Record<string, unknown>;
}

export interface FiscalCalculationService {
  calculate(input: CalculateFiscalTotalsInput): CalculateFiscalTotalsResult;
}
```

### Integracion y autorizacion

```ts
export interface GetValidArcaAuthInput {
  clubId: number;
  fiscalPointOfSaleId?: string | null;
}

export interface ArcaAuth {
  token: string;
  sign: string;
  cuit: string;
  expirationTime: string;
}

export interface ArcaAuthService {
  getValidAuth(input: GetValidArcaAuthInput): Promise<ArcaAuth>;
  refreshAuth(input: GetValidArcaAuthInput): Promise<ArcaAuth>;
  invalidateAuth(input: GetValidArcaAuthInput): Promise<void>;
}

export interface ArcaGateway {
  authorizeVoucher(input: ArcaAuthorizeVoucherInput): Promise<ArcaRawAuthorizationResponse>;
  getLastAuthorizedNumber(input: {
    clubId: number;
    fiscalPointOfSaleId?: string | null;
    pointOfSale: number;
    comprobanteTipo: number;
  }): Promise<number>;
}

export interface FiscalVoucherService {
  authorizeVoucher(facturaId: string): Promise<FiscalAuthorizationResult>;
  retryVoucher(facturaId: string): Promise<FiscalAuthorizationResult>;
}
```

### Representacion documental y admin

```ts
export interface RenderFiscalVoucherPdfInput {
  facturaId: string;
}

export interface RenderFiscalVoucherPdfResult {
  fileUrl: string;
}

export interface FiscalDocumentService {
  renderFiscalPdf(input: RenderFiscalVoucherPdfInput): Promise<RenderFiscalVoucherPdfResult>;
  renderInternalReceipt(input: { facturaId: string }): Promise<RenderFiscalVoucherPdfResult>;
}

export interface FiscalIncidentService {
  createIncident(input: {
    clubId: number;
    facturaId?: string;
    type: string;
    title: string;
    detail?: string;
    priority?: string;
  }): Promise<{ incidentId: string }>;
}
```

## 49. Eventos de outbox definitivos

Para evitar crecimiento desordenado, conviene fijar desde el principio los tipos de evento y sus payloads.

### Eventos sugeridos

```text
ARCA_INVOICE_REQUESTED
ARCA_CREDIT_NOTE_REQUESTED
ARCA_VOUCHER_RETRY_REQUESTED
ARCA_AUTH_REFRESH_REQUESTED
ARCA_VOUCHER_RENDER_REQUESTED
FISCAL_INCIDENT_CREATED
```

### Payload base comun

```ts
type FiscalOutboxBaseEvent = {
  eventId: string;
  occurredAt: string;
  clubId: number;
  provider: 'ARCA';
  fiscalVoucherId?: string;
  attempt?: number;
};
```

### Solicitud de emision

```ts
type ArcaInvoiceRequestedEvent = FiscalOutboxBaseEvent & {
  type: 'ARCA_INVOICE_REQUESTED';
  fiscalVoucherId: string;
  originType: 'BOOKING' | 'ACCOUNT' | 'ACCOUNT_ITEM' | 'MANUAL' | 'REFUND';
  originId: string;
};

type ArcaCreditNoteRequestedEvent = FiscalOutboxBaseEvent & {
  type: 'ARCA_CREDIT_NOTE_REQUESTED';
  fiscalVoucherId: string;
  associatedVoucherId: string;
};
```

### Retry, refresh y render

```ts
type ArcaVoucherRetryRequestedEvent = FiscalOutboxBaseEvent & {
  type: 'ARCA_VOUCHER_RETRY_REQUESTED';
  fiscalVoucherId: string;
  reason: string;
};

type ArcaAuthRefreshRequestedEvent = FiscalOutboxBaseEvent & {
  type: 'ARCA_AUTH_REFRESH_REQUESTED';
  serviceName: 'wsfe';
};

type ArcaVoucherRenderRequestedEvent = FiscalOutboxBaseEvent & {
  type: 'ARCA_VOUCHER_RENDER_REQUESTED';
  fiscalVoucherId: string;
  renderKind: 'FISCAL_PDF' | 'INTERNAL_RECEIPT';
};
```

### Reglas de consumo

- cada evento debe ser idempotente por `eventId`
- el worker debe registrar `processedAt`, `attempt` y `lastError`
- el retry no debe reconstruir una factura nueva; solo volver a procesar la existente
- el render documental debe ocurrir solo si el estado final lo habilita
- si la venta proviene de una caja, resolver primero el `PuntoDeVentaFiscal` asociado a esa caja
- si la venta no proviene de caja, usar el punto de venta fiscal default del club

## 50. Tabla de codigos ARCA cerrada para v1

Esta tabla deja cerrados los codigos que Pique necesita para implementar la primera version. Los valores no deben quedar desperdigados en constantes anonimas. Ademas, antes de habilitar produccion se deben contrastar con los catalogos devueltos por ARCA para detectar cambios normativos.

### Tipos de concepto

| Codigo | Significado |
| --- | --- |
| `1` | Productos |
| `2` | Servicios |
| `3` | Productos y servicios |

### Clases y variantes de comprobante

| Clase | Variante | Uso funcional |
| --- | --- | --- |
| `A` | `STANDARD` | emision clase A comun cuando corresponda |
| `A` | `PAGO_EN_CBU_INFORMADA` | emision clase A con leyenda obligatoria; usa los mismos codigos que A comun |
| `A` | `OPERACION_SUJETA_A_RETENCION` | emision clase A con leyenda obligatoria y codigos especificos |
| `B` | `STANDARD` | emision a consumidor final u otros casos definidos por politica |
| `C` | `STANDARD` | emision de monotributo/exento segun politica |

No modelar factura `M` como ampliacion futura. Desde el `1 de diciembre de 2025`, la normativa reemplazo ese esquema por variantes de comprobante `A`.

### Mapeo `voucherClass + voucherVariant + voucherKind -> cbteTipo`

| Clase | Variante | Factura `INVOICE` | Nota de credito `CREDIT_NOTE` | Soporte v1 |
| --- | --- | --- | --- | --- |
| `A` | `STANDARD` | `1` | `3` | si |
| `A` | `PAGO_EN_CBU_INFORMADA` | `1` | `3` | implementar validacion y leyenda |
| `A` | `OPERACION_SUJETA_A_RETENCION` | `51` | `53` | implementar validacion y leyenda |
| `B` | `STANDARD` | `6` | `8` | si |
| `C` | `STANDARD` | `11` | `13` | si |

### Codigos documentados para una ampliacion posterior

| Clase | Variante | Nota de debito | Recibo |
| --- | --- | --- | --- |
| `A` | `STANDARD` | `2` | `4` |
| `A` | `PAGO_EN_CBU_INFORMADA` | `2` | `4` |
| `A` | `OPERACION_SUJETA_A_RETENCION` | `52` | `54` |
| `B` | `STANDARD` | `7` | `9` |
| `C` | `STANDARD` | `12` | `15` |

Para v1, `FiscalVoucherKind` queda limitado a `INVOICE` y `CREDIT_NOTE`. Agregar debitos o recibos exige ampliar el enum, los builders, los tests y la UI.

### Tipos de documento del receptor soportados por Pique v1

| Codigo | Documento | Uso inicial |
| --- | --- | --- |
| `80` | CUIT | personas o entidades identificadas fiscalmente |
| `86` | CUIL | persona humana identificada |
| `87` | CDI | identificacion fiscal admitida |
| `91` | CI extranjera | receptor extranjero cuando corresponda |
| `94` | pasaporte | receptor extranjero cuando corresponda |
| `96` | DNI | consumidor final identificado |
| `99` | consumidor final | receptor no identificado cuando la norma lo permite; informar `DocNro = 0` |

El allowlist anterior define lo que Pique implementa de entrada. El catalogo `FEParamGetTiposDoc` sigue siendo la fuente de verdad operativa de ARCA y debe consultarse durante onboarding o sincronizacion.

### Tipos de moneda iniciales

| Codigo | Significado |
| --- | --- |
| `PES` | Peso argentino |

### Politica de implementacion

- crear un modulo `arca-codes.ts` o equivalente
- centralizar mapeos `voucherClass + voucherVariant + voucherKind -> comprobanteTipo`
- centralizar mapeos `receiver doc -> docTipo`
- sincronizar o validar `FEParamGetTiposCbte`, `FEParamGetTiposDoc`, `FEParamGetTiposConcepto` y `FEParamGetCondicionIvaReceptor`
- no escribir numeros magicos en servicios o controladores
- resolver `CashRegister -> PuntoDeVentaFiscal -> codigo ARCA` en una sola capa de politica o infraestructura

### Regla para `CondicionIVAReceptorId`

El request a `WSFEv1` debe enviar `CondicionIVAReceptorId`. Este campo es obligatorio segun el manual vigente revisado el `1 de junio de 2026`. En el dominio se conserva `receptorCondicionIva` como snapshot legible y se agrega `receptorCondicionIvaArcaId` como codigo ARCA enviado.

## 51. Plan de implementacion por PRs

La idea es dividir el trabajo en entregas que permitan revisar y desplegar de forma segura.

### PR 1. Modelo fiscal base

Incluye:

- enums Prisma
- `ConfiguracionFiscal`
- `PuntoDeVentaFiscal`
- `Factura`
- `FiscalVoucherItem`
- `FiscalAuthTicket`
- `FiscalIncident`
- migraciones iniciales

Salida esperada:

- base de datos lista para guardar configuracion y drafts fiscales

### PR 2. Politicas y calculo fiscal

Incluye:

- `FiscalPolicyService`
- `FiscalCalculationService`
- tests de matriz
- tests de ejemplos numericos

Salida esperada:

- capacidad de resolver comprobante y calcular importes sin tocar ARCA

### PR 3. Integracion ARCA auth + gateway

Incluye:

- `ArcaAuthService`
- `ArcaGateway`
- cache Redis
- locks de refresh
- healthcheck tecnico

Salida esperada:

- autenticacion WSAA y consultas basicas encapsuladas

### PR 4. Emision y parser de respuestas

Incluye:

- `FiscalVoucherService`
- `authorizeVoucher`
- parser de errores
- tabla de acciones sugeridas

Salida esperada:

- emision de comprobantes desde un draft persistido

### PR 5. Orquestacion async

Incluye:

- eventos outbox definitivos
- worker fiscal
- retries
- locks de secuencia
- conciliacion basica ante duda de duplicado

Salida esperada:

- emision desacoplada de la caja

### PR 6. Documentos y QR

Incluye:

- `ArcaQrService`
- PDF fiscal
- comprobante interno
- reimpresion

Salida esperada:

- representacion final disponible para usuario y backoffice

### PR 7. UI de configuracion y caja

Incluye:

- pantalla de configuracion fiscal
- pantalla de puntos de venta fiscales
- asignacion de cajas a puntos de venta fiscales
- acciones de validacion/homologacion
- flujo de emision opcional/obligatoria desde caja

Salida esperada:

- activacion real de clubes piloto

### PR 8. Bandeja admin e incidencias

Incluye:

- lista de comprobantes
- detalle de comprobante
- incidencias fiscales
- retry manual
- notas internas

Salida esperada:

- operacion diaria sin dependencia constante de ingenieria

### PR 9. Observabilidad y rollout

Incluye:

- dashboards
- alertas
- feature flags
- checklist de go-live por club

Salida esperada:

- salida controlada a produccion

## 52. Cierre de alcance para arrancar implementacion

Con las secciones anteriores, el documento ya deberia permitir:

- diseñar migraciones iniciales
- dividir trabajo por capas
- alinear backend, frontend y operaciones
- estimar fases de rollout
- detectar decisiones que aun dependen de validacion normativa

Lo que sigue despues de este punto ya no deberia ser “seguir escribiendo documentacion general”, sino:

1. validar normativa puntual pendiente,
2. convertir estos contratos en codigo,
3. y abrir el backlog de implementacion real.

## 53. Correccion de arquitectura sobre puntos de venta fiscales

Decision de arquitectura actualizada:

Pique ya soporta multiples cajas por club (`CashRegister`), por lo tanto la arquitectura fiscal no debe asumir un unico punto de venta por club.

### Decision adoptada

- un `Club` puede tener multiples `CashRegister`
- un `Club` puede tener multiples `PuntoDeVentaFiscal`
- cada `PuntoDeVentaFiscal` pertenece a una `ConfiguracionFiscal` del club
- una `CashRegister` puede tener `0..1` `PuntoDeVentaFiscal` asignado
- un `PuntoDeVentaFiscal` puede estar asociado a multiples cajas
- el club debe poder definir un `PuntoDeVentaFiscal` default

### Regla operativa

- si una venta POS nace desde una caja con punto de venta fiscal asignado, la emision usa ese punto de venta
- si la caja no tiene asignacion propia, la emision usa el punto de venta fiscal default del club
- si no existe asignacion propia ni default, la venta POS no debe emitir fiscalmente
- la numeracion fiscal debe aislarse por `club + puntoDeVentaFiscal + comprobanteTipo`

### Impacto en el modelo de datos

La entidad `ConfiguracionFiscal` deja de ser el lugar correcto para guardar un unico `puntoDeVenta` del club como supuesto general. En su lugar, se debe modelar una entidad dedicada `PuntoDeVentaFiscal` y referenciarla desde `Factura`.

### Impacto en UI y operacion

Se requiere:

- pantalla de administracion de puntos de venta fiscales
- asignacion de cajas a puntos de venta fiscales
- posibilidad de marcar un punto de venta fiscal default por club

## 54. Decisiones cerradas para implementacion y revisiones futuras

Esta seccion deja por escrito decisiones que se consideran cerradas para v1, junto con los puntos que deberan revisarse mas adelante si el modulo crece en complejidad.

### 54.1 `voucherClass` y `voucherVariant` se modelan como enums

Decision para v1:

- usar `enum FiscalVoucherClass { A, B, C }`
- usar `enum FiscalVoucherVariant { STANDARD, PAGO_EN_CBU_INFORMADA, OPERACION_SUJETA_A_RETENCION }`
- no usar `String` libre para `voucherClass`
- resolver `cbteTipo` a partir de `voucherClass + voucherVariant + voucherKind`

Motivo:

- evita valores inconsistentes
- representa las variantes vigentes de comprobante `A` sin deformar la clase base
- simplifica validaciones
- alinea mejor schema, backend y frontend

Revisar mas adelante si:

- se soportan otros proveedores fiscales con clases no equivalentes a `A/B/C`
- conviene reemplazar la clase por un modelo mas general basado solo en `cbteTipo`
- ARCA incorpora nuevas variantes, leyendas o codigos

### 54.2 Snapshot fiscal por item: columnas normalizadas + `snapshot Json`

Decision para v1:

- mantener `FiscalVoucherItem` como tabla propia
- guardar en columnas los campos consultables mas importantes
- guardar en `snapshot Json` el detalle congelado completo del item

Motivo:

- permite auditar calculo fiscal sin sobre-modelar de entrada
- deja queryables los campos relevantes
- evita una explosion de tablas prematura

Revisar mas adelante si:

- aparece necesidad de multiples impuestos por item
- se agregan percepciones, retenciones o tributos separados por item
- se necesitan reportes SQL finos sobre estructura historica de impuestos
- auditoria o BI requiere desnormalizar mas informacion

Si eso ocurre, evaluar:

- tabla adicional de impuestos por item
- tabla adicional de snapshots versionados
- materializaciones para reporting fiscal

### 54.3 Relaciones reales del dominio fiscal

Decision para v1:

- `Factura -> Club`: obligatoria
- `Factura -> ConfiguracionFiscal`: obligatoria
- `Factura -> Account`: opcional pero recomendada como ancla comercial principal
- `Factura -> Booking`: opcional
- `Factura -> originType/originId`: obligatorio como referencia estable de negocio
- `FiscalIncident -> Club`: obligatoria
- `FiscalIncident -> Factura`: opcional
- `FiscalIncident.assignedToUserId`: nullable en v1

Motivo:

- Pique no factura solo reservas; tambien factura cuentas y ventas manuales
- `Account` representa mejor la unidad comercial consolidada
- `Booking` debe seguir existiendo como origen cuando aplique, pero no forzar todo el modelo a depender de reservas
- `assignedToUserId` nullable evita acoplar la primera version a un flujo operativo aun no completamente definido

Revisar mas adelante si:

- el producto exige que toda factura tenga siempre `Account`
- algunas facturas nacen de origenes nuevos distintos de `Booking` o `Account`
- conviene forzar FK a usuario para asignacion de incidencias
- aparece necesidad de historico de asignaciones, comentarios o workflow de soporte

### 54.4 Regla general para futuras revisiones

Todo lo definido en esta seccion se considera correcto para v1 salvo que ocurra alguno de estos eventos:

- cambio normativo relevante
- aparicion de un nuevo proveedor fiscal
- soporte multi-pais real en produccion
- necesidad de reporting fiscal mas sofisticado
- necesidad de soporte operativo con workflow administrativo mas complejo

Si ocurre alguno de esos eventos, reabrir estas decisiones antes de extender el modulo con parches aislados.

## 55. Normative Review cerrado al 1 de junio de 2026

Esta seccion registra la validacion puntual realizada contra fuentes oficiales de ARCA. Cierra las decisiones necesarias para implementar v1, pero no reemplaza una revision final antes de habilitar produccion.

### 55.1 Manual vigente de `WSFEv1`

Al `1 de junio de 2026`, el manual oficial publicado por ARCA es:

- `WSFEv1 RG 4291 - Proyecto FE v4.3`
- revision fechada `01-06-2026`

La version `4.3` incorpora validaciones para la condicion de IVA del receptor. El campo `CondicionIVAReceptorId` debe tratarse como obligatorio en el builder de request.

Decision de implementacion:

- persistir `receptorCondicionIvaArcaId`
- resolver su valor desde el catalogo oficial `FEParamGetCondicionIvaReceptor`
- validar que sea compatible con la clase de comprobante antes de invocar autorizacion
- guardar tambien `receptorCondicionIva` como snapshot legible del dominio

### 55.2 Umbral vigente para consumidor final

La `Resolucion General 5824/2026` fija en `$10.000.000` el importe a partir del cual una operacion con consumidor final debe identificar al adquirente. Este valor es el vigente al `1 de junio de 2026`.

Para persona humana local, la identificacion contempla apellido y nombre, domicilio y al menos uno de estos documentos:

- `DNI`
- `CUIL`
- `CDI`

Para personas extranjeras se admite documento de identidad o pasaporte segun corresponda.

Decision de implementacion:

- guardar el umbral como parametro versionado y no como numero magico
- aplicar la exigencia cuando `importeTotal >= umbralConsumidorFinal`
- permitir identificacion por debajo del umbral
- contemplar que, si el receptor solicita CUIT para computar una deduccion de impuesto a las ganancias, se debe informar independientemente del monto
- programar revision semestral del parametro en enero y julio; la primera actualizacion prevista por la norma es julio de 2026

### 55.3 Fechas obligatorias para concepto `2` y `3`

El manual `WSFEv1 v4.3` confirma:

| Concepto | Fechas requeridas |
| --- | --- |
| `1` Productos | se pueden omitir fechas de servicio |
| `2` Servicios | exigir `fechaServicioDesde`, `fechaServicioHasta` y `fechaVencimientoPago` |
| `3` Productos y servicios | exigir `fechaServicioDesde`, `fechaServicioHasta` y `fechaVencimientoPago` |

Validaciones minimas:

- `fechaServicioDesde <= fechaServicioHasta`
- `fechaVencimientoPago >= fechaEmision`
- el builder no debe enviar un concepto `2` o `3` incompleto

### 55.4 Reglas de clase `A`, `B` y `C`

Decision funcional inicial:

| Emisor | Caso principal | Clase inicial |
| --- | --- | --- |
| Responsable inscripto | receptor que corresponde facturar con discriminacion de IVA | `A` |
| Responsable inscripto | consumidor final u otro caso admitido por politica | `B` |
| Monotributista | operacion facturable | `C` |
| Exento u otra condicion | no asumir automaticamente | resolver durante onboarding y validar catalogos vigentes |

Reglas adicionales:

- la clase debe resolverse en una politica centralizada y versionada
- la condicion IVA del receptor se debe informar con `CondicionIVAReceptorId`
- la nota de credito hereda clase y variante del comprobante asociado
- desde el `1 de diciembre de 2025`, no tratar factura `M` como camino nuevo; modelar las variantes vigentes de comprobante `A`
- una configuracion que requiera una variante todavia no soportada debe bloquear activacion fiscal durante onboarding, no improvisar un `cbteTipo`

### 55.5 QR fiscal final

La representacion impresa o electronica del comprobante debe incluir el QR definido por ARCA.

URL final:

```text
https://www.arca.gob.ar/fe/qr/?p={DATOS_CODIFICADOS}
```

`DATOS_CODIFICADOS` es la representacion JSON codificada en Base64. El payload minimo debe incluir:

```json
{
  "ver": 1,
  "fecha": "YYYY-MM-DD",
  "cuit": 30000000007,
  "ptoVta": 1,
  "tipoCmp": 6,
  "nroCmp": 1,
  "importe": 12100,
  "moneda": "PES",
  "ctz": 1,
  "tipoCodAut": "E",
  "codAut": 70417054367476
}
```

Cuando corresponda, agregar:

- `tipoDocRec`
- `nroDocRec`

Decision de implementacion:

- persistir `qrPayloadBase64`
- persistir `qrUrl`
- generar el QR solo despues de autorizacion aprobada y CAE persistido
- agregar test de serializacion estable del payload

### 55.6 Parametros y catalogos a sincronizar

Los siguientes valores deben centralizarse y validarse contra ARCA:

| Catalogo o parametro | Estrategia |
| --- | --- |
| `FEParamGetTiposCbte` | validar al activar tenant y sincronizar periodicamente |
| `FEParamGetTiposDoc` | validar allowlist soportado por Pique |
| `FEParamGetTiposConcepto` | validar valores `1`, `2`, `3` |
| `FEParamGetCondicionIvaReceptor` | usar para resolver `CondicionIVAReceptorId` compatible |
| `umbralConsumidorFinal` | guardar como parametro versionado con vigencia |

### 55.7 Checklist normativo antes de produccion

Antes de activar el primer club en produccion:

- volver a descargar el manual vigente de `WSFEv1`
- ejecutar sincronizacion de catalogos ARCA
- confirmar el valor vigente de `umbralConsumidorFinal`
- probar homologacion para `A`, `B`, `C` y notas de credito soportadas
- probar las variantes `A` aplicables al CUIT emisor
- validar QR con comprobante autorizado de homologacion
- revisar si ya entro en vigencia la vinculacion de actividad economica por punto de venta prevista para el `1 de julio de 2026`

### 55.8 Fuentes oficiales revisadas

- [Documentacion oficial de homologacion externa y manuales](https://www.arca.gob.ar/ws/documentacion/homologacion-externa.asp)
- [Manual oficial WSFEv1 RG 4291 v4.3](https://www.arca.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf)
- [Resolucion General 5824/2026](https://biblioteca.arca.gob.ar/search/query/norma.aspx?p=t%3ARAG%7Cn%3A5824%7Co%3A9%7Ca%3A2026%7Cf%3A12%2F02%2F2026)
- [Resolucion General 5764/2025](https://biblioteca.arca.gob.ar/dcp/REAG09005764_2025_09_24)
- [Especificaciones oficiales del QR](https://arca.gob.ar/fe/qr/documentos/QRespecificaciones.pdf)

## 56. Estado de cierre para implementacion

Con la revision anterior quedan cerrados para v1:

- `cbteTipo` para facturas y notas de credito `A`, `B`, `C`
- variantes actuales de comprobante `A`
- `DocTipo` soportados inicialmente por Pique
- obligatoriedad de `CondicionIVAReceptorId`
- umbral vigente de consumidor final con estrategia de versionado
- fechas requeridas para concepto `2` y `3`
- contrato final del QR

Lo que queda abierto no bloquea empezar a codear. Son controles de vigencia antes del go-live y revisiones futuras ante cambios normativos o ampliacion funcional.
