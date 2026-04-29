# Benchmarks Visuales — TuCancha Admin v2

> **Propósito:** Inventario + síntesis visual de las referencias recopiladas para el diseño del Admin v2.
> No es una colección de estilos a copiar; es la base para derivar un lenguaje visual propio de TuCancha.

---

## 1. Inventario completo

| Archivo | Qué muestra | Patrón útil | Aplicación en TuCancha | Valor |
|---------|-------------|-------------|------------------------|-------|
| `admin-de-partidos/reservas-match-management-table-desktop.png` | Tabla de gestión de partidos/reservas con acciones en fila | Tabla con estado de color + acciones inline | `/admin/reservas` — columnas: cancha, hora, cliente, estado, acción | Alta |
| `agenda/agenda-calendar-day-columns-desktop.png` | Vista diaria con columna por recurso (cancha/pista) | Grid columnar de recursos en eje X, hora en eje Y | Patrón base para la agenda de canchas | Alta |
| `agenda/agenda-calendar-day-view-desktop.png` | Vista diaria compacta, un solo recurso o día entero | Bloques de tiempo con color por tipo de reserva | Variante mobile o vista por cancha individual | Media |
| `agenda/agenda-calendar-overview-grid-desktop.png` | Vista semana/mes con miniaturas de ocupación | Grid de disponibilidad a vista de pájaro | Posible "mini mapa" de ocupación semanal | Media |
| `agenda/agenda-calendar-time-blocks-compact-desktop.png` | Bloques compactos, alta densidad | Tipografía small + color de fondo como semáforo | Canchas con alta rotación diaria (padel) | Alta |
| `agenda/agenda-calendar-time-blocks-detailed-desktop.png` | Bloques detallados con info de cliente/estado | Chips de info dentro del bloque al hover | Drawer de reserva expandido desde bloque | Alta |
| `agenda/agenda-calendar-with-left-sidebar-desktop.png` | Agenda + sidebar de filtros/recursos a la izquierda | Panel contextual izquierdo + área de grilla central | Filtro de canchas / vista multi-deporte | Alta |
| `ajustes/ajustes-settings-form-layout-desktop.png` | Formulario de configuración con secciones | Layout de formulario con label arriba + input full-width | Base para formularios en Ajustes (Club, Canchas) | Alta |
| `ajustes/ajustes-settings-general-panel-desktop.png` | Panel general de configuración | Secciones con título + descripción corta + controles a la derecha | Patrón para cada sección de Ajustes | Alta |
| `ajustes/ajustes-settings-permissions-matrix-desktop.png` | Matriz de permisos por rol | Grid de checkboxes o toggles por rol × capacidad | Posible en Ajustes → Permisos (futuro) | Baja |
| `ajustes/ajustes-settings-sections-navigation-desktop.png` | Navegación interna por secciones horizontales | Tabs horizontales anchos con descripción breve | Inspiración para tabs dentro de Ajustes | Media |
| `ajustes/ajustes-settings-sidebar-sections-desktop.png` | Sidebar izquierdo con secciones de configuración | Lista de ítems con estado activo subrayado/resaltado | **Patrón ganador para Ajustes:** sidebar de secciones | Alta |
| `ajustes/ajustes-settings-tabs-configuration-desktop.png` | Tabs de configuración con contenido cambiante | Tab bar + contenido dinámico a la derecha | Tabs internos dentro de una sección de Ajustes | Media |
| `asignaciones-staff/cuentas-staff-assignments-board-desktop.png` | Board de asignaciones de staff por turno | Kanban/grid de turnos por persona | Fuera de scope para Admin v2 | Baja |
| `caja/caja-payments-dashboard-desktop.png` | Dashboard financiero con KPIs + tabla + acciones | Layout de dos zonas: métricas arriba + listado abajo | Caja → zona de resumen diario | Alta |
| `caja/caja-payments-kpi-summary-desktop.png` | Fila/grid de KPIs de caja (efectivo, transferencia, total) | Tarjetas de KPI pequeñas alineadas horizontalmente | `MetricCard` en Caja → fila superior | Alta |
| `caja/caja-payments-transactions-table-desktop.png` | Tabla de transacciones con filtro de método y estado | Tabla compacta con chips de método de pago | Caja → listado de movimientos | Alta |
| `clientes/clientes-crm-detail-panel-desktop.png` | Panel de detalle de cliente con historial | Split view: lista izquierda + ficha derecha | Base directa para `/admin/clientes/[id]` | Alta |
| `clientes/clientes-crm-list-with-filters-desktop.png` | Lista de clientes con buscador + filtros | Search bar + chips de filtro + lista de resultados | Clientes → vista lista con search | Alta |
| `crear-cliente/clientes-crm-create-form-compact-desktop.png` | Formulario de alta de cliente compacto (modal o drawer) | Form de 2 columnas con campos esenciales | Modal/drawer de creación de cliente | Alta |
| `crear-cliente/clientes-crm-create-form-desktop.png` | Formulario de alta de cliente full-page | Form con secciones y validación inline | Alternativa si se hace página completa | Media |
| `crear-notificacion-push/ajustes-notifications-push-composer-desktop.png` | Compositor de notificación push | Form de redacción con preview | Fuera de scope para Admin v2 | Baja |
| `cuentas/cuentas-account-balance-summary-desktop.png` | Resumen de balance por cuenta | Desglose de saldo: pagado / pendiente / total | Ficha de cuenta en Caja → Cuentas | Alta |
| `cuentas/cuentas-billing-accounts-table-desktop.png` | Tabla de cuentas con estado OPEN/CLOSED | Tabla con badge de estado y totales | Referencia de tabla — **NO usar para Cuentas operativas** | Baja |
| `cuentas/cuentas-open-tabs-cards-desktop.png` | Cards de cuentas abiertas (POS style) | Cards con cliente, monto, acción [Cobrar] | **Patrón correcto para Caja → Cuentas:** lista enriquecida | Alta |
| `dashboard-home/informes-operations-activity-feed-desktop.png` | Feed de actividad reciente con timestamps | Timeline de eventos ordenados por hora | `MovementsTimeline` + Informes → actividad | Alta |
| `dashboard-home/informes-operations-dashboard-overview-desktop.png` | Dashboard operacional completo | Combinación de KPIs + gráfico + tabla compacta | Modelo para Informes → vista general | Alta |
| `dashboard-home/informes-operations-executive-summary-desktop.png` | Resumen ejecutivo con métricas de alto nivel | Layout limpio con cifras grandes y contexto | Informes → vista ejecutiva / cierre de período | Media |
| `dashboard-home/informes-operations-kpi-cards-desktop.png` | Grid de 4 KPI cards con delta | Cards con icono, valor, etiqueta, porcentaje de cambio | Referencia directa para `MetricCard` | Alta |
| `dashboard-home/informes-operations-metrics-grid-desktop.png` | Grid de métricas con gráficos sparkline | KPI + mini gráfico de tendencia embebido | Informes → KPIs con contexto temporal | Media |
| `dashboard-home/informes-operations-trend-charts-desktop.png` | Gráficos de tendencia con filtros de período | Área/línea con selector de rango | Informes → gráfico de ingresos / ocupación | Alta |
| `detalle-empleado/cuentas-staff-profile-detail-desktop.png` | Ficha de empleado con historial de turnos | Split view: info básica + actividad reciente | Fuera de scope para Admin v2 | Baja |
| `detalle-pagos/caja-payment-detail-breakdown-desktop.png` | Desglose de un pago: conceptos + montos + método | Lista de ítems con subtotales y total | Drawer de pago en Caja | Alta |
| `detalle-pagos/caja-payment-detail-right-panel-desktop.png` | Panel derecho con detalle de pago seleccionado | Slide-in desde la derecha con info completa | `AgendaLikeRightSidebar` para detalle de pago | Alta |
| `detalle-transacciones/caja-transaction-detail-panel-desktop.png` | Panel de detalle de transacción | Datos de transacción + acciones (reimprimir, etc.) | Detalle de movimiento en Caja | Media |
| `detalles-clientes/clientes-crm-customer-profile-desktop.png` | Ficha completa de cliente con tabs internos | Tabs: Info / Reservas / Pagos / Notas | Base para `ClientProfile` → sección de historial | Alta |
| `drawer-reservas-appointments/reservas-appointments-drawer-actions-desktop.png` | Drawer de cita/reserva con acciones disponibles | Botones de acción agrupados en zona inferior del drawer | Patrón de acciones en `BookingDrawerShell` | Alta |
| `drawer-reservas-appointments/reservas-appointments-drawer-detail-desktop.png` | Drawer de detalle de reserva | Estructura: header + info + timeline + acciones | Base para drawer de reserva en agenda | Alta |
| `drawer-reservas-appointments/reservas-appointments-drawer-with-history-desktop.png` | Drawer con historial de interacciones | Historial de cambios de estado dentro del drawer | Historial de una reserva (cambios, pagos) | Alta |
| `ejemplos-calendar-bookings/agenda-bookings-calendar-reference-desktop.png` | Referencia general de calendario de reservas | Vista tipo Google Calendar adaptada a SaaS | Referencia de alto nivel para la agenda | Media |
| `gestion-empleados/cuentas-staff-management-table-desktop.png` | Tabla de gestión de empleados | Tabla con foto, nombre, rol, estado, acciones | Fuera de scope para Admin v2 | Baja |
| `historial-pagos/caja-payment-history-table-desktop.png` | Historial de pagos con filtros temporales | Tabla con filtros de fecha y método | Caja → historial de caja | Alta |
| `hovers-agenda/agenda-calendar-hover-state-highlight-desktop.png` | Estado hover de bloque en agenda (resaltado) | Overlay de color con elevación sutil | Hover state de `AgendaBookingBlock` | Alta |
| `hovers-agenda/agenda-calendar-hover-state-tooltip-desktop.png` | Estado hover con tooltip flotante | Tooltip con info resumida + link a detalle | Hover card compacta sobre bloque de reserva | Alta |
| `informes-y-metricas/informes-analytics-kpis-and-chart-desktop.png` | KPIs + gráfico combinados en una vista | Grid de 3-4 KPIs arriba + gráfico abajo | Informes → layout principal | Alta |
| `informes-y-metricas/informes-analytics-performance-dashboard-desktop.png` | Dashboard de performance con múltiples gráficos | Grid de gráficos con encabezados de sección | Informes → múltiples dimensiones | Media |
| `informes-y-metricas/informes-analytics-revenue-breakdown-desktop.png` | Desglose de ingresos por categoría | Gráfico de barras apiladas + tabla lateral | Informes → ingresos por cancha/servicio | Alta |
| `informes-y-metricas/informes-analytics-summary-kpis-desktop.png` | KPIs de resumen en tarjetas pequeñas | 6-8 KPIs en grid responsive | Informes → fila de KPIs compactos | Alta |
| `mobile/mobile-agenda-list-view.png` | Vista mobile de agenda en formato lista | Lista vertical de reservas por hora | Agenda mobile → vista lista alternativa | Media |
| `mobile/mobile-agenda-week-strip.png` | Strip semanal mobile con días seleccionables | Selector de día horizontal (scroll) | Agenda mobile → navegación de semana | Alta |
| `mobile/mobile-caja-payments-list.png` | Lista de pagos en mobile | Cards apiladas con info de pago | Caja mobile → lista de movimientos | Media |
| `mobile/mobile-calendar-day-cards.png` | Cards de día en mobile con reservas | Grid de cards por período del día | **B2C app pattern — NO aplicar directo al admin** | Revisar |
| `mobile/mobile-clientes-profile-card.png` | Card de perfil de cliente en mobile | Card compacta con foto, nombre, métricas | **Posiblemente B2C — validar antes de usar** | Revisar |
| `mobile/mobile-reservas-list-and-detail.png` | Lista + detalle de reserva en mobile | Split adaptativo: lista full + detalle full (native nav) | Reservas mobile → navegación entre lista y detalle | Media |
| `modales/general-modal-confirmation-dialog-desktop.png` | Modal de confirmación destructiva | Diálogo centrado con título, descripción, 2 botones | Eliminar cliente, cancelar reserva, cerrar turno | Alta |
| `modales/general-modal-form-dialog-desktop.png` | Modal con formulario embebido | Dialog de 480-560px con formulario compacto | Crear/editar cliente, crear movimiento de caja | Alta |
| `navbar-arriba-ejemplo/sidebar-top-navbar-actions-desktop.png` | Navbar superior con acciones + notificaciones | Zona de iconos de acción a la derecha del navbar | Posible toolbar superior del Admin v2 | Media |
| `notificaciones/ajustes-notifications-center-desktop.png` | Centro de notificaciones con listado | Panel de notificaciones agrupadas por tipo | Fuera de scope para Admin v2 | Baja |
| `notificaciones/ajustes-notifications-list-and-status-desktop.png` | Listado de notificaciones con estado leído/no leído | Filas con dot de estado + tiempo relativo | Fuera de scope para Admin v2 | Baja |
| `pagos/caja-payments-invoices-overview-desktop.png` | Vista de facturas/cobros pendientes | Lista de cobros con estado (pagado/pendiente/vencido) | Caja → cobros pendientes del día | Alta |
| `perfil/ajustes-user-profile-settings-desktop.png` | Configuración de perfil de usuario | Avatar + datos personales + opciones de seguridad | Ajustes → perfil del operador | Media |
| `reservas/reservas-bookings-kanban-status-desktop.png` | Kanban de reservas por estado | Columnas: Pendiente / Confirmada / Completada / Cancelada | Posible vista Kanban en /admin/reservas | Media |
| `reservas/reservas-bookings-list-with-tabs-desktop.png` | Lista de reservas con tabs de estado | Tabs: Todas / Hoy / Pendientes + tabla filtrada | Reservas → listado con filtros de estado | Alta |
| `reservas/reservas-bookings-overview-desktop.png` | Vista general de reservas | Combinación de métricas + listado de próximas | Reservas → home de módulo | Media |
| `reservas/reservas-bookings-table-with-filters-desktop.png` | Tabla de reservas con filtros avanzados | Filtros de fecha, cancha, estado, cliente | Base para `AdminDataTable` en Reservas | Alta |
| `reservas/reservas-bookings-timeline-calendar-desktop.png` | Timeline de reservas con vista de calendario | Eje de tiempo + reservas como bloques | Alternativa de vista en /admin/reservas | Media |
| `shift-de-empleados/cuentas-staff-shift-calendar-desktop.png` | Calendario de turnos de empleados | Grid calendario con asignaciones por día | Fuera de scope para Admin v2 | Baja |
| `sidebar/sidebar-collapsed-navigation-icons-desktop.png` | Sidebar colapsado mostrando solo iconos | 64px de ancho con iconos centrados + tooltip al hover | **Estado colapsado del `AdminPlaygroundShell`** | Alta |
| `sidebar/sidebar-expanded-navigation-sections-desktop.png` | Sidebar expandido con secciones y etiquetas | 200px con iconos + labels + sección activa resaltada | **Estado expandido del `AdminPlaygroundShell`** | Alta |
| `tienda/productos/editar-productos/tienda-products-edit-form-desktop.png` | Formulario de edición de producto | Form con imagen, precio, stock, descripción | Tienda → editar producto en drawer | Alta |
| `tienda/productos/tienda-products-table-desktop.png` | Tabla de productos con foto, precio, stock | Tabla con celda de imagen + acciones inline | **Referencia principal para `AdminDataTable`** en Tienda | Alta |
| `waitlist-turnosfijos?/reservas-waitlist-management-table-desktop.png` | Tabla de gestión de lista de espera | Tabla con posición, cliente, turno solicitado | Posible en /admin/reservas → Fijos/Espera | Baja |
| `waitlist-turnosfijos?/reservas-waitlist-priority-queue-desktop.png` | Cola de prioridad para lista de espera | Vista de cola ordenada con acciones | Baja relevancia para v2 inicial | Baja |

