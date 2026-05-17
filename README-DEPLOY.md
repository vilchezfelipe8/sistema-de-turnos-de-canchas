# Deploy (VPS + Docker + Nginx)

Guía mínima para desplegar Pique con foco en autenticación por cookies y operación productiva.

## 1) Requisitos base

- Docker + Docker Compose
- Reverse proxy TLS (Nginx o equivalente)
- Base de datos PostgreSQL accesible

Si usás `wpp-service`, instalar dependencias de Chromium en host/contenedor según tu estrategia.

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
- `AUTH_COOKIE_DOMAIN=.tu-dominio.com` solo si frontend/backend comparten dominio padre y necesitás cookie compartida.

Si vas a habilitar checkout online con Mercado Pago por club:

- `MERCADO_PAGO_ENABLED=true`
- `MERCADO_PAGO_CLIENT_ID`
- `MERCADO_PAGO_CLIENT_SECRET`
- `MERCADO_PAGO_REDIRECT_URI`
- `MERCADO_PAGO_WEBHOOK_SECRET`
- `APP_BASE_URL` (URL pública del backend)
- `INTEGRATION_SECRETS_KEY` (secreto fuerte para cifrar tokens OAuth en base)

No expongas tokens de clubes en logs, frontend ni variables compartidas.

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

## 4) CORS y cookies

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

## 5) Flujo de despliegue (resumen)

```bash
docker-compose build
docker-compose up -d
docker-compose logs -f backend
docker-compose logs -f frontend
```

## 6) Validación post-deploy (auth)

1. Login exitoso desde frontend.
2. Requests autenticadas responden 200 usando cookies.
3. Refresh responde `204` cuando expira access token.
4. Logout invalida sesión y limpia estado.
5. Sesión expirada redirige a login con mensaje entendible (sin stack trace).

## 7) Riesgos comunes

- `ALLOWED_ORIGINS` sin configurar: puede bloquear frontend o abrir CORS más de lo deseado.
- `AUTH_COOKIE_SECURE=false` en producción: sesión vulnerable o rechazada por navegador en escenarios cross-site.
- `AUTH_REFRESH_PEPPER` débil/default: riesgo criptográfico de refresh tokens.
- `AUTH_ALLOW_BEARER_LEGACY=true` sin necesidad: superficie extra de ataque.
- `DIRECT_DATABASE_URL` ausente o pasando por pgbouncer: `migrate deploy` puede fallar o quedar inconsistente.
- usar `db push` para “destrabar” staging/prod: deriva de esquema fuera del historial versionado.
