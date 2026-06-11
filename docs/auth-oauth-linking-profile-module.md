# Modulo de Autenticacion, OAuth, Linking y Perfil

Documento de producto y arquitectura para llevar el modulo de autenticacion de `Pique` a una experiencia completa, consistente y escalable.

Fecha de referencia: 2026-06-06
Estado: vision objetivo + backlog ejecutable
Alcance: login, sesiones, OAuth, linking `User <-> Client`, perfil jugador, experiencia admin e ideas futuras

---

## 1. Norte del modulo

La experiencia objetivo no es solo "permitir entrar con Google".

La experiencia objetivo es esta:

- el jugador siente que `Pique` lo reconoce;
- el club siente que gestiona personas, no tablas ni conflictos tecnicos;
- el sistema evita por si solo los errores obvios;
- cuando tiene dudas, no improvisa: explica, bloquea o pide confirmacion;
- todas las entradas al sistema terminan en la misma identidad, la misma sesion y la misma politica de linking.

En otras palabras:

`Autenticacion` no debe ser un modulo aislado.
Debe ser la puerta de entrada al sistema de identidad completo de `Pique`.

---

## 2. Objetivo de producto

La version excelente del modulo deberia lograr simultaneamente:

### Para el jugador

- entrar rapido con el metodo que prefiera;
- no perder reservas por haber usado otro metodo de login;
- ver siempre sus reservas, pagos y actividad correcta;
- poder pagar sin friccion sus reservas propias;
- entender con claridad que cuenta tiene conectada y en que clubes esta vinculada.

### Para el club

- evitar duplicados silenciosos;
- vincular personas reales con cuentas digitales de forma confiable;
- tener una UX clara para conflictos;
- corregir errores sin romper historial;
- auditar quien vinculo, desvinculo o fusiono.

### Para el sistema

- una sola politica de identidad;
- una sola arquitectura de sesion;
- una sola verdad sobre verificacion;
- una sola forma de auditar linking y conflictos.

---

## 3. Modelo conceptual recomendado

### Entidades principales

- `User`: identidad digital global de `Pique`.
- `Client`: ficha operativa local de una persona dentro de un club.
- `AuthSession`: sesion server-side ya emitida por cookies HttpOnly.
- `UserOAuthIdentity`: nueva entidad recomendada para identidades OAuth.

### Separacion critica

Hay dos vinculos distintos y no conviene mezclarlos:

1. `OAuth Identity <-> User`
   Determina a que cuenta global de `Pique` pertenece una identidad externa.

2. `User <-> Client` por club
   Determina con que ficha operativa del club queda asociada esa persona.

Si esto se mezcla, se vuelve muy facil crear identidades partidas o merges peligrosos.

---

## 4. Arquitectura target

### 4.1. Todos los ingresos convergen a la misma sesion

Todos estos metodos deben terminar exactamente igual:

- password mientras exista;
- magic link;
- Google OAuth;
- Apple OAuth;
- Facebook OAuth.

Todos deben terminar en:

- mismo `User`;
- mismo `issueAuthPayload(...)`;
- mismo `AuthSession`;
- mismas cookies;
- misma UX posterior de cuenta y linking.

### 4.2. Nueva entidad: `UserOAuthIdentity`

Modelo sugerido:

```txt
UserOAuthIdentity
- id
- userId
- provider                // GOOGLE | APPLE | FACEBOOK
- providerUserId
- providerEmail
- providerEmailVerified
- profilePhotoUrl
- linkedAt
- lastLoginAt
- rawProfileSnapshot?     // opcional y acotado

unique(provider, providerUserId)
index(userId)
```

### 4.3. Reglas de resolucion `OAuth -> User`

Regla recomendada:

1. Si existe `provider + providerUserId`, usar ese `User`.
2. Si no existe pero el proveedor trae `email` verificado y coincide con un `User.email`, vincular a ese `User`.
3. Si no existe match confiable, crear `User` nuevo.
4. Si el proveedor no da email confiable, no intentar merge automatico raro.
5. Si hay ambiguedad fuerte, crear flujo de revision o linking asistido, no fusion silenciosa.

### 4.4. Reglas de resolucion `User -> Client`

Debe vivir en un unico motor comun, no dentro de cada flujo.

Servicio conceptual:

```txt
IdentityResolver
- ensureClientForKnownUser(clubId, userId, identityHints)
- resolveOAuthIdentity(providerPayload)
- linkUserToClient(...)
- unlinkUserFromClient(...)
- raiseIdentityIncident(...)
```

Regla recomendada:

1. Si el `User` ya tiene `Client` vinculado en ese club, usarlo.
2. Si no lo tiene, buscar match fuerte por `email`, `phone` o `dni`.
3. Si hay match fuerte unico y el `Client` esta libre, vincular.
4. Si hay multiples candidatos, bloquear y pedir resolucion.
5. Si el candidato ya esta vinculado a otro `User`, bloquear.
6. Si no hay match fuerte, crear `Client` nuevo vinculado.

---

## 5. Politica de verificacion y confianza