---

## 2. Resumen

| Categoría | Total |
|-----------|-------|
| Imágenes analizadas | 73 |
| Imágenes renombradas | 0 (ya estaban nombradas descriptivamente) |
| Valor **Alta** | 40 |
| Valor **Media** | 18 |
| Valor **Baja** | 11 |
| **Revisar manualmente** | 2 (mobile B2C) |

### Referencias de bajo valor para Admin v2

Estas imágenes muestran patrones fuera del scope del administrador operativo de TuCancha:

- `asignaciones-staff/` — gestión de turnos de empleados
- `detalle-empleado/` — ficha de empleado
- `gestion-empleados/` — tabla de personal
- `shift-de-empleados/` — calendario de empleados
- `notificaciones/ajustes-notifications-center-desktop.png` — centro de notificaciones
- `notificaciones/ajustes-notifications-list-and-status-desktop.png`
- `crear-notificacion-push/` — compositor push
- `cuentas/cuentas-billing-accounts-table-desktop.png` — tabla de billing (no aplica al modelo de Caja)
- `waitlist-turnosfijos?/` — waitlist (v2 no incluye este módulo aún)
- `ajustes/ajustes-settings-permissions-matrix-desktop.png` — permisos por rol (futuro)

---

## 3. Lenguaje visual propio de TuCancha Admin v2

