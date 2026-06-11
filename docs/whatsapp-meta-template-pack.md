# WhatsApp Meta Template Pack

Usar en todos los templates:

- Category: `Utility`
- Type: `Default`
- Language: `Spanish (ARG)`
- Header: `None`
- Footer: `None`
- Buttons: `None`
- Type of variable: `Number`
- Media sample: `None`

## customer_booking_created_v1

Body:

```text
Reserva confirmada.

Hola, {{1}}.
Tu reserva en {{2}} quedó confirmada.

Día: {{3}}
Hora: {{4}}
Cancha: {{5}}
Importe: {{6}}

Si necesitás ayuda, usá este enlace: {{7}} y escribinos por ahí.
```

Samples:

```text
{{1}}=Francisco
{{2}}=Las Tejas
{{3}}=06/06/2026
{{4}}=19:00
{{5}}=Cancha 1
{{6}}=$28000
{{7}}=https://wa.me/5493571359791
```

## customer_booking_cancelled_v1

Body:

```text
Reserva cancelada.

Hola, {{1}}.
Tu reserva en {{2}} fue cancelada.

Día: {{3}}
Hora: {{4}}
Cancha: {{5}}
Motivo: {{7}}

Si necesitás ayuda, usá este enlace: {{6}} y escribinos por ahí.
```

Samples:

```text
{{1}}=Francisco
{{2}}=Las Tejas
{{3}}=06/06/2026
{{4}}=19:00
{{5}}=Cancha 1
{{6}}=https://wa.me/5493571359791
{{7}}=Cancelación solicitada por el club
```

## customer_booking_pending_warning_v1

Body:

```text
Reserva pendiente.

Hola, {{1}}.
Tu reserva en {{2}} sigue pendiente.

Día: {{3}}
Hora: {{4}}
Cancha: {{5}}
La reserva puede cancelarse en {{6}} minutos.

El saldo pendiente es {{7}} y todavía podés regularizarlo.
```

Samples:

```text
{{1}}=Francisco
{{2}}=Las Tejas
{{3}}=06/06/2026
{{4}}=19:00
{{5}}=Cancha 1
{{6}}=30
{{7}}=$12000
```

## staff_booking_created_v1

Body:

```text
Nueva reserva registrada.

Club: {{1}}
Cliente: {{2}}
Teléfono: {{3}}
Día: {{4}}
Hora: {{5}}
Cancha: {{6}}

Importe: {{7}}.
```

Samples:

```text
{{1}}=Las Tejas
{{2}}=Francisco
{{3}}=5493511234567
{{4}}=06/06/2026
{{5}}=19:00
{{6}}=Cancha 1
{{7}}=$28000
```

## staff_booking_cancelled_v1

Body:

```text
Reserva cancelada.

Club: {{1}}
Cliente: {{2}}
Teléfono: {{3}}
Día: {{4}}
Hora: {{5}}
Cancha: {{6}}

Motivo: {{7}}.
```

Samples:

```text
{{1}}=Las Tejas
{{2}}=Francisco
{{3}}=5493511234567
{{4}}=06/06/2026
{{5}}=19:00
{{6}}=Cancha 1
{{7}}=Cancelación solicitada por el club
```

## staff_booking_pending_warning_v1

Body:

```text
Reserva pendiente por revisar.

Club: {{1}}
Cliente: {{2}}
Teléfono: {{3}}
Día: {{4}}
Hora: {{5}}
Cancha: {{6}}

La autocancelación estimada es en {{7}} minutos.
Saldo pendiente: {{8}}.

Revisá la reserva y definí la acción correspondiente.
```

Samples:

```text
{{1}}=Las Tejas
{{2}}=Francisco
{{3}}=5493511234567
{{4}}=06/06/2026
{{5}}=19:00
{{6}}=Cancha 1
{{7}}=30
{{8}}=$12000
```
