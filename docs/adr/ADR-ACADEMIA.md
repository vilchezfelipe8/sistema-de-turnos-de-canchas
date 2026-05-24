# ADR — Módulo Academia: Profesores, clases, alumnos, asistencia, créditos y pagos

Estado: Propuesto para aprobación  
Alcance: Fase 0, diseño técnico-funcional  
No implica implementación, migraciones ni cambios de código

## Resumen ejecutivo

Pique/TuCancha necesita un módulo de Academia para gestionar profesores, clases, alumnos, asistencia, deuda y créditos sin deformar el dominio actual de reservas. La decisión principal de este ADR es no extender `Booking` para clases y, en cambio, crear entidades propias de Academia (`Teacher`, `ClassSession`, `ClassEnrollment`, `ClassPass`, `ClassCreditUsage`).

También se fija que:
- no se crea `Student` como identidad separada en MVP;
- menores y responsables de pago se modelan explícitamente;
- público/privado y individual/grupal son ejes distintos;
- pago, asistencia y crédito son conceptos separados;
- la UI financiera canónica sigue siendo `AccountDrawer`;
- Agenda deberá evolucionar a una vista compuesta entre reservas y clases.

La meta de producto que ordena este diseño es: **“Sabé quién pagó, quién asistió y cuántas clases le quedan a cada alumno.”**

## 1. Contexto

Pique/TuCancha hoy resuelve bien reservas, agenda admin, clientes, usuarios, `PersonSearch`, participantes de reserva, cuentas/cobros con `AccountDrawer` e historial visible con `BookingHistoryEntry`. Eso alcanza para canchas y reservas, pero no para Academia.

Academia necesita resolver un problema distinto:
- clases privadas y grupales;
- clases públicas y cerradas;
- profesores;
- alumnos;
- asistencia;
- deuda por alumno;
- packs/créditos;
- pago futuro desde jugador o responsable.

El dolor real no es solo “agendar algo”, sino reemplazar la tarjetita física por trazabilidad digital:
- quién tomó la clase;
- quién pagó;
- quién debe;
- cuántos créditos quedan;
- qué pasó en cada encuentro.

Frase guía:
**“Sabé quién pagó, quién asistió y cuántas clases le quedan a cada alumno.”**

Además, el producto ya tiene reglas de identidad fuertes que no deben romperse:
- no linking automático `Client ↔ User`;
- no merge automático;
- no dedupe por teléfono/email compartido;
- selección explícita con `PersonSearch`;
- warning ante posible duplicado.

Conclusión de contexto: Academia no es una variante menor de reservas. Es un dominio nuevo que comparte infraestructura con reservas, pero no su modelo central.

## 2. Decisiones principales

### D1. Academia tendrá entidades propias y no extenderá Booking

**Decisión**  
Crear `Teacher`, `ClassSession`, `ClassEnrollment`, `ClassPass`, `ClassCreditUsage`, `ClassTemplate` opcional y `ClassSeries` futuro.

**Justificación**  
`Booking` ya está demasiado orientado a reserva de cancha. Meter clases ahí mezclaría responsabilidad de reserva, asistencia, créditos y deuda por alumno.

**Consecuencias**  
Más trabajo inicial, pero menos deuda estructural. Agenda deberá volverse una vista compuesta.

**Alternativa descartada**  
Extender `Booking` con tipos de clase.

### D2. No se crea Student como identidad separada en MVP

**Decisión**  
No crear entidad `Student` autónoma.

**Justificación**  
Duplicaría `Client/User`, aumentaría riesgo de identidad rota y chocaría con las reglas anti-merge ya consolidadas.

**Consecuencias**  
El alumno será una persona del club, no una identidad paralela.

**Alternativa descartada**  
`Student` como tercera identidad operativa.

### D3. El alumno se representa con Client/User + ClassEnrollment

**Decisión**  
El alumno vive como `Client`, con `User` opcional, y participa en Academia mediante `ClassEnrollment`.

**Justificación**  
Reutiliza `PersonSearch`, perfil de cliente, historial, deuda y futura vista jugador.

**Consecuencias**  
Habrá que separar claramente alumno de responsable de pago.

**Alternativa descartada**  
Hacer que el alumno exista solo dentro de la clase como snapshot sin identidad base.

### D4. StudentProfile queda como evolución futura

**Decisión**  
Si más adelante hacen falta datos académicos propios, se agregará `StudentProfile` 1:1 con `Client`.

**Justificación**  
Separa identidad de perfil académico sin duplicar persona.

**Consecuencias**  
Nivel, progreso, objetivos y notas deportivas no entran en MVP base.

