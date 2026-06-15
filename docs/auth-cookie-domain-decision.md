# Auth Cookie & Domain Decision (MVP vigente)

## Scope

Definición operativa de autenticación web para Pique.

Modo oficial: **cookie sessions HttpOnly** con refresh rotativo.

## Cookie Names

- Access cookie: `tc_access`
- Refresh cookie: `tc_refresh`

## Environment Matrix

| Environment | Frontend URL | Backend URL | Cookie Domain | Secure | SameSite | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Local dev | `http://localhost:3001` | `http://localhost:3000` | host-only (`localhost`) | `false` | `Lax` | Cross-port same-site en localhost. |
| Preview | `https://app-preview.<domain>` | `https://api-preview.<domain>` | host-only por defecto | `true` | `Lax` | Definir dominio explícito solo si hay necesidad real de compartir cookies entre subdominios. |
| Production | `https://pique.ar` | `https://pique.ar/api` | host-only por defecto; `.pique.ar` opcional | `true` | `Lax` | Recomendado para el primer piloto por simplicidad operativa. |

## Rules

1. `AUTH_ENABLE_COOKIE_SESSIONS=true` es obligatorio para modo productivo.
2. `AUTH_ALLOW_BEARER_LEGACY=false` por defecto.
3. `SameSite=None` requiere `AUTH_COOKIE_SECURE=true` (enforced).
4. En producción, `AUTH_COOKIE_SECURE=true` (enforced).
5. En producción, `AUTH_REFRESH_PEPPER` fuerte y no default de dev (enforced).
6. Si hay proxy TLS, usar `AUTH_TRUST_PROXY=true`.

## Backend defaults esperados

- `AUTH_ENABLE_COOKIE_SESSIONS=true`
- `AUTH_ALLOW_BEARER_LEGACY=false`
- `AUTH_ACCESS_COOKIE_NAME=tc_access`
- `AUTH_REFRESH_COOKIE_NAME=tc_refresh`
- `AUTH_COOKIE_DOMAIN=` (vacío => host-only; recomendado para el primer piloto)
- `AUTH_COOKIE_SECURE=false` en local / `true` en producción
- `AUTH_COOKIE_SAMESITE=lax`

## Rollout status

- Cookie sessions: activo y recomendado.
- Bearer legado: solo compatibilidad temporal y controlada.