### 3.1 Estética base

TuCancha Admin v2 no imita ningún producto referenciado. Toma lo mejor de cada uno y lo simplifica:

| Decisión | Valor |
|----------|-------|
| Fondo de app | `#f5f6f8` |
| Fondo de panel/tarjeta | `#ffffff` |
| Borde de panel | `1px solid #dce2ee` |
| Sin sombras en paneles | `box-shadow: none` |
| Sin gradientes decorativos | — |
| Tipografía | Inter / System UI |
| Peso de texto de valor KPI | `font-weight: 700`, `font-size: 28-32px` |
| Peso de etiqueta | `font-weight: 500`, `font-size: 11px`, `text-transform: uppercase`, `letter-spacing: 0.05em` |
| Color de texto principal | `#1a2035` |
| Color de texto secundario | `#5a6478` |
| Color de texto muted | `#98a1b3` |
| Accent / interactivo | `#3053e2` |
| Accent hover | `#2444c7` |
| Rojo destructivo | `#d93025` |
| Verde positivo | `#1a7a4a` |
| Border radius base | `8px` |
| Densidad | Media (ni ultra-compacto ni espacioso) |

### 3.2 Shell de la aplicación

| Elemento | Especificación |
|----------|---------------|
| Sidebar expandido | 200px, `#ffffff`, borde derecho `#dce2ee` |
| Sidebar colapsado | 64px, solo iconos, tooltip al hover |
| Ítem activo | Fondo `#eef1fd`, texto + icono `#3053e2`, sin indicador de línea lateral |
| Ítem inactivo | Texto `#5a6478`, icono `#98a1b3` |
| Hover de ítem | Fondo `#f5f6f8` |
| Logo/club en top | 48px de altura, nombre del club en texto medium |
| Zona inferior | Avatar del operador + opciones de sesión |
| Mobile | Bottom bar de 5 ítems, iconos + labels, fondo blanco, borde superior `#dce2ee` |

