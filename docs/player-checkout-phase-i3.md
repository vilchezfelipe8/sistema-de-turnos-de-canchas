# Fase I.3A — Checkout publico interno

## Que cierra

- `GET /api/me/bookings/:id/checkout` como contrato publico seguro.
- Resumen publico de deuda/pago contra `Account BOOKING`.
- Elegibilidad de checkout y razones de bloqueo calculadas en backend.
- UI publica de estado de pago en `Mis reservas`.
- Base tecnica para un checkout real en I.3B sin crear pagos online ahora.

## Que queda fuera de alcance

- Mercado Pago.
- Stripe.
- Creacion de pagos online reales.
- Webhooks.
- Refunds automaticos.
- Pagos por participante.
- Open Match y logica social/comercial.
- Cambios en caja admin.

## Contrato actual

El backend expone un DTO publico de checkout:

- `booking`: contexto de la reserva y rol del usuario.
- `account`: resumen seguro de `Account BOOKING` con conceptos visibles.
- `paymentSummary`: estado publico del pago.
- `checkout`: elegibilidad y razon de bloqueo.

En I.3A:

- `checkout.enabled` siempre es `false`.
- el frontend no calcula montos;
- el backend es la fuente de verdad para `total`, `paid`, `pending` y bloqueos.

## Reglas vigentes

- Solo puede consultar el checkout el titular explicito o un participante real (`BookingParticipant.userId` con estado `JOINED`).
- Nunca se habilita acceso por email, telefono, nombre, DNI o metadata coincidente.
- Si la reserva no tiene `Account BOOKING`, el contrato devuelve `ACCOUNT_MISSING`.
- Si no hay saldo pendiente, devuelve `NO_PENDING_BALANCE`.
- Si hay refunds/devoluciones asociados, devuelve `BOOKING_HAS_REFUNDS`.
- Si consulta un participante, el resumen se muestra pero devuelve `PARTICIPANT_PAYMENTS_NOT_SUPPORTED`.
- Si la reserva podria pagarse online en el futuro pero el club aun no tiene integracion, devuelve `PROVIDER_NOT_CONFIGURED`.

## Base tecnica para I.3B

Endpoint futuro sugerido:

- `POST /api/me/bookings/:id/checkout/mercadopago`

Lineamientos:

- siempre operar contra `Account BOOKING`;
- calcular saldo pendiente en backend al iniciar la intencion;
- usar una clave de idempotencia por intento de checkout;
- rechazar si la cuenta ya no tiene saldo pendiente;
- rechazar si la reserva cambio de estado o tiene refunds en revision;
- registrar el `Payment` recien cuando llegue la confirmacion segura del proveedor;
- no habilitar refunds automaticos en la primera version.

## Futuro documentado

- I.3B — Mercado Pago OAuth por club + checkout real
- I.3C o posterior — pagos parciales online
- fase futura — pagos por participante
- fase futura — refunds online
- fase futura — comprobantes/tickets externos
- fase futura — Stripe si el producto lo requiere

## Fase siguiente

- `I.3B — Mercado Pago OAuth por club + checkout real`