**Alternativa descartada**  
Meter datos académicos en `Client` desde el día 1.

### D5. Menores se resuelven separando alumno, responsable y usuario

**Decisión**  
No asumir que quien toma la clase, quien paga y quien inicia sesión son la misma persona.

**Justificación**  
Caso real de menores.

**Consecuencias**  
Hay que modelar responsable explícito.

**Alternativa descartada**  
Inferir tutor por apellido, email o teléfono.

### D6. ClientRelationship se diseña para responsables/tutores

**Decisión**  
Introducir una relación explícita entre clientes.

**Justificación**  
Cubre menores, tutores, familia, pagadores y permisos cruzados sin inventar heurísticas peligrosas.

**Consecuencias**  
Agrega complejidad de permisos, pero ordena el dominio.

**Alternativa descartada**  
Guardar solo un nombre o contacto de tutor sin entidad relacional.

### D7. ClassEnrollment tendrá studentClientId y billingResponsibleClientId

**Decisión**  
Separar alumno de responsable de facturación en la inscripción.

**Justificación**  
Evita mezclar asistencia con pago y soporta menores desde el principio.

**Consecuencias**  
Más campos y validaciones, pero modelo correcto.

**Alternativa descartada**  
Una sola persona “dueña” del enrollment.

### D8. ClassPass separa ownerClientId y beneficiaryClientId

**Decisión**  
El pack tiene comprador/administrador y beneficiario.

**Justificación**  
Soporta “mamá compra, hijo usa” sin inventar parches.

**Consecuencias**  
No alcanza por sí solo para packs familiares complejos; eso queda fuera de MVP.

**Alternativa descartada**  
Pack con un solo titular implícito.

### D9. ClassSession separa visibility y classType

**Decisión**  
Modelar dos ejes:
- `visibility: PUBLIC | PRIVATE`
- `classType: INDIVIDUAL | GROUP`

**Justificación**  
Público/privado no es lo mismo que individual/grupal.

**Consecuencias**  
Deben soportarse las 4 combinaciones válidas.

**Alternativa descartada**  
Asumir `PUBLIC = GROUP` y `PRIVATE = INDIVIDUAL`.

### D10. Pago, asistencia y crédito se modelan por separado

**Decisión**  
Separar `enrollmentStatus`, `attendanceStatus`, `paymentStatus`, `ClassCreditUsage` y `Account/Payment`.

**Justificación**  
En la operación real no coinciden.

**Consecuencias**  
Más estados, pero trazabilidad real.

**Alternativa descartada**  
Un único status comercial-operativo.

### D11. Agenda debe renderizar Booking y ClassSession como items distintos en una vista compuesta

**Decisión**  
Agenda no se reescribe sobre clases; compone dos dominios.

**Justificación**  
Mantiene claro qué es reserva y qué es clase.

**Consecuencias**  
Habrá que diseñar una capa de schedule unificado.

**Alternativa descartada**  
Convertir las clases en bookings encubiertos.

### D12. AccountDrawer sigue siendo la UI financiera canónica; Academia se integra con Cuentas, no crea otro sistema de cobro paralelo

**Decisión**  
Academia no crea un sistema paralelo de cobro.

**Justificación**  
Ya existe infraestructura usable de cuentas/pagos.

**Consecuencias**  
Habrá que extender `AccountSource` y diseñar integración con enrollments y passes.

**Alternativa descartada**  
Drawer financiero nuevo dentro de Academia.

## 3. Modelo de dominio propuesto

### Teacher

- `id`
- `clubId`
- `clientId?`
- `userId?`
- `displayName`
- `email?`
- `phone?`
- `isInternal`
- `isActive`
- `specialtiesJson?`
- `notes?`
- `createdAt`
- `updatedAt`

### ClassSession

- `id`
- `clubId`
- `teacherId`
- `visibility: PUBLIC | PRIVATE`
- `classType: INDIVIDUAL | GROUP`
- `activityTypeId?`
- `courtId?`
- `startsAt`
- `endsAt`
- `durationMinutes`
- `capacity`
- `pricePerStudent?`
- `status`
- `level?`
- `description?`
- `requiresApproval`
- `requiresPaymentToEnroll`
- `classTemplateId?`
- `createdByUserId`
- `metadataJson?`

### ClassEnrollment

- `id`
- `clubId`
- `classSessionId`
- `studentClientId`
- `studentUserId?`
- `billingResponsibleClientId?`
- `snapshotName`
- `snapshotEmail?`
- `snapshotPhone?`
- `priceAtEnrollment`
- `paidAmount`
- `enrollmentStatus`
- `attendanceStatus`
- `paymentStatus`
- `classCreditUsageId?`
- `cancelledAt?`
- `attendedAt?`
- `notes?`
- `createdByUserId`

