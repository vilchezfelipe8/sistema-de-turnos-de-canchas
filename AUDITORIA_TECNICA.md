# Auditoría técnica – Sistema de turnos de canchas

Auditoría estructural frontend/backend, contrato API, fechas, DTOs, seguridad e inconsistencias.  
Enfoque: preparación multi-país/multi-timezone y deuda técnica.

---

## A) Mapa completo de endpoints

Base: backend monta rutas bajo `/api/*` excepto `/clients` (sin prefijo).  
Si el frontend usa `getApiUrl()` = origen del backend, las llamadas deben ser a `{API_URL}/api/...`; en el código actual el frontend usa `{API_URL}/bookings`, `{API_URL}/auth/...`, etc. **Sin `/api` en la path**. Eso solo es correcto si en producción `NEXT_PUBLIC_API_URL` apunta a un proxy que ya incluye `/api` o si el backend en producción monta las rutas en la raíz. **Inconsistencia crítica de base URL.**

### Auth – `/api/auth`
| Método | Ruta | Params | Query | Body | Validación | Auth | Response |
|--------|------|--------|-------|------|------------|------|----------|
| POST | `/api/auth/register` | - | - | firstName, lastName, email, password, phoneNumber, role (MEMBER\|ADMIN) | Zod: min(1), email, password.min(6), phoneNumber.min(5) | No | 201 `{ message, userId }` o 400 `{ error }` |
| POST | `/api/auth/login` | - | - | email, password | Zod: email, password.min(1) | No | 200 `{ message, token, user }` (user: id, firstName, lastName, email, phoneNumber, role, clubId) |
| GET | `/api/auth/me` | - | - | - | - | Sí (Bearer) | 200 user (id, firstName, lastName, email, phoneNumber, role, clubId) |

### Bookings – `/api/bookings`
| Método | Ruta | Params | Query | Body | Validación | Auth | Response |
|--------|------|--------|-------|------|------------|------|----------|
| GET | `/api/bookings/availability` | - | courtId, date (YYYY-MM-DD), activityId, durationMinutes? | - | Zod: courtId +, date regex, activityId +, durationMinutes? | No | 200 `{ date, availableSlots: string[] }` |
| GET | `/api/bookings/all-availability` | - | date, activityId, durationMinutes? | - | Zod: date regex, activityId +, durationMinutes? | No | 200 `{ date, availableSlots }` |
| GET | `/api/bookings/availability-with-courts` | - | date, activityId, clubSlug?, durationMinutes? | - | Zod: date string, activityId number, resto opcional | No | 200 `{ date, slotsWithCourts: [{ slotTime, availableCourts: [{ id, name, price? }] }] }` |
| POST | `/api/bookings` | - | - | courtId, activityId, date?+slotTime? O startDateTime? (ISO), durationMinutes?, guestIdentifier?, guestName?, guestEmail?, guestPhone?, guestDni?, isProfessor?, asGuest? | Zod createSchema; fecha: date+slotTime (local→UTC vía club timeZone) o startDateTime ISO | Opcional | 201 `{ ...booking, refresh, refreshDate }` (booking sin paymentStatus en entidad) |
| POST | `/api/bookings/confirm` | - | - | bookingId, paymentMethod? (CASH/DEBT) | **Sin Zod**: solo body | Sí | 200 resultado mapToEntity (sin paymentStatus en tipo) |
| POST | `/api/bookings/cancel` | - | - | bookingId | **Sin Zod** | Sí | 200 `{ message, booking }` |
| GET | `/api/bookings/admin/schedule` | - | date (YYYY-MM-DD) | - | Manual: falta date → 400 | Sí + ADMIN + setAdminClubFromUser | 200 array schedule (courtId, courtName, slotTime, startDateTime ISO, isAvailable, booking) |
| POST | `/api/bookings/fixed` | - | - | userId?, courtId, activityId, startDateTime (ISO), guestName?, guestPhone?, guestDni?, isProfessor? | **Sin Zod**: solo body | Sí + ADMIN + setAdminClubFromUser | 201 `{ fixedBookingId, generatedCount, msg }` |
| DELETE | `/api/bookings/fixed/:id` | id | - | - | parseInt(id) | Sí + ADMIN + setAdminClubFromUser | 200 `{ message }` |
| GET | `/api/bookings/debtors/list` | - | - | - | - | Sí + ADMIN + setAdminClubFromUser | 200 array debtors (clientes con totalDebt, bookings, history) |
| POST | `/api/bookings/pay-debt` | - | - | bookingId, paymentMethod | **Sin Zod** | Sí | 200 `{ message, result }` |
| GET | `/api/bookings/:id/items` | id | - | - | - | Sí | 200 array BookingItem con product |
| POST | `/api/bookings/:id/items` | id (o body.bookingId) | - | productId, quantity, paymentMethod? | Manual | Sí | 200 newItem o 500 |
| DELETE | `/api/bookings/items/:itemId` | itemId | - | - | - | Sí | 200 `{ message }` |
| GET | `/api/bookings/history/:userId` | userId | - | - | - | Sí | 200 array bookings (con court.club, items) |
| PATCH | `/api/bookings/:id/payment-status` | id | - | paymentStatus (PAID/DEBT/PARTIAL) | **Sin Zod** | Sí | 200 `{ success: true }` |

