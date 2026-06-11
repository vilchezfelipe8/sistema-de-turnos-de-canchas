# Pique — Módulo de Clientes, Usuarios e Identidad

> Documento maestro de producto, arquitectura, UX, reglas de negocio, edge cases y backlog futuro para dejar sólido el módulo de clientes y usuarios de Pique.

**Fecha de referencia:** 2026-06-03  
**Estado:** Documento vivo / Product & Architecture Spec  
**Alcance:** MVP + mejoras futuras + ideas avanzadas + decisiones explícitas  

---

## 0. Resumen ejecutivo

El módulo de clientes y usuarios de Pique tiene que resolver una tensión central:

- El club necesita operar rápido, simple y sin fricción: reservas por mostrador, WhatsApp, teléfono, alumnos, clientes ocasionales, consumos, caja y academia.
- La plataforma necesita una identidad consistente: usuarios que inician sesión, pagan online, ven sus reservas, reciben notificaciones, participan en partidos y tienen historial.

La decisión base es mantener dos entidades separadas:

```txt
User   = identidad digital global de Pique
Client = ficha operativa local de una persona dentro de un club
```

No se elimina `Client`. No se obliga a que toda persona tenga `User`. No se crea `User` automáticamente desde admin. No se hacen merges ni vínculos automáticos peligrosos.

La solución correcta no es fusionar entidades, sino centralizar la política de resolución de identidad:

```txt
Cuando hay certeza fuerte, el sistema ayuda.
Cuando hay duda, pregunta.
Cuando hay conflicto, bloquea.
Cuando hay operación manual, audita.
```

---

## 1. Objetivos del módulo

### 1.1. Objetivo de producto

Permitir que el club administre personas de forma simple, sin tener que entender conceptos técnicos como usuario global, vínculo, merge, identidad partida o deduplicación.

El admin debería sentir que está manejando “personas del club”.

### 1.2. Objetivo técnico

Mantener consistencia entre:

- reservas;
- clientes;
- usuarios;
- pagos;
- caja;
- academia;
- participantes;
- notificaciones;
- historial;
- reportes;
- auditoría.

### 1.3. Objetivo de datos

Evitar duplicados silenciosos, datos contradictorios y vínculos incorrectos.

El sistema no puede garantizar que nunca existan duplicados, pero sí debe garantizar que Pique no cree duplicados automáticamente cuando tiene información suficiente para evitarlos.

### 1.4. Objetivo de UX

Convertir problemas de identidad en flujos claros:

- “Encontramos una persona parecida”;
- “Este dato ya pertenece a otro cliente”;
- “Este usuario ya está vinculado”;
- “Necesitamos revisar antes de continuar”.

Nunca mostrar errores crudos o técnicos al usuario final del club.

---

## 2. Glosario

| Concepto | Definición |
|---|---|
| `User` | Identidad digital global de Pique. Puede iniciar sesión y operar en la app. |
| `Client` | Ficha operativa de una persona dentro de un club. Puede no tener usuario. |
| `Membership` | Relación de acceso de un `User` con un club como OWNER, ADMIN, STAFF o MEMBER. |
| `Booking` | Reserva. Siempre debe tener `clientId`. Puede tener `userId`. |
| `Account` | Cuenta financiera. Puede tener o no `clientId`. |
| `Link` | Vinculación manual o automática segura entre `Client` y `User`. |
| `Merge` | Consolidación manual de dos `Client` del mismo club. |
| `Identity Hint` | Dato usado para resolver identidad: teléfono, email, DNI, userId, etc. |
| `Strong Match` | Coincidencia fuerte por teléfono, email o DNI normalizado. |
| `Weak Match` | Coincidencia débil por nombre, parecido textual o contexto insuficiente. |
| `Canonical Client` | Cliente principal luego de resolver duplicados o merge. |
| `Merged Client` | Cliente absorbido que queda como rastro histórico. |
| `Identity Incident` | Evento auditado relacionado con duplicados, conflictos o resolución manual. |
| `PersonInClub` | Concepto de producto: persona dentro del club = `Client` + `User` opcional. |

---

## 3. Modelo conceptual

### 3.1. User

`User` representa la identidad digital global de Pique.

Un `User` puede:

- iniciar sesión;
- tener email verificado;
- tener teléfono;
- tener DNI/documento;
- ver “mis reservas”;
- pagar online;
- recibir notificaciones;
- pertenecer a uno o varios clubes;
- ser titular de reservas;
- participar en reservas;
- eventualmente tener reputación, preferencias y perfil deportivo.

Un `User` no necesariamente es cliente de ningún club.

### 3.2. Client

`Client` representa la ficha local del club.

Un `Client` puede:

- ser titular operativo de reservas;
- tener historial en el club;
- tener saldo/deuda;
- estar asociado a cuentas;
- comprar productos;
- estar en academia;
- ser alumno;
- ser consumidor frecuente;
- no tener cuenta digital;
- estar vinculado opcionalmente a un `User`.

Un `Client` puede existir sin `User`.

### 3.3. Membership

`Membership` representa acceso/rol dentro del club.

No debe confundirse con identidad de jugador.

Un usuario puede tener reservas o actividad en un club sin ser admin/staff/member del club en sentido operativo.

Membership sirve para permisos, no necesariamente para determinar si una persona “existe” como jugador/cliente del club.

### 3.4. Booking

`Booking` debe mantener `clientId` obligatorio.

`Booking.userId` puede existir cuando hay un usuario digital conocido.

Regla target:

- toda reserva tiene `clientId`;
- toda reserva pública creada por usuario logueado tiene `userId`;
- si se puede vincular de forma segura `Client.userId`, se debe hacer;
- no se debe crear identidad partida innecesaria.

### 3.5. PersonInClub

Para producto, UI y reportes se recomienda pensar en una entidad conceptual:

```txt
PersonInClub = Client + User opcional
```

La UI no debería exponer permanentemente “cliente vs usuario”, salvo en vistas avanzadas.

---

## 4. Decisiones base

| Tema | Decisión |
|---|---|
| Separar `User` y `Client` | Sí |
| Eliminar `Client` | No |
| Cliente sin usuario | Sí, permitido |
| Usuario sin cliente | Sí, permitido |
| Reserva sin cliente | No |
| Reserva pública logueada sin `userId` | No debería pasar |
| Crear `User` automáticamente desde admin | No |
| Vincular automáticamente con match fuerte único | Sí |
| Vincular automáticamente con ambigüedad | No |
| Merge automático | No |
| Merge manual | Sí, futuro/según prioridad |
| Duplicados imposibles al 100% | No es objetivo realista |
| Evitar duplicados silenciosos | Sí |
| `forceCreateNew` | Sí, restringido y auditado |
| Ocultar mergeados en operación diaria | Sí |
| Checkout jugador titular | Sí |
| Pago por participantes | Futuro |
| Participantes pagan por otros | No en primera etapa |
| Academia exige `User` | No |
| `person-search` y link manual alineados | Sí |

---

## 5. Principios rectores

### 5.1. Operación simple para el club

El club no debe tener que entender el modelo técnico.

La experiencia debe hablar en lenguaje cotidiano:

- “cliente existente”;
- “persona parecida”;
- “usar este cliente”;
- “crear nuevo”;
- “revisar conflicto”.

### 5.2. El sistema ayuda cuando puede estar seguro

Si hay un único match fuerte y libre, Pique debe reutilizar/vincular.

Ejemplo:

- usuario logueado con teléfono 3511234567;
- existe un único `Client` activo del club con ese teléfono;
- ese `Client` no tiene `userId`;
- el sistema puede vincular automáticamente.

### 5.3. El sistema pregunta cuando hay duda

Si hay múltiples candidatos, no elegir arbitrariamente.

Debe mostrar candidatos y pedir resolución humana.

### 5.4. El sistema bloquea cuando hay conflicto

Si el dato fuerte pertenece a un cliente vinculado a otro usuario, bloquear.

Si un usuario ya está vinculado a otro cliente activo del mismo club, bloquear.

### 5.5. Toda resolución manual debe auditarse

Cualquier acción sensible debe generar registro:

- creación forzada;
- link;
- unlink;
- merge;
- edición de teléfono/email/DNI;
- resolución de duplicado;
- bloqueo por conflicto.

---

## 6. Estado actual del módulo

### 6.1. Lo que está bien encaminado

- `Client` y `User` están separados correctamente.
- `Booking.clientId` obligatorio mantiene continuidad operativa.
- Existe deduplicación en alta manual de cliente.
- Existe `ensureClientForUser` para reserva admin con `systemUser`.
- La reserva admin con `systemUser` es el flujo más sólido.
- POS puede operar sin cliente o con cliente draft.
- El checkout del titular autenticado ya existe.
- Hay tests sobre varios flujos críticos.

### 6.2. Riesgos detectados

- La edición manual de cliente no aplica la misma deduplicación que el alta.
- La reserva pública logueada puede dejar `Booking.userId` poblado pero `Client.userId = null`.
- `person-search` puede mostrar usuarios que luego link manual rechaza.
- Clientes mergeados pueden seguir apareciendo en vistas operativas.
- La política de identidad está distribuida entre varios servicios.

### 6.3. Riesgo principal

La identidad partida:

```txt
Booking.userId = user.id
Booking.clientId = client.id
Client.userId = null
```

Ese estado puede existir por legacy, pero no debería generarse en nuevos flujos cuando hay certeza fuerte.

---

## 7. Política madre de resolución de identidad

Para cualquier flujo donde Pique ya conoce un `User`, aplicar:

1. Si el usuario ya tiene `Client` activo vinculado en ese club, usar ese.
2. Si no tiene, buscar coincidencias fuertes por teléfono, email o DNI.
3. Si hay un único `Client` coincidente, activo y libre, reutilizarlo y vincularlo.
4. Si hay múltiples candidatos, bloquear resolución automática y pedir decisión manual.
5. Si el candidato está vinculado a otro usuario, bloquear.
6. Si no hay match fuerte, crear `Client` nuevo vinculado al `User`.

Servicio recomendado:

```ts
ClientIdentityResolutionService
```

Método principal:

```ts
ensureClientForKnownUser(clubId, userId, identityHints)
```

Métodos complementarios:

```ts
resolveClientForDraft(clubId, draft)
detectClientDuplicates(clubId, identityFields)
linkUserToClient(clubId, clientId, userId, actorId)
mergeClients(clubId, sourceClientId, targetClientId, actorId)
archiveClient(clubId, clientId, actorId)
raiseIdentityIncident(...)
```

---

## 8. Match de identidad

### 8.1. Señales fuertes

Se consideran señales fuertes:

- teléfono normalizado exacto;
- email normalizado exacto;
- DNI/documento normalizado exacto.

### 8.2. Señales medias

Pueden ayudar a ordenar candidatos, pero no deberían vincular automáticamente por sí solas:

- nombre + teléfono parcial;
- nombre + email parecido;
- historial de reservas en el mismo club;
- actividad reciente;
- coincidencia de apellido;
- mismo organizador recurrente;
- mismo grupo frecuente.

### 8.3. Señales débiles

No deben generar vínculo automático:

- nombre parecido;
- apellido parecido;
- coincidencia fonética;
- misma inicial;
- mismo horario habitual;
- mismo deporte;
- mismo club sin otro dato.

### 8.4. Scoring futuro

A futuro se puede implementar un score de confianza.

Ejemplo:

| Señal | Puntos |
|---|---:|
| Teléfono exacto | 80 |
| Email exacto | 80 |
| DNI exacto | 95 |
| Nombre exacto | 20 |
| Apellido exacto | 20 |
| Reserva previa con mismo usuario | 50 |
| Actividad reciente en club | 20 |

Regla sugerida:

- 90+ → match automático si no hay conflicto;
- 60-89 → sugerir y pedir confirmación;
- <60 → no vincular.

No implementar score complejo en MVP si no hace falta, pero dejarlo documentado como dirección.

---

## 9. Normalización de datos

### 9.1. Teléfono

Reglas target:

- guardar formato normalizado interno;
- conservar display opcional;
- remover espacios, guiones, paréntesis;
- soportar país;
- Argentina por defecto al inicio;
- evitar comparar teléfonos crudos.

Ejemplos equivalentes:

```txt
351 123 4567
+54 9 351 1234567
0351-1234567
```

### 9.2. Email

Reglas:

- lowercase;
- trim;
- validar formato;
- no comparar con espacios;
- evitar duplicados por mayúsculas.

### 9.3. DNI/documento

Reglas:

- normalizar quitando puntos y espacios;
- soportar documentos por país a futuro;
- no asumir que todos los clubes son argentinos;
- permitir campo opcional.

### 9.4. Nombre y apellido

No usarlos como identidad fuerte.

Sí usarlos para:

- mostrar candidatos;
- ordenar resultados;
- mejorar búsqueda;
- detectar posibles duplicados suaves.

---

## 10. Deduplicación

### 10.1. Alta de cliente

Al crear un `Client`:

1. Normalizar teléfono, email, DNI.
2. Buscar coincidencias fuertes dentro del mismo club.
3. Si no hay match, crear.
4. Si hay match único, sugerir reutilizar.
5. Si hay múltiples matches, bloquear.
6. Si hay conflicto con cliente vinculado a otro usuario, bloquear.
7. Si se fuerza creación, auditar.

### 10.2. Edición de cliente

La edición debe aplicar la misma protección que el alta.

Reglas:

- si cambia teléfono, email o DNI, ejecutar deduplicación;
- si aparece otro cliente activo con ese dato, bloquear o pedir resolución;
- si el dato pertenece a cliente vinculado a otro usuario, bloquear;
- si no cambian datos identitarios, permitir;
- si solo cambian nombre/notas, permitir.

Prioridad: alta/urgente.

### 10.3. Creación forzada

`forceCreateNew` debe existir, pero restringido.

Reglas:

- solo admins con permiso suficiente;
- advertencia clara;
- no como acción principal;
- registrar motivo;
- auditar;
- no permitir si rompe invariante dura.

Texto sugerido:

```txt
Crear igual
No recomendado. Puede generar duplicados en el historial del club.
```

### 10.4. Incidentes de duplicado

Registrar:

- candidatos encontrados;
- datos que dispararon el match;
- actor;
- decisión tomada;
- motivo si se forzó creación;
- timestamp;
- origen del flujo.

---

## 11. Flujos principales

### 11.1. Registro normal

- crea `User`;
- no crea `Client`;
- no crea `Membership`;
- no vincula club.

Correcto.

### 11.2. Magic link

- crea o actualiza `User`;
- no crea `Client`;
- no vincula automáticamente a clubes.

Correcto.

### 11.3. Invitación a staff/admin

- crea/usa `Membership`;
- no necesariamente crea `Client`;
- membership no equivale a jugador/cliente.

Correcto.

### 11.4. Alta manual desde admin

- crea `Client`;
- no crea `User`;
- aplica deduplicación;
- puede forzar con permiso.

Correcto con controles.

### 11.5. Edición manual desde admin

Debe corregirse para aplicar deduplicación.

### 11.6. Reserva pública no logueada

- puede usar `clientDraft`;
- resuelve o crea `Client`;
- no crea `User`;
- no vincula usuario;
- aplica deduplicación.

### 11.7. Reserva pública logueada

Target:

```txt
Booking.userId = user.id
Booking.clientId = client.id
Client.userId = user.id si es seguro
```

No dejar identidad partida si hay match claro.

### 11.8. Reserva admin con clubClient

- usa `Client` seleccionado;
- si tiene `userId`, puede poblar titular digital;
- no intenta corregir automáticamente identidades si el admin eligió explícitamente.

### 11.9. Reserva admin con systemUser

Debe usar `ensureClientForKnownUser`.

Este flujo es el modelo target.

### 11.10. Reserva admin con newClient

- resolver duplicados;
- reutilizar si match único;
- bloquear si múltiples;
- crear sin `User` si no hay match;
- no crear usuario automáticamente.

### 11.11. POS / caja

- cliente opcional;
- “Consumidor final” permitido;
- si hay clientDraft, resolver con deduplicación;
- no vincular `User` automáticamente.

---

## 12. person-search

### 12.1. Objetivo

Buscar personas relevantes para un club combinando:

- clientes del club;
- usuarios vinculados;
- usuarios con membership;
- usuarios con reservas;
- usuarios con coincidencias fuertes;
- actividad relevante.

### 12.2. Tipos de resultado

- `clubClient`;
- `linked`;
- `systemUser`;
- futuro: `candidate`;
- futuro: `conflict`;
- futuro: `merged/archived` con toggle.

### 12.3. Problema actual

No debe mostrar como vinculable algo que luego link manual rechaza.

### 12.4. Decisión target

Si `person-search` muestra un `systemUser` como candidato vinculable, `linkUserToClient` debe aceptarlo siempre que:

- el usuario no esté vinculado a otro cliente activo del club;
- el cliente no esté vinculado a otro usuario;
- exista señal fuerte o relación suficiente;
- el actor tenga permiso.

Si no es vinculable, mostrar deshabilitado con motivo.

---

## 13. Vinculación Client ↔ User

### 13.1. Link automático seguro

Permitido cuando:

- hay match fuerte único;
- no hay conflicto;
- el flujo conoce `User`;
- el `Client` está libre;
- el `User` no tiene otro `Client` activo en el club.

### 13.2. Link manual

Debe requerir:

- permiso;
- confirmación;
- auditoría;
- preview del impacto.

### 13.3. Unlink

Debe existir eventualmente para corregir errores.

Reglas:

- no borrar historial;
- registrar actor y motivo;
- mantener reservas pasadas;
- decidir qué pasa con reservas futuras.

### 13.4. UI de link

Texto sugerido:

```txt
Vincular usuario de Pique
Este cliente quedará asociado a la cuenta digital de la persona.
A partir de ahora podrá ver sus reservas y operar desde la app si corresponde.
```

---

## 14. Merge de clientes

### 14.1. Decisión

No hacer merge automático.

Sí permitir merge manual futuro.

### 14.2. Modelo sugerido

```txt
Client.status = ACTIVE | ARCHIVED | MERGED
Client.mergedIntoClientId
Client.mergedAt
Client.mergedByUserId
Client.mergeReason
```

### 14.3. Reglas

- el destino queda activo;
- el origen queda `MERGED`;
- no borrar filas;
- mover o redireccionar referencias según corresponda;
- preservar auditoría;
- ocultar mergeados en operación diaria.

### 14.4. UI ideal de merge

Pantalla comparativa:

| Campo | Cliente A | Cliente B | Resultado |
|---|---|---|---|
| Nombre | Juan Pérez | Juan P. | Juan Pérez |
| Teléfono | 351... | 351... | 351... |
| Email | - | juan@mail.com | juan@mail.com |
| Reservas | 12 | 3 | 15 |
| Saldo | $0 | $500 | $500 |

Acciones:

- elegir cliente canónico;
- elegir datos finales;
- confirmar impacto;
- mergear.

### 14.5. Futuro avanzado

- sugerencias automáticas de posibles merges;
- cola de revisión;
- merge asistido por score;
- revertir merge si fue error;
- reporte de limpieza de base.

---

## 15. Archivado de clientes

### 15.1. Diferencia entre archivar y mergear

Archivar:

- cliente deja de usarse operativamente;
- no necesariamente fue duplicado;
- puede ser baja, inactividad o error.

Mergear:

- cliente fue absorbido por otro;
- hay cliente canónico.

### 15.2. Regla UI

Por defecto mostrar solo `ACTIVE`.

Agregar toggle:

```txt
Incluir archivados y mergeados
```

---

## 16. Checkout y pagos

### 16.1. Titular

Para MVP:

- paga solo el titular;
- titular digital se resuelve por `booking.userId` primero;
- luego `booking.client.userId`;
- luego organizer participant si existe.

### 16.2. Reserva pública logueada

Debe quedar lista para checkout.

Si el usuario creó la reserva, debe aparecer en “mis reservas”.

### 16.3. Participantes

No MVP inmediato.

Futuro:

- cada participante paga su parte;
- no se permite inicialmente pagar por otro;
- participante debe ser `User`;
- invitaciones con link;
- estado de pago por participante.

### 16.4. Casos futuros

- split payment;
- seña + saldo;
- pago parcial;
- pago mixto;
- pago por transfer/manual;
- pago offline marcado por admin;
- link de pago enviado por WhatsApp;
- recordatorios automáticos;
- bloqueo por deuda según política del club.

---

## 17. Participantes de reserva

### 17.1. Decisión actual

No implementar completo ahora.

### 17.2. Dirección futura

Una reserva puede tener:

- titular;
- participantes;
- invitados pendientes;
- participantes confirmados;
- participantes que pagaron;
- participantes que cancelaron.

### 17.3. Reglas recomendadas

- titular no es responsable automáticamente por todos;
- cada participante paga su parte;
- no pagar por otros en primera etapa;
- participantes deben ser usuarios reales;
- evitar agregar personas sin consentimiento o trazabilidad;
- permitir que se bajen solos según reglas del club;
- notificar cambios.

---

## 18. Academia

### 18.1. Decisión

Academia debe operar sobre `Client`.

No exigir `User`.

### 18.2. Casos

- alumno menor sin usuario;
- padre/madre como contacto;
- alumno adulto con usuario;
- profesor admin/staff;
- cliente de reservas que también es alumno;
- alumno que paga packs;
- alumno con deuda;
- baja temporal.

### 18.3. Futuro

- portal del alumno;
- notificaciones de clases;
- pagos de packs;
- historial de asistencia;
- recuperación de clases;
- responsables/familiares;
- grupos recurrentes;
- listas de espera.

---

## 19. UX ideal para resolución de identidad

### 19.1. Posible duplicado

```txt
Encontramos clientes parecidos
Antes de crear uno nuevo, revisá si esta persona ya existe en el club.
```

Mostrar:

- nombre;
- teléfono;
- email;
- DNI;
- última reserva;
- deuda/saldo;
- etiquetas: vinculado a usuario, archivado, mergeado;
- nivel de coincidencia.

Acciones:

- usar este cliente;
- crear nuevo de todos modos;
- cancelar.

### 19.2. Conflicto fuerte

```txt
Este teléfono/email/documento ya pertenece a otro cliente del club.
Revisá el cliente existente antes de continuar.
```

Acciones:

- ver cliente existente;
- cancelar.

### 19.3. Usuario ya vinculado

```txt
Este usuario ya está asociado a otro cliente del club.
No se puede vincular automáticamente.
```

Acciones:

- ver cliente asociado;
- cancelar.

### 19.4. Identidad pendiente

Para casos donde se permite operar pero queda algo a revisar:

```txt
Reserva creada, pero la identidad quedó pendiente de revisión.
```

Esto debería usarse con cuidado.

---

## 20. Estados e indicadores de identidad

### 20.1. Estados posibles de Client

```txt
ACTIVE
ARCHIVED
MERGED
PENDING_REVIEW
```

### 20.2. Estado de vínculo

```txt
UNLINKED
LINKED
LINK_CANDIDATE
LINK_CONFLICT
LINK_PENDING_REVIEW
```

### 20.3. Badges UI

- “Tiene cuenta Pique”;
- “Sin cuenta”;
- “Posible duplicado”;
- “Archivado”;
- “Mergeado”;
- “Revisar identidad”;
- “Dato compartido”.

---

## 21. Auditoría

Registrar eventos:

- `CLIENT_CREATED`;
- `CLIENT_UPDATED_IDENTITY_FIELD`;
- `CLIENT_DUPLICATE_DETECTED`;
- `CLIENT_FORCE_CREATED`;
- `CLIENT_LINKED_TO_USER`;
- `CLIENT_UNLINKED_FROM_USER`;
- `CLIENT_MERGED`;
- `CLIENT_ARCHIVED`;
- `IDENTITY_CONFLICT_BLOCKED`;
- `BOOKING_CREATED_WITH_KNOWN_USER`;
- `BOOKING_CREATED_WITH_IDENTITY_PENDING`.

Cada evento debería tener:

- clubId;
- actorId;
- clientId;
- userId si aplica;
- bookingId si aplica;
- before/after de campos sensibles;
- motivo;
- source flow;
- timestamp.

---

## 22. Permisos

### 22.1. Acciones sensibles

Requieren permiso específico:

- crear cliente forzado;
- link manual;
- unlink;
- merge;
- archivar;
- editar teléfono/email/DNI;
- ver auditoría;
- resolver conflicto.

### 22.2. Roles sugeridos

| Acción | OWNER | ADMIN | STAFF |
|---|---:|---:|---:|
| Crear cliente | Sí | Sí | Sí |
| Forzar duplicado | Sí | Sí | No/Configurable |
| Editar datos identitarios | Sí | Sí | Configurable |
| Link manual | Sí | Sí | No/Configurable |
| Merge | Sí | Sí | No |
| Ver auditoría | Sí | Sí | No |

---

## 23. Configuración por club