**Referencias:** `sidebar/sidebar-expanded-navigation-sections-desktop.png` + `sidebar/sidebar-collapsed-navigation-icons-desktop.png`

### 3.3 Componentes base

#### MetricCard
- Tarjeta blanca, borde `#dce2ee`, radio `8px`
- Etiqueta: 11px, uppercase, `#98a1b3`
- Valor: 28-32px, bold, `#1a2035`
- Delta opcional: flecha + porcentaje, verde si positivo, rojo si negativo
- Icono opcional: 20px, color accent, zona superior-derecha
- Sin decoración, sin sombra, sin gradiente

**Referencias:** `dashboard-home/informes-operations-kpi-cards-desktop.png` + `caja/caja-payments-kpi-summary-desktop.png`

#### AdminDataTable
- Fondo blanco, header `#f5f6f8`, borde `#dce2ee`
- Celdas: 40-48px de altura, tipografía 13-14px
- Borde entre filas: `1px solid #f0f2f7`
- Columna de acciones: botones `ghost` alineados a la derecha
- Hover de fila: `#f5f6f8`
- Sort activo: icono + accent color

**Referencia principal:** `tienda/productos/tienda-products-table-desktop.png`

#### MovementsTimeline
- Lista vertical de movimientos financieros
- Cada ítem: hora (monospace, muted) + label + monto (bold, color por tipo)
- Positivo: `#1a7a4a`, Negativo: `#d93025`, Neutro: `#1a2035`
- Separador: línea vertical `#dce2ee` entre ícono y content
- Sin bordes de tarjeta por ítem; solo separador horizontal `1px solid #f0f2f7`