Modelos Prisma usados en bookings: `Booking`, `Court`, `Club`, `User`, `ActivityType`, `FixedBooking`, `BookingItem`, `Product`, `CashMovement`.  
Fechas: `startDateTime`/`endDateTime` en DB como `Timestamptz`; se guardan en UTC; en varios flujos se convierte con `TimeHelper` y zona del club; en otros se usa offset fijo -3h (Argentina).

### Courts – `/api/courts`
| Método | Ruta | Params | Query | Body | Validación | Auth | Response |
|--------|------|--------|-------|------|------------|------|----------|
| GET | `/api/courts` | - | clubSlug? | - | - | Opcional (optionalSetAdminClubFromUser) | 200 array Court (con club, activities, activityType) |
| POST | `/api/courts` | - | - | - | - | Sí + ADMIN | 403 (alta deshabilitada) |
| PUT | `/api/courts/:id` | id | - | isUnderMaintenance?, name?, activityTypeId?, price? | Manual | Sí + ADMIN + setAdminClubFromUser | 200 court |
| PUT | `/api/courts/:id/suspend` | id | - | - | - | Sí + ADMIN + setAdminClubFromUser | 200 `{ message, court }` |
| PUT | `/api/courts/:id/reactivate` | id | - | - | - | Sí + ADMIN + setAdminClubFromUser | 200 `{ message, court }` |

### Clubs – `/api/clubs`
| Método | Ruta | Params | Query | Body | Validación | Auth | Response |
|--------|------|--------|-------|------|------------|------|----------|
| GET | `/api/clubs` | - | - | - | - | No | 200 array Club |
| GET | `/api/clubs/slug/:slug` | slug | - | - | - | No | 200 Club |
| GET | `/api/clubs/:id` | id | - | - | parseInt(id) | No | 200 Club |
| POST | `/api/clubs` | - | - | slug, name, addressLine, city, province, country, contact, phone?, logoUrl?, ... | Sin Zod, destructuración | Sí + ADMIN | 201 club |
| PUT/PATCH | `/api/clubs/:id` | id | - | slug, name, addressLine, ... | Sin Zod | Sí + ADMIN + verifyClubAccessById | 200 club |

