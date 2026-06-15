# Admin UX Migration Plan

## Norte

El admin nuevo toma `playground2` como dirección visual oficial: moderno, denso, claro, vendible por impacto visual y consistente en operación diaria.

El objetivo no es migrar paginas sueltas. El objetivo es que todo el admin se sienta como un solo producto: mismas reglas de navegacion, mismos overlays, mismas jerarquias visuales, mismos estados y buen comportamiento en mobile.

## Alcance inmediato

La prioridad actual es migrar y ordenar el frontend existente. No se agregan features nuevas en esta etapa.

El trabajo inmediato es:
- Consolidar la estetica `playground2`.
- Definir bien que muestra cada pantalla.
- Unificar modales, drawers, tablas, cards, estados y navegacion.
- Asegurar accesibilidad y mobile.
- Llevar las rutas reales del admin hacia la nueva experiencia.

Partidos, ligas, torneos, facturación formal avanzada y gestión profunda de profesores quedan como roadmap futuro.

## Mapa de modulos actuales

### Calendario

Pantalla principal de operación diaria.

Muestra:
- Agenda por dia, cancha y horario.
- Estados de reserva, pagos, bloqueos y recurrencias.
- Acciónes rapidas para crear, mover, confirmar, cancelar y cobrar.

Patron:
- Pagina completa.
- Drawer derecho para crear/ver/editar reserva.
- Modal para confirmaciones destructivas, cobros y resultados.
- En mobile debe tener vista propia por dia/lista/cancha, no una grilla desktop comprimida.

### Reservas

Control y auditoria de reservas, no reemplaza al Calendario.

Muestra:
- Historial de reservas.
- Reservas fijas o recurrentes.
- Canceladas, pendientes, completadas y no-shows.
- Busqueda global por cliente, cancha, fecha o codigo.

Patron:
- Tabla desktop.
- Cards mobile.
- Drawer derecho para detalle.
- Modal para cancelar, eliminar serie o restaurar acciónes sensibles.
- Si una parte de este modulo todavia no existe, debe entrar como estructura visual primero solo cuando reutilice datos existentes.

### Clientes

Directorio operativo y financiero de clientes.

Muestra:
- Directorio.
- Deuda/cuentas.
- Perfil, historial, descuentos y notas.
- Posibles duplicados.

Patron:
- Drawer derecho para crear, editar y ver perfil.
- Modal para eliminar, fusionar duplicados y acciónes irreversibles.
- Mobile con cards compactas: nombre, teléfono, deuda, última reserva y acción primaria.

### Caja

Modulo financiero diario.

Subvistas:
- Resumen.
- Cuentas.
- Movimientos.
- Cierres.
- Devoluciones.

Muestra:
- Caja abierta/cerrada.
- Cobros del dia.
- Cuentas con deuda.
- Movimientos por metodo.
- Cierres y diferencias.
- Devoluciones pendientes y ejecutadas.

Patron:
- Subnav interna.
- Drawer derecho para detalle de cuenta, movimiento o devolucion.
- Modal para registrar cobro, confirmar cierre, aprobar/ejecutar/cancelar devolucion.
- Toast para feedback simple.

### Tienda

Módulo de venta.

Muestra:
- Productos disponibles.
- Carrito.
- Cliente asociado opcional.
- Metodo de pago.
- Cuenta asociada si el consumo se carga a una reserva o cliente.

Patron:
- Vista tipo POS.
- Drawer o panel lateral para carrito en desktop.
- Bottom sheet/carrito fijo en mobile.
- Modal para confirmar pago y resultado.

### Productos

Catalogo e inventario.

Muestra:
- Productos fisicos.
- Precio, stock, categoria, estado, combos.
- Alertas de bajo stock.

Patron:
- Tabla desktop.
- Cards mobile.
- Drawer derecho para crear/editar.
- Modal para eliminar/desactivar.

### Servicios

Oferta configurable no necesariamente inventariable.

Muestra:
- Clases particulares.
- Clases grupales / escuelita.
- Cursos.
- Profesores.
- Packs / abonos.
- Alquileres y extras.

Patron:
- Drawer derecho para crear/editar servicio.
- Modal para desactivar o confirmar cambios sensibles.
- En esta etapa, clases y profesores viven como parte de Servicios si usan capacidades existentes.
- Si Clases crece mucho, puede convertirse despues en modulo propio.

### Canchas

Configuración operativa de espacios.

Muestra:
- Canchas.
- Estado operativo/mantenimiento.
- Deporte.
- Duracion base.
- Precios, reglas y horarios si aplica.

Patron:
- Cards o tabla densa.
- Drawer derecho para editar.
- Modal para suspender/reactivar.

### Informes

Modulo de decision para duenos/admins.

