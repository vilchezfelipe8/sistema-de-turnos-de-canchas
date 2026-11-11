# Reservas mobile de Barrio Parque — 30/10/2026

## Alcance y evidencia

Uso principal confirmado: ícono instalado en el celular. Revisión del recorrido de jugador en código y de la ficha pública en producción a 390 × 844 px, sin sesión ni reservas reales. La ficha pública muestra Tenis y Pádel; antes de este cambio, ninguno quedaba seleccionado. El recorrido autenticado de la app instalada requiere validación final en dispositivo.

## Slug y entrada

Se conserva `/club/club-atletico-barrio-parque`. El manifest usa esa ruta como identidad y abre `/club/club-atletico-barrio-parque?app=club`. Cambiar el slug afectaría enlaces compartidos y accesos instalados. Si se quiere una dirección más corta, agregar un alias con redirección, conservando la ruta actual.

La app instalada activa navegación Inicio · Reservar · Mis reservas. En navegador común, la misma ruta muestra la ficha completa del club. `?app=club` por sí solo no activa la experiencia instalada: el código también verifica el modo standalone.

## Ajustes implementados

| Acción | Antes | Ahora |
| --- | --- | --- |
| Entrar a reservar en Barrio Parque | Elegir Tenis o Pádel | Tenis seleccionado si tiene canchas habilitadas; se puede cambiar |
| Abrir enlace con deporte elegido | Selección leída desde URL | Se conserva prioridad del enlace sobre el valor por defecto |
| Nueva reserva desde Mis reservas, en app del club | Buscar entre complejos | Reservar directamente en el club de la app |
| Ver próximas reservas | Fecha más lejana primero | Partido más cercano primero; historial conserva orden descendente |
| Tocar Tu próximo partido | Abrir lista general | Abrir detalle de ese partido |
| Ver mis reservas tras confirmar | Buscar reserva recién creada | Abrir detalle de esa reserva, cuando API devuelve su ID |
| Volver a reservar / Reservar otro | Volver al inicio del club | Abrir sección Reservar |
| Volver desde revisión | Volver al inicio del club | Abrir sección Reservar; todavía no restaura selección anterior |
| Cancelar una reserva | Abrir Canceladas con el turno recién cancelado seleccionado | Volver a Activas sin selección; quitar ID del enlace para que recargar tampoco reabra el turno |

Los enlaces al detalle usan `/bookings?bookingId=…`. Solo seleccionan reservas presentes en la lista autorizada para la sesión; un ID ajeno o inexistente deja la lista normal. Reservas pasadas o canceladas abren su pestaña correspondiente.

## Recorrido del socio

1. Abrir ícono: inicio del club, botón Reservar cancha y próximo partido.
2. Reservar: Tenis ya elegido; elegir día y modalidad Single/Dobles si corresponde. La duración puede depender de modalidad.
3. Elegir horario y cancha; Revisar reserva.
4. Si sesión venció: ingresar con DNI o email y contraseña; el modal permite continuar la selección.
5. Revisar fecha, hora, cancha y precio. Invitaciones son opcionales. Confirmar reserva crea el turno.
6. Ver mis reservas abre el detalle recién creado. Desde inicio, próximo partido abre su propio detalle.
7. Para otro turno: Nueva reserva vuelve al mismo club.

## Próxima iteración, por impacto

| Prioridad | Fricción pendiente | Cambio propuesto |
| --- | --- | --- |
| Alta | Volver desde revisión pierde fecha, horario, cancha y modalidad | Restaurar borrador completo, revalidando disponibilidad; diferenciar Volver de Reservar otro |
| Alta | Invitaciones ocupan espacio antes del botón final | Mantener opción de invitar, plegada inicialmente; mostrar resumen y Confirmar reserva antes |
| Alta | Detalle de Mis reservas queda debajo de toda la lista en mobile | Abrir vista de detalle con Volver a mis reservas; evitar largos saltos de scroll |
| Alta | Varios textos y controles pequeños | Texto principal de 16 px; controles de al menos 48 px; selector accesible con foco y teclado; inputs de 16 px para evitar zoom en iPhone |
| Media | Calendario de app muestra como máximo siete días sin selector para avanzar | Si el club habilita más de siete días, permitir navegar por semanas |
| Media | Inicio dice que no hay partidos mientras carga o si falla la consulta | Distinguir cargando, sin reservas y error con Reintentar |
| Media | Mis reservas e invitaciones abarcan todos los clubes bajo identidad del club instalado | Explicitar alcance y priorizar club actual, sin ocultar compromisos de otros clubes |
| Media | Inicio no actualiza próximo partido al recuperar foco | Refrescar después de cambios externos o de volver a la app |

## Criterios de aceptación en dispositivo

- Sesión vigente y vencida: reservar, ingresar y continuar sin perder selección.
- Tenis preseleccionado con tenis y pádel disponibles; cambio manual a pádel se conserva; enlace `sport=Pádel` tiene prioridad.
- Si tenis no tiene canchas habilitadas, no seleccionar una actividad inexistente.
- Nueva reserva desde lista vacía o con reservas mantiene Barrio Parque en app instalada.
- Próximas reservas ordenadas por cercanía; tocar próximo partido y confirmación abre ID correcto.
- ID inexistente o ajeno no abre datos; partido pasado/cancelado abre pestaña correcta.
- Cancelar turno requiere confirmación y respeta permisos existentes.
- Pantallas de 360/390 px, teclado abierto y texto ampliado: controles visibles y sin superposiciones.

## Validación ejecutada

- TypeScript: `tsc --noEmit --incremental false`, sin errores.
- ESLint sobre los cuatro TSX modificados: sin advertencias ni errores.
- Pruebas existentes de normalización y filtros de deportes: 4/4 aprobadas. No cubren el recorrido autenticado ni los nuevos enlaces al detalle.
- Build de producción Next.js: completado. Advertencias en archivos ajenos al cambio y base Browserslist desactualizada.
- `git diff --check`: sin errores.

