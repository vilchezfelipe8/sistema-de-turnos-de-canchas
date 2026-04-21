# Auth Cookie & Domain Decision (Pre-Phase B)

## Scope
Defines cookie transport behavior by environment for session-based auth.

This is the required decision record before implementing cookie sessions in backend/frontend.

## Cookie Names
- Access cookie: `tc_access`
- Refresh cookie: `tc_refresh`

## Environment Matrix

| Environment | Frontend URL | Backend URL | Cookie Domain | Secure | SameSite | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Local dev | `http://localhost:3001` | `http://localhost:3002` | host-only (`localhost`) | `false` | `Lax` | Cross-port only, same-site on localhost. |
| Preview | `https://app-preview.<domain>` | `https://api-preview.<domain>` | host-only by default | `true` | `Lax` | Use explicit domain only if both apps share a stable parent domain. |
| Production | `https://app.tucancha.app` | `https://api.tucancha.app` | `.tucancha.app` | `true` | `Lax` | Keep `None` disabled unless a real cross-site integration requires it. |

## Rules
1. Default is `SameSite=Lax`.
2. `SameSite=None` is forbidden unless explicitly approved for a cross-site requirement.
3. If `SameSite=None`, `Secure=true` is mandatory.
4. Ingress/proxy must preserve forwarded protocol so secure cookies are not downgraded or dropped.
5. In local development, never force `Secure=true`.

## Backend Env Defaults
- `AUTH_ENABLE_COOKIE_SESSIONS=false` (until rollout starts)
- `AUTH_ALLOW_BEARER_LEGACY=true`
- `AUTH_ACCESS_COOKIE_NAME=tc_access`
- `AUTH_REFRESH_COOKIE_NAME=tc_refresh`
- `AUTH_COOKIE_DOMAIN=` (empty => host-only)
- `AUTH_COOKIE_SECURE=false` (local only)
- `AUTH_COOKIE_SAMESITE=lax`

## Rollout Notes
1. Enable cookie sessions first in staging with bearer fallback still enabled.
2. Validate login/logout/refresh on multiple browsers.
3. Only then enable in production.
4. Remove bearer fallback in final migration phase.