### ClassPass

- `id`
- `clubId`
- `ownerClientId`
- `ownerUserId?`
- `beneficiaryClientId`
- `beneficiaryUserId?`
- `packageName`
- `totalCredits`
- `usedCredits`
- `remainingCredits`
- `expiresAt?`
- `activityTypeId?`
- `classType?`
- `teacherId?`
- `transferable`
- `status`
- `purchasedAt`
- `accountId?`
- `paymentId?`
- `notes?`

### ClassCreditUsage

- `id`
- `clubId`
- `classPassId`
- `classEnrollmentId`
- `creditsUsed`
- `usedAt`
- `reason`
- `createdByUserId`

### ClientRelationship

- `id`
- `clubId`
- `fromClientId`
- `toClientId`
- `relationshipType`
- `canPayFor`
- `canManageEnrollments`
- `canViewSchedule`
- `canCancelClass`
- `canViewPayments`
- `notes`
- `createdAt`
- `updatedAt`

### ClassTemplate opcional

- `name`
- `defaultDuration`
- `defaultCapacity`
- `defaultPrice`
- `defaultVisibility`
- `defaultClassType`
- `level`
- `description`
- `activityTypeId`

### StudentProfile futuro

Asociado a `Client`, no identidad separada:
- nivel
- notas académicas
- objetivos
- progreso
- datos deportivos

### FamilyGroup futuro

Fuera de MVP.

## 4. Estados recomendados

### ClassSession.status

- `DRAFT`
- `SCHEDULED`
- `CONFIRMED`
- `COMPLETED`
- `CANCELLED`

### ClassEnrollment.enrollmentStatus

- `ENROLLED`
- `WAITLISTED`
- `CANCELLED`

### ClassEnrollment.attendanceStatus

- `PENDING`
- `ATTENDED`
- `ABSENT`
- `NO_SHOW`
- `CANCELLED_ON_TIME`
- `CANCELLED_LATE`

### ClassEnrollment.paymentStatus

- `UNPAID`
- `PARTIAL`
- `PAID`
- `COVERED_BY_CREDIT`
- `REFUNDED`

### ClassPass.status

- `ACTIVE`
- `EXPIRED`
- `DEPLETED`
- `CANCELLED`

### ClassCreditUsage.reason

- `ATTENDANCE`
- `LATE_CANCEL`
- `NO_SHOW`
- `MANUAL_ADJUSTMENT`
- `REFUND_REVERSAL`

## 5. Reglas funcionales

### Identidad

- no linking automático `Client ↔ User`
- no merge automático
- uso de `PersonSearch` para alumno, profesor y responsable
- warning si se crea un cliente/alumno con posible duplicado
- un menor puede existir sin `User`
- un responsable puede tener `User`
- no usar email/teléfono como verdad absoluta para fusionar personas

### Visibility vs classType

- `PUBLIC` no implica `GROUP`
- `PRIVATE` no implica `INDIVIDUAL`
- `INDIVIDUAL` normalmente `capacity = 1`
- `GROUP` normalmente `capacity > 1`
- las 4 combinaciones son válidas:
  - `PUBLIC + INDIVIDUAL`
  - `PUBLIC + GROUP`
  - `PRIVATE + INDIVIDUAL`
  - `PRIVATE + GROUP`

### Menores

- alumno y responsable pueden ser personas distintas
- responsable paga/administra
- alumno toma la clase
- el `User` puede pertenecer al responsable, no al menor
- permisos definidos por relación explícita, no inferida

### Pagos

- la deuda nace en `ClassEnrollment`
- el pack nace en `ClassPass`
- el pago puede hacerlo alumno adulto o responsable autorizado
- el modelo debe soportar pago futuro desde jugador para cualquier clase asociada
- no mezclar visibilidad de la clase con capacidad de pago futuro

### Créditos

- `ClassPass.owner` compra/administra
- `ClassPass.beneficiary` usa
- el consumo se registra con `ClassCreditUsage`
- `NO_SHOW` y `CANCELLED_LATE` podrán consumir crédito según regla futura
- multi-beneficiario queda fuera de MVP

### Asistencia

- asistencia no implica pago
- pago no implica asistencia
- crédito no implica asistencia
- todos los estados se registran por separado

### Agenda