A futuro, cada club podría configurar:

- si permite crear duplicados forzados;
- qué campos son obligatorios;
- si DNI es requerido;
- si teléfono es requerido;
- si email es requerido;
- si staff puede editar identidad;
- si staff puede resolver duplicados;
- si se permiten clientes sin teléfono;
- si se bloquea reserva pública ante conflicto;
- política de deuda;
- política de cancelación;
- política de pago online.

Para MVP, mantener configuración simple.

---

## 24. Calidad de datos

### 24.1. Panel futuro

Un panel de calidad de datos por club podría mostrar:

- clientes sin teléfono;
- clientes sin email;
- clientes sin DNI;
- posibles duplicados;
- clientes con datos inválidos;
- clientes sin actividad;
- clientes mergeados;
- clientes pendientes de revisión;
- porcentaje de clientes con cuenta Pique.

### 24.2. Acciones sugeridas

- revisar duplicados;
- completar datos;
- invitar a crear cuenta;
- archivar inactivos;
- mergear candidatos.

---

## 25. Experiencia avanzada/flayera

### 25.1. Asistente de limpieza de clientes

Un asistente que diga:

```txt
Detectamos 23 posibles duplicados.
Te mostramos los más seguros primero.
```

Acciones:

- revisar uno por uno;
- mergear;
- ignorar;
- marcar como personas distintas.

### 25.2. Timeline de persona

En vez de ver solo datos, ver:

- primera reserva;
- última reserva;
- pagos;
- clases;
- cancelaciones;
- incidencias;
- merge/link/unlink;
- notas internas.

### 25.3. Perfil 360° del cliente

Vista completa:

- datos personales;
- reservas;
- pagos;
- deuda;
- academia;
- consumos;
- preferencias;
- comportamiento;
- notas;
- grupo frecuente;
- nivel de confianza de identidad.

### 25.4. Sugerencias inteligentes

Ejemplos:

```txt
Este cliente parece ser el mismo que Juan Pérez.
Coinciden teléfono y apellido.
```

```txt
Este usuario reservó 4 veces pero todavía no está vinculado al cliente del club.
```

```txt
Hay 12 clientes con teléfonos incompletos. Podés revisarlos cuando quieras.
```

### 25.5. Modo “no molestar al admin”

No interrumpir siempre.

Clasificar problemas:

- bloqueante;
- advertencia;
- revisión posterior;
- sugerencia.

### 25.6. Resolución posterior

Permitir que el club siga operando y deje una cola de revisión, salvo conflictos críticos.

---

## 26. Métricas del módulo

Medir:

- cantidad de clientes activos;
- clientes sin usuario;
- clientes vinculados;
- duplicados detectados;
- duplicados forzados;
- merges realizados;
- conflictos bloqueados;
- reservas con `booking.userId`;
- reservas con identidad partida;
- checkout exitoso desde app;
- tiempo promedio para crear reserva;
- frecuencia de aparición del modal de duplicados;
- tasa de abandono por conflicto de identidad.

---

## 27. Testing

### 27.1. Tests críticos

- alta duplicada por teléfono bloquea;
- alta duplicada por email bloquea;
- alta duplicada por DNI bloquea;
- edición hacia teléfono existente bloquea;
- edición hacia email existente bloquea;
- edición hacia DNI existente bloquea;
- reserva pública logueada usa client vinculado;
- reserva pública logueada vincula match fuerte único;
- reserva pública logueada crea client vinculado si no hay match;
- reserva pública logueada bloquea múltiples matches;
- reserva pública logueada bloquea conflicto con otro user;
- admin systemUser reutiliza client;
- admin newClient reutiliza match;
- link manual respeta elegibilidad de person-search;
- merge oculta cliente origen de listas operativas;
- checkout reconoce reserva por `booking.userId`.

### 27.2. Tests de UX/API

- errores devuelven códigos semánticos;
- frontend puede mostrar candidatos;
- force create exige flag y permiso;
- conflictos incluyen razón clara;
- no se exponen errores técnicos.

---

## 28. Errores y códigos recomendados

| Código | Uso |
|---|---|
| `CLIENT_POSSIBLE_DUPLICATE` | Hay candidatos y se requiere resolución. |
| `CLIENT_IDENTITY_CONFLICT` | Dato fuerte pertenece a otro cliente/usuario. |
| `CLIENT_ALREADY_LINKED` | Cliente ya vinculado a otro usuario. |
| `USER_ALREADY_LINKED_TO_CLIENT` | Usuario ya tiene cliente activo en club. |
| `CLIENT_MERGED_NOT_SELECTABLE` | Se intentó usar un cliente mergeado. |
| `CLIENT_ARCHIVED_NOT_SELECTABLE` | Se intentó usar un cliente archivado. |
| `IDENTITY_REVIEW_REQUIRED` | La operación requiere revisión manual. |
| `FORCE_CREATE_NOT_ALLOWED` | Actor sin permiso para forzar duplicado. |

---

## 29. Roadmap recomendado

### Fase 1 — Blindaje inmediato

- deduplicación en edición;
- ocultar mergeados;
- alinear `person-search` y link manual;
- tests críticos.

### Fase 2 — Servicio central

- crear/consolidar `ClientIdentityResolutionService`;
- mover reglas comunes;
- usarlo en reservas, clientes, POS, checkout y academia.

### Fase 3 — Reserva pública logueada perfecta

- siempre `Booking.userId`;
- vincular `Client.userId` si hay match fuerte;
- bloquear ambigüedad;
- evitar identidad partida nueva.

### Fase 4 — UX de resolución

- modal/drawer de duplicados;
- comparación de candidatos;
- usar existente;
- crear igual con permiso;
- auditoría.

### Fase 5 — Operación avanzada

- merge manual robusto;
- archivado;
- panel de calidad de datos;
- cola de revisión.

### Fase 6 — Experiencia jugador

- participantes;
- pago por parte;
- invitaciones;
- mis reservas completas;
- perfil jugador;
- notificaciones inteligentes.

### Fase 7 — Inteligencia y automatización segura

- sugerencias de merge;
- scoring;
- limpieza asistida;
- detección de datos raros;
- insights para el club.

---

## 30. No hacer ahora, pero dejar documentado

- merge automático;
- creación automática de `User` desde admin;
- obligación de cuenta para reservar;
- pagos por participantes;
- pago por otros participantes;
- perfil público jugador completo;
- reputación avanzada;
- scoring automático como fuente de verdad;
- reglas complejas de familias/responsables;
- bloqueo automático por deuda global;
- normalización multi-país avanzada;
- IA tomando decisiones sin revisión humana.

---

## 31. Preguntas abiertas

1. ¿Qué campos serán obligatorios por defecto para crear `Client`?
2. ¿Permitimos clientes sin teléfono en clubes muy operativos?
3. ¿Quién puede forzar duplicados?
4. ¿Quién puede editar teléfono/email/DNI?
5. ¿El club puede desactivar reserva pública si hay conflicto de identidad?
6. ¿Qué pasa si un padre reserva por un hijo?
7. ¿Cómo modelar responsables/familias en academia?
8. ¿Cuándo permitir unlink?
9. ¿Se puede revertir merge?
10. ¿La app jugador mostrará reservas creadas por admin si el cliente está vinculado?
11. ¿Qué nivel de auditoría se muestra al club?
12. ¿Cómo tratar datos importados desde sistemas anteriores?

---

## 32. Criterios de aceptación globales

El módulo se considera sólido cuando:

- crear cliente no genera duplicados silenciosos;
- editar cliente no genera duplicados silenciosos;
- reserva pública logueada no deja identidad partida si hay match fuerte;
- admin puede operar rápido sin entender el modelo técnico;
- los errores se convierten en decisiones de producto;
- mergeados/archivados no contaminan operación diaria;
- checkout del titular funciona de forma consistente;
- existe auditoría de acciones sensibles;
- todos los flujos usan la misma política de identidad;
- los casos ambiguos se bloquean o pasan a revisión.

---

---

## 34. Addendum 2026-06-03 — Incidentes, verificación y UX de identidad invisible

Este addendum consolida decisiones y recomendaciones surgidas de la revisión del módulo de clientes/usuarios de Pique. El objetivo es dejar el módulo documentado como una capa de **Personas e Identidad**, no solo como una separación técnica entre `User` y `Client`.

La idea central es:

```txt
Pique gestiona personas.
Al club le muestra clientes.
Al jugador le muestra su perfil e historial.
Al sistema le mantiene User y Client separados.
```

La separación técnica `User` / `Client` debe existir en arquitectura, pero no debe ser la forma principal en la que el admin o el jugador entienden el producto.

---

## 35. Incidentes de identidad y datos

### 35.1. Definición conceptual

Un incidente no debe entenderse como un error técnico ni como un sistema automático de corrección. Debe entenderse como:

```txt
Algo que Pique detectó y no pudo resolver con suficiente certeza.
```

Hoy los incidentes están acotados a una bandeja operativa de posibles duplicados. Esa base está bien, pero a futuro pueden evolucionar hacia una bandeja de **revisión de identidad y calidad de datos**.

### 35.2. Estado actual conocido

Actualmente los incidentes aparecen cuando un flujo falla con `CLIENT_POSSIBLE_DUPLICATE` y el error trae `candidateClientIds`.

Se generan en:

- alta manual de cliente (`ADMIN`);
- reserva normal (`BOOKING`);
- reserva fija (`FIXED_BOOKING`);
- caja / cotización de caja (`CASH`).

No se observaron generándose en:

- edición de cliente;
- link manual `Client -> User`;
- merge manual;
- `person-search`.

### 35.3. Datos que guarda un incidente

Cada incidente guarda o debería guardar:

- `status`: `OPEN`, `RESOLVED`, `DISMISSED`;
- `reasonType`: `PHONE`, `EMAIL`, `DNI`, `MULTI_SIGNAL_CONFLICT`, etc.;
- `sourceType`: flujo que originó el incidente;
- `userId`: opcional, solo si el conflicto involucra un usuario identificable;
- `primaryClientId`;
- `candidateClientIds`;
- `payload` con contexto del flujo;
- `dedupeKey` para evitar abrir muchas veces el mismo incidente.

La `dedupeKey` evita que el mismo conflicto abra 20 incidentes iguales. Si vuelve a pasar el mismo conflicto, debería reutilizarse el incidente `OPEN` existente y actualizar su `payload`.

### 35.4. Qué hacen y qué no hacen los incidentes

Los incidentes sí sirven para:

- dejar trazabilidad;
- alimentar una cola de revisión;
- mostrarle al club posibles problemas;
- conectar errores de deduplicación con acciones de resolución;
- dar contexto al equipo de soporte o admins avanzados;
- medir calidad de datos.

Los incidentes no deben:

- hacer merge automático;
- hacer link automático diferido sin certeza;
- corregir datos por su cuenta;
- bloquear clientes globalmente;
- resolver identidad sin acción explícita;
- convertirse en la política de identidad.

La política de identidad debe vivir en servicios de dominio. El incidente es registro, cola y soporte de UX.

### 35.5. Nombre de producto recomendado

Internamente puede llamarse `ClientIdentityIncident`.

En la UI del club no se recomienda usar “incidentes”, porque suena técnico o grave. Opciones mejores:

- “Clientes para revisar”;
- “Revisión de clientes”;
- “Calidad de datos”;
- “Posibles duplicados”;
- “Vínculos pendientes”.

Texto sugerido:

```txt
Clientes para revisar

Encontramos posibles problemas en algunos clientes del club.
Revisarlos ayuda a evitar duplicados, errores de cobro y reservas mal asociadas.
```

### 35.6. Categorías futuras de incidentes

#### Incidentes bloqueantes

Casos donde el sistema no debería dejar avanzar sin resolución:

- teléfono ya usado por otro cliente activo y sin excepción válida;
- DNI ya usado por otro cliente activo;
- email ya usado por otro cliente activo vinculado a cuenta;
- `User` ya vinculado a otro `Client` del mismo club;
- múltiples clientes candidatos para un usuario logueado;
- conflicto fuerte entre datos verificados.

#### Incidentes no bloqueantes

Casos donde se puede seguir operando, pero conviene revisar:

- nombre muy parecido sin señal fuerte;
- cliente sin teléfono;
- cliente sin email;
- teléfono incompleto;
- cliente con muchas reservas pero sin cuenta vinculada;
- posible duplicado por patrones de comportamiento.

#### Incidentes informativos

Casos que dan contexto, pero no necesariamente requieren acción inmediata:

