# Fase I.3B — Mercado Pago por club + checkout real

## Qué cierra

- Conexión de Mercado Pago **por club** mediante OAuth.
- Estado admin de integración: conectado, desconectado, expirado o con error.
- Checkout público real para reservas del titular explícito usando `Account BOOKING`.
- Creación de `OnlinePaymentAttempt` local antes de hablar con Mercado Pago.
- Webhook idempotente que recién crea `Payment` cuando el provider informa un pago aprobado.
- Reglas explícitas para no tocar caja POS ni crear `CashMovement` en pagos online.

## Qué queda fuera de alcance

- Stripe.
- Pagos por participante.
- Refunds automáticos.
- Open Match.
- Marketplace/comunidad.
- Split de pago entre jugadores.
- Reintento manual de webhooks desde admin.
- Panel admin de intentos online.
- Chargebacks o disputas.

## Flujo vigente

1. El club conecta su propia cuenta de Mercado Pago desde Ajustes.
2. El backend guarda tokens cifrados y nunca los expone al frontend.
3. El jugador titular consulta `GET /api/me/bookings/:id/checkout`.
4. Si el checkout está habilitado, el frontend llama `POST /api/me/bookings/:id/checkout/mercadopago`.
5. El backend:
   - recalcula saldo pendiente desde `Account BOOKING`,
   - crea un `OnlinePaymentAttempt`,
   - crea la preferencia en Mercado Pago,
   - devuelve `initPoint`.
6. Mercado Pago redirige al jugador y luego notifica por webhook.
7. El webhook:
   - valida firma,
   - consulta el pago al provider,
   - aplica idempotencia,
   - recién si está aprobado crea el `Payment` local.

## Reglas de seguridad

- El dinero entra a la cuenta conectada del **club**, no a una cuenta global nuestra.
- El frontend nunca calcula montos.
- `Payment` confirmado se crea solo en webhook aprobado.
- `CashMovement` POS no se crea en pagos online.
- Participantes reales pueden ver el resumen, pero no iniciar pago todavía.
- Si cambia el saldo, hay refunds o la cuenta ya quedó pagada, el flujo se bloquea.

## Bloqueos conocidos para piloto

- Si el club no configuró Mercado Pago, el checkout sigue en solo lectura.
- Si la integración expira o falla el refresh token, el club debe reconectar.
- Si Mercado Pago informa un monto distinto al esperado, el intento queda en `ERROR` para revisión manual.
- No hay refunds automáticos ni conciliación avanzada en esta fase.

## Qué sigue

- `I.3C` o el corte siguiente de pagos online:
  - panel de intentos online,
  - conciliación más fina,
  - retries manuales de webhook,
  - comprobantes,
  - manejo más explícito de errores del provider.
- Fase futura separada:
  - pagos por participante,
  - refunds online automáticos,
  - Stripe,
  - Open Match y social.

## Carriles futuros fuera del checkout jugador

Estos carriles quedan documentados para backlog futuro y no deben mezclarse con `I.3B/I.3C`.

### 1. Billing-SaaS — Suscripción del club

Flujo distinto al checkout de reservas:

- pagador: club,
- cobrador: Pique,
- objetivo: suscripción SaaS de la plataforma,
- proveedor a definir más adelante: Stripe Billing, Mercado Pago suscripciones o checkout recurrente/manual,
- no impacta `Account BOOKING`,
- no impacta la caja del club,
- no usa el token OAuth del club como vendedor.

### 2. Profesores — Clases y liquidaciones

Análisis futuro para resolver, según el modelo operativo final:

- jugador paga clase al club,
- club liquida al profesor,
- profesor cobra directo,
- comisiones,
- reportes,
- responsabilidades fiscales.

No forma parte del checkout actual de reservas.

### 3. Proveedores / Cuentas por pagar

Módulo futuro separado para:

- proveedores,
- compras,
- gastos,
- facturas,
- pagos,
- impacto en caja/contabilidad,
- reportes.

No forma parte del checkout actual de reservas.

### Regla de separación

`I.3B/I.3C` sigue siendo únicamente:

- jugador -> club,
- por reservas,
- usando `Account BOOKING` como fuente de verdad.

## Estado final de I.3C

`I.3C` queda **cerrada** por validación en smoke real controlado.

### Sandbox

El smoke sandbox quedó **parcial / no cerrado** por limitaciones del sandbox de Mercado Pago:

- checkout y preference se generaban correctamente,
- no había `Payment` antes del webhook,
- no había `CashMovement POS`,
- pero el pago sandbox aprobado no resultó confiable para cerrar la fase.

### Real

El smoke real quedó **cerrado** con estas validaciones:

- pago real aprobado,
- webhook real recibido,
- `OnlinePaymentAttempt` en `APPROVED`,
- un único `Payment` con `source=ONLINE`,
- una única `PaymentAllocation`,
- `Account BOOKING` con `paid = total` y `pending = 0`,
- sin `CashMovement POS`,
- sin caja abierta obligatoria,
- return URL sin confirmar el pago,
- replay de webhook con `alreadyProcessed: true`.

Datos no sensibles del smoke real:

- `bookingId`: `189`
- `attemptId`: `cmp93etif018811toohsmhah0`
- provider payment id: `158897986909`
- amount: `466.67`
- provider status: `approved`
- payment source: `ONLINE`

Conclusión:

La implementación de Mercado Pago queda validada end-to-end para un pago real controlado.

Sigue fuera de alcance de este cierre:

- pagos por participante,
- refunds online automáticos,
- Open Match,
- marketplace/comunidad,
- conciliación avanzada,
- panel admin de intentos online,
- chargebacks/disputas,
- suscripción SaaS del club,
- profesores/liquidaciones,
- proveedores/cuentas por pagar.