- `Booking` y `ClassSession` conviven en una vista compuesta
- `ClassSession` puede bloquear `courtId`
- `ClassSession` debe bloquear `teacherId`
- validar overlap de cancha y de profesor

### Privacidad

- admin ve todo
- profesor ve lista, asistencia y estado financiero simple, no detalle contable completo por defecto
- responsable ve solo menores/clientes vinculados explícitamente
- no exponer datos de otros alumnos
- notas y evaluaciones sensibles deben quedar restringidas

## 6. Impacto por módulo

### Backend

Impacta:
- Prisma schema
- nuevos servicios de Academia
- nuevos controllers y routes
- futuras migraciones
- integración con PersonSearch
- integración con cuentas

No conviene:
- meter lógica de clases dentro de `BookingService`
- reciclar `FixedBooking` para cursos

### Frontend admin

Nuevos módulos:
- Profesores
- Clases
- Inscripciones
- Asistencia
- Packs/créditos
- Drawer de clase
- Agenda compuesta

Se reutiliza:
- `PersonSearch`
- `AccountDrawer`
- patrones de hover/drawer/timeline de Agenda

### Cuentas/Pagos

Requiere extender:
- `AccountSource` futuro para academia, probablemente al menos:
  - `CLASS_ENROLLMENT`
  - `CLASS_PASS`
- uso de `AccountItem`
- uso de `Payment`
- deuda por alumno
- cobro de pack

### Clientes

El perfil de cliente debería poder mostrar a futuro:
- clases
- asistencias
- ausencias
- créditos
- responsables o relaciones
- deuda académica

### Jugador futuro

Debe poder cubrir:
- mis clases
- clases públicas
- clases privadas asignadas
- pagar clase o deuda
- comprar pack
- ver créditos
- ver clases de hijos o vinculados, si corresponde

### Profesor futuro

Panel limitado para:
- ver clases
- lista de alumnos
- asistencia
- deuda simple
- notas

No debería arrancar viendo contabilidad completa.

## 7. Alternativas descartadas

### A. Extender Booking con tipos de clase

Descartado porque:
- `Booking` se vuelve monstruoso
- mezcla reserva con academia
- complica asistencia
- complica créditos
- complica deuda por alumno
- complica futuro jugador y profesor

### B. Crear Student como identidad separada

Descartado porque:
- duplica `Client/User`
- multiplica problemas de identidad
- contradice las reglas anti-merge
- complica pagos, historial y permisos

### C. Tratar PUBLIC como sinónimo de GROUP

Descartado porque:
- es conceptualmente incorrecto
- rompe clases individuales publicadas

### D. Tratar PRIVATE como sinónimo de INDIVIDUAL

Descartado porque:
- rompe grupos cerrados y escuelitas

### E. Mezclar pago, asistencia y crédito en un solo status

Descartado porque:
- mata la trazabilidad
- no cubre casos reales
- genera discusiones operativas justo donde el módulo quiere resolverlas

## 8. Fases de implementación

### Fase 0 — ADR y backlog

**Objetivo**  
Cerrar arquitectura.

**Alcance**  
Decisiones, entidades, reglas, fases.

**Entidades**  
Ninguna implementada; diseño solamente.

**Módulos**  
Ninguno implementado; documentación y tickets.

**Qué NO incluye**  
Código.

**Riesgos**  
Si queda ambigua, después se improvisa en schema.

**Criterios de aceptación**  
ADR aprobado y backlog priorizado.

### Fase 1 — Admin profesores

**Objetivo**  
Base operativa de profesores.

**Alcance**  
`Teacher`, CRUD admin.

**Entidades**  
`Teacher`

**Módulos**  
Admin profesores.

**Qué NO incluye**  
Comisiones, disponibilidad compleja, login profesor.

**Riesgos**  
Mezclarlo con `Client.isProfessor`.

**Criterios de aceptación**  
Alta, baja y edición de profesor.

### Fase 2 — Modelos base Academia

**Objetivo**  
Crear corazón del dominio.

**Alcance**  
`ClassSession`, `ClassEnrollment`, relación inicial con `Teacher`.

**Entidades**  
`ClassSession`, `ClassEnrollment`, `ClientRelationship`

**Módulos**  
Backend Academia.

**Qué NO incluye**  
Agenda compuesta completa.

**Riesgos**  
Definir mal los identificadores y estados.

**Criterios de aceptación**  
Schema y contratos backend coherentes.

### Fase 3 — Admin clases básicas

**Objetivo**  
Crear y editar clases.

**Alcance**  
Privada/grupal, pública/privada, profesor, cancha, horario, capacidad, precio.

**Entidades**  
`ClassSession`, `Teacher`