- cliente mergeado usado en un flujo legacy;
- usuario cambió teléfono;
- cliente archivado reactivado;
- historial repartido entre varios clientes;
- dato importado desde sistema anterior.

### 35.7. Flujos donde deberían crearse incidentes

| Flujo | Crear incidente | Comentario |
|---|---:|---|
| Alta manual de cliente | Sí | Ya existe y está bien |
| Edición de cliente | Sí, urgente | Hoy es un hueco importante |
| Reserva normal | Sí | Ya existe |
| Reserva fija | Sí | Ya existe |
| Caja / cotización | Sí | Afecta cobros y cuentas |
| Link manual Client → User | Sí | Si hay conflicto o rechazo |
| Merge manual | Auditar / resolver incidente | No necesariamente abrir uno nuevo |
| person-search | No por buscar | Solo si se intenta una acción conflictiva |
| Reserva pública logueada | Sí | Si no se puede asociar con certeza |
| Checkout jugador | Sí | Si hay conflicto de pagador/identidad |
| Academia | Sí | Especialmente alumno/responsable/familia |

### 35.8. Edición de cliente como prioridad

La edición debe generar o reutilizar incidente si se intenta guardar un teléfono/email/DNI que ya pertenece a otro cliente.

Caso:

```txt
Admin edita el teléfono de Juan y pone un teléfono que ya tiene Pedro.
```

Comportamiento recomendado:

1. Bloquear guardado si el conflicto es fuerte.
2. Mostrar mensaje claro.
3. Crear o reutilizar incidente con `dedupeKey`.
4. Permitir revisar ambos clientes.
5. Permitir corregir, fusionar o cancelar.
6. No mostrar “guardar igual” como acción común.

Mensaje sugerido:

```txt
Este teléfono ya está usado por otro cliente del club.

Cliente existente:
Pedro Gómez · 351...

Revisá ambos clientes antes de guardar este cambio.
```

Acciones:

- Ver cliente existente;
- Revisar posible duplicado;
- Cancelar.

### 35.9. Link manual Client → User

Si el admin intenta vincular un cliente a una cuenta de Pique y el sistema detecta conflicto, debe quedar trazado.

Ejemplo:

```txt
Querés vincular a Juan Pérez con la cuenta juan@mail.com,
pero esa cuenta ya está vinculada a Juan P.
```

Debe generar/reutilizar incidente:

```txt
reasonType = USER_ALREADY_LINKED | MULTI_CLIENT_MATCH | SIGNAL_CONFLICT
sourceType = MANUAL_LINK
primaryClientId = cliente que se intentó vincular
candidateClientIds = cliente ya vinculado / candidatos
userId = user involucrado
```

Mensaje UI:

```txt
No pudimos vincular esta cuenta automáticamente.

Esta cuenta de Pique parece estar relacionada con otro cliente del club.
Revisá ambos perfiles antes de continuar.
```

### 35.10. person-search

`person-search` no debería abrir incidentes solo por buscar. Buscar debe ser barato y no ensuciar la bandeja.

Mientras se busca, la UI sí puede mostrar señales:

- posible duplicado;
- ya vinculado;
- sin cuenta vinculada;
- datos incompletos;
- archivado;
- mergeado.

El incidente debería crearse cuando el admin intenta una acción:

- vincular;
- crear cliente pese a coincidencias;
- usar un cliente mergeado;
- crear reserva con candidato ambiguo;
- forzar creación.

### 35.11. Merge manual

El merge manual no necesariamente debe crear un incidente nuevo. Debe generar auditoría.

Si el merge viene desde un incidente:

```txt
incident.status = RESOLVED
incident.resolutionType = MERGE_CLIENTS
```

Si el merge se hace desde una ficha sin incidente previo:

```txt
AuditLog: MERGE_CLIENTS
```

### 35.12. Estados futuros posibles

Estados actuales:

- `OPEN`;
- `RESOLVED`;
- `DISMISSED`.

Estados futuros recomendados:

- `OPEN`;
- `IN_REVIEW`;
- `RESOLVED`;
- `DISMISSED`;
- `AUTO_RESOLVED`;
- `REOPENED`.

No hace falta implementarlos ahora, pero conviene diseñar el modelo sabiendo que podrían aparecer.

### 35.13. Tipos de resolución recomendados

Además de los actuales:

- `LINK_USER_TO_CLIENT`;
- `MERGE_CLIENTS`.

Agregar o dejar previstos:

- `MARK_AS_DISTINCT`;
- `UPDATE_CLIENT_DATA`;
- `ARCHIVE_DUPLICATE`;
- `REACTIVATE_CLIENT`;
- `REDIRECT_TO_CANONICAL`;
- `DISMISS_NOT_DUPLICATE`;
- `DISMISS_INSUFFICIENT_SIGNAL`;
- `UNLINK_USER`;
- `FORCE_CREATE_APPROVED`.

`MARK_AS_DISTINCT` es importante porque no todo parecido es duplicado. Puede haber padre/hijo, hermanos, pareja, responsable/alumno o teléfono familiar compartido.

### 35.14. Motivo de descarte

`DISMISSED` solo dice que no se hizo nada, pero no explica por qué. Conviene agregar `dismissReason`.

Valores sugeridos:

- `NOT_DUPLICATE`;
- `INSUFFICIENT_INFORMATION`;
- `VALID_SHARED_PHONE`;
- `VALID_SHARED_EMAIL`;
- `LEGACY_DATA_KEEP_SEPARATE`;
- `IGNORE_FOR_NOW`;
- `OTHER`.

Esto permite decidir si un incidente descartado puede volver a abrirse.

### 35.15. Reapertura de incidentes

Regla recomendada:

| Motivo anterior | ¿Reabrir? |
|---|---|
| `MARK_AS_DISTINCT` | No por la misma señal |
| `VALID_SHARED_PHONE` | No por ese teléfono compartido |
| `VALID_SHARED_EMAIL` | No por ese email compartido |
| `IGNORE_FOR_NOW` | Sí, puede reaparecer |
| `INSUFFICIENT_INFORMATION` | Sí, si aparecen nuevas señales |
| `LEGACY_DATA_KEEP_SEPARATE` | No, salvo cambio fuerte |

### 35.16. dedupeKey recomendada

La `dedupeKey` debería componerse con señales estables.

Ejemplos:

```txt
clubId + reasonType + normalizedSignal + candidateClientIdsHash
clubId:PHONE:+5493511234567:candidatesHash
clubId:EMAIL:juan@mail.com:candidatesHash
clubId:DNI:12345678:candidatesHash
clubId:USER_LINK:userId:clientCandidatesHash
```

Si cambia el set de candidatos, conviene actualizar el incidente abierto o crear uno nuevo según si el problema sigue siendo el mismo.

---

## 36. Datos verificados y confianza de identidad

### 36.1. Qué significa “verificado”

Verificado no significa verdad absoluta ni validación legal. Significa que Pique tiene una señal razonable de que una persona controla un dato.

Ejemplos:

```txt
Teléfono cargado = el admin escribió 3511234567.
Teléfono verificado = la persona recibió un código o link por WhatsApp/SMS y lo confirmó.
```

```txt
Email cargado = alguien escribió juan@mail.com.
Email verificado = Juan entró por magic link o código enviado a ese email.
```

### 36.2. Por qué importa

Para vincular automáticamente un `User` con un `Client`, no alcanza con que un dato coincida. Importa la confianza de ese dato.

Si un usuario verifica un teléfono y en el club hay un único cliente con ese teléfono, el sistema puede vincular con mucha más seguridad.

Si el teléfono está cargado manualmente pero nunca fue confirmado por el usuario, puede servir como señal, pero no siempre como automatización.

### 36.3. Niveles de confianza

#### Nivel 0 — Dato cargado

El dato existe, pero nadie confirmó que pertenezca a la persona.

Ejemplos:

- teléfono escrito por admin;
- email escrito por admin;
- DNI cargado manualmente.

Uso:

- sugerir candidatos;
- detectar posibles duplicados;
- abrir incidentes;
- pedir revisión.

#### Nivel 1 — Dato confirmado por usuario

La persona demostró controlar el dato.

Ejemplos:

- teléfono confirmado por WhatsApp/SMS;
- email confirmado por magic link;
- login con Google/Apple para email.

Uso:

- vincular automáticamente si hay match único y sin conflicto;
- reducir fricción del jugador;
- mejorar confianza de pagos/notificaciones.

#### Nivel 2 — Vínculo confirmado por club

Un admin del club confirmó que una cuenta de Pique corresponde a un cliente del club.

Ejemplos:

- admin toca “Vincular cuenta de Pique”;
- resolución manual de incidente;
- soporte confirma asociación.

Uso:

- relación fuerte `Client` ↔ `User`;
- habilitar historial, pagos y reservas del jugador;
- auditar quién confirmó.

#### Nivel 3 — Identidad fuerte formal

Validación más formal de documento o identidad legal.

Ejemplos futuros:

- documento validado;
- verificación externa;
- revisión manual fuerte;
- coincidencia con medio de pago.

No se recomienda para MVP, pero se deja previsto para torneos, ranking, suscripciones, reglamentos o casos de mayor riesgo.

### 36.4. Campos sugeridos

En `User`:

```txt
phoneVerifiedAt
emailVerifiedAt
documentVerifiedAt // futuro
```

En el vínculo o `Client`:

```txt
linkedAt
linkedByUserId
linkSource
linkConfidence
```

Valores de `linkSource` sugeridos:

- `AUTO_PHONE_MATCH`;
- `AUTO_EMAIL_MATCH`;
- `AUTO_DNI_MATCH`;
- `ADMIN_CONFIRMED`;
- `USER_REQUESTED`;
- `SUPPORT_CONFIRMED`;
- `IMPORT_LEGACY`;
- `INCIDENT_RESOLUTION`.

### 36.5. Reglas recomendadas de vinculación automática

| Señal | ¿Vincular automático? | Condición |
|---|---:|---|
| Teléfono verificado | Sí | Match único, cliente libre, sin conflicto |
| Email verificado | Sí | Match único, cliente libre, sin conflicto |
| DNI cargado | Depende | Mejor bloquear si hay conflicto; auto solo si política lo permite |
| Nombre parecido | No | Solo sugerencia/incidente |
| Teléfono no verificado | No siempre | Puede sugerir, no siempre automatizar |
| Admin confirma vínculo | Sí | Auditar |
| Soporte confirma vínculo | Sí | Auditar |

### 36.6. Caso teléfono compartido

Si dos clientes comparten teléfono, aunque el usuario verifique ese número, no se debe vincular automáticamente.

Ejemplo:

```txt
Client 1: Laura Gómez, phone 3519999999
Client 2: Tomás Gómez, phone 3519999999
User verifica phone 3519999999
```

Resultado:

- no vincular automático;
- mostrar mensaje al jugador;
- crear incidente o solicitud de revisión;
- permitir que el club confirme.

Mensaje jugador:

```txt
Encontramos más de un perfil posible en este club.
Para proteger tu historial, el club debe confirmar la vinculación.
```

---

## 37. Lenguaje de producto: ocultar User / Client

### 37.1. Principio

`User` y `Client` son conceptos técnicos. El admin y el jugador no deberían tener que entenderlos.

Internamente:

```txt
User + Client
```

Externamente:

```txt
Persona
Cliente
Jugador
Alumno
Responsable
Cuenta de Pique
Perfil en el club
Historial en el club
```

### 37.2. Lenguaje para admin

Usar:

- Cliente;
- Persona;
- Jugador;
- Alumno;
- Responsable;
- Cuenta de Pique;
- Vincular cuenta;
- Perfil del cliente;
- Clientes para revisar;
- Posibles duplicados.

Evitar:

- User;
- Client;
- Link User;
- Client sin User;
- User global;
- Entidad vinculada;
- Foreign key;
- Error técnico.

Ejemplos:

| Evitar | Usar |
|---|---|
| `Client sin User vinculado` | Este cliente todavía no tiene cuenta de Pique vinculada |
| `Link User` | Vincular cuenta de Pique |
| `User already linked to another Client` | Esta cuenta de Pique ya está asociada a otro cliente del club |
| `CLIENT_POSSIBLE_DUPLICATE` | Puede que este cliente ya exista |

### 37.3. Lenguaje para jugador

Usar:

- Mi perfil;
- Mi historial;
- Mis clubes;
- Mis reservas;
- Mis pagos;
- Vincular historial;
- Cuenta;
- Privacidad.

Evitar:

- Cliente;
- Client;
- User;
- Relación User/Client;
- Identidad partida.

