PR: Agregar constraint Postgres para evitar turnos solapados (exclusion constraint)

Resumen
--------
Esta PR añade una migración SQL que crea una constraint de exclusión en la tabla `Booking`
para evitar que dos reservas de la misma cancha se solapen en tiempo. La solución usa
un `tstzrange` construido a partir de `date` + `startTime`/`endTime` y un índice GIST.

Archivos añadidos
-----------------
- `prisma/migrations/20260102_add_exclusion_constraint/migration.sql`

Por qué
-------
- Protege la integridad de datos a nivel DB frente a condiciones de carrera o fallos
  en la lógica de aplicación.
- Es la solución más robusta a escala para evitar solapamientos (complementaria a la
  verificación atómica en la app).

Requisitos y precauciones
------------------------
- Hacer backup de la BD antes de aplicar la migración.
- La migración crea la extensión `btree_gist` si no existe.
- Esta migración asume que:
  - `Booking.date` contiene un timestamp al inicio del día (00:00).
  - `startTime` y `endTime` están en formato `HH:MM`.

Cómo aplicar (producción)
-------------------------
1. Hacer backup completo de la BD.
2. Ejecutar la migración SQL directamente contra la BD:
   - `psql "$DATABASE_URL" -f prisma/migrations/20260102_add_exclusion_constraint/migration.sql`
   - O usar la herramienta de migraciones que prefieran para ejecutar SQL raw.

Cómo revertir
-------------
- Para quitar el constraint:
  - `ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS booking_no_overlap;`
- La extensión `btree_gist` puede dejarse si la usan otras features; si no:
  - `DROP EXTENSION IF EXISTS btree_gist;`

Notas técnicas
---------------
- Si en el futuro se decide almacenar `start` y `end` como `timestamptz` directos
  en la tabla (recomendado), la constraint sería más simple y eficiente.
- La migración es compatible con reservas ya existentes; en caso de que existan
  solapamientos preexistentes, la creación del constraint fallará y habrá que
  resolver/limpiar esos registros antes de aplicarla.

