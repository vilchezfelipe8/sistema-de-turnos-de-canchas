# Backlog Maestro — Pique
**Última actualización:** 2026-05-13  
**Generado por:** auditoría grep real del repo + análisis de contexto histórico  
**Convención:** no se modificó código. Solo lectura y documentación.

---

## Resumen ejecutivo

Pique es un SaaS multi-club para gestión de canchas/clubs deportivos. El backend corre Express + Prisma + PostgreSQL con 42 modelos, 34 migraciones y arquitectura de tres procesos separables (`api` / `worker` / `scheduler`). El frontend corre Next.js Pages Router. El sistema está en producción y operativo.

**Lo que está cerrado y sólido:**
- Auth cookie-first con `AUTH_ALLOW_BEARER_LEGACY=false` como default.
- Rate limiting en auth, bookings y pagos (implementado y aplicado).
- AppError completo en la capa financiera (Caja, Cuentas, Pagos, Devoluciones, POS).
- ErrorCodes catálogo canónico (37 códigos).
- Frontend parser de errores (`apiError.ts`) lee `code`, `meta`, `fieldErrors`.
- `bookingErrorMap.ts` mapea 14 códigos de error de reserva a comportamiento UI.
- POS venta mostrador funcional (P2-A cerrado: clientId en Account).
- Roles tenant OWNER/ADMIN/STAFF con enforcement en backend.
- Módulos deshabilitados en sidebar con bloqueo por URL.
- Duplicados de clientes con decisión humana (no automática).
- Titular canónico, cambio de titular bloqueado por pagos.

**Lo que está parcial o pendiente:**
- `createBookingAppError` en BookingController tiene string matching residual.
- `ClubAdminRoutes.ts` expone `error.message` directo en 6 endpoints (activities/exceptions).
- `ActivityScheduleHelper.ts` tiene 8 `throw new Error` que debería ser validationError AppError.
- `getUserClubContext.ts`, repositorios y utilidades lanzan `throw new Error` genérico que llega a controllers sin tipo.
- `AuthController` usa 25 llamadas inline `res.status().json()` sin AppError.
- Frontend consume `code` y `meta` pero `fieldErrors` casi no se usa todavía (backend no los manda sistemáticamente).
- POS: anulación de venta (P2-B), servicios (P2-C), reportes POS (P2-D) pendientes.
- `cuentas.tsx` (1015 líneas) no migrada al nuevo shell.
- Agenda Phase 3 (hook extraction) no iniciada.
- Sin gestión de staff desde UI.
- Sin reportes de negocio.
- Sin flujo de jugador completo.
- Sin integraciones de pago online.
- Rebranding no iniciado.

---

## Items cerrados recientemente (no repetir)

| Cerrado | Descripción |
|---------|-------------|
| ApiError legacy eliminado | `utils/apiError.ts` backend eliminado; `sendApiError` / `createBookingApiError` old removidos. |
| controllerError500 eliminado | Todos los controllers financieros. |
| buildDomainError eliminado | PaymentService. |
| AppError financiero completo | CashShift, Account, Payment, Refund, Cash, CashRegister — todos usando sendAppError. |
| Tests AppError | `appError.test.ts`, `appError.financial.test.ts` completos. |
| Rate limiting auth/booking/payment | loginLimiter, registerLimiter, magicLinkRequestLimiter, sessionRefreshLimiter, paymentLimiter, bookingLimiter — aplicados en rutas correspondientes. ✅ |
| Cookie auth | AUTH_COOKIE_DOMAIN/SECURE/SAMESITE configurables. AUTH_ALLOW_BEARER_LEGACY=false por default. ✅ |
| Frontend apiError.ts | ApiRequestError + parseApiErrorPayload + meta + code + fieldErrors listos en frontend. ✅ |
| bookingErrorMap.ts | 14 códigos mapeados. resolveBookingErrorBehavior funciona. ✅ |
| P2-A | clientId en Account migrado. |
| Roles OWNER/ADMIN/STAFF | requireTenantRole aplicado. |
| Módulos disabled | Sidebar + bloqueo URL. |
| Duplicados decisión humana | ClientDuplicateIncidentService completo. |
| Titular canónico | Cambio de titular con guards. |

---

## Backlog por categoría

---

