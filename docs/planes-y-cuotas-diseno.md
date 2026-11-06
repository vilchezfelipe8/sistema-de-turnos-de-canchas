# Planes y cuotas — diseño

Estado: entrega 1 implementada (2026-11-05): schema, ABM de planes, venta, cuotas con cuenta,
sincronización al pagar, "al día hasta" calculado, cancelación, Ajustes → Planes y panel en la
ficha del cliente. Pendiente: entregas 2 a 4.

## Objetivo

Que un club pueda vender planes (gimnasio, cuota social, clases mensuales) y que Pique
genere las cuotas, controle la mora y sepa en todo momento si un cliente está habilitado
para una actividad. Es la base para reemplazar AccesoGym en PadFit: check-in, turnos
del gimnasio, molinete y avisos por WhatsApp consultan este módulo.

También sirve para Barrio Parque: la cuota social mensual es un plan que mantiene
al socio "al día" sin cargar `validUntil` a mano.

## Caso real: PadFit (chat de WhatsApp del 2026-07-07)

| Plan | Incluye | Pago | Lista | Efectivo |
|---|---|---|---|---|
| Mensual | sin detallar | 1 pago | sin dato | $55.000 |
| Full Pass Trimestral | musculación, cardio y clases fitness grupales | 3 cuotas con vencimiento fijo | $56.300 c/u | $45.000 c/u |
| | | 1 pago | $152.500 | $122.000 |
| Full Pass Semestral | igual | 1 pago | $278.000 | $223.000 |

- Los planes Full Pass "congelan el precio".
- Pausa por única vez: hasta 1 semana en el trimestral y hasta 2 en el semestral.
- Clases de pádel mensuales: ocasional o 1, 2 o 3 veces por semana (4, 8 u 12 clases),
  en pareja, grupales o individuales.
- El precio efectivo es la lista con 20% de descuento, redondeado (45.040 → 45.000).

## Lo que ya existe y se reutiliza

- `Account` / `AccountItem` / `Payment` / ledger: cada cuota es una cuenta propia.
  Así sirven sin cambios el cobro en caja, el precio por medio de pago, el pago online
  con Mercado Pago, las devoluciones y los informes.
- `AccountService.reconcilePaidAmountTx`: es el punto donde una cuenta se cierra o se
  reabre por saldo. Desde ahí se sincroniza el estado de la cuota.
- `ClubMember.validUntil` y `isMemberCurrent` (RN-01): siguen siendo la fuente para los
  precios de socio. El plan los actualiza en lugar de que se carguen a mano.
- `ClassPass` y `ClassCreditUsage`: los planes con clases incluidas generan un pack
  de créditos por período.
- `ActivityType`: las actividades que habilita un plan (Musculación, Funcional, Zumba,
  Pádel) son tipos de actividad del club.
- Scheduler de `src/index.ts` (`setInterval`): ahí se suma el job de renovación y mora.
- Outbox y `wpp-service`: los avisos de vencimiento salen como eventos nuevos.

## Modelo de datos

Se usa `SubscriptionPlan` / `Subscription` porque `Membership` ya existe (rol de
usuario en el club).

