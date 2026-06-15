# Pilot Readiness

## 1. Decision Sobre Staging

- El staging persistente con host/dominio propio queda diferido por ahora.
- El staging temporal por tunel queda habilitado solo para validacion interna.
- No usar tuneles para clubes reales ni para operacion piloto.
- La validacion interna ya cubierta con tunel alcanza para esta etapa previa al primer piloto.

## 2. Riesgo Aceptado

Al no montar staging persistente en esta etapa:

- hay menos margen para probar deploys sin tocar produccion;
- hay menos estabilidad para repetir smokes largos sobre una URL fija;
- la validacion previa al piloto depende mas de disciplina operativa que de infraestructura separada.

Compensacion acordada:

- backups antes de invitar al club;
- smoke interno obligatorio en el entorno productivo controlado antes de abrir acceso;
- rollback claro y probado;
- piloto chico, controlado y con soporte manual cercano.

## 3. Checklist Pre-Produccion Controlada

| Check | Obligatorio | Estado |
|---|---:|---|
| DB nueva limpia | si | pendiente |
| `migrate deploy` | si | pendiente |
| backup configurado | si | pendiente |
| dominio real frontend/backend | si | pendiente |
| envs productivas completas | si | pendiente |
| login admin | si | pendiente |
| agenda/reservas | si | pendiente |
| POS/caja | si, si entra | pendiente |
| Mercado Pago | opcional | pendiente |
| WhatsApp | opcional / recomendado OFF si no esta maduro | pendiente |
| rollback | si | pendiente |

## 4. Smoke Obligatorio Antes De Invitar Club

- login admin;
- crear cliente;
- crear reserva;
- confirmar reserva;
- cancelar reserva;
- abrir caja;
- venta POS;
- pago POS;
- reporte basico;
- login jugador;
- Mis reservas;
- checkout summary;
- Mercado Pago solo si se activa para ese club.

## 5. Plan De Contingencia

| Problema | Accion |
|---|---|
| deploy falla | rollback al release anterior |
| DB falla | restaurar backup |
| MP falla | desactivar Mercado Pago y cobrar manualmente |
| WhatsApp falla | desactivar WhatsApp |
| POS falla | registrar manualmente la operacion y seguir operando |
| login falla | revisar cookies, CORS y envs |

## 6. Backlog Futuro

- staging persistente con dominio propio;
- CI/CD completo;
- backups automatizados y restore probado;
- monitoreo y logs centralizados;
- alertas;
- ambiente demo permanente;
- pagos por participante;
- refunds automaticos;
- Open Match;
- marketplace;
- billing SaaS;
- profesores y liquidaciones;
- proveedores y cuentas por pagar.

## 7. Produccion Controlada / Piloto Real Chico

### 7.1 Decisiones de Produccion

| Tema | Decision |
|---|---|
| Backend produccion | publicar una sola instancia controlada detras de `https://pique.ar/api` |
| Frontend produccion | publicar una sola instancia controlada en `https://pique.ar` |
| PostgreSQL produccion | DB nueva, limpia y separada de local/staging |
| Redis | habilitar si el despliegue lo necesita para workers, locks o jobs; si no, dejarlo explicitamente fuera |
| Scheduler | encendido |
| Worker WhatsApp | apagado al inicio salvo validacion operativa muy concreta |
| Dominio frontend | `https://pique.ar` |
| Dominio backend | `https://pique.ar/api` |
| Mercado Pago | recomendado OFF al dia 1 de onboarding; activar despues de validar agenda, reservas y caja |
| WhatsApp | recomendado OFF al dia 1; comunicacion manual al inicio |

### 7.2 DB Productiva Limpia

| Check | Resultado / pendiente |
|---|---|
| crear DB nueva | pendiente |
| confirmar permiso `CREATE EXTENSION btree_gist` | pendiente |
| correr `migrate deploy` | pendiente |
| correr `prisma generate` | pendiente |
| definir seed minimo o carga manual | pendiente |
| backup inicial post-migracion | pendiente |
| backup post-carga del club | pendiente |

Reglas:

- no usar DB local;
- no usar DB staging;
- no usar `db push`;
- usar `migrate deploy`;
- no invitar al club antes del backup inicial.

### 7.3 Checklist de Envs de Produccion

#### Backend