### A. Backend / AppError / API contracts

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| A-1 | Eliminar string matching en createBookingAppError | `BookingController.ts` L38-97 tiene `message.includes('pasado')` y `normalizedMessage.includes('duracion no permitida')` etc. Frágil si cambia el texto en BookingService. BookingService ya usa factories en el 90% de los paths — terminar la migración para que el mapper solo haga `if (error instanceof AppError) return error; return badRequest(fallback)`. | Parcial | Técnico | P1 | — | `controllers/BookingController.ts` L38-97 | createBookingAppError sin string matching. Solo pasa instanceof. |
| A-2 | Migrar ClubAdminRoutes.ts a AppError | 6 endpoints de activities/exceptions usan `res.status(400/500).json({ error: error.message })` exponiendo mensajes internos. Migrar a sendAppError. | No iniciado | Datos | P1 | — | `routes/ClubAdminRoutes.ts` L131,152,205,248,310,344 | 0 usos de `error.message` en respuestas JSON. |
| A-3 | Migrar ActivityScheduleHelper a AppError | 8 `throw new Error` para validaciones de schedule. Propagan sin tipo a controllers. Migrar a `badRequest(..., INVALID_INPUT)` o `validationError`. | No iniciado | Técnico | P2 | — | `utils/ActivityScheduleHelper.ts` | 8 throws → factories AppError. Tests para cada caso. |
| A-4 | Migrar getUserClubContext a AppError | 3 `throw new Error` (`userId inválido`, `Debe seleccionar un club activo`, `No se pudo resolver el club`) propagan sin tipo. Migrar a AppError. | No iniciado | Técnico | P2 | — | `utils/getUserClubContext.ts` | 3 throws → AppError. |
| A-5 | Migrar repositorios a AppError | ClubRepository (L35, L50) y BookingRepository (L15) lanzan `throw new Error`. | No iniciado | Técnico | P2 | — | `repositories/ClubRepository.ts`, `repositories/BookingRepository.ts` | throws → AppError. |
| A-6 | Migrar AuthController a AppError | 25 `res.status().json()` inline sin error codes tipados. Frontend no puede distinguir credenciales inválidas de cuenta bloqueada. Migrar a sendAppError + factories. | No iniciado | Seguridad/UX | P1 | — | `controllers/AuthController.ts` | 0 inline json errors. Todos los catch → sendAppError. Error codes específicos en auth. |
| A-7 | Migrar CourtController catch blocks | 4 catch blocks con `res.status(400).json()` en vez de sendAppError. | No iniciado | Técnico | P2 | — | `controllers/CourtController.ts` L115,160,192 | catch → sendAppError. |
| A-8 | Migrar ClientRoutes handler a AppError | Handler inline con `getErrorMessage()` local. No usa AppError ni sendAppError. | No iniciado | Técnico | P2 | — | `routes/ClientRoutes.ts` | sendAppError reemplaza handler. |
| A-9 | fieldErrors sistemáticos en validaciones | El backend casi nunca envía `fieldErrors` aunque el frontend tiene toda la infraestructura lista para consumirlos. Agregar fieldErrors en: AuthController (email, phone, password), ClubController (settings forms), BookingController (date, time, court). | No iniciado | UX | P2 | A-6, A-7 | varios controllers | fieldErrors presentes en respuestas de validación de forms. Frontend los muestra por campo. |
| A-10 | Documentar catálogo de error codes por endpoint | No existe documentación de qué codes puede devolver cada endpoint. El frontend tiene que inferirlos del código. | No iniciado | Operativo | P3 | A-1 a A-9 | nuevo `docs/error-codes.md` | Documento completo con endpoint → [codes posibles]. |
| A-11 | Tests AppError para dominio Reservas | `appError.booking.test.ts` existe en el repo pero no fue llenado. Necesita cubrir: BOOKING_OVERLAP, CLIENT_POSSIBLE_DUPLICATE, BOOKING_SLOT_UNAVAILABLE, ACTIVITY_OUT_OF_CLUB, CLUB_CONFIG_INVALID, BOOKING_INVALID_STATUS, BOOKING_NOT_FOUND. | No iniciado | Técnico | P1 | — | `tests/appError.booking.test.ts` | ≥12 tests cubriendo todos los codes de dominio reservas. |
| A-12 | Tests AppError para Auth | FORBIDDEN, AUTH_MISSING, AUTH_INVALID, AUTH_EXPIRED, CLUB_NOT_FOUND. | No iniciado | Técnico | P2 | A-6 | `tests/appError.auth.test.ts` | ≥5 tests. |
| A-13 | Deduplicar helper getErrorMessage | Existe en `controllers/BookingController.ts` L15 y `routes/ClientRoutes.ts` L9. Misma firma, duplicado. Centralizar en `utils/` o eliminar. | No iniciado | Técnico | P3 | A-1, A-8 | ambos archivos | 1 sola fuente o eliminado donde ya no se usa. |
| A-14 | Eliminar sendControllerAppError redundante | BookingController L33 define wrapper thin sobre sendAppError. Sin valor. Eliminar, reemplazar usos por sendAppError directo. | No iniciado | Técnico | P3 | — | `controllers/BookingController.ts` L33 | Eliminado. |
| A-15 | Verificar y registrar DiscountRoutes + ProductRoutes | No existen `DiscountRoutes.ts` ni `ProductRoutes.ts` como archivos separados. DiscountController y ProductController están implementados. Confirmar si están registrados en ClubAdminRoutes.ts o index.ts. Si no están registrados: **las funcionalidades están silenciosamente rotas**. | **URGENTE** | **Datos** | **P0** | — | `src/index.ts`, `routes/ClubAdminRoutes.ts` | Rutas confirmadas funcionales en dev. Test de smoke. |

---

### B. Reservas / Agenda / Fixed Booking

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| B-1 | Fixed booking hardening | Auditar el flujo completo de reservas recurrentes/fijas: cancelación de serie, edición de ocurrencia, edición de serie completa, rollback si falla creación parcial. | No iniciado | Datos | P1 | — | `services/BookingService.ts` L4400-5100, `repositories/BookingRepository.ts` | Flujos documentados y testeados. Rollback funcional. |
| B-2 | Duplicados en reservas recurrentes/fijas | El sistema detecta CLIENT_POSSIBLE_DUPLICATE al crear reserva simple. ¿Se detecta al crear serie recurrente? ¿Qué pasa si hay duplicado en la mitad de la serie? | No iniciado | Datos | P2 | B-1 | `services/BookingService.ts` L4467+ | Comportamiento documentado y testeado. |
| B-3 | Cancelación de serie recurrente con cobros | Si una reserva de serie tiene pagos, ¿qué pasa al cancelar toda la serie? ¿Se requiere devolución por cada ocurrencia? | No iniciado | Caja/dinero | P1 | B-1 | `services/BookingService.ts`, `services/RefundService.ts` | Política definida. Casos de prueba escritos. |
| B-4 | bookingLimiter en cancelación/reschedule | El `bookingLimiter` solo se aplica a POST `/` (crear) y POST `/quote`. No se aplica a cancelación, reschedule ni confirmación. Bots podrían cancelar reservas masivamente. | No iniciado | Seguridad | P2 | — | `routes/BookingRoutes.ts` | bookingLimiter aplicado a cancel + reschedule. |
| B-5 | Agenda — performance con muchas canchas | agenda-playground2 carga todos los slots de todas las canchas para el día. Auditar si hay paginación o lazy load. En clubs grandes con 10+ canchas esto puede ser lento. | No iniciado | UX/Técnico | P2 | — | `pages/admin/agenda-playground2.tsx` | Análisis de performance documentado. Lazy load si necesario. |
| B-6 | Agenda mobile | La agenda usa una grilla de canchas horizontales. No está optimizada para mobile. | No iniciado | UX | P3 | — | `pages/admin/agenda-playground2.tsx` | Vista mobile funcional (responsive o alternativa). |
| B-7 | Phase 3 agenda: hook extraction | Extraer `useAgendaSchedule`, `useAgendaDragAndDrop`, `useBookingDrawerController` del monolito de 12.800+ líneas. | No iniciado | Técnico | P3 | — | `pages/admin/agenda-playground2.tsx` | 3 hooks extraídos. Archivo < 8000 líneas. |
| B-8 | bookingLimiter en CashRoutes/AccountRoutes | Los endpoints de POS y Account no tienen rate limiting para creación masiva. Considerar aplicar. | No iniciado | Seguridad | P3 | — | `routes/CashRoutes.ts`, `routes/AccountRoutes.ts` | Rate limits aplicados. |
| B-9 | Tests de invariantes de integridad | Los 4 `throw new Error` de invariantes en BookingService (L3049, L3483, L3945, L5499) + 1 en BookingDomainService no tienen test. Agregar tests que verifiquen que el catch los convierte en UNEXPECTED_ERROR 500. | No iniciado | Técnico | P2 | — | `tests/bookingAccountInvariants.test.ts` | Test para cada invariante. |
| B-10 | Checkout público — reserva sin cuenta admin | El flujo de jugador que reserva desde la app pública. ¿Está completo? ¿Qué pasa con el pago? | No iniciado | Comercial | P2 | D-1 | `routes/BookingRoutes.ts`, frontend | Flujo documentado. Jugador puede crear reserva y ver estado. |

---