Ejemplos:

| Evitar | Usar |
|---|---|
| `Vincular Client` | Vincular mi historial |
| `No encontramos Client asociado` | Todavía no encontramos historial tuyo en este club |
| `Múltiples Clients candidatos` | Encontramos más de un perfil parecido. Para proteger tus datos, el club debe confirmarlo |

### 37.4. Concepto final

El concepto de producto debería ser:

```txt
Persona del club
```

Pero se presenta distinto según contexto:

| Contexto | Nombre visible |
|---|---|
| Admin general | Cliente |
| Reserva | Titular / jugador |
| Academia | Alumno |
| Menores | Responsable / familiar |
| Pagos | Pagador |
| App jugador | Perfil en el club |
| Soporte Pique | Identidad / vínculos |

---

## 38. Experiencia admin 10000%

### 38.1. Buscador universal de personas

El admin debería tener un único buscador, disponible en reservas, caja, clientes, academia y resolución de duplicados.

Debe permitir buscar por:

- nombre;
- apellido;
- teléfono;
- email;
- DNI;
- alias;
- grupo frecuente;
- historial reciente.

Resultados agrupados visualmente:

```txt
Clientes del club
Cuentas de Pique vinculables
Clientes archivados o mergeados
Posibles duplicados
```

Ejemplo:

```txt
Juan Pérez
Cliente del club · 12 reservas · Última vez hace 4 días · Cuenta vinculada

Juan P.
Posible duplicado · mismo teléfono

Juan Pérez
Cuenta de Pique · todavía no vinculada al club
```

### 38.2. Ficha 360° del cliente

La ficha del cliente debe ser el centro operativo de una persona dentro del club.

Debe incluir:

- datos básicos;
- estado;
- cuenta de Pique vinculada o no;
- próxima reserva;
- última reserva;
- historial;
- saldo/deuda;
- consumos;
- clases/academia;
- pagos;
- cancelaciones;
- no-shows;
- preferencias;
- grupos frecuentes;
- observaciones internas;
- auditoría relevante.

Ejemplo:

```txt
Juan Pérez
Cliente activo · Cuenta de Pique vinculada

Próxima reserva: viernes 20:00
Última reserva: ayer
Saldo: $0
Frecuencia: juega 2 veces por semana
Horario habitual: noche
Deporte principal: pádel
```

### 38.3. Acciones rápidas

Desde la ficha, el admin debería poder:

- crear reserva;
- cobrar deuda;
- ver historial;
- mandar WhatsApp;
- editar datos;
- vincular cuenta;
- desvincular cuenta, con permisos;
- agregar a academia;
- crear clase;
- agregar a grupo frecuente;
- ver consumos;
- archivar;
- fusionar;
- revisar incidentes relacionados.

### 38.4. Alertas inteligentes

El sistema debe reemplazar errores técnicos por alertas accionables.

Ejemplos:

```txt
Puede que este cliente ya exista.
Encontramos una persona con el mismo teléfono.
```

```txt
Este cliente tiene una deuda pendiente de $8.000.
¿Querés cobrarla ahora?
```

```txt
Este teléfono ya aparece en otro cliente.
Revisá antes de guardar.
```

### 38.5. Cola de revisión

Sección recomendada:

```txt
Clientes para revisar
```

Tipos de tarjetas:

- posible duplicado;
- cuenta pendiente de vincular;
- datos incompletos;
- teléfono compartido;
- cliente archivado usado recientemente;
- conflicto de cuenta;
- historial pendiente.

Acciones:

- revisar;
- fusionar;
- marcar como personas distintas;
- corregir datos;
- vincular cuenta;
- descartar con motivo;
- ignorar por ahora.

### 38.6. Historial entendible

La ficha debe tener una línea de tiempo clara:

```txt
Hoy 18:42
Francisco editó el teléfono.

Ayer 20:10
Se creó una reserva para cancha 1.

20/05
Se vinculó con una cuenta de Pique.

15/05
Se detectó posible duplicado con “Juan P.”.
```

### 38.7. Sugerencias contextuales futuras

No MVP obligatorio, pero diferencial fuerte:

- “Juan suele jugar los miércoles a las 20:00. ¿Querés usar su horario habitual?”
- “Este cliente suele jugar con los mismos 3 amigos. ¿Crear grupo frecuente?”
- “Este alumno lleva 3 clases sin pagar. Revisar saldo.”
- “Este cliente no reserva hace 45 días. Podés enviarle una promo.”

---

## 39. Experiencia jugador 10000%

### 39.1. Onboarding simple

El jugador debería poder entrar por:

- teléfono;
- email;
- Google;
- Apple;
- magic link;
- WhatsApp OTP futuro.

Después del login, Pique puede intentar encontrar historial en clubes de forma segura.

### 39.2. Vincular historial

Si hay match único fuerte con dato verificado:

```txt
Vinculamos tu historial en La Redonda.
```

Si hay ambigüedad:

```txt
Encontramos perfiles parecidos.
Para proteger tus datos, el club debe confirmar la vinculación.
```

Si no hay historial:

```txt
Todavía no encontramos historial tuyo en este club.
```

### 39.3. Mis clubes

Sección futura recomendada:

```txt
Mis clubes
```

Cada club puede mostrar:

- reservas próximas;
- historial;
- saldo/deuda;
- cuenta vinculada;
- estado de vinculación;
- favoritos;
- reglas del club.

### 39.4. Mis reservas

Vista:

- próximas;
- historial;
- canceladas;
- pendientes de pago.

Cada reserva:

- club;
- cancha;
- fecha/hora;
- estado;
- pago;
- participantes;
- reglas de cancelación;
- pagar;
- compartir;
- cancelar si aplica.

### 39.5. Pagos

Para MVP:

- pagar mi reserva;
- titular como referencia principal;
- no pagar por otros participantes.

Futuro:

- pagar mi parte;
- ver quién pagó;
- recordar a amigos;
- dividir pago;
- reembolsos o créditos.

### 39.6. Participantes

Futuro ideal:

- titular comparte link;
- amigo confirma asistencia;
- amigo paga su parte;
- titular ve estado de cada participante;
- reglas claras para baja/cancelación.

Decisión actual recomendada:

```txt
Cada participante paga solo su parte.
No se permite pagar por otros en primera etapa.
```

### 39.7. Privacidad y control

El jugador debería poder ver:

- qué clubes tienen su perfil;
- qué datos tiene cada club;
- qué cuenta está vinculada;
- historial visible;
- solicitar corrección;
- desvincular identidad digital cuando corresponda.

Importante: desvincular cuenta no significa borrar historial operativo, reservas, pagos o información contable del club.

---

## 40. Casos especiales: familias, responsables y academia

### 40.1. Teléfonos y emails compartidos

En clubes y academia es normal que haya datos compartidos:

- padre/hijo;
- madre/hija;
- hermanos;
- pareja;
- responsable/alumno;
- teléfono familiar.

Por eso no conviene prohibir absolutamente teléfono/email repetido. Conviene permitir excepciones explícitas y auditadas.

### 40.2. DNI/documento

El DNI debería considerarse señal fuerte. Recomendación:

- mismo DNI en dos clientes activos: bloquear;
- permitir excepción solo por soporte/admin avanzado y con auditoría;
- no tratar DNI cargado como “verificado” salvo validación adicional.

### 40.3. Responsable/alumno

Futuro recomendado:

```txt
Responsable: Laura Gómez
Alumno: Tomás Gómez
```

Casos:

- el responsable paga;
- el alumno no tiene usuario;
- el responsable recibe notificaciones;
- el alumno tiene ficha deportiva;
- el responsable tiene ficha financiera.

### 40.4. Cuenta familiar

Futuro avanzado:

- responsable principal;
- miembros asociados;
- permisos de pago;
- notificaciones por miembro;
- consentimientos;
- restricciones para menores.

---

## 41. Permisos y operaciones sensibles

No todos los roles deberían poder resolver identidad.

Operaciones sensibles:

- forzar creación duplicada;
- fusionar clientes;
- desvincular cuenta;
- editar teléfono/email/DNI de cliente vinculado;
- marcar como personas distintas;
- reactivar cliente archivado;
- resolver conflicto de cuenta;
- confirmar vínculo manual.

Recomendación:

| Operación | Rol sugerido |
|---|---|
| Crear cliente | STAFF+ |
| Editar datos básicos | STAFF+ |
| Editar datos identitarios sensibles | ADMIN+ |
| Forzar duplicado | ADMIN/OWNER |
| Fusionar clientes | ADMIN/OWNER |
| Desvincular cuenta | OWNER o ADMIN avanzado |
| Resolver incidente | ADMIN+ |
| Ver auditoría completa | OWNER / soporte Pique |

---

## 42. Decisiones de producto pendientes

Estas preguntas conviene resolver antes de implementar fases avanzadas:

1. ¿Quién puede “crear igual” ante posible duplicado?
2. ¿Bloqueamos siempre por DNI repetido?
3. ¿Permitimos mismo teléfono en dos clientes? Recomendación: sí, como excepción explícita.
4. ¿Permitimos mismo email en dos clientes? Recomendación: sí con cuidado; no si el email está vinculado a una cuenta y genera conflicto.
5. ¿Cuándo un jugador que verifica teléfono/email vincula historial automáticamente?
6. ¿Puede el admin desvincular cuenta de Pique? Recomendación: sí, con permisos, motivo y auditoría.
7. ¿Un incidente descartado puede volver a aparecer? Depende del motivo.
8. ¿Qué acciones ve un STAFF vs ADMIN vs OWNER?
9. ¿La reserva pública debe bloquear si hay múltiples candidatos? Recomendación: sí, si el usuario está logueado y el historial/pago puede quedar mal asociado.
10. ¿Cómo se resuelve padre/hijo en academia sin duplicar identidad?

---

## 42.A. Evaluacion honesta de la experiencia actual

La arquitectura va en una direccion correcta, pero la experiencia todavia no esta redonda.

Evaluacion honesta:

- modelo conceptual: bueno;
- robustez de algunos flujos: buena;
- claridad operativa para admin: media;
- experiencia total de identidad/personas: todavia lejos de sentirse excelente.

Si hubiera que puntuarlo hoy:

- modelo de dominio: `8/10`;
- direccion de producto: `7.5/10`;
- claridad para admin: `5/10`;
- experiencia jugador: `6/10`;
- experiencia global del modulo: `5.5/10`.

El problema principal no es que el modulo este mal pensado.

El problema es que todavia se filtra demasiada complejidad interna.

Hoy no se siente simple del todo porque:

- el sistema internamente distingue `User`, `Client`, `Booking`, merge, link e incidentes, pero el admin no deberia tener que pensar en eso;
- la experiencia no siempre cuenta una sola historia;
- hay casos donde el sistema funciona, pero no transmite tranquilidad;
- el admin todavia puede quedar sintiendo que esta peleando con identidad, no gestionando personas;
- hay flujos que resuelven muy bien y otros que dejan identidad partida;
- el merge existe, pero operativamente no se siente cerrado si el mergeado sigue apareciendo raro;
- los incidentes sirven, pero todavia no son una UX elegante de resolucion;
- `person-search` y link manual todavia no cuentan la misma historia;
- para el jugador, "mi reserva / mi pago / mi identidad" deberia sentirse obvio siempre, y hoy todavia depende de detalles tecnicos.

Entonces, ¿es simple y claro?

No del todo.

Es entendible para el equipo que conoce la arquitectura, pero todavia no es extremadamente simple y claro para un club real.

La prueba mas honesta es esta:

Si el sistema fuera realmente excelente, el admin sentiria que maneja personas, no `User`, `Client`, merge, link, incidentes, ownership y conflictos.

Hoy todavia se nota la mecanica interna.

Resumen corto:

- hay criterio;
- hay una buena base;
- pero todavia no se siente como "esto vuela y nadie se confunde".

---

## 42.B. Que falta para que se sienta excelente

### 1. Una capa real de producto: "Persona del club"

El admin deberia ver una sola entidad visual.

Adentro puede haber:

- `User`;
- `Client`;
- reservas;
- deuda;
- pagos;
- incidentes;
- mergeados;
- historial;
- auditoria.

La complejidad puede existir en backend, pero no deberia derramarse en la experiencia principal.

### 2. Un resolver de identidad unico para todos los flujos

Toda entrada donde Pique ya conoce al usuario deberia pasar por la misma politica.

Eso evita:

- duplicados silenciosos;
- identidad partida nueva;
- diferencias raras entre flujo publico, admin y pagos.