## Revisión completa: qué sacar de la vista mobile

Propuesta de simplificación; esta sección no representa cambios implementados. El objetivo es reducir decisiones y desplazamiento para socios que entran desde el ícono instalado. Revisión del código actual, sin medición de rendimiento en dispositivo.

### Diferenciar ficha pública y app instalada

La app instalada ya excluye banner grande, presentación pública, reseñas, redes, favoritos, migas de navegación y footer. En navegador común siguen presentes. No corresponden como nuevos recortes de la app instalada.

Para la ficha pública mobile: cabecera compacta con logo y nombre; reserva antes de información institucional; dirección, contacto y redes en Información del club; reseñas después del flujo principal; instalación como acción secundaria identificable. Mantener enlaces legales accesibles.

### Recortes de la app instalada

| Zona | Elemento actual | Propuesta | Condición o cuidado |
| --- | --- | --- | --- |
| Cabecera | Cambio de tema siempre visible | Mover a Mi perfil/preferencias | Conservar preferencia elegida |
| Cabecera | Contador de reservas o invitaciones en avatar, además de accesos inferiores | Cuenta sin contadores; invitaciones en Mis reservas | Evitar números que parezcan avisos sin leer |
| Inicio | Bienvenida grande; nombre del club ya aparece arriba | Saludo breve; reservar y próximo partido arriba | Mantener identidad del club reconocible |
| Inicio | Dirección y teléfono como tarjeta permanente | Agrupar bajo Información del club | Mantener Llamar al club fácil de encontrar |
| Inicio/reserva | Horarios de socios y público repetidos | Mensaje contextual único cuando afecta al usuario | Si puede reservar, evitar explicación extensa; si está bloqueado, mostrar hora y acción claras |
| Reserva | Selector de deporte completo | Tenis · Cambiar en una línea compacta | Pádel debe seguir accesible; con un solo deporte habilitado no hace falta selector |
| Reserva | Duración como campo separado, incluso fija | Incluir duración en opción de modalidad | Si duración se puede elegir independientemente, conservar control |
| Reserva | Modalidad en desplegable | Opciones visibles de Single/Dobles cuando sean pocas | Mostrar duración y cantidad de jugadores junto a cada opción; no sumar un nuevo paso |
| Reserva | Texto genérico Elegí deporte, día y horario y separadores amplios | Encabezado breve; priorizar días, modalidad y horarios | Recortar márgenes y bloques, conservando texto y controles grandes |
| Revisión | Lista completa de invitados y lugares vacíos antes del botón final | Invitar jugadores (opcional), plegado | Conservar invitación antes de confirmar para quien la necesite |
| Revisión | Desglose de cada lugar y explicaciones extensas | Tu parte + total + Ver detalle | Precio por persona, total y condiciones siguen explícitos; no ocultar diferencias por socio ni recargos |
| Ingreso durante reserva | Enlace de acceso y registro compiten con DNI/contraseña | Acceso principal + primera vez + recuperación; otras opciones plegadas | No eliminar recuperación o activación; siguen siendo esenciales |
| Mis reservas | Nueva reserva arriba y Reservar en barra inferior | Mantener acción inferior; acción extra solo en lista vacía | Aplicar únicamente cuando barra inferior está presente |
| Mis reservas | Pestañas de historial/canceladas compiten con próximas | Próximas al entrar; historial como acceso secundario | Historial y canceladas continúan consultables |
| Detalle de reserva | Club, rol y código ocupan filas completas | Fecha/hora/cancha/precio primero; Más información para datos secundarios | Indicar claramente si es invitado; código accesible para consulta al club |
| Detalle de reserva | Lista completa permanece encima del detalle | Mostrar lista o detalle con Volver a mis reservas | Conservar posición al regresar |

### Pantalla principal de reserva propuesta

1. Identidad compacta del club y cuenta.
2. Tenis · Cambiar.
3. Día: Hoy, Mañana y demás fechas habilitadas.
4. Modalidad con duración incluida, cuando corresponda.
5. Horarios disponibles.
6. Canchas del horario elegido.
7. Resumen de selección y precio + Revisar reserva. Evaluar posición fija encima de navegación, sin tapar contenido ni teclado.

Confirmación: fecha, hora, cancha, modalidad, tu parte/total y condición de pago; Confirmar reserva visible sin recorrer lugares vacíos. Invitaciones y detalle de cobro se expanden a pedido.

Mantener Inicio · Reservar · Mis reservas, próximo partido, horarios, selección de cancha, precio antes de confirmar, reglas de apertura relevantes, activación/recuperación y confirmación de cancelación.

### Carga que también se puede sacar

- Los efectos de la página del club consultan resumen/listado de reseñas, elegibilidad, reseña propia y favoritos aunque el retorno visual sea el de app instalada. Montar esa lógica solo con la ficha pública que la usa.
- Inicio, cabecera y página del club solicitan reservas por separado; inicio, cabecera y barra inferior solicitan invitaciones. Compartir o deduplicar datos para reducir trabajo repetido.
- Página y grilla vuelven a obtener datos del mismo club. Reutilizar configuración ya cargada.

### Orden sugerido

1. Compactar deporte y quitar duración redundante: menos bloques antes de horarios.
2. Plegar invitados y detalle de cobro: acercar confirmación.
3. Simplificar detalle/lista de reservas y acciones repetidas.
4. Mover preferencias/contacto secundario y quitar consultas invisibles.

Cambios de esta propuesta pendientes. Ajustes implementados en secciones anteriores siguen locales, sin despliegue ni modificación del manifest o del slug.