**Referencias:** `dashboard-home/informes-operations-activity-feed-desktop.png` + `detalle-pagos/caja-payment-detail-breakdown-desktop.png`

#### Split view (lista + detalle)
- Desktop: `280px` lista izquierda + `flex-1` detalle derecho, sin divisor prominente
- Ítem seleccionado en lista: fondo `#eef1fd`, borde izquierdo `3px solid #3053e2`
- Detalle: header con nombre + acción primaria, cuerpo con secciones
- Mobile: lista full screen → detalle full screen con botón Back

**Referencia:** `clientes/clientes-crm-detail-panel-desktop.png`

#### Drawer (slide-in derecho)
- Ancho: `480px` desktop, `100%` mobile
- Header: título + [X] cerrar a la derecha
- Cuerpo: scroll independiente
- Footer sticky: acciones principales

**Referencia:** `drawer-reservas-appointments/reservas-appointments-drawer-detail-desktop.png`

#### Modal de confirmación
- Centrado, max-width `480px`
- Título (16px bold) + descripción (14px muted) + 2 botones (Cancelar secundario + Confirmar destructivo/primario)
- Sin iconos decorativos en el título

**Referencia:** `modales/general-modal-confirmation-dialog-desktop.png`

### 3.4 Criterios de consistencia

| Cuándo usar... | Patrón |
|----------------|--------|
| Lista de entidades gestionables (clientes, productos, reservas) | `AdminDataTable` con sort + filtros |
| KPIs resumidos en cabecera de sección | `MetricCard` en fila horizontal |
| Actividad financiera cronológica | `MovementsTimeline` |
| Detalle de una entidad con historial | Split view (desktop) / full screen (mobile) |
| Acción contextual sobre una entidad | Drawer slide-in derecho |
| Cuentas abiertas pendientes de cobro (Caja→Cuentas) | Lista enriquecida de cards — **NO tabla** |
| Acción destructiva o confirmación importante | Modal centrado |
| Configuración del sistema con múltiples secciones | Sidebar de secciones + contenido a la derecha |

