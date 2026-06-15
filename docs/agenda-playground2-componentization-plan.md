# Agenda Playground 2 - Plan de componentizacion

## Estado actual

- Archivo principal: `apps/frontend/pages/admin/agenda-playground2.tsx`.
- Tamano aproximado: 9677 lineas.
- Complejidad reactiva actual (aprox):
  - `useState`: 50
  - `useEffect`: 36
  - `useMemo`: 61
  - `useCallback`: 36
- El archivo mezcla al menos 4 responsabilidades principales en un solo componente:
  - Shell/layout de admin y navegacion lateral.
  - Grilla de agenda (timeline + drag/drop + hover preview).
  - Drawer lateral de reserva (datos, pagos, historial, participantes).
  - Modales de confirmacion y estados transitorios.

## Objetivo

Reducir riesgo y costo de mantenimiento separando "UI de presentacion", "estado local de feature" y "acceso a servicios"; luego reutilizar piezas en las otras playground (`clientes-playground2`, `cash-playground2`).

## Criterio de extracción

Extraer primero piezas:
1. De alto reuso.
2. De bajo acoplamiento al estado mas complejo.
3. Que no cambien comportamiento funcional.

## Fase 0 (ya iniciada)

- [x] Configuración del sidebar playground compartida en:
  - `apps/frontend/components/admin/playgroundNavigation.ts`
- Reusada en:
  - `apps/frontend/components/admin/AdminPlaygroundShell.tsx`
  - `apps/frontend/pages/admin/agenda-playground2.tsx`

## Fase 1 - Estandarizar shell/layout

### 1.1 Migrar Agenda para usar `AdminPlaygroundShell`

Hoy Agenda replica header + sidebar manualmente. Debe pasar a usar el shell compartido, igual que Clientes y Cash.

Beneficio:
- Un unico lugar para cambios de marca, user menu, club selector, colapso sidebar y estado visual base.

Riesgo:
- Medio (hay overlays y drawer absoluto en Agenda).

Mitigacion:
- Mantener `agendaSurfaceRef` dentro del `children` del shell.
- Revisar offsets/top de overlays (`top-16`) y z-index.

### 1.2 Definir contenedor comun para contenido playground

Crear un wrapper liviano (ej: `PlaygroundContentFrame`) para reemplazar repeticion de:
- `flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6`
- paneles con `rounded-xl/2xl` + borde + fondo + overflow.

Reuso objetivo:
- Agenda, Clientes, Cash.

## Fase 2 - Separar la agenda en bloques funcionales

### 2.1 `AgendaToolbar`

Responsabilidad:
- Filtros de deporte, busqueda y selector de fecha.

Props sugeridas:
- `availableSports`, `sportFilter`, `onSportChange`
- `searchTerm`, `onSearchChange`
- `selectedDate`, `onDateChange`, `onMoveDate`

### 2.2 `AgendaTimelineGrid`

Responsabilidad:
- Render de columnas por cancha + slots + bloques + hover.

Props sugeridas:
- Datos ya filtrados (`visibleCourts`, `visibleBookings`)
- Estado de seleccion/drag (`dragSelection`, `bookingDropPreview`, `draggingBookingId`, etc.)
- Callbacks de interacción (`onSlotMouseDown`, `onSlotMouseEnter`, `onBookingMouseDown`, etc.)

Nota:
- Mantener logica de drag en hook dedicado para no inflar el componente visual.

### 2.3 `BookingHoverCard`

Responsabilidad:
- Tooltip flotante con participantes y deuda/pago.

Props sugeridas:
- `preview`, `participantsResolver`.

### 2.4 `AgendaRightDrawer`

Agenda ya tiene mucho del drawer aislado. Consolidar como componente de composicion.

Responsabilidad:
- estructura del drawer + tabs + secciones.

Internamente debe reutilizar (o ampliar) `modules/admin/bookingDrawer`.

## Fase 3 - Hooks de estado y side-effects

### 3.1 `useAgendaSchedule`

- Carga de canchas.
- Carga de schedule diario.
- Helpers de refresh.

### 3.2 `useAgendaDragAndDrop`

- Estado de arrastre.
- Preview de drop.
- Persistencia de movimiento (si aplica).

### 3.3 `useBookingDrawerController`

- Apertura/cierre drawer.
- Hidratacion financiera/timeline/config.
- Coordinacion de errores y estados de submit.

### 3.4 `useCalendarNotice`

- Encapsular notificaciones temporales y limpieza de timers.

## Fase 4 - Modales y acciónes transversales

Extraer modales en componentes puros:
- Confirmaciones.
- Errores bloqueantes.
- Exitos.
- Pagos simplificados.

Objetivo:
- Reducir el JSX inline del archivo principal.

## Estrategia de rollout (sin frenar feature)

1. Extracciónes pequeñas y seguras (shell/nav/wrappers).
2. Mover solo UI presentacional (sin tocar negocio).
3. Mover hooks de efecto despues de estabilizar UI.
4. Validar cada PR con smoke tests manuales:
   - abrir/cerrar drawer
   - crear reserva
   - mover reserva drag/drop
   - registrar pago
   - cambiar club

## Definicion de listo por fase

- Fase 1 lista cuando Agenda usa shell comun sin regresiones visuales.
- Fase 2 lista cuando timeline, toolbar y hover card viven en componentes separados.
- Fase 3 lista cuando los hooks encapsulan al menos 70% de la logica de efectos del archivo.
- Fase 4 lista cuando los modales estan fuera de `agenda-playground2.tsx`.

## Meta tecnica recomendada

- Bajar `agenda-playground2.tsx` de ~9.6k lineas a < 2.5k lineas, dejando:
  - Wiring de alto nivel.
  - Orquestacion de hooks.
  - Composicion de componentes.