### Club Admin – `/api/clubs` (mismo prefijo, rutas con :slug)
| Método | Ruta | Params | Query | Body | Validación | Auth | Response |
|--------|------|--------|-------|------|------------|------|----------|
| GET | `/api/clubs/:slug/admin/schedule` | slug | - | - | - | Sí + ADMIN + verifyClubAccess | 200 schedule (igual que booking admin/schedule) |
| GET | `/api/clubs/:slug/admin/courts` | slug | - | - | - | Sí + ADMIN + verifyClubAccess | 200 courts |
| POST | `/api/clubs/:slug/admin/courts` | slug | - | name, surface (ClubController.createCourt usa clubId, name, surface, activityIds) | **Inconsistencia**: ClubAdminRoutes pasa req.body; CourtController espera name, isIndoor, surface, activityTypeId y clubId del middleware | Sí + ADMIN + verifyClubAccess | 201 court |
| PUT | `/api/clubs/:slug/admin/courts/:id` | slug, id | - | isUnderMaintenance, name, activityTypeId, price | - | Sí + ADMIN + verifyClubAccess | 200 court |
| PUT | `/api/clubs/:slug/admin/courts/:id/suspend` | slug, id | - | - | - | Sí + ADMIN + verifyClubAccess | 200 `{ message, court }` |
| PUT | `/api/clubs/:slug/admin/courts/:id/reactivate` | slug, id | - | - | - | Sí + ADMIN + verifyClubAccess | 200 `{ message, court }` |
| GET | `/api/clubs/:slug/admin/info` | slug | - | - | - | Sí + ADMIN + verifyClubAccess | 200 req.club |
| PUT | `/api/clubs/:slug/admin/info` | slug | - | body completo club | - | Sí + ADMIN + verifyClubAccess | 200 club |
| POST | `/api/clubs/:slug/admin/bookings/fixed` | slug | - | userId?, courtId, activityId, startDateTime, guestName?, guestPhone?, guestDni?, isProfessor? | Sin Zod | Sí + ADMIN + verifyClubAccess | 201 |
| DELETE | `/api/clubs/:slug/admin/bookings/fixed/:id` | slug, id | - | - | - | Sí + ADMIN + verifyClubAccess | 200 |
| POST | `/api/clubs/:slug/admin/bookings/confirm` | slug | - | bookingId, paymentMethod? | - | Sí + ADMIN + verifyClubAccess | 200 |
| POST | `/api/clubs/:slug/admin/bookings/cancel` | slug | - | bookingId | - | Sí + ADMIN + verifyClubAccess | 200 |
| GET | `/api/clubs/:slug/admin/products` | slug | - | - | - | Sí + ADMIN + verifyClubAccess | 200 products |
| POST | `/api/clubs/:slug/admin/products` | slug | - | name, price, stock, category | - | Sí + ADMIN + verifyClubAccess | 201 product |
| PUT | `/api/clubs/:slug/admin/products/:id` | slug, id | - | data | - | Sí + ADMIN + verifyClubAccess | 200 product |
| DELETE | `/api/clubs/:slug/admin/products/:id` | slug, id | - | - | - | Sí + ADMIN + verifyClubAccess | 200 `{ message }` |
| GET | `/api/clubs/:slug/admin/clients-list` | slug | q? | - | - | Sí + ADMIN + verifyClubAccess | 200 array clientes (filtrado por q en memoria) |

### Clients – `/clients` (sin prefijo /api)
| Método | Ruta | Params | Query | Body | Validación | Auth | Response |
|--------|------|--------|-------|------|------------|------|----------|
| GET | `/clients` | - | clubSlug (obligatorio) | - | verifyClubSlugAccess | Sí + ADMIN | 200 array clientes fabricados desde bookings (id ficticio, firstName, lastName, email, phoneNumber, totalBookings) |

### Cash – `/api/cash`
| Método | Ruta | Params | Query | Body | Validación | Auth | Response |
|--------|------|--------|-------|------|------------|------|----------|
| GET | `/api/cash` | - | - | - | - | Sí + ADMIN + setAdminClubFromUser | 200 `{ balance: { total, cash, digital, income, expense }, movements }` |
| POST | `/api/cash` | - | - | amount, description, type (INCOME/EXPENSE), method (CASH/TRANSFER) | parseFloat(amount), isNaN → 400 | Sí + ADMIN + setAdminClubFromUser | 200 movement |
| GET | `/api/cash/products` | - | - | - | - | Sí + ADMIN + setAdminClubFromUser | 200 array Product |
| POST | `/api/cash/product-sale` | - | - | productId, quantity, method? | Manual | Sí + ADMIN + setAdminClubFromUser | 200 movement |