### 3. Un wizard de duplicados mas humano

En vez de obligar al club a interpretar conflicto tecnico, la UI deberia decir:

- "Encontramos 2 personas parecidas";
- "Esta ya tiene usuario";
- "Esta tiene 14 reservas y deuda";
- "Esta otra no tiene actividad".

Y ofrecer acciones claras:

- usar existente;
- crear igual;
- revisar despues;
- fusionar;
- vincular.

### 4. Un estado visible de confianza por persona

Ejemplos:

- `Confirmado`;
- `Probable duplicado`;
- `Datos incompletos`;
- `Vinculado con usuario`.

Eso ayuda a que el equipo del club entienda rapidamente que tan consolidada esta cada identidad.

### 5. Un flujo post-reserva para el jugador

Si un admin le cargo reservas antes de que tuviera cuenta, el jugador deberia poder ver algo como:

```txt
Reservaste como Francisco.
Queres reclamar esta reserva como tuya?
```

Eso convierte una inconsistencia tecnica en una UX amigable.

### 6. Historial claro de identidad

Deberia ser visible:

- quien vinculo;
- quien mergeo;
- cuando;
- por que;
- desde que flujo.

### 7. Mergeados invisibles en operacion normal

El merge no deberia dejar una sensacion rara en listas normales.

La operacion diaria deberia ver personas activas.

Lo archivado o mergeado deberia vivir en detalle, auditoria o vistas avanzadas.

### 8. Consistencia total entre busqueda, vinculacion, reservas, pagos y cuenta del jugador

La experiencia se siente excelente cuando todos los puntos de entrada cuentan la misma historia.

Hoy todavia falta cerrar esa consistencia de punta a punta.

### 9. El flujo publico logueado no deberia dejar identidad partida si hay match claro

Si el sistema ya conoce al usuario y encuentra un match fuerte unico, deberia consolidar la identidad en ese momento.

### 10. Editar clientes no deberia poder romper la logica de identidad

La edicion no puede ser el agujero por donde vuelve a entrar toda la inconsistencia.

### 11. Los incidentes deberian ser una UX guiada, no solo una bandeja tecnica

Hoy ayudan operativamente, pero todavia no se sienten como una experiencia realmente pulida.

### 12. El lenguaje visible deberia ser mucho mas de negocio y mucho menos de estructura interna

El club deberia leer personas, historial, reserva, cuenta, pagos y actividad.

No deberia tener que pensar en entidades tecnicas salvo en modos avanzados.

---

## 42.C. Ideas flasheras / vision futura

### Identity cockpit del club

Una vista de "salud de identidad" con:

- duplicados abiertos;
- personas con telefono compartido;
- reservas con identidad partida;
- clientes sin datos fuertes;
- merges recientes;
- incidentes pendientes.

### Confidence score por persona

Ejemplo:

```txt
Esta identidad esta consolidada al 92%
```

No como verdad absoluta, sino como ayuda operativa.

### Sugerencias inteligentes de consolidacion

Ejemplos:

- "Parece la misma persona por telefono + email + reservas";
- "Recomendamos vincular, no mergear";
- "Hay conflicto: el telefono coincide, pero el email no".

### Claim flow para jugadores

Si el admin les cargo reservas antes de tener cuenta, cuando se registran podrian reclamar su historial.

Eso ayuda a:

- ordenar identidad;
- mejorar mis reservas;
- preparar pagos online;
- evitar que el club tenga que hacer todo manualmente.

### Verificacion liviana por WhatsApp u OTP

No para todo.

Pero si como herramienta para consolidar identidad en casos dudosos o destrabar ownership.

### Timeline de persona

Algo asi:

- creado manualmente;
- luego reservo online;
- luego se registro;
- luego se vinculo;
- luego pago desde app.

Eso ayuda muchisimo a soporte, auditoria y comprension del caso.

### Modo mostrador ultra simple

Una UX pensada para velocidad real:

- crear persona rapida;
- usar existente;
- seguir sin completar.

Todo sin hablar de `User` ni `Client`.

### Detector de split-brain

Una cola automatica para casos donde:

- `booking.userId` y `client.userId` no estan consolidados;
- hay reservas del mismo usuario contra multiples clientes;
- hay identidad fuerte suficiente como para sugerir revision.

### Norte de experiencia 1000000%

La sensacion objetivo deberia ser:

- el club siente que maneja personas, no tablas;
- el sistema evita solo los errores obvios;
- cuando duda, explica perfecto;
- nunca crea duplicados silenciosos;
- el jugador siempre encuentra y paga sus reservas sin friccion;
- los casos raros existen, pero estan encapsulados en una UX elegante.

Hoy todavia no estamos ahi, pero si hay material para llegar.

### Vista 360 de persona

Una ficha completa con:

- reservas;
- pagos;
- deuda;
- incidentes;
- cuenta;
- actividad.

Eso permitiria que el club realmente sienta que esta gestionando una persona consolidada, no piezas separadas.

### Conclusion mas honesta

La arquitectura va bien.

La vision puede ser muy buena.

Pero la experiencia todavia no esta en "esto vuela".

Hoy esta en un punto de:

- hay criterio;
- hay base;
- hay futuro.

Pero todavia no en:

- nadie se confunde;
- todo se siente natural;
- el sistema inspira total confianza.

---

## 42.D. MVP excelente

Si hubiera que definir una version "excelente pero aterrizada" del modulo, el MVP excelente deberia lograr esto:

### Para el club

- el admin siente que gestiona personas, no entidades tecnicas;
- crear o reutilizar una persona es rapido y claro;
- los duplicados no aparecen silenciosamente;
- cuando hay conflicto, la UI explica que pasa y que conviene hacer;
- merge y vinculacion existen, pero no contaminan la operacion normal.

### Para el jugador

- si reserva logueado, la reserva queda claramente asociada a su identidad;
- siempre encuentra sus reservas en la app;
- puede pagar sin friccion sus reservas propias;
- si tenia historial previo cargado por admin, puede reclamarlo o consolidarlo.

### Capacidades minimas del MVP excelente

1. Un solo motor de resolucion de identidad usado por:
   - alta de cliente;
   - edicion de cliente;
   - reserva publica logueada;
   - reserva admin con `systemUser`;
   - POS / draft de cliente;
   - checkout / ownership derivado.
2. `updateClient()` no permite romper identidad ni generar colisiones silenciosas.
3. Reserva publica logueada no deja identidad partida si hay match fuerte unico.
4. `person-search` y link manual quedan totalmente alineados.
5. Clientes mergeados quedan ocultos en operacion diaria.
6. Existe una vista clara de "persona del club" aunque internamente sigan existiendo `User` y `Client`.
7. El jugador puede ver y pagar sus reservas propias con consistencia.

### Regla de oro del MVP excelente

```txt
El sistema ayuda solo cuando tiene certeza fuerte.
Si no la tiene, frena, explica y pide decision.
```

---

## 42.E. Top 5 cambios de mayor impacto

Si hubiera que maximizar impacto con foco, estos son los cinco cambios mas valiosos:

### 1. Unificar toda la resolucion de identidad en un solo servicio

Es el cambio mas importante porque evita que cada flujo invente reglas distintas.

### 2. Hacer que editar cliente use la misma politica de deduplicacion que crear cliente

Es el agujero mas claro hoy.

### 3. Consolidar reserva publica logueada cuando hay match fuerte unico

Esto sube mucho la experiencia del jugador, pagos y ownership.

### 4. Crear la capa de producto "Persona del club"

Aunque empiece solo como UI y naming, cambia fuertemente la claridad del sistema.

### 5. Ocultar mergeados y resolver duplicados con una UX mas humana

Eso mejora mucho la sensacion operativa del club sin rehacer todo el backend.

---

## 42.F. Priorizacion sugerida: ahora / proximo / despues

### Ahora

- bloquear colisiones en `updateClient()`;
- alinear `person-search` con link manual;
- consolidar identidad en reserva publica logueada cuando hay match fuerte unico;
- ocultar clientes mergeados en listados normales;
- cerrar criterio target de ownership y checkout del titular.

### Proximo

- introducir la vista "Persona del club";
- crear wizard de duplicados mas humano;
- mostrar estados visibles de confianza de identidad;
- agregar historial de identidad visible para admin;
- crear cola o dashboard simple para incidentes y casos de identidad partida.

### Despues

- claim flow para jugadores;
- vista 360 de persona;
- timeline de persona;
- confidence score;
- verificacion por WhatsApp/OTP;
- identity cockpit completo;
- detector automatico de split-brain.

---

## 42.G. Decisiones tomadas / pendientes / bloqueantes

### Decisiones tomadas

- `User` y `Client` siguen separados;
- `Client` no se elimina;
- toda reserva sigue teniendo `clientId`;
- no se hace merge automatico;
- no se hace link automatico con ambiguedad;
- el jugador debe poder pagar al menos sus reservas propias creadas desde flujo publico;
- mergeados no deberian contaminar la operacion diaria;
- el club deberia ver personas, no estructura tecnica.

### Pendientes de definicion

- cuanto se permite forzar `forceCreateNew`;
- cuando telefono solo alcanza para sugerir y cuando para bloquear;
- como manejar telefono/email compartido;
- que politica exacta usar para DNI repetido;
- que permisos exactos tienen STAFF, ADMIN y OWNER para acciones sensibles;
- como se presenta en UI el conflicto entre usar, vincular, fusionar o crear igual.

### Bloqueantes conceptuales

- falta una politica comun realmente aplicada en todos los flujos;
- editar cliente todavia puede romper identidad;
- la reserva publica logueada todavia puede dejar identidad partida;
- `person-search` y link manual todavia no son una sola historia;
- la experiencia jugador todavia depende de detalles internos que deberian quedar encapsulados.

---

## 42.H. One-pager ejecutivo

Si hubiera que resumir todo el modulo en una sola pagina para reunion:

### Donde estamos

- buena base conceptual;
- varios flujos ya robustos;
- experiencia todavia no suficientemente simple ni consistente.

### Que duele hoy

- identidad partida;
- deduplicacion no centralizada del todo;
- merge correcto pero raro en operacion diaria;
- incidentes utiles pero poco elegantes;
- lenguaje tecnico demasiado visible.

### Que queremos lograr

- el club gestiona personas;
- el jugador encuentra y paga sus reservas sin friccion;
- los duplicados no aparecen silenciosamente;
- cuando hay duda, el sistema la explica perfecto.

### Que haria primero

1. cerrar deduplicacion de edicion;
2. consolidar flujo publico logueado;
3. alinear busqueda y link manual;
4. ocultar mergeados;
5. crear capa visual "Persona del club".

---

## 42.I. Plan de implementacion por epicas

### Enfoque general

La implementacion recomendada no deberia arrancar por las ideas mas flasheras.

El orden correcto es:

1. cerrar agujeros de consistencia;
2. unificar politica de identidad;
3. mejorar UX operativa;
4. recien despues sumar capas mas avanzadas de producto.

---

### Epica 0. Blindaje de identidad y datos

Objetivo:

Evitar que el sistema siga generando o tolerando inconsistencia basica.

Tickets sugeridos:

1. Bloquear colisiones en `updateClient()` con la misma politica de `createClient()`.
2. Agregar tests de edicion con telefono, email y DNI repetidos.
3. Definir respuesta UX/API unificada para conflicto de edicion.
4. Evaluar si editar con conflicto abre incidente automaticamente.

Criterios de aceptacion:

- editar cliente no puede introducir colisiones silenciosas;
- el admin recibe mensaje claro y candidatos cuando aplica;
- quedan tests cubriendo telefono, email, DNI y multi-signal conflict.

Dependencias:

- ninguna fuerte; deberia ser la primera epica.

---

### Epica 1. Politica unica de resolucion de identidad

Objetivo:

Que todos los flujos importantes usen la misma logica de reusar, vincular, bloquear o crear.

Tickets sugeridos:

1. Formalizar un servicio comun tipo `ensureClientForKnownUser(...)`.
2. Reusar esa politica en reserva publica logueada.
3. Reusar esa politica en reserva admin con `systemUser`.
4. Revisar reuso parcial en POS / `clientDraft`.
5. Documentar reglas exactas de match fuerte, ambiguedad y bloqueo.

Criterios de aceptacion:

- la politica vive en un solo punto;
- los flujos conocidos no divergen entre si;
- los casos con match fuerte unico consolidan correctamente;
- los casos ambiguos bloquean en vez de inventar decisiones.

Dependencias:

- conveniente completar Epica 0 primero.

---

### Epica 2. Reserva publica logueada y ownership consistente