---

## 4. Referencias por módulo

### Agenda
- **Grid columnar:** `agenda/agenda-calendar-day-columns-desktop.png` (columnas = canchas)
- **Bloques detallados:** `agenda/agenda-calendar-time-blocks-detailed-desktop.png`
- **Hover states:** `hovers-agenda/agenda-calendar-hover-state-tooltip-desktop.png`
- **Drawer de reserva:** `drawer-reservas-appointments/reservas-appointments-drawer-with-history-desktop.png`
- **Síntesis:** Columnas verticales por recurso, bloques de color por estado, hover con `BookingHoverCard`, drawer de 480px con historial

### Clientes
- **Lista filtrable:** `clientes/clientes-crm-list-with-filters-desktop.png`
- **Ficha de cliente:** `detalles-clientes/clientes-crm-customer-profile-desktop.png`
- **Split view:** `clientes/clientes-crm-detail-panel-desktop.png`
- **Síntesis:** Split view 280+flex, buscar por nombre/tel/dni, perfil con tabs (Info / Reservas / Cuenta)

### Caja
- **Dashboard financiero:** `caja/caja-payments-dashboard-desktop.png`
- **KPIs de caja:** `caja/caja-payments-kpi-summary-desktop.png`
- **Movimientos:** `caja/caja-payments-transactions-table-desktop.png`
- **Cuentas abiertas (cards):** `cuentas/cuentas-open-tabs-cards-desktop.png` ← patrón operativo
- **Desglose de pago:** `detalle-pagos/caja-payment-detail-breakdown-desktop.png`
- **Síntesis:** KPIs arriba, timeline de movimientos, Cuentas como cards POS (no tabla), desglose en drawer