### Locations – `/api/locations`
| Método | Ruta | Params | Query | Body | Validación | Auth | Response |
|--------|------|--------|-------|------|------------|------|----------|
| GET | `/api/locations` | - | - | - | - | No | 200 array Location |

### Health – `/api/health` y `/health`
| Método | Ruta | Auth | Response |
|--------|------|------|----------|
| GET | `/api/health` | No | 200 `{ status, timestamp, database, server }` |
| GET | `/health` | No | 200 `{ status: 'ok' }` |

### WhatsApp (backend)
| GET | `/whatsapp/qr` | Sí + ADMIN | HTML o 404 |
| GET | `/whatsapp/status` | No | JSON status |

---

## B) Contrato real frontend → backend

### Base URL
- Frontend: `getApiUrl()` → `NEXT_PUBLIC_API_URL` o `window.location.protocol//hostname:3000` o `http://localhost:3000`.
- Llamadas: `${API_URL}/bookings`, `${API_URL}/auth/me`, `${API_URL}/courts`, `${API_URL}/clubs/...`, etc. **Ninguna agrega `/api`.**  
- Backend: rutas bajo `app.use('/api/bookings', ...)`, etc.  
- Conclusión: en producción debe cumplirse `NEXT_PUBLIC_API_URL = base del backend` y el backend debe servir en esa base **o** el frontend debe usar `${API_URL}/api/bookings`, etc. Hoy hay riesgo de 404 si la base no incluye `/api`.

### Endpoints que consume el frontend (resumen)
- **Auth**: `POST /auth/login`, `POST /auth/register`, `GET /auth/me` (useValidateAuth, AuthService).
- **Bookings**:  
  - `GET /bookings/availability-with-courts?activityId=1&date=...&clubSlug=...&durationMinutes=...` (useAvailability).  
  - `POST /bookings` (createBooking desde BookingGrid y services/BookingService).  
  - `GET /bookings/history/:userId`, `POST /bookings/cancel`, `POST /bookings/confirm` (BookingService; confirm también en AdminTabBookings con paymentMethod).  
  - `GET /bookings/admin/schedule?date=...`, `POST /bookings/fixed`, `DELETE /bookings/fixed/:id` (BookingService, AdminTabBookings).  
  - `POST /bookings/pay-debt` (ClientsPage).  
- **Courts**: `GET /courts`, `GET /courts?clubSlug=...` (BookingGrid).
- **Clubs**: `GET /clubs`, `GET /clubs/:id`, `GET /clubs/slug/:slug` (ClubService).
- **Club Admin**: `GET/PUT /clubs/:slug/admin/...` (schedule, courts, info, bookings/fixed, confirm, cancel, products, clients-list) vía ClubAdminService.
- **Cash**: `GET /cash`, `POST /cash`, `GET /cash/products`, `POST /cash/product-sale` (AdminCashDashboard; usa `NEXT_PUBLIC_API_URL || 'http://localhost:4000'` — puerto distinto al default 3000).
- **Locations**: `GET /locations` (LocationService).
- **Health**: `GET /health` (AdminDevDashboard; `NEXT_PUBLIC_API_URL || 'http://localhost:3001'`).

Inconsistencias de URL en frontend:
- AdminCashDashboard: puerto 4000.
- AdminDevDashboard: puerto 3001.
- Resto: getApiUrl() (3000 o env).
- ClientsPage y AdminTabBookings: `process.env.NEXT_PUBLIC_API_URL` directo (sin fallback a getApiUrl()).

