# Deploy (VPS + Docker + Nginx)

Guía mínima para desplegar Pique con foco en autenticación por cookies y operación productiva.

## 1) Requisitos base

- Docker + Docker Compose
- Reverse proxy TLS (Nginx o equivalente)
- Base de datos PostgreSQL accesible

Si usás `wpp-service`, instalar dependencias de Chromium en host/contenedor según tu estrategia.

Nota:

- `apps/wpp-service` es el transporte legacy basado en WhatsApp Web.
- La dirección objetivo de producto/arquitectura está documentada en `docs/whatsapp-cloud-api-migration.md`.

## 2) Variables de entorno críticas

Partir de `env.example` y definir valores reales.

Obligatorias en producción:

- `NODE_ENV=production`
- `DATABASE_URL`
- `DIRECT_DATABASE_URL` (sin pgbouncer; usada por Prisma Migrate)
- `JWT_SECRET`
- `AUTH_REFRESH_PEPPER` (secreto fuerte y único)
- `FRONTEND_URL` (URL pública frontend)
- `ALLOWED_ORIGINS` (lista explícita, separada por comas)
- `AUTH_ENABLE_COOKIE_SESSIONS=true`
- `AUTH_ALLOW_BEARER_LEGACY=false`
- `AUTH_COOKIE_SECURE=true`
- `AUTH_TRUST_PROXY=true` (si hay proxy TLS delante)

Recomendadas:

- `REDIS_URL`
- `READ_DATABASE_URL`
- `AUTH_COOKIE_SAMESITE=lax`
- `AUTH_COOKIE_DOMAIN=` vacío por defecto si servís frontend y backend desde `https://pique.ar` + `/api`.
- `AUTH_COOKIE_DOMAIN=.pique.ar` solo si más adelante separás subdominios y realmente necesitás cookie compartida.

Si vas a habilitar checkout online con Mercado Pago por club:

- `MERCADO_PAGO_ENABLED=true`
- `MERCADO_PAGO_CLIENT_ID`
- `MERCADO_PAGO_CLIENT_SECRET`
- `MERCADO_PAGO_REDIRECT_URI`
- `MERCADO_PAGO_WEBHOOK_SECRET`
- `APP_BASE_URL` (URL pública del backend)
- `INTEGRATION_SECRETS_KEY` (secreto fuerte para cifrar tokens OAuth en base)

No expongas tokens de clubes en logs, frontend ni variables compartidas.

Si vas a preparar `WhatsApp Cloud API` para PRs siguientes:

- `ENABLE_WHATSAPP_SEND_V2=false`
- `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2=false`
- `ENABLE_WHATSAPP_STAFF_EVENTS_V2=false`
- `ENABLE_WHATSAPP_V2_DRY_RUN=false`
- `ENABLE_WHATSAPP_CLOUD_API=false`
- `ENABLE_WHATSAPP_WEBHOOK_PROCESSOR=false`
- `WHATSAPP_META_GRAPH_API_BASE_URL=https://graph.facebook.com`
- `WHATSAPP_META_GRAPH_API_VERSION=v19.0`
- `WHATSAPP_META_REQUEST_TIMEOUT_MS=10000`
- `WHATSAPP_META_ACCESS_TOKEN` en entorno backend
- `WHATSAPP_META_RECIPIENT_ALLOWLIST=` para pruebas controladas
- `WHATSAPP_META_WEBHOOK_VERIFY_TOKEN` en entorno backend

Regla:

- no guardar token en DB
- `tokenSecretRef` debe apuntar a nombre de variable de entorno
- el verify token del webhook debe vivir solo en entorno, nunca hardcodeado

Checklist operativo de readiness:

- `WhatsappSender.code=PIQUE_DEFAULT`
- `mode=PIQUE_DEFAULT`
- `provider=META_CLOUD_API`
- `status=ACTIVE`
- `clubId=null`
- `phoneNumberId` y `wabaId` cargados desde Meta
- `tokenSecretRef=WHATSAPP_META_ACCESS_TOKEN`
- templates MVP en `ACTIVE`
- preflight admin OK antes de prender rollout

Orden recomendado de rollout:

1. deploy con flags apagadas
2. preflight
3. dry-run
4. allowlist interna
5. piloto customer
6. piloto staff
7. rollback por flags si hace falta

## 3) Migraciones y base limpia

No uses `prisma db push` como estrategia de staging/producción.

Secuencia recomendada para una DB nueva:

```bash
cd apps/backend
npx prisma validate
npx prisma migrate deploy
npx prisma generate
ALLOW_SEED=true npx prisma db seed
```

Notas operativas:

- `DATABASE_URL` puede apuntar a pgbouncer para runtime.
- `DIRECT_DATABASE_URL` debe apuntar a PostgreSQL directo, sin pgbouncer, para migraciones.
- La validación pre-piloto mostró que las migraciones aplican completas en un entorno Linux/Node 20 limpio.
- Si en macOS local ves `Schema engine error` genérico con Prisma 5.22, no tomes eso como fallo del historial SQL; verificá `migrate deploy` en un contenedor Linux o en staging/CI, que es el entorno objetivo.

Si una migración falla:

1. frenar deploy;
2. revisar la migración exacta y el SQL en `_prisma_migrations`;
3. no compensar con `db push`;
4. corregir con una nueva migración o reparar una migration no aplicada en entornos compartidos.

## 4) Arquitectura recomendada de staging

Separar staging de producción de forma explícita:

- frontend staging con URL propia;
- backend staging con URL propia;
- PostgreSQL staging propio;
- Redis staging propio;
- worker/scheduler staging propios;
- integración Mercado Pago configurada de forma independiente por club si se prueba checkout online.

Topología mínima sugerida para el piloto inicial:

- `https://pique.ar` para frontend
- `https://pique.ar/api` para backend
- `postgres staging`
- `redis staging`
- `backend api`
- `backend worker`
- `backend scheduler`

Alternativa futura si se separa web/app o backend:

- `app-staging.pique.ar`
- `api-staging.pique.ar`
- `postgres staging`
- `redis staging`
- `backend api`
- `backend worker`
- `backend scheduler`

No reutilizar la base productiva ni compartir secretos entre entornos.

## 5) CORS y cookies

- CORS debe permitir solo orígenes reales del frontend.
- `credentials` está habilitado en backend y frontend.
- Requests mutantes autenticadas por cookie requieren `X-CSRF-Token`.
- El frontend lo obtiene desde `GET /api/auth/csrf` y lo envía automáticamente.
- Para `SameSite=None`, `AUTH_COOKIE_SECURE=true` es obligatorio.
- En local development: `AUTH_COOKIE_SECURE=false`.
- En smoke/staging con frontend y backend en dominios HTTPS distintos (por ejemplo túneles), usar:
  - `AUTH_COOKIE_SAMESITE=none`
  - `AUTH_COOKIE_SECURE=true`
  - `AUTH_COOKIE_DOMAIN=` vacío para mantener cookie host-only del backend.

## 6) Flujo de staging / despliegue (resumen)

```bash
docker-compose build
docker-compose up -d
docker-compose logs -f backend
docker-compose logs -f frontend
```

Para una DB nueva o local de prueba, el helper seguro es:

```bash
cd apps/backend
npm run db:setup
```

Variables útiles:

- `POSTGRES_DB=pique_staging`
- `RUN_SEED=true`

Ese helper:

1. reutiliza el `postgres` local existente o levanta uno nuevo;
2. crea la DB si falta;
3. valida permiso de `btree_gist`;
4. construye una imagen Linux del backend;
5. corre `prisma migrate deploy` dentro de Linux;
6. opcionalmente ejecuta seed.

## 7) Validación post-deploy (auth)

1. Login exitoso desde frontend.
2. Requests autenticadas responden 200 usando cookies.
3. Refresh responde `204` cuando expira access token.
4. Logout invalida sesión y limpia estado.
5. Sesión expirada redirige a login con mensaje entendible (sin stack trace).

## 8) Contingencia / rollback mínimo

- si una migración falla: detener el deploy, revisar `_prisma_migrations`, no seguir con `db push`;
- si backend staging falla: redeployar la imagen anterior;
- si frontend staging falla: redeployar el build anterior;
- si Mercado Pago genera incidentes: desactivar `MERCADO_PAGO_ENABLED` o desconectar el club;
- si seed falla: recrear DB staging limpia y repetir bootstrap controlado.

## 9) Riesgos comunes

- `ALLOWED_ORIGINS` sin configurar: puede bloquear frontend o abrir CORS más de lo deseado.
- `AUTH_COOKIE_SECURE=false` en producción: sesión vulnerable o rechazada por navegador en escenarios cross-site.
- `AUTH_REFRESH_PEPPER` débil/default: riesgo criptográfico de refresh tokens.
- `AUTH_ALLOW_BEARER_LEGACY=true` sin necesidad: superficie extra de ataque.
- `DIRECT_DATABASE_URL` ausente o pasando por pgbouncer: `migrate deploy` puede fallar o quedar inconsistente.
- usar `db push` para “destrabar” staging/prod: deriva de esquema fuera del historial versionado.
