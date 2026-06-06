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
| `ENABLE_WHATSAPP_SEND_V2` | no | `false` | `false` | procesamiento V2 interno |
| `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2` | no | `false` | `false` | migra solo eventos reales `CUSTOMER` a `WHATSAPP_SEND_V2` |
| `ENABLE_WHATSAPP_STAFF_EVENTS_V2` | no | `false` | `false` | migra solo eventos reales `CLUB_STAFF` existentes a `WHATSAPP_SEND_V2` |
| `ENABLE_WHATSAPP_V2_DRY_RUN` | no | `false` | `false` | valida pipeline V2 sin llamar a Meta |
| `ENABLE_WHATSAPP_CLOUD_API` | no | `false` | `false` | gate del provider Cloud API |
| `ENABLE_WHATSAPP_WEBHOOK_PROCESSOR` | no | `false` | `false` | procesamiento de webhooks Cloud API |
| `WHATSAPP_META_GRAPH_API_BASE_URL` | no | `https://graph.facebook.com` | `https://graph.facebook.com` | base URL Graph API |
| `WHATSAPP_META_GRAPH_API_VERSION` | no | `v19.0` | `v19.0` | versiÃ³n Graph API |
| `WHATSAPP_META_REQUEST_TIMEOUT_MS` | no | `10000` | `10000` | timeout request Cloud API |
| `WHATSAPP_META_RECIPIENT_ALLOWLIST` | no | vacío | `5493511234567,5491123456789` | limita envíos reales a números permitidos |
| `WHATSAPP_META_ACCESS_TOKEN` | no | vacÃ­o | `EAAG...` | token referenciado por `tokenSecretRef` |
| `WHATSAPP_META_WABA_ID` | no | vacío | `1234567890` | bootstrap de `PIQUE_DEFAULT` |
| `WHATSAPP_META_PHONE_NUMBER_ID` | no | vacío | `9876543210` | bootstrap de `PIQUE_DEFAULT` |
| `WHATSAPP_META_BUSINESS_PHONE` | no | vacío | `5493515551111` | bootstrap de `PIQUE_DEFAULT` |
| `WHATSAPP_META_TOKEN_SECRET_REF` | no | `WHATSAPP_META_ACCESS_TOKEN` | `WHATSAPP_META_ACCESS_TOKEN` | referencia a env con token real |
| `WHATSAPP_SENDER_DISPLAY_NAME` | no | `Pique` | `Pique` | nombre visible del sender bootstrap |
| `DISABLE_WHATSAPP` | no | vacío | `true` | apagar WhatsApp |
| `WHATSAPP_META_WEBHOOK_VERIFY_TOKEN` | no | vacio | `replace_with_secret` | verificacion GET webhook Meta |
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
- Las variables actuales de WhatsApp reflejan la implementación legacy (`wpp-service` / `local_browser`).
- La migración objetivo a `WhatsApp Cloud API`, junto con futuras variables y feature flags, está definida en `docs/whatsapp-cloud-api-migration.md`.
- Para bootstrapear `PIQUE_DEFAULT` y templates MVP desde entorno, usar `npm run whatsapp:bootstrap-cloud-api` dentro de `apps/backend`.
## WhatsApp V2 Rollout

- `ENABLE_WHATSAPP_V2_DRY_RUN=false`
- `WHATSAPP_META_RECIPIENT_ALLOWLIST=`
- `ENABLE_WHATSAPP_V2_DRY_RUN=true` evita llamar a Meta.
- `WHATSAPP_META_RECIPIENT_ALLOWLIST` limita envios reales a numeros explicitamente permitidos.

Flags y vars de readiness recomendadas:

- `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2=false`
- `ENABLE_WHATSAPP_STAFF_EVENTS_V2=false`
- `ENABLE_WHATSAPP_SEND_V2=false`
- `ENABLE_WHATSAPP_CLOUD_API=false`
- `ENABLE_WHATSAPP_WEBHOOK_PROCESSOR=false`
- `ENABLE_WHATSAPP_V2_DRY_RUN=false`
- `WHATSAPP_META_RECIPIENT_ALLOWLIST=`
- `WHATSAPP_META_GRAPH_API_BASE_URL=https://graph.facebook.com`
- `WHATSAPP_META_GRAPH_API_VERSION=v19.0`
- `WHATSAPP_META_REQUEST_TIMEOUT_MS=10000`
- `WHATSAPP_META_ACCESS_TOKEN=<env backend>`
- `WHATSAPP_META_WEBHOOK_VERIFY_TOKEN=<env backend>`

Precedencia final:

1. `ENABLE_WHATSAPP_V2_DRY_RUN=true` gana y no llama a Meta.
2. `WHATSAPP_META_RECIPIENT_ALLOWLIST` bloquea destinatarios no permitidos.
3. `ENABLE_WHATSAPP_SEND_V2=false` impide dispatch V2.
4. `ENABLE_WHATSAPP_CLOUD_API=false` impide provider real.
5. `ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2` y `ENABLE_WHATSAPP_STAFF_EVENTS_V2` solo deciden que produce dominio.
6. `ENABLE_WHATSAPP_WEBHOOK_PROCESSOR` es independiente del dispatch.