### Flujo de creación de reserva (Booking)
1. **Frontend (BookingGrid)**  
   - Usuario elige fecha (`selectedDate`), slot (`selectedSlot`, ej. "10:00"), cancha (`selectedCourt`), duración (`selectedDuration`).  
   - `bookingDateTime = new Date(year, month, day, hours, minutes, 0, 0)` — **fecha/hora en hora local del navegador.**  
   - No se envía `bookingDateTime` como ISO; se envía `date` (YYYY-MM-DD) + `slotTime` (HH:mm) vía `createBooking(selectedCourt.id, 1, selectedDate, selectedSlot, ..., { durationMinutes: selectedDuration })`.

2. **Frontend (services/BookingService.createBooking)**  
   - Si hay `slotTime`: body = `{ courtId, activityId, date: YYYY-MM-DD, slotTime, guestName?, guestEmail?, guestPhone?, guestDni?, ... }`.  
   - Si no: body = `{ startDateTime: date.toISOString() }`.  
   - En BookingGrid siempre se pasa `selectedSlot`, así que se usa **date + slotTime**.

3. **Backend (BookingController.createBooking)**  
   - Si vienen `date` + `slotTime`: obtiene court → club → `timeZone` (default `TimeHelper.getDefaultTimeZone()` = env o 'UTC'); `startDate = TimeHelper.localSlotToUtc(dateStr, slotTime, tz)`.  
   - Si viene `startDateTime`: `startDate = new Date(startDateTime)` (interpretación ISO en servidor).  
   - Validaciones: no pasado, no más de 1 mes (no-admin), guestIdentifier o auth, guestName/guestPhone para invitado.  
   - `bookingService.createBooking(..., startDate, ...)` guarda en Prisma `startDateTime`/`endDateTime` (UTC en DB).

4. **Respuesta**  
   - `payload = { ...result, refresh: true, refreshDate }`.  
   - `result` = entidad Booking (mapToEntity): no incluye `paymentStatus` ni `guestDni` en la clase; al serializar JSON sí salen las Date como ISO.  
   - `refreshDate` = YYYY-MM-DD en UTC (desde `startDate.getUTCFullYear/Month/Date`). **Posible desfase de un día** si el slot en local es de madrugada y en UTC cae el día anterior.

5. **Frontend tras crear**  
   - Usa `createResult.refresh`, `createResult.refreshDate` para refrescar y opcionalmente `setSelectedDate` con refreshDate.  
   - Muestra mensaje de éxito.

### Transformaciones y timezone en frontend
- **Envío**: Solo date (YYYY-MM-DD) + slotTime (HH:mm); el backend interpreta en timezone del club. El frontend no envía timezone explícito; depende del club en backend.
- **Recepción**:  
  - Slots: `slotsWithCourts[].slotTime` (string) y opcionalmente `startDateTime` ISO.  
  - Historial y schedule: `startDateTime`/`endDateTime` ISO; en bookings.tsx y otros se hace `new Date(booking.startDateTime)` y se formatea con `toLocaleDateString`/`toLocaleTimeString` con `timeZone: 'America/Argentina/Buenos_Aires'` en algunos sitios y en otros solo locale.  
- **Riesgo**: Si el usuario está en otra zona, `new Date(year, month, day, h, m)` en el cliente es en su local; el backend convierte date+slotTime con la zona del **club**. Para un club en Argentina y usuario en España, el mismo par (date, slotTime) puede ser correcto o confuso según si se considera “hora del club” o “hora del usuario”. Hoy está implícito “hora del club”.

---

## C) Problemas detectados

### Validación
- **Sin Zod/schema**: confirm (bookingId, paymentMethod), cancel (bookingId), pay-debt (bookingId, paymentMethod), createFixed (varios), updateStatus (paymentStatus), addItem (productId, quantity, paymentMethod), createMovement (amount, type, method), createClub/updateClub (body completo), createCourt (ClubAdmin: name, surface vs CourtController: name, isIndoor, surface, activityTypeId).
- **confirmBooking**: no se valida que `bookingId` sea número ni que `paymentMethod` sea uno permitido.
- **cancelBooking**: no se valida `bookingId` en body; si falta o es string, puede haber NaN o errores en servicio.

