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
- `JWT_SECRET`
- `AUTH_REFRESH_PEPPER` (secreto fuerte y único)
- `FRONTEND_URL` (URL pública frontend)
- `ALLOWED_ORIGINS` (lista explícita, separada por comas)
- `AUTH_ENABLE_COOKIE_SESSIONS=true`
- `AUTH_ALLOW_BEARER_LEGACY=false`
- `AUTH_COOKIE_SECURE=true`
- `AUTH_TRUST_PROXY=true` (si hay proxy TLS delante)

Recomendadas:

- `AUTH_COOKIE_SAMESITE=lax`
- `AUTH_COOKIE_DOMAIN=.tu-dominio.com` solo si frontend/backend comparten dominio padre y necesitás cookie compartida.

## 3) CORS y cookies

- CORS debe permitir solo orígenes reales del frontend.
- `credentials` está habilitado en backend y frontend.
- Para `SameSite=None`, `AUTH_COOKIE_SECURE=true` es obligatorio.
- En local development: `AUTH_COOKIE_SECURE=false`.

## 4) Flujo de despliegue (resumen)

```bash
docker-compose build
docker-compose up -d
docker-compose logs -f backend
docker-compose logs -f frontend
```

## 5) Validación post-deploy (auth)

1. Login exitoso desde frontend.
2. Requests autenticadas responden 200 usando cookies.
3. Refresh responde `204` cuando expira access token.
4. Logout invalida sesión y limpia estado.
5. Sesión expirada redirige a login con mensaje entendible (sin stack trace).

## 6) Riesgos comunes

- `ALLOWED_ORIGINS` sin configurar: puede bloquear frontend o abrir CORS más de lo deseado.
- `AUTH_COOKIE_SECURE=false` en producción: sesión vulnerable o rechazada por navegador en escenarios cross-site.
- `AUTH_REFRESH_PEPPER` débil/default: riesgo criptográfico de refresh tokens.
- `AUTH_ALLOW_BEARER_LEGACY=true` sin necesidad: superficie extra de ataque.