```prisma
enum SubscriptionBillingType {
  RECURRING   // se renueva solo cada período (mensual, cuota social)
  FIXED_TERM  // dura N meses y vence (trimestral, semestral)
}

enum SubscriptionStatus {
  ACTIVE
  PAUSED
  PAST_DUE    // tiene una cuota vencida fuera del período de gracia
  EXPIRED     // terminó el plazo y no se renovó
  CANCELLED
}

enum SubscriptionInstallmentKind {
  ENROLLMENT_FEE  // matrícula
  PERIOD          // cuota del período
}

enum SubscriptionInstallmentStatus {
  PENDING
  PAID
  VOID
}

enum SubscriptionEntitlementKind {
  ACTIVITY_ACCESS  // puede usar la actividad (musculación libre, 3x semana)
  CLASS_CREDITS    // recibe N créditos de clase por período
}

model SubscriptionPlan {
  id             String   @id @default(cuid())
  clubId         Int
  name           String                   // "Full Pass Trimestral"
  description    String?
  billingType    SubscriptionBillingType
  periodMonths   Int                      // 1, 3, 6, 12
  enrollmentFee  Decimal? @db.Decimal(10, 2)  // matrícula opcional (precio de lista)
  dueDayOfMonth  Int?                     // null = vence según la fecha de alta
  graceDays      Int      @default(5)     // días después del vencimiento antes de la mora
  pauseMaxDays   Int      @default(0)     // 7 trimestral, 14 semestral
  pauseMaxCount  Int      @default(0)     // veces por período (1 en PadFit)
  grantsMemberCategoryId String?          // al estar al día, el cliente es socio de esta categoría
  isActive       Boolean  @default(true)
  sortOrder      Int      @default(0)

  options        SubscriptionPlanOption[]
  entitlements   SubscriptionPlanEntitlement[]
  subscriptions  Subscription[]
}

// Formas de pago de un plan, cada una con su precio de lista.
// Trimestral: { 1 pago, $152.500 } y { 3 cuotas, $56.300 c/u }.
model SubscriptionPlanOption {
  id                String  @id @default(cuid())
  planId            String
  label             String               // "1 pago", "3 cuotas"
  installmentsCount Int                  // 1..periodMonths
  installmentPrice  Decimal @db.Decimal(10, 2)  // precio de lista de cada cuota
  isActive          Boolean @default(true)
}

model SubscriptionPlanEntitlement {
  id              String  @id @default(cuid())
  planId          String
  kind            SubscriptionEntitlementKind
  activityTypeId  Int
  timesPerWeek    Int?     // ACTIVITY_ACCESS: null = libre
  creditsPerPeriod Int?    // CLASS_CREDITS: 4, 8, 12
  classType       ClassSessionType?  // CLASS_CREDITS: grupal o individual
}

model Subscription {
  id               String  @id @default(cuid())
  clubId           Int
  planId           String
  optionId         String
  clientId         String              // quien usa el plan
  payerClientId    String              // quien paga (padre/tutor; por defecto el mismo)
  status           SubscriptionStatus @default(ACTIVE)
  planSnapshot     Json                // nombre, opción, precios y beneficios al venderse
  priceLocked      Boolean             // FIXED_TERM: true. RECURRING: false (toma precio vigente)
  startDate        DateTime @db.Date
  endDate          DateTime? @db.Date  // FIXED_TERM: fin del plazo (se corre con pausas)
  currentPeriodEnd DateTime @db.Date   // RECURRING: fin del período en curso
  autoRenew        Boolean  @default(true)  // RECURRING
  pausesUsed       Int      @default(0)
  cancelledAt      DateTime? @db.Timestamptz(3)
  cancelReason     String?
  notes            String?
  createdByUserId  Int
  createdAt        DateTime @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime @updatedAt @db.Timestamptz(3)

  installments     SubscriptionInstallment[]
  pauses           SubscriptionPause[]
  history          SubscriptionHistory[]
  classPasses      ClassPass[]          // packs generados por período

  @@index([clubId, status])
  @@index([clubId, clientId])
}

model SubscriptionInstallment {
  id             String  @id @default(cuid())
  clubId         Int
  subscriptionId String
  sequence       Int                   // 0 = matrícula, 1..N = cuotas
  kind           SubscriptionInstallmentKind
  coversFrom     DateTime @db.Date     // qué período habilita esta cuota
  coversTo       DateTime @db.Date
  dueDate        DateTime @db.Date
  listAmount     Decimal  @db.Decimal(10, 2)
  status         SubscriptionInstallmentStatus @default(PENDING)
  paidAt         DateTime? @db.Timestamptz(3)
  accountId      String?  @unique      // cuenta SUBSCRIPTION_INSTALLMENT

  @@unique([subscriptionId, sequence])
  @@index([clubId, status, dueDate])
}

model SubscriptionPause {
  id             String   @id @default(cuid())
  subscriptionId String
  startDate      DateTime @db.Date
  endDate        DateTime @db.Date
  reason         String?
  createdByUserId Int
  createdAt      DateTime @default(now()) @db.Timestamptz(3)
}

model SubscriptionHistory {
  id             String   @id @default(cuid())
  subscriptionId String
  clubId         Int
  action         String    // CREATED, PERIOD_RENEWED, INSTALLMENT_PAID, PAUSED, PAST_DUE, ...
  fromStatus     SubscriptionStatus?
  toStatus       SubscriptionStatus?
  detail         Json?
  changedByUserId Int?
  createdAt      DateTime @default(now()) @db.Timestamptz(3)
}
```