### Fechas y timezone
- **Offset fijo -3h (Argentina)** en BookingController (WhatsApp) y en BookingService (localStart con `getTime() - 3*60*60*1000`) para mostrar “local”. Si el club está en otra zona (ej. Córdoba o Chile), es incorrecto.
- **BookingRepository / CashService**: `getUtcRangeForLocalDate(date)` se llama **sin** `timeZone`; usan `TimeHelper.getDefaultTimeZone()` (env o 'UTC'). El “día” para consultas de reservas y caja es en UTC, no en zona del club. Un club en Argentina puede tener el “día” mal definido cerca de medianoche.
- **getAdminSchedule**: construye `searchDate` con `new Date(year, month - 1, day)` (medianoche local del servidor), luego busca bookings en ese rango; el servicio usa `startOfDay`/`endOfDay` con `setHours(0,23,...)` sobre esa fecha — mismo problema de “día” en zona del servidor, no del club.
- **createFixed**: `startDate = new Date(startDateTime)` (ISO desde frontend); luego se usa `startDateTime.getDay()` y conversión a startTime/endTime con `TimeHelper.utcToLocal` pero sin pasar `timeZone` del club (usa default). Inconsistente con createBooking que sí usa timeZone del club.
- **Frontend**: Mezcla de `new Date(y, m, d)` (local del navegador), `new Date(iso)` y en algunos sitios `timeZone: 'America/Argentina/Buenos_Aires'` fijo. No hay una única fuente de verdad de zona (club vs usuario).

### DTO y entidades
- **Entidad Booking (backend)**: No tiene `paymentStatus` ni `guestDni`; el schema Prisma sí. `mapToEntity` no los asigna. Las respuestas que devuelven la entidad (create, confirm, cancel, etc.) no incluyen paymentStatus en el tipo; en getHistory y getAdminSchedule se devuelve el objeto Prisma o un payload armado a mano, que sí puede traer paymentStatus.
- **createBooking response**: Incluye `refreshDate` calculado en UTC; si el slot en local es 00:30, en UTC puede ser día anterior y el front podría mostrar el día equivocado.
- **Club**: Schema tiene `contactInfo`; createClub usa `contact` en body. Posible desalineación.
- **Court**: ClubController.createCourt (ClubAdminRoutes) espera `clubId, name, surface, activityIds`; CourtController.createCourt espera `name, isIndoor, surface, activityTypeId` y clubId del middleware. Si el admin usa la ruta por slug, el body no lleva clubId y puede faltar isIndoor/activityTypeId.

### Seguridad y auth
- **Rutas sin auth**: availability, all-availability, availability-with-courts, GET clubs, GET club by id/slug, GET courts (opcional auth), GET locations, GET /health y /api/health, GET /whatsapp/status. Aceptable para datos públicos; GET /whatsapp/status expone estado del servicio.
- **confirm/cancel por bookingId**: Solo se comprueba que el usuario esté autenticado; en BookingRoutes no se verifica que la reserva pertenezca al club del admin. El servicio cancelBooking sí recibe `clubId` (cuando viene del middleware) y valida; confirmBooking no recibe clubId y no valida pertenencia al club. Un admin de club A podría confirmar/cancelar reservas de club B si conoce el bookingId.
- **getHistory/:userId**: Cualquier usuario autenticado puede pedir el historial de otro usuario pasando otro userId. Falta verificar `req.user.userId === req.params.userId`.
- **Clients**: GET /clients requiere clubSlug y verifica que el club sea del admin; correcto.
- **Cash/Products**: Requieren ADMIN + setAdminClubFromUser; clubId del token. Correcto.

### Overfetching / datos sensibles
- **Auth/me y login**: No devuelven `password`; sí role y clubId. Aceptable.
- **getHistory**: Incluye court.club (addressLine, phone, etc.); no hay select mínimo; aceptable para “mis reservas”.
- **getClubDebtors**: Incluye user, items, cashMovements, court; necesario para deuda. Aceptable.
- **Schedule/admin**: Devuelve objetos booking completos (incl. user, court, activity). Aceptable para admin.