Objetivo:

Que el flujo publico del jugador cierre bien de punta a punta: reservar, ver, pagar.

Tickets sugeridos:

1. Garantizar `booking.userId` en toda reserva publica logueada.
2. Si hay match fuerte unico, consolidar `client.userId`.
3. Revisar ownership derivado en `mis reservas`.
4. Revisar checkout del titular para asegurar consistencia con la nueva politica.
5. Agregar tests end-to-end del flujo: reservar -> ver en app -> pagar.

Criterios de aceptacion:

- el jugador encuentra siempre sus reservas propias;
- el checkout del titular funciona consistentemente;
- no quedan identidades partidas nuevas cuando habia match fuerte suficiente.

Dependencias:

- Epica 1.

---

### Epica 3. Alineacion operativa admin

Objetivo:

Que admin no viva contradicciones entre buscador, link manual, merge y listas.

Tickets sugeridos:

1. Alinear `person-search` con `linkUserToClient`.
2. Definir elegibilidad real de un usuario vinculable.
3. Ocultar mergeados en listas normales.
4. Agregar filtros o vista avanzada para archivados/mergeados.
5. Revisar mensajes de error y microcopy de merge/link.

Criterios de aceptacion:

- si `person-search` muestra un usuario como vinculable, el link manual no lo contradice;
- clientes mergeados no aparecen como clientes normales;
- el admin entiende claramente que hacer ante conflicto, merge o link.

Dependencias:

- Epica 1 para reglas comunes;
- Epica 0 para evitar que UI tape problemas de datos.

---

### Epica 4. UX guiada de duplicados e incidentes

Objetivo:

Pasar de conflictos tecnicos a resolucion guiada.

Tickets sugeridos:

1. Diseñar wizard de duplicados mas humano.
2. Mostrar contexto relevante por candidato:
   - si tiene usuario;
   - reservas;
   - deuda;
   - actividad;
   - estado de confianza.
3. Agregar acciones claras:
   - usar existente;
   - crear igual;
   - vincular;
   - fusionar;
   - revisar despues.
4. Mejorar bandeja de incidentes con estado y proxima accion sugerida.
5. Definir si ciertos conflictos de edicion y link tambien abren incidentes.

Criterios de aceptacion:

- el admin no necesita interpretar un error tecnico para resolver el caso;
- los incidentes dejan de sentirse solo como una cola cruda;
- la resolucion manual queda auditada y es comprensible.

Dependencias:

- Epica 3 mejora mucho la base de esta UX.

---

### Epica 5. Capa de producto "Persona del club"

Objetivo:

Traducir toda la complejidad interna a una experiencia visual unica.

Tickets sugeridos:

1. Definir naming visible final: persona, cliente, cuenta, historial.
2. Diseñar ficha resumida de Persona del club.
3. Unificar en esa ficha:
   - datos basicos;
   - cuenta de Pique asociada;
   - reservas;
   - pagos/deuda;
   - incidentes;
   - historial de identidad.
4. Replantear listado principal para que se lea como personas.
5. Agregar estados visibles de confianza.

Criterios de aceptacion:

- la UI principal habla de personas y actividad, no de estructura tecnica;
- el admin puede entender un caso sin navegar por cinco pantallas inconexas;
- mejora perceptible de claridad operativa.

Dependencias:

- Epicas 3 y 4.

---

### Epica 6. Experiencia jugador avanzada

Objetivo:

Cerrar el arco de identidad del lado del jugador.

Tickets sugeridos:

1. Claim flow de historial cargado por admin.
2. Mejoras en `mis reservas` para ownership y contexto.
3. Timeline de persona o historial resumido.
4. Soporte futuro para pagos de participantes si se decide.
5. Verificacion liviana por OTP/WhatsApp para casos sensibles.

Criterios de aceptacion:

- el jugador puede entender que reservas son suyas;
- puede consolidar historial cuando aplica;
- la cuenta digital se siente conectada con la realidad del club.

Dependencias:

- Epica 2;
- idealmente Epica 5.

---

### Epica 7. Vision 2027 / herramientas avanzadas

Objetivo:

Llevar el modulo de una buena base operativa a una experiencia realmente sobresaliente.

Tickets sugeridos:

1. Identity cockpit del club.
2. Confidence score por persona.
3. Detector automatico de split-brain.
4. Vista 360 de persona.
5. Sugerencias inteligentes de consolidacion.

Criterios de aceptacion:

- el club puede ver salud de identidad a nivel sistema;
- soporte y operaciones tienen herramientas proactivas, no solo reactivas;
- la experiencia transmite mas confianza y menos trabajo manual.

Dependencias:

- todas las epicas anteriores dejan mejor preparado este salto.

---

## 42.J. Backlog inicial de tickets

Si hubiera que cargar tickets ya, el backlog inicial sugerido seria este:

### Sprint 1

- backend: bloquear duplicados en `updateClient()`;
- backend: tests de edicion con conflictos;
- backend: documentar metadatos estandar de conflicto;
- frontend: mostrar conflicto de edicion con candidatos.

### Sprint 2

- backend: extraer politica comun de resolucion de identidad;
- backend: aplicar la politica al flujo publico logueado;
- backend: tests del flujo publico con match fuerte unico, ambiguedad y sin match;
- frontend: revisar mensajes del flujo publico en conflicto.

### Sprint 3

- backend: alinear `person-search` y link manual;
- frontend: ocultar mergeados en listas operativas;
- frontend: agregar acceso a archivados/mergeados;
- backend/frontend: revisar microcopy de merge, link y conflicto.

### Sprint 4

- frontend: wizard de duplicados;
- frontend: mejoras de bandeja de incidentes;
- backend: extender incidentes a conflictos de edicion y/o link si se define;
- diseño/producto: definir estados de confianza de identidad.

### Sprint 5

- frontend: primera ficha "Persona del club";
- frontend: vista consolidada de actividad, cuenta y reservas;
- backend: endpoints o agregados necesarios para la ficha;
- producto: validar lenguaje final visible.

---

## 42.K. Riesgos de implementacion

Hay algunos riesgos a cuidar mientras se implementa:

- tocar resolucion de identidad puede afectar reservas, caja y checkout al mismo tiempo;
- si se cambia backend sin ajustar UX, el sistema puede quedar mas correcto pero menos entendible;
- si se agrega automatizacion antes de unificar reglas, los errores se amplifican;
- si se introduce "Persona del club" solo como nombre, sin resolver contradicciones reales, puede quedar cosmetico;
- si no se agregan tests de regresion fuertes, es facil reabrir duplicados o identidad partida.

Recomendacion:

- cada epica deberia salir con tests y con definicion clara de UX visible.

---

## 42.L. Tickets listos para cargar

Formato sugerido por ticket:

- titulo
- prioridad
- epica
- objetivo
- alcance
- criterios de aceptacion
- dependencias

---

### Ticket 1. Bloquear duplicados en edicion de cliente

**Prioridad:** P0  
**Epica:** Epica 0. Blindaje de identidad y datos

**Objetivo**

Hacer que `updateClient()` aplique la misma politica de deduplicacion que `createClient()`.

**Alcance**

- validar telefono, email y DNI en edicion;
- detectar candidatos fuertes;
- responder con conflicto estandar cuando corresponda;
- evitar colisiones silenciosas.

**Criterios de aceptacion**

- editar un cliente con telefono repetido no genera update silencioso;
- editar un cliente con email repetido no genera update silencioso;
- editar un cliente con DNI repetido no genera update silencioso;
- el error devuelve candidatos consistentes para UX;
- quedan tests automaticos cubriendo los tres casos y multi-signal conflict.

**Dependencias**

- ninguna.

---

### Ticket 2. Estandarizar respuesta de conflicto de identidad

**Prioridad:** P0  
**Epica:** Epica 0. Blindaje de identidad y datos

**Objetivo**

Unificar el contrato de error para conflictos de identidad entre alta, edicion, reserva y caja.

**Alcance**

- revisar `CLIENT_POSSIBLE_DUPLICATE`;
- definir metadatos minimos esperados;
- alinear shape de candidatos y contexto;
- documentar el contrato.

**Criterios de aceptacion**

- los principales flujos devuelven el mismo formato de conflicto;
- frontend puede renderizar candidatos sin adapters especiales por flujo;
- el contrato queda documentado en este modulo.

**Dependencias**

- ninguna.

---

### Ticket 3. Extraer motor comun de resolucion de identidad

**Prioridad:** P0  
**Epica:** Epica 1. Politica unica de resolucion de identidad

**Objetivo**

Centralizar en un solo servicio la logica de reusar, vincular, bloquear o crear cliente cuando el sistema conoce a un usuario.

**Alcance**

- definir servicio comun tipo `ensureClientForKnownUser(...)`;
- documentar entradas y salidas;
- consolidar match fuerte, ambiguedad, conflicto y create-new.

**Criterios de aceptacion**

- existe un punto unico de verdad para esta politica;
- la logica no queda duplicada en varios servicios;
- los tests del servicio cubren reutilizacion, vinculacion, bloqueo por ambiguedad y creacion.

**Dependencias**

- recomendable tener Ticket 1 y 2 cerrados.

---

### Ticket 4. Aplicar motor comun a reserva publica logueada

**Prioridad:** P0  
**Epica:** Epica 2. Reserva publica logueada y ownership consistente

**Objetivo**

Hacer que la reserva publica logueada use la politica target de identidad y no deje identidad partida cuando hay match fuerte unico.

**Alcance**

- garantizar `booking.userId`;
- reusar `Client` vinculado si existe;
- vincular match fuerte unico si corresponde;
- bloquear ante ambiguedad.

**Criterios de aceptacion**

- la reserva publica logueada siempre guarda `booking.userId`;
- si hay match fuerte unico, `client.userId` queda consolidado;
- si hay multiples candidatos, el flujo no decide arbitrariamente;
- quedan tests para match unico, ambiguedad y sin match.

**Dependencias**

- Ticket 3.

---

### Ticket 5. Validar ownership y checkout del titular con la nueva politica

**Prioridad:** P0  
**Epica:** Epica 2. Reserva publica logueada y ownership consistente

**Objetivo**

Confirmar que el jugador ve y paga consistentemente sus reservas despues del cambio de identidad.

**Alcance**

- revisar `mis reservas`;
- revisar checkout del titular;
- validar prioridad entre `booking.userId`, `client.userId` y organizer participant;
- agregar regresiones automaticas.

**Criterios de aceptacion**

- una reserva creada por usuario logueado aparece siempre en `mis reservas`;
- el titular puede consultar checkout de su reserva;
- el titular puede iniciar pago si el resto de las condiciones financieras lo permiten;
- no se rompe el caso participante no-owner.

**Dependencias**

- Ticket 4.

---

### Ticket 6. Alinear `person-search` con link manual

**Prioridad:** P1  
**Epica:** Epica 3. Alineacion operativa admin

**Objetivo**

Evitar que el buscador muestre usuarios que luego el link manual rechaza sin explicación consistente.

**Alcance**

- definir elegibilidad real de usuario vinculable;
- alinear backend de link manual con esa regla;
- ajustar búsqueda o acciones disponibles según corresponda.

**Criterios de aceptacion**

- si `person-search` muestra un usuario como vinculable, `linkUserToClient` no lo contradice;
- si un usuario no es vinculable, la UI lo comunica claramente;
- quedan tests del caso mostrado-vs-rechazado.

**Dependencias**

- Ticket 3.

---

### Ticket 7. Ocultar clientes mergeados en operación diaria

**Prioridad:** P1  
**Epica:** Epica 3. Alineacion operativa admin

**Objetivo**

Evitar que clientes mergeados aparezcan como si fueran clientes activos normales.

**Alcance**

- excluir mergeados de listados operativos por defecto;
- ofrecer acceso opcional a archivados/mergeados;
- revisar selectores para impedir selección accidental.

**Criterios de aceptacion**

- clientes mergeados no aparecen en listas normales;
- sigue existiendo forma de verlos en detalle o vista avanzada;
- no se pueden usar accidentalmente en flujos operativos normales.

**Dependencias**

- ninguna fuerte.

---

### Ticket 8. Wizard humano de duplicados

**Prioridad:** P1  
**Epica:** Epica 4. UX guiada de duplicados e incidentes

**Objetivo**

Transformar conflictos de duplicado en una resolución clara y guiada para admin.

**Alcance**

- mostrar candidatos con contexto relevante;
- permitir usar existente, crear igual, vincular, fusionar o revisar despues;
- mejorar lenguaje visible.