### C. Clientes / Identidad

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| C-1 | Merge manual de clientes duplicados | `ClientDuplicateIncidentService` registra el incidente pero no tiene endpoint de resolución / merge. Un admin debería poder marcar "estos dos son el mismo" y fusionar sus reservas/cuentas. | No iniciado | Datos | P2 | — | `services/ClientDuplicateIncidentService.ts`, nuevo endpoint | Endpoint de merge. UI en panel de incidentes. |
| C-2 | Linking manual Client ↔ User | No hay UI para que un admin vincule manualmente un Client con un User (cuando el jugador crea cuenta). La política de no-linking automático es correcta pero falta la acción manual. | No iniciado | Datos | P2 | — | `services/UserClientLinkAudit.ts`, nuevo endpoint | Endpoint + UI de linking manual. |
| C-3 | Historial completo por cliente | No hay vista de "todo lo de este cliente": todas sus reservas pasadas, todas sus cuentas, todos sus pagos, todos sus consumos en caja. | No iniciado | UX | P2 | — | `pages/admin/clientes-playground2.tsx`, AccountDrawer | Vista de historial completo en perfil de cliente. |
| C-4 | Cliente asociado a venta POS sin cuenta | En venta de mostrador se crea una Account con clientId. Pero si no se selecciona cliente, ¿queda sin clientId? Auditar flujo de "venta sin cliente". | No iniciado | Datos | P2 | — | `services/CashService.ts` | Política clara: venta sin cliente permitida o no. Documentada. |
| C-5 | Auditoría de linking | `UserClientLinkAudit.ts` existe como servicio pero no hay evidencia de ruta ni controller. Verificar si se ejecuta en algún job o si es dead code. | No iniciado | Técnico | P2 | — | `services/UserClientLinkAudit.ts` | Estado: usado o eliminado. |
| C-6 | Validación de teléfono — edge cases internacionales | La normalización de teléfono existe. Auditar edge cases: números sin código de país, extensiones, formatos alternativos. | No iniciado | Datos | P3 | — | `utils/phone.ts`, `tests/phoneNormalization.test.ts` | Tests de edge cases pasando. |
| C-7 | Panel de incidentes de duplicados | `AdminDuplicateIncidents.tsx` existe. Auditar si está conectado a datos reales y tiene acciones (descartar incidente, iniciar merge). | No iniciado | UX | P2 | C-1 | `components/admin/AdminDuplicateIncidents.tsx` | Panel funcional con acciones. |

---

### D. Participantes / Jugador (app pública)

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| D-1 | Mis reservas (jugador) | El jugador autenticado puede ver todas sus reservas: próximas, pasadas, canceladas. Estado de pago. | No iniciado | Comercial | P2 | — | nuevo `pages/mis-reservas.tsx` | Vista funcional. Reservas por estado. |
| D-2 | Participante puede ver reserva | Si soy participante (no titular) puedo ver la reserva pero no puedo modificarla ni pagarla. | No iniciado | Comercial | P2 | — | frontend público | Vista de reserva solo lectura para participante. |
| D-3 | Cancelación por jugador con reglas | Jugador puede cancelar su reserva hasta X horas antes. Regla configurable por club. Backend tiene autoCancelPendingBookings. Falta la cancelación voluntaria del jugador. | No iniciado | Comercial/Caja | P2 | — | `services/BookingService.ts`, frontend | Endpoint de cancelación jugador + UI + regla de tiempo. |
| D-4 | Pago online por jugador | Jugador puede pagar su reserva online (Mercado Pago / Stripe). Requiere integración de pago. Ver sección M. | No iniciado | Comercial | P2 | M-1 | frontend, `services/PaymentService.ts` | Jugador puede pagar desde app. |
| D-5 | Perfil de jugador | Editar nombre, teléfono, email desde la app pública. Foto de perfil. | No iniciado | UX | P3 | — | frontend | Perfil editable. |
| D-6 | Favoritos de club | `ClubFavoriteService.ts` y `ClubFavorite` model existen. Auditar si hay UI y si el endpoint funciona. | No iniciado | UX | P3 | — | `services/ClubFavoriteService.ts`, frontend | Jugador puede marcar/desmarcar favorito. |
| D-7 | Errores públicos amigables | El flujo público (checkout, reserva, pago) puede recibir AppErrors del backend. ¿Se muestran bien en el frontend público o se muestran como JSON crudo? | No iniciado | UX | P2 | — | frontend público | Errores del backend se muestran en lenguaje usuario. |

---

### E. Caja / Cuentas / Pagos / POS

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| E-1 | P2-B: Anular venta mostrador | Anular venta POS sin pagos: revertir stock, cerrar/anular cuenta, UI con confirmación. **En progreso.** | In progress | Caja/dinero | P1 | — | `services/CashService.ts`, `controllers/CashController.ts`, UI | Stock revertido. Cuenta anulada. UI confirma. |
| E-2 | P2-C: Servicios en venta mostrador | Agregar ClubServiceCatalog items al drawer POS. | No iniciado | Comercial | P1 | E-1 | `services/CashService.ts`, UI | Servicios aparecen y se pueden vender. |
| E-3 | P2-D: Tab Reportes POS en Caja | Vista de ventas de mostrador del turno. Total por turno, por producto. | No iniciado | Comercial | P2 | E-1, E-2 | `pages/admin/pagos-playground.tsx` | Tab Reportes POS funcional. |
| E-4 | Split multi-método real | Hoy un pago es de un solo método. El flujo de preconfirmación visual ya tiene checkboxes de concepto. Implementar split real: pago mixto efectivo + transferencia, etc. | No iniciado | Caja/dinero | P2 | — | `services/PaymentService.ts`, UI | Pago registrado con dos métodos. Allocations correctas. |
| E-5 | Ticket/impresión de venta POS | Jugador o cliente quiere recibo de su venta de mostrador. PDF o vista imprimible. | No iniciado | Comercial | P3 | E-1, E-2 | nuevo componente | Vista imprimible de ticket. |
| E-6 | Combos en POS | Combo = producto que descuenta stock de sus componentes. `ProductComponent` model existe. ¿Está implementado en CashService? | No iniciado | Comercial | P3 | — | `services/CashService.ts`, `services/ProductService.ts` | Venta de combo descuenta componentes. |
| E-7 | AccountDrawer — mejoras pendientes | Auditar si AccountDrawer tiene empty states, loading states correctos, y si muestra bien las devoluciones en el historial de pagos. | No iniciado | UX | P2 | — | `components/admin/agenda/AccountDrawer.tsx` (o equivalente) | Drawer con empty/loading/refunds bien mostrados. |
| E-8 | Cuentas BAR — cuentas abiertas sin cerrar | No hay alerta o reporte de cuentas BAR (tipo BOOKING) que llevan mucho tiempo abiertas sin cobrar. | No iniciado | Caja/dinero | P2 | — | `services/AccountService.ts`, nuevo endpoint | Reporte de cuentas abiertas > X días. |
| E-9 | Cierre de caja — vista de resumen | Al cerrar turno de caja, mostrar: efectivo esperado, movimientos del turno, diferencia. | No iniciado | Caja/dinero | P2 | — | `services/CashShiftService.ts`, UI | Vista de cierre completa. |
| E-10 | Cash movements — UI completa | `CashMovement` model existe (ingresos/egresos de caja). ¿Hay UI para registrar movimientos manuales (ej: retiro de efectivo)? Auditar. | No iniciado | Caja/dinero | P2 | — | UI | UI para agregar movimiento manual. |
| E-11 | Sobrepago — manejo claro | El código maneja PAYMENT_OVERPAY. ¿El frontend muestra claramente cuánto se excede? ¿Hay opción de sobrepago voluntario (propina)? | No iniciado | UX/Caja | P3 | — | UI | Manejo claro de sobrepago en UI. |
| E-12 | cuentas.tsx — migrar a AdminRouteShell | 1015 líneas, auth-check manual, localStorage directo, 34 useState inline. | No iniciado | Técnico | P1 | — | `pages/admin/cuentas.tsx` | Usa AdminRouteShell + useActiveClub. |
| E-13 | cuentas.tsx — mover como tab en Caja | Post E-12. Redirect `/admin/cuentas` → `/admin/caja?tab=cuentas`. | No iniciado | UX | P2 | E-12 | `pages/admin/cuentas.tsx`, `pages/admin/pagos-playground.tsx` | Tab en Caja. Redirect activo. |