### Reservas
- **Tabla con filtros:** `reservas/reservas-bookings-table-with-filters-desktop.png`
- **Tabs de estado:** `reservas/reservas-bookings-list-with-tabs-desktop.png`
- **Síntesis:** `AdminDataTable` con tabs (Hoy / Próximas / Historial) y filtros de estado

### Tienda
- **Tabla de productos:** `tienda/productos/tienda-products-table-desktop.png`
- **Formulario de edición:** `tienda/productos/editar-productos/tienda-products-edit-form-desktop.png`
- **Síntesis:** `AdminDataTable` con celda de imagen, precio, stock; edición en drawer

### Informes
- **KPIs + gráfico:** `informes-y-metricas/informes-analytics-kpis-and-chart-desktop.png`
- **Desglose de ingresos:** `informes-y-metricas/informes-analytics-revenue-breakdown-desktop.png`
- **Tendencias:** `dashboard-home/informes-operations-trend-charts-desktop.png`
- **Síntesis:** Fila de `MetricCard` + gráfico de área/barras + tabla de desglose por categoría

### Ajustes
- **Sidebar de secciones:** `ajustes/ajustes-settings-sidebar-sections-desktop.png` ← patrón ganador
- **Form layout:** `ajustes/ajustes-settings-form-layout-desktop.png`
- **Síntesis:** Sidebar de secciones a la izquierda (Club / Canchas / Integraciones / Cuenta), contenido con formulario a la derecha

---

## 5. Resolución de conflictos entre referencias

| Conflicto | Decisión |
|-----------|----------|
| ¿Tabla o cards para Cuentas abiertas en Caja? | **Cards** — doc maestro v1.1 explícito; la tabla es para gestión/auditoría, no para operación POS en tiempo real |
| ¿Horizontal tabs o sidebar para Ajustes? | **Sidebar de secciones** — más escalable, más claro visualmente, referencia directa en benchmarks |
| ¿Ultra-dense (Linear style) o densidad media para tablas? | **Densidad media** — TuCancha opera en tablet/pantallas medianas; ultra-dense es ilegible sin mouse de precisión |
| ¿Split view en mobile o drawer para clientes? | **Full screen** en mobile (navegación nativa), split solo en desktop ≥ 768px |
| Referencias mobile B2C (apps de reserva para el jugador) | **Ignorar para admin** — son para el jugador, no para el operador de club |
| ¿Sombras en paneles? | **No** — borde plano `#dce2ee`; sombra solo en dropdowns flotantes y tooltips |