| Env | Obligatoria | Estado |
|---|---:|---|
| `NODE_ENV=production` | si | pendiente |
| `DATABASE_URL` | si | pendiente |
| `DIRECT_DATABASE_URL` | si | pendiente |
| `JWT_SECRET` | si | pendiente |
| `AUTH_REFRESH_PEPPER` | si | pendiente |
| `FRONTEND_URL` | si | recomendado `https://pique.ar` |
| `APP_BASE_URL` | si | recomendado `https://pique.ar` |
| `ALLOWED_ORIGINS` | si | recomendado `https://pique.ar,https://www.pique.ar` |
| `AUTH_COOKIE_SECURE=true` | si | pendiente |
| `AUTH_COOKIE_SAMESITE` | si | recomendado `lax` |
| `AUTH_TRUST_PROXY=true` si aplica | si, si hay proxy | pendiente |
| `INTEGRATION_SECRETS_KEY` | si | pendiente |
| `MERCADO_PAGO_ENABLED` | si | pendiente |
| `MERCADO_PAGO_TEST_TOKEN=false` | si, si MP entra | pendiente |
| `MERCADO_PAGO_CLIENT_ID` | si, si MP entra | pendiente |
| `MERCADO_PAGO_CLIENT_SECRET` | si, si MP entra | pendiente |
| `MERCADO_PAGO_WEBHOOK_SECRET` | si, si MP entra | pendiente |
| `MERCADO_PAGO_REDIRECT_URI` | si, si MP entra | recomendado `https://pique.ar/api/integrations/mercadopago/callback` |
| flags de WhatsApp | segun decision | pendiente |
| Redis si aplica | segun arquitectura | pendiente |

#### Frontend

| Env | Obligatoria | Estado |
|---|---:|---|
| `NEXT_PUBLIC_API_URL` | si | recomendado `/api` |
| `NEXT_PUBLIC_SITE_URL` | si | recomendado `https://pique.ar` |

Nota:

- `app.pique.ar` queda como opcion futura si se separa web publica y app.
- `api.pique.ar` queda como opcion futura si mas adelante se separa backend.
- para el piloto inicial preferimos mismo dominio con `/api`.

### 7.4 Decision de WhatsApp

Nota:

- esta seccion refleja una recomendacion operativa conservadora previa a la migracion oficial;
- la decision de arquitectura vigente para evolucion del producto esta documentada en `docs/whatsapp-cloud-api-migration.md`.

| Opcion | Decision |
|---|---|
| WhatsApp apagado | recomendada para dia 1 del piloto |
| WhatsApp por `wpp-service` | evaluar despues del onboarding inicial |
| WhatsApp `local_browser` | no recomendado para un piloto real controlado |

Si WhatsApp queda apagado:

- el club arranca con comunicacion manual;
- el canal de soporte debe saber responder consultas sin depender de automatismos;
- cualquier activacion posterior debe pasar por smoke operativo puntual.

### 7.5 Decision de Mercado Pago

Recomendacion operativa:

1. arrancar el onboarding con Mercado Pago apagado;
2. validar agenda, reservas, clientes y caja;
3. activar Mercado Pago por club solo despues de esa validacion;
4. hacer un pago chico real controlado;
5. verificar webhook, `Payment ONLINE` y ausencia de `CashMovement POS`.

Checklist especifico de MP si entra:

- callback OAuth de produccion;
- webhook de produccion;
- seller real del club;
- buyer real distinto;
- monto chico;
- `Payment ONLINE` unico;
- `pending = 0` en `Account BOOKING`;
- no `CashMovement POS`.

### 7.6 Backup y Rollback

| Incidente | Accion |
|---|---|
| deploy backend falla | rollback al release anterior |
| deploy frontend falla | rollback al build anterior |
| migration falla | detener despliegue y restaurar desde backup si ya impacto la DB |
| DB falla | restaurar backup |
| login falla | revisar cookies, CORS, dominios y envs |
| MP falla | desactivar Mercado Pago y cobrar manualmente |
| POS falla | operar manualmente y registrar luego |
| WhatsApp falla | desactivar WhatsApp |

Minimos obligatorios:

- backup antes de la carga inicial;
- backup antes del primer dia de uso del club;
- procedimiento de restore conocido;
- criterio claro para desactivar MP sin tocar otros flujos.

### 7.7 Smoke Interno en Produccion Controlada

#### Admin

- login admin;
- agenda carga;
- crear cliente;
- crear reserva;
- confirmar reserva;
- cancelar reserva;
- abrir caja;
- venta POS producto;
- pago POS;
- anulacion POS;
- reporte basico.

#### Jugador

- login jugador;
- Mis reservas;
- checkout summary.

#### Pagos

- si MP esta apagado: checkout bloqueado con mensaje claro;
- si MP esta encendido: pago chico real, webhook, `Payment ONLINE`, sin `CashMovement POS`.

### 7.8 Checklist de Onboarding del Club Piloto

1. crear club;
2. configurar owner/admin;
3. cargar canchas;
4. cargar actividades;
5. cargar horarios;
6. cargar precios;
7. cargar productos y servicios;
8. configurar staff;
9. probar agenda;
10. probar caja;
11. probar reserva;
12. probar cliente;
13. decidir MP ON/OFF;
14. decidir WhatsApp ON/OFF;
15. capacitar al club;
16. definir canal de soporte;
17. definir plan manual si falla algo.