---

### F. Productos / Servicios / Inventario

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| F-1 | Stock bajo — alertas | No hay notificación o indicador cuando el stock de un producto baja de cierto umbral. | No iniciado | Operativo | P2 | — | `services/ProductService.ts`, UI | Indicador visual de stock bajo. Umbral configurable. |
| F-2 | Historial de movimientos de stock | No hay log de quién vendió qué y cuándo para cada producto. | No iniciado | Operativo/Legal | P2 | — | nuevo modelo o tabla de log | Historial visible en panel de producto. |
| F-3 | Auditoría de stock — consistencia | Verificar que el stock del producto en DB es consistente con la suma de ventas. Script de auditoría. | No iniciado | Datos | P2 | — | `services/ProductService.ts` | Script de auditoría ejecutable. |
| F-4 | Combos — descuento de componentes | `ProductComponent` model existe. Verificar si la venta de un combo descuenta el stock de cada componente correctamente. Si no: implementar. | No iniciado | Datos | P2 | E-6 | `services/CashService.ts` | Test de combo: stock de componentes decrece. |
| F-5 | Descuentos — auditar rutas registradas | DiscountController + DiscountService implementados. No existe DiscountRoutes.ts como archivo separado. Verificar si las rutas están registradas en ClubAdminRoutes o index.ts. | **URGENTE** | Datos | **P0** | A-15 | `routes/ClubAdminRoutes.ts`, `src/index.ts` | Endpoints de descuento funcionales. |
| F-6 | Descuentos — UI panel admin | `DiscountPolicyDrawer` fue extraído. Auditar si el flujo completo de crear/editar/asignar descuento funciona en UI. | No iniciado | UX | P2 | F-5 | `components/admin/` | CRUD de descuentos funcional en UI. |
| F-7 | Servicios sueltos (ClubServiceCatalog) | Servicios que no son productos físicos (ej: clase de padel 1h). `ClubServiceCatalogService.ts` existe. Auditar endpoint y UI. | No iniciado | Comercial | P2 | — | `services/ClubServiceCatalogService.ts` | Servicios se pueden crear, listar y vender desde POS. |
| F-8 | Tab Inventario en Tienda | El tab de Inventario probablemente muestra AdminComingSoonPanel. Implementar vista de stock actual por producto. | No iniciado | Operativo | P2 | F-1, F-2 | `pages/admin/tienda.tsx` | Tab Inventario con tabla de stock real. |
| F-9 | Precios variables por horario | `CourtPriceRule` existe (precio por franja horaria en cancha). ¿Hay modelo equivalente para productos/servicios con precios distintos según día/hora? | No iniciado | Comercial | P3 | — | `services/PricingService.ts` | Precios variables en servicios. |

---

### G. Reportes

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| G-1 | Ingresos por rango de fechas | Total cobrado en un período: por método de pago, por tipo de cuenta (BOOKING vs CASH). | No iniciado | Comercial | P2 | — | `services/MetricsService.ts` | Endpoint + UI con filtro de fecha. |
| G-2 | Ocupación de canchas | % de horarios ocupados vs disponibles por cancha y por período. | No iniciado | Comercial | P3 | — | `services/MetricsService.ts`, BookingRepository | Vista de ocupación por cancha. |
| G-3 | Reservas por estado | Cuántas PENDING, CONFIRMED, COMPLETED, CANCELLED en un período. | No iniciado | Operativo | P2 | — | `services/MetricsService.ts` | Tabla con estados y counts. |
| G-4 | Cuentas pendientes de cobro | Lista de cuentas OPEN con saldo > 0, ordenadas por antigüedad. | No iniciado | Caja/dinero | P2 | — | `services/AccountService.ts` | Vista de deuda total y por cliente. |
| G-5 | Ventas POS por turno | Todas las ventas de mostrador del turno actual (o histórico). Total, por producto. | No iniciado | Caja/dinero | P1 | E-3 | `services/CashService.ts`, `services/CashShiftService.ts` | Vista en tab Reportes POS. |
| G-6 | Ventas POS por producto | Cuántas unidades de cada producto se vendieron en un período. | No iniciado | Operativo | P3 | G-5 | `services/CashService.ts` | Tabla de ventas por producto. |
| G-7 | Devoluciones — reporte | Total devuelto, devoluciones por estado (PENDING/APPROVED/EXECUTED/FAILED), por período. | No iniciado | Caja/dinero | P2 | — | `services/RefundService.ts` | Vista de devoluciones con filtros. |
| G-8 | Exportación de datos | Exportar a CSV los reportes de ingresos, reservas, stock. | No iniciado | Operativo | P3 | G-1 a G-7 | nuevo endpoint | Botón "Exportar CSV" en cada reporte. |
| G-9 | AdminTabStatistics — implementar | El componente existe pero probablemente tiene AdminComingSoonPanel o datos vacíos. | No iniciado | UX | P2 | G-1, G-3, G-4 | `components/admin/AdminTabStatistics.tsx` | KPIs de negocio visibles. |
| G-10 | Proyecciones de lectura — auditar | AccountSummaryProjection, CashShiftSummaryProjection, DailyCashSummaryProjection + ProjectionService. Verificar que estén actualizadas y el frontend las consuma. | No iniciado | Datos | P2 | — | `services/ProjectionService.ts` | Proyecciones actualizadas y usadas. |

---