Muestra:
- Ocupacion.
- Ingresos.
- Ventas.
- Clientes.
- Canchas mas usadas.
- Metodos de pago.
- Productos/servicios.

Patron:
- Pagina completa.
- Filtros arriba.
- Graficos y tablas.
- Exportacion futura.

### Mensajes

Comunicacion y automatizaciones.

Muestra:
- Recordatorios.
- Avisos de deuda.
- Confirmaciones.
- Campanas.
- Historial de envios.

Patron:
- Lista + detalle.
- Drawer para crear mensaje/campana.
- Modal para confirmar envio.
- En esta etapa puede quedar preparado como modulo futuro si no hay flujo funcional listo.

### Ajustes

Configuración transversal.

Muestra:
- Datos del club.
- Usuarios y permisos.
- Metodos de pago.
- Politicas de reserva/cancelacion.
- Branding.
- Notificaciones.
- Integraciones.

Patron:
- Pagina completa con secciones.
- Formularios por bloques.
- Modal solo para cambios irreversibles.

## Reglas de interacción

### Drawer derecho

Usar para:
- Crear entidades.
- Editar entidades.
- Ver detalle navegable.
- Flujos medianos o largos.

Ejemplos:
- Reserva.
- Cliente.
- Cuenta.
- Cancha.
- Producto.
- Servicio.

En mobile, el drawer se transforma en bottom sheet o pantalla deslizable.

### Modal

Usar para:
- Confirmaciones.
- Acciónes destructivas.
- Resultados de pago.
- Decisiones cortas que bloquean la operación.

Ejemplos:
- Cancelar reserva.
- Eliminar cliente.
- Cerrar caja.
- Aprobar devolucion.
- Confirmar cobro.

### Toast

Usar para:
- Exito simple.
- Error simple.
- Acción completada sin decision posterior.

No usar toast para información critica que el usuario deba leer antes de continuar.

## Accesibilidad minima

- Todo boton iconico debe tener `aria-label` o `title`.
- Foco visible en inputs, botones, tabs y acciónes.
- Escape cierra modales/drawers cuando no haya cambios sin guardar.
- Modales y drawers deben tener `role="dialog"` y `aria-modal` cuando bloqueen el fondo.
- Estados vacios deben explicar que falta y ofrecer acción primaria.
- En mobile, objetivos tactiles de al menos 40px.
- Contraste consistente en texto secundario, badges y botones.

## Mobile

Reglas:
- No comprimir tablas desktop: convertir a cards.
- No comprimir la grilla del calendario: crear vista mobile especifica.
- Acciónes primarias persistentes abajo cuando el flujo lo necesite.
- Filtros complejos dentro de un boton/filtro desplegable.
- Drawers desktop pasan a bottom sheet o pantalla deslizable.

## Roadmap futuro

Estos modulos quedan fuera de la migracion actual. Conviene pensarlos para evolucionar hacia una plataforma deportiva mas completa, pero no deben bloquear la limpieza del admin.

### Competencias

Incluye:
- Partidos abiertos.
- Ligas.
- Torneos.
- Rankings.
- Fixture y resultados.

### Clases avanzado

Podria separarse de Servicios cuando necesite:
- Agenda propia de clases.
- Profesores con disponibilidad.
- Alumnos.
- Asistencia.
- Comisiones o pagos a profesores.

### Facturación formal

Podria separarse de Caja cuando necesite:
- Facturas legales.
- Numeracion.
- Datos fiscales.
- Exportaciones contables.
- Integracion con proveedor fiscal.

### Comunicacion avanzada

Podria crecer desde Mensajes hacia:
- WhatsApp bidirecciónal.
- Campanas.
- Segmentos de clientes.
- Automatizaciones por deuda, reserva o inactividad.

## Orden de migracion

1. Estabilizar rutas reales del admin moderno:
   - `/admin/agenda`
   - `/admin/clientes`
   - `/admin/caja`
2. Definir componentes base compartidos:
   - `AdminPageHeader`
   - `AdminToolbar`
   - `AdminPanel`
   - `AdminRightSidebar`
   - `AdminModal`
   - `AdminDataTable`
   - `AdminMobileCardList`
   - `AdminEmptyState`
3. Componentizar Calendario.
4. Migrar Canchas, Productos y Servicios a la misma gramatica.
5. Ordenar Reservas, Tienda, Informes y Mensajes solo con funcionalidades existentes o preparadas.
6. Dejar Competencias, Clases avanzado y Facturación formal como roadmap posterior.

## Criterio de listo

Una pantalla esta lista cuando:
- Tiene desktop y mobile definidos.
- Usa drawer/modal/toast segun estas reglas.
- Tiene loading, error y empty state.
- Tiene foco visible y labels accesibles.
- No inventa una gramatica visual distinta.
- Esta conectada desde el sidebar del admin moderno.