**Criterios de aceptacion**

- el admin puede resolver un conflicto sin interpretar errores tecnicos;
- cada candidato muestra contexto suficiente para decidir;
- las acciones dejan auditoria o incidente cuando corresponde.

**Dependencias**

- Ticket 2;
- Ticket 6 ayuda mucho.

---

### Ticket 9. Mejorar bandeja de incidentes

**Prioridad:** P1  
**Epica:** Epica 4. UX guiada de duplicados e incidentes

**Objetivo**

Hacer que los incidentes sean una herramienta operativa clara y no solo una cola cruda.

**Alcance**

- mostrar motivo, gravedad y proxima accion sugerida;
- mejorar estados;
- revisar si conflictos de edicion o link abren incidente.

**Criterios de aceptacion**

- la bandeja permite priorizar casos rapidamente;
- cada incidente tiene contexto suficiente;
- queda definida la politica de incidentes para edicion y/o link conflictivo.

**Dependencias**

- Ticket 8 recomendado.

---

### Ticket 10. Crear la primera ficha de Persona del club

**Prioridad:** P1  
**Epica:** Epica 5. Capa de producto Persona del club

**Objetivo**

Dar una representación visual única y entendible de la persona dentro del club.

**Alcance**

- naming visible;
- ficha resumida;
- datos básicos;
- cuenta de Pique asociada;
- reservas;
- saldo/deuda;
- incidentes;
- historial de identidad.

**Criterios de aceptacion**

- la UI principal se entiende como persona, no como entidad técnica aislada;
- el admin puede entender el caso de una persona desde una sola vista;
- el lenguaje visible evita exponer complejidad innecesaria.

**Dependencias**

- Ticket 6;
- Ticket 7;
- idealmente Ticket 9.

---

### Ticket 11. Definir y mostrar estados de confianza de identidad

**Prioridad:** P2  
**Epica:** Epica 5. Capa de producto Persona del club

**Objetivo**

Hacer visible qué tan consolidada está cada identidad.

**Alcance**

- definir estados iniciales;
- lógica mínima para asignarlos;
- mostrarlos en ficha/lista.

**Criterios de aceptacion**

- existen estados visibles y consistentes;
- el equipo del club entiende mejor qué casos revisar primero;
- no se presenta como “verdad mágica” sino como ayuda operativa.

**Dependencias**

- Ticket 10.

---

### Ticket 12. Claim flow para historial cargado por admin

**Prioridad:** P2  
**Epica:** Epica 6. Experiencia jugador avanzada

**Objetivo**

Permitir que un jugador reclame como suyo un historial o reservas que antes estaban solo del lado del club.

**Alcance**

- definir disparador;
- definir validación;
- diseñar UX de reclamo;
- auditar consolidación.

**Criterios de aceptacion**

- el jugador puede reclamar reservas históricas cuando corresponde;
- el club conserva trazabilidad del proceso;
- el flujo no genera vinculaciones peligrosas por ambigüedad.

**Dependencias**

- Ticket 4;
- Ticket 10 recomendable.

---

### Ticket 13. Vista 360 de persona

**Prioridad:** P2  
**Epica:** Epica 7. Vision 2027 / herramientas avanzadas

**Objetivo**

Consolidar en una sola vista la vida completa de la persona dentro del club.

**Alcance**

- reservas;
- pagos;
- deuda;
- incidentes;
- cuenta;
- actividad;
- timeline.

**Criterios de aceptacion**

- soporte y admin entienden el caso completo sin saltar entre pantallas desconectadas;
- mejora el tiempo de resolución de casos complejos.

**Dependencias**

- Ticket 10;
- Ticket 11.

---

### Ticket 14. Identity cockpit del club

**Prioridad:** P3  
**Epica:** Epica 7. Vision 2027 / herramientas avanzadas

**Objetivo**

Dar una vista sistémica de la salud de identidad del club.

**Alcance**

- duplicados abiertos;
- reservas con identidad partida;
- clientes sin datos fuertes;
- merges recientes;
- señales de riesgo.

**Criterios de aceptacion**

- el club puede ver el estado general del módulo de identidad;
- aparecen prioridades claras de limpieza y consolidación.

**Dependencias**

- Ticket 9;
- Ticket 11;
- Ticket 13.

---

### Ticket 15. Detector automático de split-brain

**Prioridad:** P3  
**Epica:** Epica 7. Vision 2027 / herramientas avanzadas

**Objetivo**

Detectar automáticamente reservas o personas donde `booking.userId` y `client.userId` quedaron desacoplados.

**Alcance**

- definir heurísticas;
- generar cola o señal interna;
- revisar integración con incidentes o dashboard.

**Criterios de aceptacion**

- el sistema puede listar casos de identidad partida detectables;
- no genera acciones automáticas peligrosas;
- deja insumo claro para revisión operativa.

**Dependencias**

- Ticket 4;
- Ticket 9;
- Ticket 14 recomendable.

---

## 42.M. Decisiones finales propuestas

Estas decisiones estan redactadas como postura recomendada para cerrar negocio y destrabar implementacion.

### 1. `forceCreateNew`

**Decision propuesta**

`forceCreateNew` debe existir, pero solo para `ADMIN` y `OWNER`, con warning fuerte y auditoria obligatoria.

**Regla recomendada**

- no debe ser el camino por defecto;
- debe requerir confirmacion explicita;
- debe guardar actor, motivo y contexto;
- debe usarse solo cuando el operador decide conscientemente crear igual a pesar del conflicto.

**Razon**

Eliminarlo por completo volveria demasiado rigido al sistema.

Dejarlo abierto a todos reintroduce duplicados evitables en operacion diaria.

---

### 2. Politica de `phone` solo

**Decision propuesta**

`phone` solo no debe alcanzar para auto-linkear, auto-mergear ni decidir identidad canonicamente.

**Regla recomendada**

- `phone` solo sirve para sugerir candidatos;
- puede disparar advertencia o conflicto;
- no debe consolidar identidad por si mismo salvo que ademas exista otra senal fuerte.

**Razon**

El telefono es util, pero no es un identificador estable ni univoco.

Hay casos reales de telefono compartido, reciclado o mal cargado.

---

### 3. Politica para `phone/email` compartido

**Decision propuesta**

Telefono y email compartido deben permitirse como excepcion valida de negocio, no tratarse como imposibilidad absoluta.

**Regla recomendada**

- el sistema puede advertir;
- puede sugerir revisar antes de crear;
- pero no debe bloquear categoricamente todos los casos;
- el conflicto debe poder resolverse manualmente y quedar auditado.

**Razon**

En clubes reales hay familias, parejas, responsables de menores y cuentas compartidas.

Modelarlo como error absoluto volveria el sistema artificialmente rigido.

---

### 4. Politica para `DNI` repetido

**Decision propuesta**

`DNI` repetido debe bloquear por defecto.

**Regla recomendada**

- si se detecta `DNI` repetido, el flujo frena;
- solo `OWNER` o `ADMIN` avanzado puede overridear;
- el override debe exigir motivo y auditoria;
- el sistema deberia tratar este caso como senal de riesgo alto.

**Razon**

El DNI es la senal manual mas fuerte de identidad.

Si tampoco se endurece eso, el sistema pierde su mejor dato fuerte.

---

### 5. Permisos por rol para operaciones sensibles

**Decision propuesta**

Las operaciones sensibles no deben quedar abiertas a `STAFF`.

**Regla recomendada**

- `STAFF`: crear cliente, editar datos basicos, operar reservas y caja;
- `ADMIN`: resolver incidentes, vincular usuario, usar `forceCreateNew`, editar datos identitarios sensibles;
- `OWNER`: overrides excepcionales, merges delicados, desvinculaciones y operaciones de mayor riesgo.

**Razon**

La operacion diaria necesita velocidad, pero la identidad necesita gobernanza.

---

### 6. UX de conflicto de identidad

**Decision propuesta**

Los conflictos de identidad deben resolverse con UX guiada, no con errores tecnicos crudos.

**Regla recomendada**

La UI deberia ofrecer, segun el caso:

- usar cliente existente;
- crear igual;
- vincular usuario;
- fusionar clientes;
- revisar despues.

Y deberia mostrar contexto suficiente:

- si ya tiene usuario;
- cantidad de reservas;
- deuda;
- actividad;
- estado de confianza si existe.

**Razon**

El objetivo no es esconder el conflicto, sino volverlo entendible y operable.

---

### 7. Incidentes en edicion de cliente

**Decision propuesta**

Los conflictos de identidad nacidos en edicion deben abrir incidente cuando haya candidatos fuertes reales.

**Regla recomendada**

- no abrir incidente por cualquier validacion menor;
- si el conflicto es identitario y hay candidatos concretos, si abrirlo;
- debe dejar trazabilidad y bandeja de revision.

**Razon**

Editar cliente es hoy una fuente real de inconsistencia y no deberia quedar fuera del radar operativo.

---

### 8. Incidentes en link manual

**Decision propuesta**

Los conflictos identitarios del link manual pueden abrir incidente, pero no los rechazos puramente de permisos.

**Regla recomendada**

- si falla por conflicto identitario real, abrir incidente;
- si falla porque el actor no tiene permisos o porque el flujo no corresponde, no.

**Razon**

Conviene separar gobernanza de identidad de control de acceso.

---

### 9. Claim flow del jugador

**Decision propuesta**

El reclamo de historial por parte del jugador debe ser manual guiado, no automatico.

**Regla recomendada**

- el sistema puede sugerir que ciertas reservas parecen suyas;
- el jugador confirma;
- si hay ambiguedad, no se consolida automaticamente;
- el proceso debe quedar auditado.

**Razon**

Esto ayuda a consolidar experiencia digital sin adjudicar historial incorrectamente.

---

### 10. Pago de invitados

**Decision propuesta**

En esta etapa, el pago online debe quedar solo para el titular.

**Regla recomendada**

- titular autenticado: si;
- participante invitado: no por ahora;
- revisar mas adelante cuando ownership e identidad esten mucho mas consolidados.

**Razon**

Abrir pagos de invitados antes de ordenar identidad complica mucho el modelo y agrega riesgo innecesario.

---

### Resumen ejecutivo de cierre

La postura recomendada es:

- `phone` ayuda, pero no decide;
- `DNI` casi decide solo;
- `forceCreateNew` existe, pero muy restringido;
- las acciones sensibles no quedan en manos de `STAFF`;
- los conflictos se resuelven con UX guiada;
- el jugador paga sus propias reservas antes de abrir escenarios mas complejos.

---

## 43. Checklist actualizado de documentación e implementación

Para considerar el módulo bien documentado y preparado:

- [ ] Definir lenguaje visible: Cliente / Cuenta de Pique / Perfil / Historial.
- [ ] Ocultar `User` / `Client` en UI normal.
- [ ] Documentar incidentes actuales y futuros.
- [ ] Agregar incidentes en edición de cliente.
- [ ] Agregar incidentes en link manual conflictivo.
- [ ] Definir `dismissReason`.
- [ ] Definir `resolutionType` extendido.
- [ ] Definir `dedupeKey` formal.
- [ ] Definir niveles de verificación.
- [ ] Definir reglas de auto-link con teléfono/email verificado.
- [ ] Definir excepciones para teléfono/email compartido.
- [ ] Definir política fuerte para DNI.
- [ ] Definir permisos por operación sensible.
- [ ] Diseñar ficha 360°.
- [ ] Diseñar buscador universal.
- [ ] Diseñar “Clientes para revisar”.
- [ ] Diseñar experiencia jugador: vincular historial, mis clubes, mis reservas.
- [ ] Diseñar responsable/alumno para academia futura.
- [ ] Definir métricas de calidad de datos.
- [ ] Definir auditoría mínima y auditoría avanzada.

---

## 44. Principio final actualizado

La versión final del módulo debe seguir esta regla:

```txt
El sistema puede tener User y Client.
El club ve clientes/personas.
El jugador ve su perfil, clubes e historial.
Los conflictos se traducen en revisión guiada.
Las acciones sensibles se auditan.
La automatización solo actúa cuando hay certeza fuerte.
```


## 33. Cierre

Pique debe tener un módulo de identidad flexible para la realidad de los clubes, pero confiable para escalar hacia app de jugadores, pagos online, academia, participantes, reportes y automatizaciones.

La arquitectura correcta es:

```txt
Client local para operar.
User global para experiencia digital.
Resolución centralizada para unirlos cuando sea seguro.
Auditoría para todo lo sensible.
UX clara para que el club no sufra la complejidad.
```