### H. UX / Feedback / Confirmaciones

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| H-1 | Frontend: consumir fieldErrors del backend | La infraestructura está lista (apiError.ts). El backend casi nunca envía fieldErrors. Cuando se implemente A-9, asegurar que el frontend muestra el error por campo correcto. | No iniciado | UX | P2 | A-9 | varios componentes de forms | Forms muestran error debajo del campo correspondiente. |
| H-2 | Frontend: consumir meta en todos los errores | `meta` está disponible en AppError y apiError.ts lo lee. Auditar dónde se usa y dónde falta. CLIENT_POSSIBLE_DUPLICATE usa meta (candidateClientIds). ACCOUNT_HAS_PENDING_BALANCE usa meta (remaining). | Parcial | UX | P2 | — | varios | Todos los errores con meta los muestran en UI. |
| H-3 | Empty states sistemáticos | Auditar todos los listados sin datos (productos, servicios, clientes, reservas, pagos). Algunos probablemente no tienen empty state o tienen uno genérico. | No iniciado | UX | P3 | — | todos los componentes de lista | Cada lista tiene empty state específico. |
| H-4 | Loading states sistemáticos | Auditar skeletons/spinners en todos los drawers y listas. Consistencia. | No iniciado | UX | P3 | — | todos los drawers/listas | Loading state en cada drawer y lista. |
| H-5 | Protección doble submit | Auditar todos los forms que hacen POST. ¿Deshabilitan el botón durante el submit? | No iniciado | UX | P2 | — | todos los forms | Botón submit deshabilitado durante request. |
| H-6 | Confirmaciones destructivas faltantes | Auditar: cancelar reserva (con cobros), anular cuenta, eliminar producto con stock. ¿Siempre piden confirmación? | No iniciado | UX | P1 | — | varios | Confirmación modal para acciones destructivas con consecuencias financieras. |
| H-7 | Preconfirmaciones financieras faltantes | El flujo de pago tiene 3 pasos (form → preconfirm → result). ¿El flujo de devolución tiene preconfirmación? ¿El cierre de cuenta? | No iniciado | Caja/dinero | P2 | — | UI | Preconfirmación antes de devolver o cerrar cuenta. |
| H-8 | IDs técnicos visibles en UI | Auditar si en algún lugar del panel admin se muestran IDs numéricos de Prisma al usuario (booking.id, account.id, etc.). Reemplazar por códigos legibles (RES-001, CTA-001). | No iniciado | UX | P3 | — | varios | No hay IDs técnicos expuestos. Hay códigos humanos si aplica. |
| H-9 | Mobile QA — panel admin | El panel admin no está pensado para mobile pero los operadores de caja pueden necesitarlo en tablet. QA general. | No iniciado | UX | P3 | — | todos los componentes admin | Funcional en tablet. |
| H-10 | Banners de error inline en forms | Algunos forms muestran errores como toast (que se va). Debería ser banner inline persistente hasta que el usuario corrija. | No iniciado | UX | P2 | — | varios forms | Errores en form → banner inline, no toast. |

---

### I. Seguridad / Auth / Deploy

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| I-1 | AUTH_ALLOW_BEARER_LEGACY=false en prod | Ya es false por default pero verificar que en prod el env no lo overridea. Documentar que debe ser false. | Parcial | Seguridad | P1 | — | `.env.prod`, documentación | Confirmado false en prod. Documentado. |
| I-2 | Cookies production — verificar config | AUTH_COOKIE_SECURE=true, SameSite=None (cross-site si frontend y backend en dominios distintos) o Strict. Verificar config actual. | Parcial | Seguridad | P1 | — | `utils/authConfig.ts`, `.env.prod` | Config correcta en prod. |
| I-3 | CSRF protection | Cookie-based auth con SameSite=Strict da CSRF protection básico. Pero si SameSite=None, necesita CSRF token. Verificar y documentar decisión. | No iniciado | Seguridad | P1 | I-2 | `src/index.ts`, middleware | Decisión documentada. Si necesario: CSRF token implementado. |
| I-4 | CORS final en prod | Verificar que el CORS del backend solo permite el dominio de frontend en producción. No `origin: '*'`. | No iniciado | Seguridad | P1 | — | `src/index.ts` | CORS restrictivo en prod. Env variable para origin. |
| I-5 | Secrets — auditoría | JWT_SECRET, AUTH_REFRESH_PEPPER, DATABASE_URL, REDIS_URL, etc. Verificar que están en variables de entorno, no hardcoded. Rotar si hay duda. | No iniciado | Seguridad | P0 | — | `.env`, deploys | Secrets en vault o env. No en repo. |
| I-6 | npm audit | Correr npm audit en backend, frontend y wpp-service. Revisar vulnerabilidades críticas. | No iniciado | Seguridad | P2 | — | `package.json` | 0 vulnerabilidades críticas. |
| I-7 | Backups de DB | ¿Hay backups automáticos de PostgreSQL en prod? ¿Cuánto retention? ¿Se testea el restore? | No iniciado | Datos | P0 | — | infra | Backups diarios. Restore testeado. |
| I-8 | Healthchecks | `HealthController.ts` y `HealthRoutes.ts` existen. Verificar que el healthcheck real incluye: DB conectada, Redis conectado, Outbox worker vivo. | No iniciado | Operativo | P1 | — | `controllers/HealthController.ts` | Healthcheck devuelve estado real de dependencias. |
| I-9 | Logs de producción | ¿Hay logging estructurado? ¿Los errores AppError se loggean con contexto suficiente para debugging en prod? | No iniciado | Operativo | P2 | — | `src/index.ts`, middleware | Logs estructurados (JSON) en prod. Error 500 incluye stack trace en log (no en respuesta). |
| I-10 | Audit logs — completitud | `AuditLogService.ts` existe. Auditar qué acciones se registran. ¿Cobros? ¿Cancelaciones? ¿Cambios de titular? | No iniciado | Legal | P2 | — | `services/AuditLogService.ts` | Acciones críticas (cobro, cancel, change-titular) auditadas. |
| I-11 | WPP service hardening | `wpp-service` usa probablemente whatsapp-web.js. Riesgo de reconexión, sesión expirada, ban de número. Auditar y documentar política de reconexión. | No iniciado | Integración | P2 | — | `apps/wpp-service/` | Reconexión automática. Alertas si se cae. |

---

### J. Staff / Usuarios / Roles

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| J-1 | Invitar staff — UI | No hay UI para invitar a un usuario como STAFF o ADMIN de un club. El modelo Membership existe. | No iniciado | Operativo | P2 | — | nuevo componente en Ajustes | Form de invitación. Email con link. |
| J-2 | Cambiar rol de staff — UI | No hay UI para cambiar el rol de un miembro existente (STAFF → ADMIN). | No iniciado | Operativo | P2 | J-1 | componente de gestión de staff | Dropdown de rol en lista de miembros. |
| J-3 | Eliminar acceso de staff — UI | No hay UI para quitar el acceso de un staff member. | No iniciado | Seguridad | P2 | J-1 | componente de gestión de staff | Botón "Quitar acceso" con confirmación. |
| J-4 | Global admin vs tenant admin — UI | Verificar que el panel de global admin (si existe) no es accesible por OWNER/ADMIN de club. Auditar rutas globales. | No iniciado | Seguridad | P1 | — | middleware, rutas | Rutas globales solo accesibles por superadmin. |
| J-5 | STAFF — permisos operativos | STAFF puede: agenda, caja, clientes básicos. ¿Puede ver reportes? ¿Puede hacer devoluciones? Definir y documentar la matriz de permisos de STAFF. | No iniciado | Operativo | P2 | — | middleware, documentación | Matriz de permisos documentada. |

