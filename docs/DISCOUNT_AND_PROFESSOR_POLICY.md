# Política De Descuentos Y Profesor

## 1. Separación de responsabilidades

- El `ajuste de duración para profesor` es una regla operativa de agenda.
- Los `descuentos` son reglas económicas y se definen con `DiscountPolicy`.
- Los campos económicos legacy de profesor fueron eliminados; el precio se calcula solo con `DiscountPolicy`.

## 2. Regla operativa (ajuste para profesor)

- Se controla con configuración del club:
- `professorDurationOverrideEnabled` (booleano)
- `professorDurationOverrideMinutes` (entero, por defecto 60)
- Si se solicita el ajuste y está deshabilitado, la reserva se rechaza con `PROFESSOR_DURATION_OVERRIDE_DISABLED`.

## 3. Precedencia económica (DiscountPolicy)

- Orden de evaluación:
- primero menor `priority`
- desempate por `policy.id` ascendente
- luego `assignment.createdAt`
- Acumulación:
- si una política seleccionada es no acumulable (`isStackable = false`), corta la cadena
- si es acumulable, la siguiente se aplica sobre el neto resultante

## 4. Profesor + promociones generales

- No existe descuento implícito por “profesor” en el cálculo de precio.
- Cualquier descuento para profesor debe representarse como `DiscountPolicy` y asignarse al cliente.
- La combinación con otras promociones se resuelve por `priority` e `isStackable`.

## 5. Gobierno y auditoría

- El ajuste manual de profesor solo puede solicitarse desde flujos de admin/owner.
- El ajuste manual requiere `professorOverrideReason` (mínimo 10 caracteres).
- Eventos de auditoría obligatorios:
- `BOOKING_PROFESSOR_OVERRIDE`
- `FIXED_BOOKING_PROFESSOR_OVERRIDE`