**Módulos**  
UI admin de clases.

**Qué NO incluye**  
Waitlist, cursos.

**Riesgos**  
No validar overlaps.

**Criterios de aceptación**  
CRUD funcional de sesiones.

### Fase 4 — Enrollments con PersonSearch

**Objetivo**  
Inscribir alumnos correctamente.

**Alcance**  
`PersonSearch`, warning duplicados, responsable opcional.

**Entidades**  
`ClassEnrollment`, `ClientRelationship`

**Módulos**  
UI admin de inscripciones.

**Qué NO incluye**  
Jugador autoinscribiéndose.

**Riesgos**  
Romper reglas de identidad.

**Criterios de aceptación**  
Inscripción sin merges automáticos.

### Fase 5 — Asistencia admin

**Objetivo**  
Trazabilidad operativa.

**Alcance**  
Attendance statuses, carga manual.

**Entidades**  
`ClassEnrollment`

**Módulos**  
Asistencia admin.

**Qué NO incluye**  
QR, panel profesor complejo.

**Riesgos**  
Mezclar asistencia con pago.

**Criterios de aceptación**  
Asistencia auditable por alumno.

### Fase 6 — ClassPass / créditos digitales

**Objetivo**  
Reemplazar tarjetita física.

**Alcance**  
`ClassPass`, `ClassCreditUsage`, consumo básico.

**Entidades**  
`ClassPass`, `ClassCreditUsage`

**Módulos**  
Admin packs/créditos.

**Qué NO incluye**  
Pool familiar, transferencias complejas.

**Riesgos**  
Modelar mal owner/beneficiary.

**Criterios de aceptación**  
Compra y consumo trazables.

### Fase 7 — Cobro admin de clases/packs

**Objetivo**  
Llevar deuda y pago a cuentas reales.

**Alcance**  
Integración con `Account`, cobro clase, cobro pack.

**Entidades**  
`ClassEnrollment`, `ClassPass`, `Account`

**Módulos**  
Academia + Cuentas.

**Qué NO incluye**  
Pagos online jugador.

**Riesgos**  
Elegir mal granularidad de cuenta.

**Criterios de aceptación**  
Deuda por alumno clara y cobro registrable.

### Fase 8 — Agenda integrada

**Objetivo**  
Ver reservas y clases juntas.

**Alcance**  
Card, hover, drawer de `ClassSession`.

**Entidades**  
`Booking`, `ClassSession`

**Módulos**  
Agenda admin.

**Qué NO incluye**  
Reescritura total de Agenda.

**Riesgos**  
Contaminar Agenda sin capa de composición.

**Criterios de aceptación**  
Agenda compuesta usable.

### Fase 9 — Jugador/alumno

**Objetivo**  
Exponer clases y deuda al usuario final.

**Alcance**  
Mis clases, deuda, créditos, pago futuro.

**Entidades**  
`ClassEnrollment`, `ClassPass`, `ClientRelationship`

**Módulos**  
Jugador/alumno.

**Qué NO incluye**  
Progreso académico.

**Riesgos**  
Permisos de responsables y menores.

**Criterios de aceptación**  
Alumno o responsable correcto ve y paga lo suyo.

### Fase 10 — Profesor/panel limitado

**Objetivo**  
Operación básica de profesor.

**Alcance**  
Asistencia, alumnos, estado simple de deuda.

**Entidades**  
`Teacher`, `ClassSession`, `ClassEnrollment`

**Módulos**  
Panel profesor.

**Qué NO incluye**  
Comisiones ni reporting profundo.

**Riesgos**  
Fuga de datos sensibles.

**Criterios de aceptación**  
Profesor puede operar sin ver de más.

### Fase 11 — Avanzado/flayero

**Objetivo**  
Escalar producto Academia.

**Alcance**  
Waitlist, reglas de cancelación, cursos, métricas, agenda profesor, etc.

**Entidades**  
Pendientes según necesidad.

**Módulos**  
Backlog avanzado.

**Qué NO incluye**  
MVP.

**Riesgos**  
Querer meterlo antes de estabilizar núcleo.

**Criterios de aceptación**  
Backlog separado del MVP.

## 9. Backlog derivado

### ACA-001 — ADR arquitectura Academia
- **Tipo:** Tech Design
- **Prioridad:** P0
- **Descripción:** consolidar arquitectura del módulo Academia
- **Criterios de aceptación:** ADR aprobado
- **Dependencias:** ninguna
- **Qué NO incluye:** implementación