---

### K. Onboarding / Operación de club

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| K-1 | Setup inicial de un club nuevo | El flujo de crear club → canchas → actividades → horarios → precios → staff → primera reserva no está documentado. ¿Funciona end-to-end? | No iniciado | Comercial | P1 | — | Ajustes, documentación | Flujo de onboarding documentado y funcional. |
| K-2 | Seed demo | Seed con datos realistas: 1 club, 3 canchas, actividades, horarios, 10 clientes, 20 reservas, algunos pagos, caja abierta. Para demos y desarrollo. | No iniciado | Operativo | P2 | — | `prisma/seed.ts` | `npx prisma db seed` genera datos demo realistas. |
| K-3 | Manual de uso para el operador de club | Documento corto explicando cómo operar el día a día: abrir caja, reservar, cobrar, cerrar caja. | No iniciado | Comercial | P2 | — | `docs/manual-operador.md` | Documento de ≤10 páginas con capturas. |
| K-4 | Primer cobro — flujo completo | Auditar el flujo: reserva confirmada → cuenta abierta → registrar pago → cuenta cerrada. ¿Funciona sin errores? | No iniciado | Caja/dinero | P1 | — | varios | Smoke test del flujo completo. |

---

### L. Rebranding Pique

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| L-1 | Auditar menciones de TuCancha/sistema-de-turnos | Grep de "TuCancha", "tucancha", "tu-cancha", "sistema-de-turnos" en todo el repo. Categorizar: strings de UI, variables, comentarios, configs, nombres de paquetes. | No iniciado | Comercial | P2 | — | todo el repo | Lista completa. Plan de reemplazo. |
| L-2 | EMAIL_FROM y Resend | Configurar `from:` de emails transaccionales como dominio Pique. Evitar spam filters. | No iniciado | Integración | P2 | — | `services/AuthEmailService.ts`, `.env` | Emails salen con dominio Pique. |
| L-3 | Auth domain — cookies y magic links | Las cookies y los magic links necesitan el dominio correcto configurado. | No iniciado | Seguridad | P2 | I-2 | `utils/authConfig.ts` | AUTH_COOKIE_DOMAIN = dominio Pique. |
| L-4 | Favicon, logo, metadata | frontend/public/favicon, <title>, og:image, description. | No iniciado | Comercial | P3 | — | `apps/frontend/public/`, `pages/_app.tsx` | Branding Pique visible. |
| L-5 | API root y dominios | Si el backend y frontend están en dominios distintos, configurar correctamente. | No iniciado | Técnico | P2 | I-4 | `.env`, CORS config | Dominios configurados. |
| L-6 | WhatsApp Business profile | El número de WhatsApp del sistema debería tener perfil Pique, no TuCancha. | No iniciado | Comercial | P2 | — | wpp-service | Perfil actualizado. |
| L-7 | Cookies tc_* si existen | Verificar si hay cookies con prefijo tc_ que deban renombrarse. | No iniciado | Técnico | P3 | — | `utils/authConfig.ts` | Cookies con prefijo correcto. |
| L-8 | Repo, packages y DB | Renombrar el repo de GitHub, el nombre en package.json, el nombre de la DB en prod. Decisión de negocio primero. | Decisión pendiente | Operativo | P4 | — | package.json, infra | Acordado y ejecutado. |

---

### M. Integraciones

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| M-1 | Mercado Pago OAuth por club | Cada club conecta su propia cuenta MP. Jugador paga desde app. El backend recibe webhook y confirma reserva. | No iniciado | Integración | P2 | D-4 | nuevo módulo `integrations/mercadopago/` | Club conecta MP. Jugador puede pagar. Webhook funciona. |
| M-2 | Stripe (alternativa) | Alternativa a MP para clubs internacionales. | No iniciado | Integración | P3 | M-1 | — | Decisión de negocio primero. |
| M-3 | Webhooks salientes | Clubs que quieran recibir eventos en sus propios sistemas (nueva reserva, pago, cancelación). | No iniciado | Integración | P4 | — | nuevo módulo | Endpoint de webhook configurable por club. |
| M-4 | Conciliación de pagos | Pagos online vs. pagos registrados manualmente. Diferencias a reportar. | No iniciado | Caja/dinero | P2 | M-1 | `services/PaymentService.ts` | Reporte de diferencias. |
| M-5 | Email templates — mejores | Los emails de magic link y notificaciones probablemente son texto plano. Mejorar con HTML responsive. | No iniciado | UX | P3 | L-2 | `services/AuthEmailService.ts` | Emails HTML con branding Pique. |
| M-6 | Notificaciones push | Notificaciones push para la app del jugador (reserva confirmada, recordatorio, cancelación). Requiere servicio de push (FCM/APNS). | No iniciado | Comercial | P3 | — | `services/NotificationService.ts` | Push notifications funcionando en app móvil. |
| M-7 | Facturación / AFIP | Emisión de comprobantes fiscales. Legal para clubs en Argentina. | Decisión pendiente | Legal/facturación | P3 | — | nuevo módulo | Decisión de negocio + implementación. |

---

### N. Documentación / QA / Testing

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| N-1 | Tests — CI con Prisma binary correcto | Los tests DB-dependientes fallan en sandbox Linux por mismatch darwin-arm64 vs linux-arm64. Configurar CI con binary correcto. | No iniciado | Técnico | P1 | — | `.github/workflows/`, `package.json` | Tests pasan en CI. |
| N-2 | Setup local — documentación real | No hay documentación de setup local paso a paso (prerequisitos, env, seed, primer dev run). | No iniciado | Operativo | P2 | — | `README.md` o `docs/setup-local.md` | Documento que permite a dev nuevo levantar el proyecto en < 30 min. |
| N-3 | Deploy docs | Cómo deployar backend, frontend, wpp-service. Variables de entorno necesarias. | No iniciado | Operativo | P2 | — | `docs/deploy.md` | Guía de deploy completa. |
| N-4 | Env matrix | Listado de todas las variables de entorno con: descripción, obligatoria/opcional, default, ejemplo. | No iniciado | Operativo | P2 | — | `docs/env-matrix.md` | Tabla completa de env vars. |
| N-5 | Release checklist | Lista de verificación antes de cada deploy: tsc clean, tests verdes, smoke test, DB migrations, backups. | No iniciado | Operativo | P2 | — | `docs/release-checklist.md` | Checklist de ≤20 ítems. |
| N-6 | Smoke release — completitud | `smokeRelease.ts` existe. Verificar que cubre: health, auth login, booking quote, payment, cash shift, product list. | No iniciado | Técnico | P2 | — | `scripts/smokeRelease.ts` | Smoke test cubre todos los endpoints críticos. |
| N-7 | Tests frontend | No hay tests de componentes React ni de servicios frontend. Al menos los helpers críticos deberían tener unit tests. | No iniciado | Técnico | P3 | — | `apps/frontend/` | Jest/Testing Library setup. Tests para apiError.ts, bookingErrorMap.ts, formatMoney. |