No basta con que un dato coincida. Importa el nivel de confianza del dato.

### Niveles recomendados

- Nivel 0: dato cargado
- Nivel 1: dato confirmado por el usuario
- Nivel 2: vinculo confirmado por el club
- Nivel 3: identidad fuerte formal

### Lectura practica

- email de Google/Apple verificado = senal fuerte;
- magic link completado = email verificado;
- telefono cargado por admin = no alcanza solo;
- telefono verificado por OTP/WhatsApp = puede pasar a senal fuerte;
- DNI repetido = caso sensible, bloquear por defecto.

### Campos recomendados

En `User`:

```txt
emailVerifiedAt
phoneVerifiedAt
documentVerifiedAt?   // futuro
```

En el vinculo o `Client`:

```txt
linkedAt
linkedByUserId
linkSource
linkConfidence
```

Valores sugeridos para `linkSource`:

- `AUTO_EMAIL_MATCH`
- `AUTO_PHONE_MATCH`
- `AUTO_DNI_MATCH`
- `ADMIN_CONFIRMED`
- `USER_REQUESTED`
- `SUPPORT_CONFIRMED`
- `IMPORT_LEGACY`
- `INCIDENT_RESOLUTION`
- `OAUTH_CLAIM_FLOW`

---

## 6. Experiencia objetivo del jugador

### 6.1. Login

La pantalla de entrada deberia sentirse simple y premium:

- Continuar con Google
- Continuar con Apple
- Continuar con Facebook
- Recibir link por email

El orden recomendado para salida inicial:

1. Google
2. Apple
3. Magic link
4. Facebook

Facebook conviene mantenerlo como fase 2 si agrega complejidad antes de cerrar bien `Google + Apple`.

### 6.2. Post-login ideal

El jugador no deberia pensar en linking tecnico.

Escenarios deseados:

- si ya existe su `User`, entra y sigue;
- si existe match claro con `Client`, el sistema lo resuelve solo;
- si hay ambiguedad, se explica con lenguaje humano;
- si no hay nada, el sistema crea lo minimo necesario sin duplicar.

### 6.3. Mensajes humanos en conflicto

En vez de errores tecnicos, usar mensajes como:

```txt
Encontramos mas de un perfil posible en este club.
No queremos asociarte al perfil incorrecto.
Podes elegir uno si corresponde o dejarlo en revision.
```

### 6.4. Centro de cuenta del jugador

Pantalla de perfil objetivo:

- datos personales;
- email y telefono con estado de verificacion;
- accesos conectados;
- sesiones activas;
- clubes donde esta vinculado;
- estado de cada vinculo;
- reservas y pagos propios;
- acciones de seguridad.

Secciones recomendadas:

```txt
Mi cuenta
Mis accesos
Mis clubes
Seguridad
Actividad
```

### 6.5. Acciones clave del perfil

- conectar Google;
- conectar Apple;
- conectar Facebook;
- desconectar proveedor;
- cambiar email si se permite;
- cerrar sesion actual;
- cerrar todas las sesiones;
- reclamar historial o perfil del club si aplica.

---

## 7. Experiencia objetivo del admin

### 7.1. La unidad visible no deberia ser tecnica

El admin no deberia sentir que gestiona `User`, `Client`, `link`, `merge` e incidentes por separado.

Deberia sentir que gestiona:

`Persona del club`

### 7.2. Ficha ideal de persona del club

Una sola vista deberia consolidar:

- datos basicos;
- cuenta vinculada o no;
- estado de verificacion;
- reservas;
- pagos y deuda;
- incidentes;
- historial de identidad;
- clientes absorbidos o archivados.

### 7.3. Bloque de identidad en perfil admin

Debe mostrar claramente:

- cuenta de `Pique` vinculada o no;
- metodo de ingreso conocido;
- fuente de verificacion;
- confianza del vinculo;
- fecha y actor del ultimo cambio;
- conflictos abiertos.

### 7.4. Linking manual

El link manual debe requerir:

- permiso;
- preview del impacto;
- confirmacion;
- auditoria.

Preview sugerido:

- reservas afectadas;
- si ese usuario ya esta vinculado a otro cliente;
- si el cliente ya esta vinculado a otro usuario;
- si hay incidentes relacionados;
- si hay pagos o cuentas sensibles asociadas.

### 7.5. Unlink manual

Debe existir, pero con reglas duras:

- no borra historial;
- exige motivo;
- deja auditoria;
- no debe romper reservas pasadas;
- las reservas futuras deben quedar explicitamente definidas por politica.

### 7.6. Merge manual

No hacerlo automatico.

Modelo recomendado:

```txt
Client.status = ACTIVE | ARCHIVED | MERGED
Client.mergedIntoClientId
Client.mergedAt
Client.mergedByUserId
Client.mergeReason
```

Regla operativa:

- la operacion normal solo ve `ACTIVE`;
- los `MERGED` quedan ocultos por defecto;
- el detalle del canonico puede mostrar absorbidos.

---

## 8. Politicas recomendadas

### 8.1. Lo que si haria