Cambios en lo existente:

- `AccountSource`: se suma `SUBSCRIPTION_INSTALLMENT` (`sourceId` = id de la cuota).
- El ítem de la cuota es `SERVICE` (como los packs de clases), con ingreso en `MEMBERSHIP_REVENUE`.
- `LedgerAccount`: se suma `MEMBERSHIP_REVENUE`.
- `LedgerReferenceType`: se suma `SUBSCRIPTION`.
- `ClassPass.subscriptionId String?`: el pack que se genera con cada período.
- Club (entrega 2): un tilde `subscriptionAutoSuspendMembers` y `subscriptionSuspendAfterDays`
  en `ClubSettings` (suspender al socio después de N días de mora).

## Reglas

### Venta de un plan

1. Se elige cliente, plan y forma de pago (y quién paga, si no es el mismo).
2. Se guarda `planSnapshot` con nombre, opción, precios y beneficios.
3. Se generan las cuotas:
   - Matrícula, si el plan tiene: secuencia 0, vence en el día de la venta.
   - **FIXED_TERM**: se generan todas de entrada. El plazo se divide en partes iguales:
     el trimestral en 3 cuotas cubre un mes cada una y vence al inicio de su mes.
     En 1 pago, una cuota cubre los 3 meses.
   - **RECURRING**: solo la cuota del primer período. Las siguientes las crea el job.
4. Cada cuota abre su cuenta `SUBSCRIPTION_INSTALLMENT` con un ítem `SUBSCRIPTION`
   por el precio de lista. La cobranza es la de siempre (caja, agenda, cliente, online).
5. Si el plan tiene `grantsMemberCategoryId` y el cliente no es socio, se crea el
   `ClubMember` con esa categoría.

### Pago

`reconcilePaidAmountTx` llama a `SubscriptionService.syncInstallmentTx` cuando la cuenta
es `SUBSCRIPTION_INSTALLMENT`, en la misma transacción:

- La cuenta se cerró: la cuota pasa a `PAID`. Si la suscripción estaba `PAST_DUE` y ya
  no quedan cuotas vencidas, vuelve a `ACTIVE`.
- La cuenta se reabrió (devolución): la cuota vuelve a `PENDING`.
- Se recalcula `ClubMember.validUntil` (ver "Al día").
- Si el plan incluye créditos de clase, al pagarse la cuota se crea el `ClassPass`
  del período (`expiresAt` = fin del período). Si se reabre, el pack se cancela si no
  tiene créditos usados. Si ya tiene, queda y se registra en el historial.

### Al día y habilitación

Un cliente **está habilitado** para una actividad en una fecha si tiene una suscripción:

- en estado `ACTIVE` (no `PAUSED`, `PAST_DUE`, `EXPIRED` ni `CANCELLED`),
- con la fecha dentro de su plazo, y fuera de una pausa,
- sin cuotas `PENDING` con `dueDate + graceDays` anterior a esa fecha,
- cuyo plan tiene un beneficio `ACTIVITY_ACCESS` de esa actividad,
- y, si el beneficio tiene `timesPerWeek`, sin superar los ingresos o turnos de la semana.

`ClubMember.validUntil` = el mayor `coversTo` de las cuotas `PAID` consecutivas de las
suscripciones que otorgan categoría. Se guarda calculado para que los precios de socio
(RN-01) sigan funcionando sin cambios. Los clubes sin planes siguen cargándolo a mano.

