# Pique

Monorepo del sistema SaaS multi-club para gestión operativa de canchas, reservas, caja y clientes.

## Estructura

- `apps/backend`: API Express + Prisma.
- `apps/frontend`: aplicación Next.js.
- `apps/wpp-service`: servicio legacy de WhatsApp (Puppeteer/Chromium).
- `docs/`: decisiones técnicas y documentos operativos.

## Setup local rápido

1. Copiar variables de entorno:
   - Crear `.env` en base a `env.example`.
2. Backend:
   - `cd apps/backend`
   - `npm install`
   - `npm run prisma:generate`
   - `npm run prisma:migrate:deploy`
   - si vas a preparar WhatsApp Cloud API: `npm run whatsapp:bootstrap-cloud-api`
   - `npm run dev`
3. Frontend:
   - `cd apps/frontend`
   - `npm install`
   - `npm run dev`

Por defecto:
- Backend: `http://localhost:3000`
- Frontend: `http://localhost:3001`

Documentación operativa relacionada:

- setup local paso a paso: `docs/setup-local.md`
- deploy y entornos: `README-DEPLOY.md` y `docs/deploy.md`
- matriz de variables: `docs/env-matrix.md`
- checklist de release: `docs/release-checklist.md`
- piloto controlado: `docs/pilot-readiness.md`
- migracion a Cloud API: `docs/whatsapp-cloud-api-migration.md`
- vision del modulo de autenticacion, OAuth, linking y perfil: `docs/auth-oauth-linking-profile-module.md`

## Autenticación oficial (MVP)

El modo oficial es **sesión por cookies HttpOnly**.

- `AUTH_ENABLE_COOKIE_SESSIONS=true`
- `AUTH_ALLOW_BEARER_LEGACY=false` (solo activar temporalmente para compatibilidad controlada)
- Frontend usa `credentials: include` en requests autenticadas.
- Refresh de sesión usa `POST /api/auth/session/refresh`.
- Logout usa `POST /api/auth/session/logout` y limpia estado local.

## Variables obligatorias de producción (mínimas)

- `NODE_ENV=production`
- `DATABASE_URL`
- `JWT_SECRET`
- `AUTH_REFRESH_PEPPER` (valor fuerte, no default de desarrollo)
- `FRONTEND_URL`
- `ALLOWED_ORIGINS` (lista explícita de orígenes permitidos)
- `AUTH_COOKIE_SECURE=true`
- `AUTH_TRUST_PROXY=true` (si hay proxy TLS delante)

Detalles de cookies y dominio:
- `docs/auth-cookie-domain-decision.md`

## Nota

Este README reemplaza documentación vieja basada en JWT bearer-only. Para despliegue operativo ver:
- `README-DEPLOY.md`
