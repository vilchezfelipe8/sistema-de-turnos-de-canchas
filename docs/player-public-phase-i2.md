# Fase I.2 — Participantes e invitaciones

## Cerrado en esta fase

- modelo explicito `BookingParticipant`
- invitaciones persistidas por reserva privada
- aceptacion y rechazo autenticados por email coincidente
- visibilidad de reservas para participante real solo cuando `BookingParticipant.userId === currentUser.id`
- `/api/me/bookings` incluye rol `OWNER` o `PARTICIPANT`
- listado seguro de participantes en el flujo publico
- salida voluntaria del participante antes del inicio de la reserva

## Reglas de identidad que se mantienen

- no hay acceso por coincidencia de email, telefono, nombre o DNI
- `invitedEmail` no da acceso por si solo
- no se hace auto-link `Client -> User`
- no se hace auto-merge de clientes
- no cambia la titularidad de la reserva
- no cambia `Booking.clientId`

## Fuera de alcance en I.2

- link publico por token
- reenvio por email o WhatsApp
- notificaciones de invitacion transaccionales
- pagos por participante
- checkout online / Mercado Pago / Stripe
- open match o partidos abiertos
- marketplace / comunidad
- refunds automaticos
- ranking, nivel o no-show

## Futuro documentado

### Fase I.2B — Entrega y ciclo ampliado de invitaciones

- link publico por token
- expiracion configurable
- reenvio real de invitaciones
- cancelacion mas rica de invitaciones
- invitaciones por WhatsApp / email transaccional

### Fase I.3 — Checkout / pago online

- boton "Pagar reserva"
- checkout por club
- Mercado Pago por club
- webhooks
- conciliacion
- pagos parciales / senias
- sin refunds automaticos en el primer corte

### Fase futura — Social / abierto

- open match
- marketplace / comunidad
- conversion de reserva privada a partido abierto
- pagos por plaza
- logica deportiva y ranking

## Proxima fase sugerida

- Fase I.3 — Checkout / pago online