Una sola función, `SubscriptionAccessService.check(clientId, activityTypeId, at)`,
devuelve `{ allowed, reason, subscription, remainingThisWeek }`. La usan el check-in,
los turnos del gimnasio y, más adelante, el molinete.

### Renovación y mora (job)

Corre cada hora junto con las otras tareas del scheduler. Es idempotente
(`@@unique([subscriptionId, sequence])`).

- **RECURRING**: cuando faltan `renewLeadDays` (5) para `currentPeriodEnd` y `autoRenew`
  está prendido, crea la cuota del próximo período con el **precio vigente** del plan
  (`priceLocked = false`) y corre `currentPeriodEnd`.
- **FIXED_TERM**: al llegar a `endDate`, pasa a `EXPIRED`. Antes de eso se manda el aviso
  para renovar. Renovar es vender el plan de nuevo con el precio del momento.
- **Mora**: si hay una cuota `PENDING` con `dueDate + graceDays` ya pasada, la suscripción
  pasa a `PAST_DUE`. Si el club lo configuró, después de `subscriptionSuspendAfterDays`
  el `ClubMember` pasa a `SUSPENDED` con su historial.
- **Pausa**: al terminar una pausa, la suscripción vuelve a `ACTIVE`.

### Pausa

- Se valida `pausesUsed < pauseMaxCount` y que los días no superen `pauseMaxDays`.
- Se corren `endDate` (o `currentPeriodEnd`), y el `coversFrom`, `coversTo` y `dueDate`
  de las cuotas futuras, por los días de la pausa.
- Durante la pausa la suscripción está `PAUSED` y el acceso se rechaza.

### Cancelación

- Las cuotas `PENDING` sin pagos pasan a `VOID` y sus cuentas se anulan con un ajuste.
  Las que tienen pagos parciales quedan como deuda.
- Lo ya pagado no se devuelve solo. Si corresponde, se hace con el flujo de devoluciones.

### Precio efectivo

Se usa el descuento por medio de pago que ya existe (20% en efectivo). PadFit redondea
el efectivo (45.040 → 45.000). Opciones a decidir:

1. Sumar un redondeo por club al descuento por medio de pago (a $100, $500 o $1.000).
2. Permitir precio efectivo explícito por opción de plan.

Recomiendo la 1, porque sirve también para clases y canchas.

## Pantallas

- **Ajustes → Planes**: alta y edición de planes, formas de pago y beneficios.
- **Ficha del cliente**: suscripciones con estado, cuotas (pagadas, pendientes y vencidas),
  botones "Vender plan", "Pausar", "Cancelar" y "Renovar". Cobrar una cuota abre el
  `AccountDrawer` de siempre.
- **Caja → Cuotas**: cuotas a vencer y vencidas, con filtro por plan y estado, y acceso
  directo al cobro. Es la lista de morosos.
- **Informes**: socios activos por plan, altas y bajas, ingresos por cuotas, mora.

## Entregas

1. **Base**: schema y migración, ABM de planes, venta, cuotas con cuenta, sincronización
   al pagar, `validUntil` calculado, ficha del cliente. Tests de la generación de
   cuotas y del pago.
2. **Ciclo de vida**: job de renovación y mora, pausa, cancelación, vista de Cuotas.
3. **Beneficios**: `SubscriptionAccessService.check`, packs de clase por período,
   límite de veces por semana.
4. **Afuera del módulo**: check-in en recepción, grilla de turnos del gimnasio,
   avisos por WhatsApp, importación de socios desde AccesoGym, integración del
   lector de huellas con el molinete.

## Preguntas para PadFit

- Precio de lista del mensual y si existe un mensual solo de musculación.
- ¿Cobran matrícula?
- ¿El mensual vence un día fijo del mes o según la fecha de alta?
- En el trimestral en 3 cuotas, ¿cuándo vence cada una?
- ¿Cuántos días de gracia dan antes de bloquear el acceso?
- ¿La pausa la pide el socio por WhatsApp o en recepción? ¿Piden certificado?
- Precio de las clases sueltas para quien no tiene plan.
- ¿Las clases mensuales de pádel también se cobran como plan, o como pack suelto?