---

### O. Limpieza técnica / deuda

| ID | Título | Descripción | Estado | Riesgo | Prioridad | Dependencias | Archivos probables | Criterio de done |
|----|--------|-------------|--------|--------|-----------|--------------|-------------------|-----------------|
| O-1 | AdminLayout + AdminSidebar + DashboardLayout + Sidebar — eliminar | Solo usadas por metrics.tsx (dev tool con notFound en prod). Migrar metrics.tsx a AdminRouteShell mínimo y borrar las 4. | No iniciado | Técnico | P2 | — | `components/admin/AdminLayout.tsx` y 3 más | 4 archivos eliminados. metrics.tsx funcional. |
| O-2 | AdminTabBookings.tsx — confirmar dead code | Importa `useParams` de react-router-dom (incorrecto en Next.js). No aparece en ninguna página activa. | No iniciado | Técnico | P2 | — | `components/admin/AdminTabBookings.tsx` | Eliminado o corregido y conectado. |
| O-3 | frontend: utils/apiError.ts — auditar sincronía | `apps/frontend/utils/apiError.ts` es sofisticado y correcto. Verificar que lee bien el nuevo formato AppError (code en raíz, no en `error.code`). | Parcial | Técnico | P1 | — | `utils/apiError.ts` | parseApiErrorPayload lee correctamente el payload de AppError. Test. |
| O-4 | bookingErrorMap.ts — sincronizar con ErrorCodes backend | El mapa usa strings como `'BOOKING_OVERLAP'`, `'SLOT_ALREADY_BOOKED'` etc. Verificar que todos estos codes existen en el catálogo `ErrorCodes` del backend. Algunos pueden ser legacy names. | No iniciado | Técnico | P2 | — | `utils/bookingErrorMap.ts`, `src/errors/errorCodes.ts` | Todos los codes del mapa existen en ErrorCodes. |
| O-5 | SLOT_ALREADY_BOOKED, BOOKING_IN_PAST — verificar en ErrorCodes | bookingErrorMap usa SLOT_ALREADY_BOOKED y BOOKING_IN_PAST pero no están en el catálogo de errorCodes.ts actual. O se agregan o se reemplazan por BOOKING_SLOT_UNAVAILABLE e INVALID_INPUT. | No iniciado | Técnico | P1 | O-4 | ambos archivos | Consistencia garantizada. |
| O-6 | getErrorMessage local en BookingController | Ver A-13. Deduplicar. | No iniciado | Técnico | P3 | A-1, A-13 | Una sola fuente. |
| O-7 | AppError.ts — comentario "migración legacy" | L35 tiene un comentario "Compatibilidad interna durante la migración de callers legacy." Migración ya terminada: actualizar o borrar el comentario. | No iniciado | Técnico | P4 | — | `src/errors/AppError.ts` L35 | Comentario actualizado. |
| O-8 | dto/financialDto.ts — throw new Error | L4: `throw new Error(message)`. Auditar si este DTO valida en runtime y si debería lanzar AppError. | No iniciado | Técnico | P3 | — | `src/dto/financialDto.ts` | AppError si es validación de negocio, o mantener como invariante. |
| O-9 | BookingService — 5749 líneas | El servicio más grande del sistema. Muchos métodos con contextos muy distintos. No fragmentar ahora pero documentar los límites de cada sección. | No iniciado | Técnico | P4 | — | `services/BookingService.ts` | Comentarios de sección claros. |
| O-10 | Eliminar imports muertos | Auditar imports sin usar en controllers/services después de las migraciones AppError. | No iniciado | Técnico | P3 | A-1 a A-15 | `tsc --noEmit` sin warnings. |

---

## Pendientes encontrados por grep

| Archivo | Línea | Texto | Acción recomendada |
|---------|-------|-------|--------------------|
| `routes/ClubAdminRoutes.ts` | 132 | `res.status(400).json({ error: error.message })` | Migrar a sendAppError |
| `routes/ClubAdminRoutes.ts` | 152 | `res.status(500).json({ error: error.message \|\| '...' })` | Migrar a sendAppError |
| `routes/ClubAdminRoutes.ts` | 205 | `res.status(status).json({ error: error.message \|\| '...' })` | Migrar a sendAppError |
| `routes/ClubAdminRoutes.ts` | 248 | `res.status(status).json({ error: error.message \|\| '...' })` | Migrar a sendAppError |
| `routes/ClubAdminRoutes.ts` | 310 | `res.status(status).json({ error: error.message \|\| '...' })` | Migrar a sendAppError |
| `routes/ClubAdminRoutes.ts` | 344 | `res.status(status).json({ error: error.message \|\| '...' })` | Migrar a sendAppError |
| `utils/ActivityScheduleHelper.ts` | 55-172 | 8 × `throw new Error(...)` para validación | Migrar a `validationError` AppError |
| `utils/getUserClubContext.ts` | 11,43,46 | 3 × `throw new Error(...)` | Migrar a AppError |
| `repositories/ClubRepository.ts` | 35,50 | 2 × `throw new Error(...)` | Auditar y migrar si es error de negocio |
| `repositories/BookingRepository.ts` | 15 | `throw new Error('No se puede guardar una reserva sin clientId')` | Debería ser AppError INVALID_INPUT |
| `controllers/BookingController.ts` | 981 | `// A future hardening pass should verify...` | Implementar la verificación prometida |
| `controllers/BookingController.ts` | 15,17 | `getErrorMessage` helper local | Deduplicar con utils o eliminar |
| `routes/ClientRoutes.ts` | 9 | `getErrorMessage` helper local (duplicado) | Deduplicar con utils o eliminar |
| `services/BookingService.ts` | 3309 | `// metadata/refs legacy` comentario | Verificar si hay código legacy real |
| `src/errors/AppError.ts` | 35 | `// Compatibilidad interna durante la migración de callers legacy.` | Borrar, migración terminada |
| `utils/bookingErrorMap.ts` | varios | `SLOT_ALREADY_BOOKED`, `BOOKING_IN_PAST` | No están en errorCodes.ts — sincronizar |
| `utils/bookingErrorMap.ts` | varios | `BILLING_MISSING_RESPONSIBLE`, `BILLING_INVALID_ASSIGNMENTS` | Verificar si están en errorCodes.ts |

---

## Dependencias entre items