- auto-link si el match es fuerte, unico y sin conflicto;
- auditar todas las acciones sensibles;
- usar una sola politica para todos los flujos;
- dar claim flow al jugador para recuperar historial;
- agregar incidentes cuando el sistema duda.

### 8.2. Lo que no haria

- no auto-mergear clientes;
- no decidir por nombre parecido;
- no usar telefono no verificado como verdad suficiente;
- no tener una regla de linking para OAuth y otra distinta para reservas;
- no esconder conflictos tecnicos bajo comportamientos silenciosos.

### 8.3. Roles y permisos sugeridos

- `STAFF`: operacion diaria, sin acciones identitarias de alto riesgo.
- `ADMIN`: linking, resolucion de incidentes, edicion identitaria sensible, `forceCreateNew`.
- `OWNER`: overrides excepcionales, merge delicado, unlink sensible, decisiones finales.

### 8.4. `forceCreateNew`

Debe existir, pero:

- no como camino feliz;
- solo para `ADMIN` y `OWNER`;
- con warning fuerte;
- con motivo obligatorio;
- con auditoria.

---

## 9. Lo que falta para que el modulo se sienta realmente completo

### P0

- `UserOAuthIdentity`
- endpoints OAuth completos
- politica formal `OAuth -> User`
- `IdentityResolver` unico
- perfil de cuenta mas fuerte
- linking/unlinking auditado
- estados de verificacion visibles

### P1

- claim flow para historial cargado por admin
- vista `Persona del club`
- wizard humano de duplicados
- timeline de identidad
- bandeja mejorada de incidentes

### P2

- health dashboard de identidad
- confidence states mas visibles
- detector de split-brain
- sesiones activas por dispositivo
- linking asistido por jugador

---

## 10. Ideas flasheras recomendadas

No son para meter antes de cerrar lo basico, pero si son parte de la vision grande.

### 10.1. Claim my profile

Cuando el jugador se registra, `Pique` puede decir:

```txt
Encontramos perfiles tuyos en estos clubes.
Queres reclamarlos para que aparezcan en tu cuenta?
```

Nunca con merge silencioso.
Siempre con validacion y contexto.

### 10.2. Identity timeline

Linea de tiempo por persona:

- creado manualmente;
- reservo online;
- se registro;
- entro con Google;
- se vinculo;
- pago desde la app;
- se resolvio incidente.

### 10.3. Identity cockpit del club

Dashboard con:

- duplicados abiertos;
- clientes sin cuenta;
- usuarios sin cliente;
- reservas con identidad partida;
- personas con datos incompletos;
- merges recientes;
- conflictos pendientes.

### 10.4. Detector automatico de split-brain

Cola automatica cuando:

- `booking.userId` y `client.userId` quedaron desacoplados;
- un mismo `User` aparece contra multiples `Client` fuertes;
- hay suficientes senales como para sugerir revision.

### 10.5. Confidence score

No como verdad absoluta.
Si como ayuda operativa.

Ejemplo:

```txt
Identidad consolidada: alta
```

o eventualmente:

```txt
92% consolidada
```

### 10.6. Verificacion ligera por OTP o WhatsApp

Muy util para:

- destrabar ownership;
- reclamar historial;
- reforzar linking dudoso;
- confirmar telefono en onboarding.

### 10.7. Vista 360 de persona

Una pantalla con:

- identidad;
- cuenta;
- reservas;
- deuda;
- pagos;
- clases;
- incidentes;
- actividad reciente.

---

## 11. Roadmap recomendado

### Fase 1. Base robusta

- sumar `UserOAuthIdentity`
- implementar Google y Apple
- conectar callbacks a la sesion actual
- documentar reglas `OAuth -> User`
- auditar vinculaciones

### Fase 2. Linking y perfil

- crear `IdentityResolver` unico
- fortalecer `Mi cuenta`
- mostrar accesos conectados
- mostrar clubes vinculados
- claim flow inicial si hay historial compatible

### Fase 3. Operacion del club

- ficha `Persona del club`
- wizard de duplicados
- bandeja de incidentes mejorada
- mergeados ocultos en operacion diaria
- linking/unlinking con preview

### Fase 4. Experiencia premium

- cockpit de identidad
- timeline
- detector de split-brain
- confidence score
- OTP/WhatsApp para verificacion ligera

---

## 12. Criterio final de excelencia

El modulo esta realmente bien resuelto cuando pasan estas cosas:

- el jugador puede entrar con cualquier metodo y seguir siendo la misma persona para el sistema;
- nunca pierde sus reservas por haber cambiado de metodo de login;
- el club no crea duplicados silenciosos cuando el sistema ya tenia informacion suficiente para evitarlos;
- los conflictos raros existen, pero se sienten guiados y seguros;
- el lenguaje visible habla de personas, perfiles y cuenta, no de estructura interna;
- todo termina en la misma identidad, la misma sesion y la misma historia.

Conclusion corta:

El mejor modulo no es el que dice "login con Google implementado".
El mejor modulo es el que hace que `Pique` siempre reconozca a la persona correcta, en el contexto correcto, con la menor friccion posible.
