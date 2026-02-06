# Admin de un club que reserva en otro club

## Comportamiento actual (y recomendado)

### Qué pasa hoy

1. **Un admin del Club A puede entrar a `/club/club-b`** (otro club) y ver la grilla de turnos de ese club.
2. **Puede reservar** como cualquier usuario: el front envía `courtId` (cancha del Club B), y el backend crea la reserva en ese club.
3. **En el backend**:
   - `POST /api/bookings` no filtra por club del usuario: solo exige `courtId` válido y disponibilidad. Cualquier usuario (o invitado) puede reservar en cualquier cancha.
   - Las rutas **admin** (agenda, confirmar, turnos fijos, etc.) usan `setAdminClubFromUser`: el admin solo ve y gestiona **su** club. Así que el admin del Club A en su panel solo ve Club A; no ve las reservas del Club B.
4. **En “Mis Turnos”** (`/bookings`): el usuario ve **todas** sus reservas (por `userId`), en todos los clubes. Si el admin de A reservó en B, esa reserva aparece en su historial.
5. **En el panel del Club B**: esa reserva aparece en la agenda del día; el admin de B la ve y puede confirmar/cancelar como cualquier otra.

Conclusión: **ya funciona bien**. Un admin puede reservar en otro club como usuario normal; su rol de admin solo afecta a las pantallas y APIs de administración de **su** club.

---

## Cómo debería ser (recomendación)

- **Permitir** que un admin de un club reserve en otro club como cualquier persona.
- **No restringir** en backend ni front por “ser admin” a la hora de crear una reserva en otra cancha/club.
- **Mantener** que:
  - El panel admin solo muestre y gestione el club del usuario (`setAdminClubFromUser`).
  - “Mis Turnos” siga mostrando todas las reservas del usuario en todos los clubes.

Opcional (solo presentación en el otro club):

- Si se quiere que en el **panel del Club B** la reserva no aparezca “a nombre del usuario” sino como “Invitado: Nombre”, se puede enviar `asGuest: true` cuando quien reserva es admin y está reservando en un club que **no** es el suyo. La reserva sigue siendo del mismo usuario en “Mis Turnos”, pero en la vista del Club B se muestra como invitado. Eso es un detalle de UX, no de seguridad.

---

## Resumen

| Acción | Comportamiento |
|--------|-----------------|
| Admin de A entra a `/club/b` | Ve la página pública del Club B y la grilla de turnos. |
| Admin de A reserva en Club B | Se crea la reserva en una cancha del B. Backend no bloquea. |
| Admin de A en su panel (`/admin/agenda`) | Solo ve y gestiona reservas de **su** club (A). |
| Admin de B en su panel | Ve la reserva que hizo el admin de A en B, como cualquier otra. |
| Admin de A en “Mis Turnos” | Ve esa reserva en B junto con las de A y cualquier otro club. |

No hace falta bloquear ni redirigir; el diseño actual es coherente con “admin = gestiona solo su club; como usuario puede reservar donde quiera”.