### ACA-002 — Diseño identidad Academia con PersonSearch
- **Tipo:** Tech Design
- **Prioridad:** P0
- **Descripción:** definir cómo se seleccionan alumno, profesor y responsable
- **Criterios de aceptación:** reglas explícitas y anti-merge confirmadas
- **Dependencias:** ACA-001
- **Qué NO incluye:** UI final

### ACA-003 — Diseño financiero Academia vs Account
- **Tipo:** Tech Design
- **Prioridad:** P0
- **Descripción:** decidir granularidad de cuentas para enrollment y pack
- **Criterios de aceptación:** definición de `AccountSource` y source-of-truth comercial
- **Dependencias:** ACA-001
- **Qué NO incluye:** cobro online

### ACA-004 — Diseño responsables/tutores para alumnos menores
- **Tipo:** Tech Design
- **Prioridad:** P0
- **Descripción:** definir `ClientRelationship` y permisos
- **Criterios de aceptación:** modelo y casos de uso cerrados
- **Dependencias:** ACA-001, ACA-002
- **Qué NO incluye:** vista jugador

### ACA-005 — Separar visibilidad y formato de clase
- **Tipo:** Data Model
- **Prioridad:** P0
- **Descripción:** fijar `visibility` y `classType` como ejes distintos
- **Criterios de aceptación:** 4 combinaciones soportadas
- **Dependencias:** ACA-001
- **Qué NO incluye:** catálogo público

### ACA-010 — Modelo Teacher
- **Tipo:** Backend / Data Model
- **Prioridad:** P1
- **Descripción:** entidad `Teacher` y relaciones base
- **Criterios de aceptación:** soporta profesor con o sin `User`
- **Dependencias:** ACA-001
- **Qué NO incluye:** comisiones

### ACA-011 — CRUD admin profesores
- **Tipo:** Feature
- **Prioridad:** P1
- **Descripción:** alta/baja/edición/listado
- **Criterios de aceptación:** admin puede gestionar profesores
- **Dependencias:** ACA-010
- **Qué NO incluye:** disponibilidad compleja

### ACA-020 — Modelo ClassSession
- **Tipo:** Backend / Data Model
- **Prioridad:** P1
- **Descripción:** sesión concreta de clase con ejes `visibility/classType`
- **Criterios de aceptación:** soporta 4 combinaciones
- **Dependencias:** ACA-001, ACA-005
- **Qué NO incluye:** waitlist

### ACA-021 — CRUD admin clases básicas
- **Tipo:** Feature
- **Prioridad:** P1
- **Descripción:** crear/editar/cancelar clases
- **Criterios de aceptación:** sesión básica administrable
- **Dependencias:** ACA-020, ACA-010
- **Qué NO incluye:** agenda integrada

### ACA-030 — Modelo ClassEnrollment
- **Tipo:** Backend / Data Model
- **Prioridad:** P1
- **Descripción:** inscripción con alumno y responsable opcional
- **Criterios de aceptación:** separa estudiante, asistencia y pago
- **Dependencias:** ACA-001, ACA-004
- **Qué NO incluye:** pagos online

### ACA-031 — UI admin inscribir alumno con PersonSearch
- **Tipo:** Frontend
- **Prioridad:** P1
- **Descripción:** agregar alumno con PersonSearch
- **Criterios de aceptación:** selección explícita y snapshots correctos
- **Dependencias:** ACA-030, ACA-002
- **Qué NO incluye:** autoinscripción jugador

### ACA-032 — Warning duplicado al crear alumno desde clase
- **Tipo:** Feature
- **Prioridad:** P1
- **Descripción:** advertir posibles duplicados sin merge automático
- **Criterios de aceptación:** warning visible y opciones explícitas
- **Dependencias:** ACA-002, ACA-031
- **Qué NO incluye:** dedupe automático

### ACA-033 — Seleccionar responsable de pago en enrollment
- **Tipo:** Feature
- **Prioridad:** P1
- **Descripción:** asignar `billingResponsibleClientId`
- **Criterios de aceptación:** responsable explícito por inscripción
- **Dependencias:** ACA-030, ACA-004
- **Qué NO incluye:** pagos online

### ACA-040 — Estados de asistencia admin
- **Tipo:** Feature
- **Prioridad:** P2
- **Descripción:** marcar asistencia por alumno
- **Criterios de aceptación:** statuses separados de pago
- **Dependencias:** ACA-030
- **Qué NO incluye:** QR

### ACA-050 — Modelo ClassPass
- **Tipo:** Backend / Data Model
- **Prioridad:** P2
- **Descripción:** packs/créditos con owner y beneficiary
- **Criterios de aceptación:** soporta compra y saldo restante
- **Dependencias:** ACA-001, ACA-004
- **Qué NO incluye:** pool familiar