### Duplicación y acoplamiento
- **Dos rutas de confirm/cancel**: `/api/bookings/confirm` y `/api/clubs/:slug/admin/bookings/confirm` (igual cancel y fixed). Misma lógica, distinto middleware (setAdminClubFromUser vs verifyClubAccess). En una no se pasa clubId al servicio para validar pertenencia.
- **ClientRoutes**: Ruta `/clients` sin `/api` y lógica de “clientes” fabricada desde bookings en el route handler; difícil de reutilizar y distinto al resto de la API.
- **TimeHelper.getDefaultTimeZone()**: Usado en muchos sitios sin recibir timeZone del club; acoplamiento implícito a env o UTC.

### Inconsistencias de tipos y enums
- **PaymentStatus**: Backend usa enum Prisma (PENDING, PAID, PARTIAL, DEBT). Frontend usa strings iguales; correcto. Pero la entidad Booking no tiene paymentStatus, por lo que los tipos TS del backend no lo reflejan en las respuestas de create/confirm.
- **FixedBooking.status**: Prisma usa string ('ACTIVE', 'CANCELLED'); no hay enum en schema. Consistente en código.
- **Club create**: Body usa `contact`; schema tiene `contactInfo`. Riesgo de que contact no se mapee a contactInfo.

---

## D) Riesgos críticos

1. **Confirm/Cancel sin verificación de club**  
   POST `/api/bookings/confirm` y `/api/bookings/cancel`: cualquier admin autenticado puede confirmar/cancelar por bookingId sin que se verifique que la reserva sea de su club. **Mitigación**: Pasar clubId (ej. desde setAdminClubFromUser) y validar en servicio que booking.court.clubId === clubId, o usar solo la ruta por slug que ya tiene verifyClubAccess.

2. **getHistory/:userId sin autorización**  
   Cualquier usuario logueado puede pedir GET `/api/bookings/history/123`. Debería restringirse a `userId === req.user.userId` (o admin con club).

3. **Base URL frontend sin `/api`**  
   Si el backend está en `https://api.dominio.com` y las rutas son `/api/bookings`, etc., el front debe llamar a `https://api.dominio.com/api/bookings`. Si hoy se usa solo `getApiUrl() + '/bookings'`, en ese escenario todas las llamadas fallan. Verificar despliegue y/o unificar base URL (o proxy que reescriba).

4. **Rango de “día” en UTC**  
   BookingRepository (findByCourtAndDate, findAllByDate, findAllByDateAndClub) y CashService.getDailySummary usan “día” en UTC. Para un club en Argentina, la “caja del día” y las búsquedas por día pueden incluir/excluir horas equivocadas. Crítico para reportes y cortes de caja.

5. **createFixed sin timeZone del club**  
   startDateTime ISO se interpreta en el servidor; dayOfWeek y conversión a startTime/endTime usan TimeHelper con timeZone por defecto, no el del club. Turnos fijos pueden quedar en hora incorrecta si el servidor o el default no son la zona del club.

6. **refreshDate en UTC en createBooking**  
   El frontend puede recibir un refreshDate de “día anterior” al que el usuario eligió (slot de madrugada en local). Mejor calcular refreshDate en la zona del club antes de devolverlo.

---

## E) Recomendaciones estructurales

1. **API y auth**  
   - Unificar base URL: o bien `NEXT_PUBLIC_API_URL` incluye `/api` (ej. `https://api.ejemplo.com/api`) o el frontend siempre concatena `/api` al path.  
   - Añadir validación (Zod) a confirm, cancel, pay-debt, createFixed, updateStatus, addItem, createMovement y a bodies de club/court donde aplique.  
   - En confirm/cancel por bookingId: inyectar clubId (middleware) y validar en servicio que la reserva sea del club; o deprecar esas rutas y usar solo las que llevan `:slug`.  
   - getHistory: permitir solo `req.params.userId === req.user.userId` o admin del club correspondiente.

