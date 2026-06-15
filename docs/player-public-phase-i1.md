# Fase I.1 — Jugador / publico minimo seguro

## Cerrado en esta fase

- Mis reservas autenticadas via `GET /api/me/bookings`
- DTO publico seguro para reservas del jugador
- Visibilidad solo por relacion explicita:
  - `Booking.userId === currentUser.id`
  - `Booking.client.userId === currentUser.id` cuando el link fue manual
- Cancelacion publica solo para titular explicito y solo si:
  - la reserva esta en `PENDING` o `CONFIRMED`
  - todavia no empezo
  - no tiene pagos registrados
- Mensajes publicos amigables para reservas, login y perfil

## Fuera de alcance en I.1

- Mercado Pago / Stripe
- pagos online
- open match
- partidos abiertos
- invitaciones por link
- aceptar o rechazar invitaciones
- baja individual de participantes
- pagos por plaza
- conversion de invitado a usuario
- linking automatico
- merge automatico

## Futuro documentado

### Fase I.2 — Participantes e invitaciones

- modelo explicito de participantes con `BookingParticipant.userId`
- participante puede ver su reserva por relacion explicita
- participante se baja de una reserva
- titular invita jugadores
- invitaciones por link
- aceptar / rechazar invitacion
- estados `INVITED`, `JOINED`, `LEFT`, `REMOVED`

### Fase I.3 — Checkout / pago online

- boton "Pagar reserva" en Mis reservas / detalle publico
- checkout por club
- senia o pago total
- relacion con `Account` y `Payment`
- pagos parciales
- Mercado Pago por club
- webhooks
- conciliacion
- sin refunds automaticos en la primera salida

## Base tecnica para pago online futuro

- la UI debe mirar `paymentSummary.status` de `PlayerBookingDto`
- el boton futuro "Pagar reserva" solo deberia aparecer cuando:
  - la reserva sea visible para el usuario
  - exista `Account` de la reserva
  - haya saldo pendiente
  - el club tenga checkout online habilitado
- endpoint futuro sugerido:
  - `POST /api/me/bookings/:id/checkout`
- el checkout debera resolver contra la `Account` BOOKING existente
- si hay pagos parciales, el checkout debe usar saldo pendiente real y no recalcular montos en frontend
- si la reserva ya tiene pagos registrados y requiere cancelacion, la cancelacion publica sigue bloqueada y deriva al club

## Proxima fase sugerida

- Fase I.2 — Participantes e invitaciones