### ACA-051 — Modelo ClassCreditUsage
- **Tipo:** Backend / Data Model
- **Prioridad:** P2
- **Descripción:** trazabilidad del consumo de crédito
- **Criterios de aceptación:** reason + vínculo a enrollment
- **Dependencias:** ACA-050, ACA-030
- **Qué NO incluye:** reglas avanzadas de negocio

### ACA-052 — Compra admin de pack/créditos
- **Tipo:** Feature
- **Prioridad:** P2
- **Descripción:** registrar compra/otorgamiento de pack
- **Criterios de aceptación:** pack activo y saldo visible
- **Dependencias:** ACA-050
- **Qué NO incluye:** compra online

### ACA-053 — Packs/créditos con beneficiario distinto del comprador
- **Tipo:** Feature / Data Model
- **Prioridad:** P2
- **Descripción:** soportar “padre compra, hijo usa”
- **Criterios de aceptación:** owner y beneficiary separados
- **Dependencias:** ACA-050, ACA-004
- **Qué NO incluye:** multi-beneficiario

### ACA-060 — Integración financiera de clases con Account
- **Tipo:** Backend
- **Prioridad:** P2
- **Descripción:** definir `AccountSource` y vínculo de deuda académica
- **Criterios de aceptación:** debt source claro para enrollment y pass
- **Dependencias:** ACA-003, ACA-030, ACA-050
- **Qué NO incluye:** pagos online

### ACA-061 — Cobro admin clase individual
- **Tipo:** Frontend / Feature
- **Prioridad:** P2
- **Descripción:** registrar cobro de deuda de clase
- **Criterios de aceptación:** pago reflejado en enrollment/account
- **Dependencias:** ACA-060
- **Qué NO incluye:** checkout jugador

### ACA-062 — Cobro admin pack
- **Tipo:** Frontend / Feature
- **Prioridad:** P2
- **Descripción:** registrar cobro de pack
- **Criterios de aceptación:** pago reflejado en `ClassPass`/`Account`
- **Dependencias:** ACA-060, ACA-050
- **Qué NO incluye:** Mercado Pago

### ACA-070 — Mis clases jugador
- **Tipo:** Frontend
- **Prioridad:** P3
- **Descripción:** vista de clases propias
- **Criterios de aceptación:** futuras/pasadas visibles
- **Dependencias:** ACA-020, ACA-030
- **Qué NO incluye:** progreso

### ACA-071 — Ver deuda/créditos jugador
- **Tipo:** Frontend
- **Prioridad:** P3
- **Descripción:** deuda y créditos del jugador
- **Criterios de aceptación:** saldo y obligaciones visibles
- **Dependencias:** ACA-060, ACA-050
- **Qué NO incluye:** wallet familiar compleja

### ACA-072 — Pagar clase/deuda
- **Tipo:** Feature
- **Prioridad:** P3
- **Descripción:** pago futuro desde jugador
- **Criterios de aceptación:** soporta clase pública, privada, grupal o deuda asociada
- **Dependencias:** ACA-060, ACA-071
- **Qué NO incluye:** todas las variantes online el día 1

### ACA-073 — Catálogo clases públicas
- **Tipo:** Frontend
- **Prioridad:** P3
- **Descripción:** listado de clases `PUBLIC` inscribibles
- **Criterios de aceptación:** no asume que todas son grupales
- **Dependencias:** ACA-020, ACA-005
- **Qué NO incluye:** recomendaciones avanzadas

### ACA-074 — Responsable paga clases de menor
- **Tipo:** Feature
- **Prioridad:** P3
- **Descripción:** adulto vinculado puede pagar clases/deuda del menor
- **Criterios de aceptación:** permisos explícitos y sin fuga de datos
- **Dependencias:** ACA-004, ACA-060
- **Qué NO incluye:** autorización familiar masiva

### ACA-075 — Vista jugador clases/deuda de hijos
- **Tipo:** Frontend
- **Prioridad:** P3
- **Descripción:** responsable ve clases, deuda y créditos de menores vinculados
- **Criterios de aceptación:** solo menores autorizados visibles
- **Dependencias:** ACA-074
- **Qué NO incluye:** lista completa de alumnos

### ACA-080 — Panel profesor
- **Tipo:** Feature
- **Prioridad:** P4
- **Descripción:** vista limitada de profesor
- **Criterios de aceptación:** clases, alumnos, asistencia, deuda simple
- **Dependencias:** ACA-040
- **Qué NO incluye:** comisiones