2. **Fechas y timezone**  
   - Definir “día” siempre con zona: recibir `timeZone` (o clubId) en BookingRepository/CashService y usar `TimeHelper.getUtcRangeForLocalDate(date, timeZone)`.  
   - Eliminar offset fijo -3h; usar en todo `TimeHelper.utcToLocal(utcDate, club.timeZone)` (y club.timeZone en createFixed).  
   - Respuesta createBooking: calcular `refreshDate` en timeZone del club, no en UTC.  
   - Frontend: documentar que “date + slotTime” es “en hora del club”; si se muestra algo en “hora del usuario”, hacerlo explícito y usar timezone del club en formateo cuando esté disponible.

3. **DTO y entidades**  
   - Incluir `paymentStatus` (y `guestDni` si se usa) en la entidad Booking o en un DTO de respuesta y en mapToEntity.  
   - Respuestas de create/confirm/cancel: devolver un DTO claro (id, startDateTime, endDateTime, price, status, paymentStatus, refreshDate, etc.) en lugar de esparcir la entidad.  
   - Unificar body de creación de cancha (slug vs id): una sola forma (ej. slug + name, surface, isIndoor?, activityTypeId?) y validar con Zod.

4. **Rutas y duplicación**  
   - Considerar una sola familia de rutas para admin de bookings (por slug) y hacer que las rutas sin slug redirijan o exijan header/cookie de club.  
   - Mover lógica de “clientes” de ClientRoutes a un servicio y devolver un DTO; opcionalmente montar bajo `/api/clubs/:slug/clients` o `/api/clients?clubSlug=`.

5. **Configuración**  
   - Unificar puertos y base URL en frontend: un solo `getApiUrl()` usado en todos los módulos (Cash, Health, etc.) y un único fallback para desarrollo.  
   - Documentar en README o env.example: `NEXT_PUBLIC_API_URL` (con o sin `/api`) y `DEFAULT_TIMEZONE` para el backend.

---

## F) Nivel de preparación para multi-país / multi-timezone (1–10)

**Evaluación: 4/10**

- **A favor**: Schema Club tiene `timeZone` (IANA); TimeHelper con date-fns-tz; createBooking convierte date+slotTime a UTC usando timeZone del club; frontend puede enviar date+slotTime.  
- **En contra**: Varios flujos usan “día” en UTC o offset -3h fijo; createFixed y getAdminSchedule no usan timeZone del club de forma consistente; CashService y repositorios no reciben timeZone; refreshDate en UTC; frontend mezcla zona del navegador y zona Argentina fija; no hay tests de timezone.  
- Para multi-país además faltan: moneda por club, idioma, y posiblemente tenant/club en todas las consultas.  
- Conclusión: Base suficiente para un solo país con una zona, pero no preparado para múltiples zonas ni múltiples países sin refactor de fechas y configuración por club.

---

## G) Nivel de deuda técnica (1–10)

**Evaluación: 6/10**

- **A favor**: Estructura por capas (routes, controllers, services, repositories); Prisma y Zod en varios puntos; middleware de auth y rol; CORS y variables de entorno.  
- **En contra**: Validación faltante en varios endpoints; entidad Booking desalineada con Prisma; dos familias de rutas para lo mismo (bookings vs clubs/:slug/admin); ruta /clients fuera de /api y lógica en el handler; timezone mezclado (UTC, -3h, default); puertos y base URL distintos entre pantallas; falta de DTOs explícitos y de tests de integración/contrato.  
- Conclusión: Deuda moderada-alta: funcional para un solo tenant y una zona, pero con riesgo de bugs de seguridad, fechas y mantenibilidad al escalar o cambiar de entorno.

---

*Documento generado a partir del análisis del árbol del proyecto (backend y frontend). Recomendado revisar y priorizar: (1) auth y validación de club en confirm/cancel e history, (2) unificación de “día” con timeZone del club, (3) base URL y validación de inputs en todos los endpoints críticos.*
