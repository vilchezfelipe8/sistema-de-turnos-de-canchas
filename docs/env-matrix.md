# Env Matrix

Variables principales para operar Pique.

## Backend

| Variable | Obligatoria | Default dev | Ejemplo | Uso |
|---|---:|---|---|---|
| `NODE_ENV` | sí | `development` | `production` | modo runtime |
| `PORT` | no | `3000` | `3000` | puerto backend |
| `DATABASE_URL` | sí | local | `postgresql://.../pique` | runtime DB |
| `DIRECT_DATABASE_URL` | sí en staging/prod | local | `postgresql://.../pique` | Prisma Migrate |
| `READ_DATABASE_URL` | no | local | `postgresql://.../pique` | read replica opcional |
| `REDIS_URL` | no | `redis://localhost:6379` | `redis://...` | jobs / locks / cache |
| `JWT_SECRET` | sí | sin default seguro | `replace_with_secret` | auth |
| `AUTH_REFRESH_PEPPER` | sí | dev-only | `replace_with_secret` | refresh rotation |
| `FRONTEND_URL` | sí | `http://localhost:3001` | `https://pique.ar` | CORS + redirects |
| `APP_BASE_URL` | sí si hay MP o magic link | `http://localhost:3000` | `https://pique.ar` | links absolutos / callbacks |
| `ALLOWED_ORIGINS` | sí | localhost | `https://pique.ar,https://www.pique.ar` | CORS |
| `AUTH_COOKIE_DOMAIN` | no | vacío | vacío u opcionalmente `.pique.ar` | host-only recomendado; multi-subdominio opcional |
| `AUTH_COOKIE_SECURE` | sí en prod | `false` | `true` | cookies seguras |
| `AUTH_COOKIE_SAMESITE` | sí | `lax` | `lax` / `none` | política de cookies |
| `AUTH_TRUST_PROXY` | no | `false` | `true` | proxy TLS |
| `RESEND_API_KEY` | no | vacío | `re_...` | email |
| `EMAIL_FROM` | no | vacío | `login@auth.pique.ar` | remitente emails |
| `WHATSAPP_PROVIDER` | no | `wpp_http` | `wpp_http` | estrategia WhatsApp |
| `WPP_SERVICE_URL` | no | `http://localhost:3002` | `https://...` | servicio WhatsApp |
| `ENABLE_WHATSAPP_WORKER` | no | `false` | `false` | worker WhatsApp |
| `DISABLE_WHATSAPP` | no | vacío | `true` | apagar WhatsApp |
| `MERCADO_PAGO_ENABLED` | no | `false` | `true` | checkout online |
| `MERCADO_PAGO_TEST_TOKEN` | no | `false` | `false` | test vs real |
| `MERCADO_PAGO_CLIENT_ID` | si MP | vacío | `APP_USR...` | OAuth MP |
| `MERCADO_PAGO_CLIENT_SECRET` | si MP | vacío | `...` | OAuth MP |
| `MERCADO_PAGO_REDIRECT_URI` | si MP | local | `https://pique.ar/api/integrations/mercadopago/callback` | callback OAuth |
| `MERCADO_PAGO_WEBHOOK_SECRET` | si MP | vacío | `...` | firma webhook |
| `INTEGRATION_SECRETS_KEY` | si MP | dev-only | `replace_with_secret` | cifrado tokens club |
| `ALLOW_SEED` | no | `false` | `true` | habilita seed controlado |

## Frontend

| Variable | Obligatoria | Default dev | Ejemplo | Uso |
|---|---:|---|---|---|
| `NEXT_PUBLIC_API_URL` | sí | `http://localhost:3000` | `/api` | base API |
| `NEXT_PUBLIC_SITE_URL` | sí | `https://pique.ar` | `https://pique.ar` | metadata / branding |

## Notas

- En staging/prod, preferir `AUTH_COOKIE_SAMESITE=lax` salvo necesidad real de cross-site.
- Si usás `SameSite=None`, `AUTH_COOKIE_SECURE=true` es obligatorio.
- No poner secretos reales en `.env.example`.
- Para el primer piloto, preferir mismo dominio (`https://pique.ar` + `/api`) y cookie host-only.