### ACA-081 — Waitlist
- **Tipo:** Feature
- **Prioridad:** P4
- **Descripción:** lista de espera por clase
- **Criterios de aceptación:** alumno puede quedar `WAITLISTED`
- **Dependencias:** ACA-030
- **Qué NO incluye:** algoritmo inteligente

### ACA-082 — Reglas de cancelación
- **Tipo:** Tech Design / Feature
- **Prioridad:** P4
- **Descripción:** políticas por clase para cancelación tardía y no-show
- **Criterios de aceptación:** impacto consistente en asistencia y crédito
- **Dependencias:** ACA-040, ACA-051
- **Qué NO incluye:** motor de reglas general

### ACA-083 — Agenda profesor
- **Tipo:** Feature
- **Prioridad:** P4
- **Descripción:** vista operativa por profesor
- **Criterios de aceptación:** schedule de clases filtrado por docente
- **Dependencias:** ACA-020, ACA-080
- **Qué NO incluye:** disponibilidad compleja

### ACA-084 — Cursos recurrentes
- **Tipo:** Feature / Data Model
- **Prioridad:** P4
- **Descripción:** `ClassSeries` / cursos
- **Criterios de aceptación:** sesiones agrupadas con continuidad
- **Dependencias:** ACA-020
- **Qué NO incluye:** plan académico completo

### ACA-085 — Métricas academia
- **Tipo:** Reporting
- **Prioridad:** P4
- **Descripción:** ocupación, asistencia, deuda, packs, no-show
- **Criterios de aceptación:** métricas básicas útiles para dueño
- **Dependencias:** fases operativas previas
- **Qué NO incluye:** BI avanzada

### ACA-086 — Privacidad y permisos para datos de menores
- **Tipo:** Tech Design
- **Prioridad:** P1
- **Descripción:** matriz de permisos admin/profesor/alumno/responsable
- **Criterios de aceptación:** reglas claras y auditables
- **Dependencias:** ACA-004
- **Qué NO incluye:** RBAC completo de toda la plataforma

## 10. Riesgos y decisiones abiertas

- overlap de cancha
- overlap de profesor
- recurrencia/cursos
- cuenta por enrollment vs por pack
- nuevos `AccountSource`
- clase con varias canchas
- clase con varios profesores
- packs familiares
- responsable de menor
- privacidad de menores
- profesor con o sin `User`
- comisiones/liquidación
- notas/evaluaciones
- cancelaciones y no-show
- acceso jugador por relación
- integración con Agenda
- reportes y métricas
- historial/auditoría específico de Academia
- qué parte ve profesor: deuda simple vs detalle financiero
- cuándo una clase pública individual queda “tomable” por jugador
- cómo se bloquea recurso cancha sin convertir clase en booking

## 11. Recomendación final

**¿El ADR está listo para pasar a implementación?**  
Sí, para arrancar Fase 1 y Fase 2. No para construir todo de una.

**¿Qué implementaría primero?**
1. P0 completo
2. `Teacher`
3. `ClassSession`
4. `ClassEnrollment`
5. `ClientRelationship`
6. asistencia básica
7. recién después `ClassPass` y finanzas

**¿Qué NO implementaría todavía?**
- `StudentProfile`
- `FamilyGroup`
- packs multi-beneficiario
- panel profesor completo
- cursos recurrentes
- waitlist inteligente
- reglas complejas de cancelación
- pagos online
- varias canchas / varios profesores

**¿Los tickets P0 están completos?**  
Sí, para abrir implementación con orden. El punto crítico es no saltearse `ACA-003`, `ACA-004` y `ACA-005`.

**Primer prompt de implementación recomendado después del ADR**  
“Implementemos Fase 1 y Fase 2 del módulo Academia. Primero auditá el schema actual y proponé el diff Prisma mínimo para `Teacher`, `ClassSession`, `ClassEnrollment` y `ClientRelationship`, sin tocar todavía Agenda ni pagos. Respetá `PersonSearch` y reglas de identidad explícita.”

**Conclusión crítica**  
Este módulo no falla por falta de pantallas; falla si nace con el modelo equivocado. Lo más importante ahora no es correr a crear clases en Agenda, sino evitar tres errores caros:
1. ensuciar `Booking`,
2. duplicar identidad con `Student`,
3. mezclar pago, asistencia y crédito en una sola cosa.

## Próximo paso recomendado

1. Implementar ACA-010 Modelo Teacher.
2. Implementar ACA-011 CRUD admin profesores.
3. Recién después avanzar con ClassSession.