```
A-15 (rutas faltantes) → F-5 (descuentos routes) — mismo problema
A-1 (string matching) → A-11 (tests AppError booking) — primero limpiar, luego testear
A-9 (fieldErrors backend) → H-1 (fieldErrors frontend)
E-1 (P2-B anulación) → E-2 (P2-C servicios) → E-3 (P2-D reportes POS)
E-12 (cuentas.tsx shell) → E-13 (cuentas.tsx como tab)
I-2 (cookies prod) → I-3 (CSRF) → L-3 (auth domain)
J-1 (invitar staff) → J-2 (cambiar rol) → J-3 (eliminar acceso)
M-1 (Mercado Pago) → D-4 (pago jugador) → M-4 (conciliación)
O-4 (bookingErrorMap) → O-5 (SLOT_ALREADY_BOOKED)
C-1 (merge clientes) → C-7 (panel incidentes)
G-1 a G-7 (reportes) → G-9 (AdminTabStatistics)
```

---

## Fases recomendadas de ejecución

| Fase | Nombre | Items incluidos | Riesgo | Criterio de terminado |
|------|--------|----------------|--------|----------------------|
| **A** | Auditoría crítica + fixes urgentes | A-15, F-5, O-3, O-5, N-1 | Bajo | Rutas confirmadas. bookingErrorMap sincronizado. CI verde. |
| **B** | POS completo | E-1, E-2, E-3 | Medio | Anulación + servicios + reportes POS. |
| **C** | AppError completar | A-1, A-2, A-3, A-4, A-5, A-6, A-7, A-8 | Bajo-Medio | 0 `error.message` expuesto. 0 inline res.status en catch. |
| **D** | Tests y QA | A-11, A-12, B-9, N-1, N-6 | Bajo | Tests AppError booking y auth. CI verde. Smoke completo. |
| **E** | Cuentas y clientes | E-12, E-13, C-1, C-2, C-7 | Medio | cuentas.tsx migrada. Merge manual. Panel incidentes. |
| **F** | fieldErrors y UX feedback | A-9, H-1, H-2, H-5, H-6, H-7 | Bajo | Forms con errores por campo. Confirmaciones destructivas. |
| **G** | Reportes básicos | G-1, G-3, G-4, G-5, G-9 | Bajo | Ingresos, reservas, cuentas pendientes, ventas POS. |
| **H** | Staff y seguridad | J-1, J-2, J-3, J-5, I-3, I-4, I-5, I-7 | Alto | Staff management. CSRF y CORS en prod. Backups. |
| **I** | Jugador y checkout público | D-1, D-2, D-3, D-7, M-1 | Medio | Jugador ve sus reservas. Puede cancelar y pagar online. |
| **J** | Limpieza + rebranding + docs | L-1 a L-8, N-2, N-3, N-4, N-5, O-1, O-2, O-6, O-10 | Bajo | Repo limpio. Docs completas. Branding Pique. |

---

## Top 20 — Prioridad absoluta

| Rank | ID | Título | Por qué ahora |
|------|----|--------|---------------|
| 1 | A-15 / F-5 | Rutas DiscountRoutes / ProductRoutes | Si no están registradas: funcionalidades de negocio silenciosamente rotas |
| 2 | O-5 | SLOT_ALREADY_BOOKED no está en ErrorCodes | Inconsistencia activa entre frontend y backend |
| 3 | O-3 | apiError.ts frontend — verificar lectura de AppError | Frontend puede estar leyendo code del lugar incorrecto |
| 4 | E-1 | P2-B: Anular venta mostrador | En progreso. Bloquea E-2 y E-3 |
| 5 | A-1 | Eliminar string matching BookingController | Frágil. Silently rompe si cambia texto en BookingService |
| 6 | A-2 | ClubAdminRoutes.ts — error.message expuesto | 6 endpoints exponen mensajes internos al cliente |
| 7 | N-1 | CI — Prisma binary mismatch | Tests no corren en CI → regressions no detectadas |
| 8 | A-11 | Tests AppError booking | Falta cobertura del dominio más crítico |
| 9 | A-6 | AuthController → sendAppError | 25 inline. Frontend no distingue tipos de error auth |
| 10 | E-12 | cuentas.tsx → AdminRouteShell | Deuda activa en página de producción |
| 11 | H-6 | Confirmaciones destructivas | Riesgo de operaciones accidentales con consecuencias financieras |
| 12 | I-5 | Secrets auditoría | No negociable antes de prod pública |
| 13 | I-7 | Backups de DB | No negociable en prod |
| 14 | E-2 | P2-C: Servicios en POS | Feature, depende de E-1 |
| 15 | K-4 | Flujo cobro completo — smoke test | Verificar que el flujo principal no tiene errores |
| 16 | J-1 | Invitar staff — UI | Club no puede autoadministrarse sin esto |
| 17 | G-5 | Ventas POS por turno | Completa el ciclo de caja |
| 18 | C-1 | Merge manual de duplicados | Incidentes acumulándose sin resolución |
| 19 | I-4 | CORS restrictivo en prod | Seguridad básica antes de prod pública |
| 20 | O-4 | bookingErrorMap — sincronizar ErrorCodes | Inconsistencia que puede causar errores silenciosos |

---

## Bloqueantes para piloto (primer club real de pago)

1. **A-15 / F-5** — Confirmar que todas las rutas funcionan
2. **O-5** — bookingErrorMap sincronizado con ErrorCodes reales
3. **I-5** — Secrets auditados y seguros
4. **I-7** — Backups de DB activos
5. **K-4** — Flujo principal de cobro smoke-testeado
6. **E-1** — Anulación de venta POS (operación activa en uso)
7. **H-6** — Confirmaciones destructivas básicas

---

## Bloqueantes para venta abierta (self-signup de clubs)

Además de bloqueantes de piloto:

1. **J-1/J-2/J-3** — Gestión de staff (club no puede autoadministrarse)
2. **I-3/I-4** — CSRF y CORS correctos en prod
3. **L-1 a L-6** — Rebranding completo a Pique
4. **M-1** — Pago online (Mercado Pago) para jugadores
5. **D-1/D-2/D-3** — Flujo de jugador mínimo
6. **N-2/N-3/N-5** — Docs de setup y release checklist
7. **K-1/K-2/K-3** — Onboarding de nuevo club documentado

---

## Items de polish (nice to have, no bloquean nada)

- H-3 — Empty states sistemáticos
- H-4 — Loading states sistemáticos
- H-8 — Códigos humanos (RES-001) en vez de IDs técnicos
- H-9 — Mobile QA panel admin
- E-5 — Ticket/impresión POS
- F-9 — Precios variables por horario en servicios
- G-2 — Ocupación de canchas
- G-8 — Exportación CSV
- D-5 — Perfil jugador
- D-6 — Favoritos de club
- M-5 — Email templates HTML
- M-6 — Push notifications
- O-7 — Borrar comentario legacy en AppError.ts
- O-9 — Documentar secciones BookingService
- L-8 — Renombrar repo/DB (decisión de negocio primero)

---

*Generado por auditoría real del repo. No se modificó código. Revisar y validar antes de ejecutar cualquier ítem. La sección "Items cerrados recientemente" garantiza que no se repita trabajo ya hecho.*
