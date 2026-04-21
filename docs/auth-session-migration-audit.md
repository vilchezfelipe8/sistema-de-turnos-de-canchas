# Auth Session Migration Audit (Implementable)

## Objective
Execute migration from fragmented auth to robust session architecture without production breakage.

This document is operational (what to do first, what can break, how to verify, when to rollback).

## Current risk snapshot

Risk level: HIGH for consistency, MEDIUM-HIGH for security.

Top current risks:
1. Session source of truth is fragmented (token/user snapshot/events/`/me`).
2. Auth invalidation depends on text parsing in frontend.
3. No server-side session object (no real revoke/logout-all/device control).
4. `localStorage` token exposure to XSS.
5. Optional auth routes can silently degrade invalid auth to guest.

## Pre-Phase B mandatory decisions

Do not start Phase B until these decisions are written and approved.

### 1) Cookie and domain strategy per environment

Create a short decision record with exact values by environment.
Reference decision file in this repo:
- `docs/auth-cookie-domain-decision.md`

Minimum matrix:

| Environment | Frontend URL | Backend URL | Cookie Domain | Secure | SameSite | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Local dev | `http://localhost:3000` | `http://localhost:3001` (or similar) | host-only (`localhost`) | `false` | `Lax` | cross-port only, not cross-site |
| Preview | define exact preview host | define exact preview host | explicit or host-only | `true` | `Lax` (or `None` only if truly cross-site) | validate proxy headers |
| Production | `https://app.tucancha.app` | `https://api.tucancha.app` | `.tucancha.app` or host-only by design | `true` | `Lax` | confirm no mixed-domain edge cases |

Rules:
1. Prefer `SameSite=Lax` unless a real cross-site requirement forces `None`.
2. If `SameSite=None`, `Secure` is mandatory.
3. Define trusted proxy behavior in backend so secure cookies are not dropped behind reverse proxy.
4. Document exact behavior for `localhost`, preview, and production before coding.

### 2) Refresh and retry contract (explicit)

Define this contract before frontend implementation starts:

1. Refresh trigger:
- only on `401` with `code` in `{ AUTH_EXPIRED, AUTH_INVALID }`.

2. Never refresh on:
- `403` (`AUTH_FORBIDDEN`, authorization problem).
- `401` with `AUTH_MISSING` (guest/no session).
- business/domain errors.

3. Retry policy:
- run at most one refresh for a failed request chain.
- retry original request once after successful refresh.
- if retry fails again with auth code, transition to guest immediately.

4. Loop prevention:
- never call refresh from inside refresh request handling.
- mark requests with internal retry metadata flag (e.g. `__authRetried`) to prevent infinite recursion.

5. Guest transition:
- clear in-memory auth state.
- emit logout/broadcast event.
- redirect only where route guard requires it (avoid unconditional global hard redirect).

### 3) Refresh rotation policy and race handling

Decide one of the following before implementation:

1. Strict rotation + family revoke on replay (recommended for security):
- Any reused refresh token revokes the full family.
- Requires single-flight refresh in frontend and careful backend transaction semantics.

2. Strict rotation with bounded race tolerance window (optional, more UX-friendly):
- Allow tiny grace window for near-simultaneous refresh attempts from the same active session metadata.
- Still revoke on clear replay patterns.

If option 1 is chosen, this is mandatory:
- single-flight refresh on frontend
- DB transaction guarantees in backend rotation path
- audit logs for replay detection events
- explicit product acceptance of occasional forced logout under abnormal races

## Phase plan (strict order)

### Phase A - Contract hardening (no transport change yet)
Goal: stop brittle auth decisions before moving to cookies.

#### Scope
Backend:
- Standardize auth error payloads with `code`.
- Keep current status codes (`401`/`403`) but with deterministic machine code.

Frontend:
- Stop parsing auth from message strings.
- Branch auth behavior by `code`.

#### Files to touch first
Backend:
- `apps/backend/src/middleware/AuthMiddleware.ts`
- `apps/backend/src/middleware/RoleMiddleware.ts`
- `apps/backend/src/middleware/ClubMiddleware.ts`
- `apps/backend/src/controllers/AuthController.ts` (auth-related rejections)

Frontend:
- `apps/frontend/utils/apiClient.ts`

#### Required output
Auth responses use shape:

```json
{ "error": "Authentication failed", "code": "AUTH_EXPIRED" }
```

Supported codes (minimum):
- `AUTH_MISSING`
- `AUTH_INVALID`
- `AUTH_EXPIRED`
- `AUTH_REVOKED` (reserved for next phases)
- `AUTH_FORBIDDEN`
- `AUTH_CONTEXT_INVALID`

#### Manual test checklist
1. No token -> protected endpoint returns `401 + AUTH_MISSING`.
2. Invalid token -> returns deterministic code (`AUTH_INVALID` or `AUTH_EXPIRED`).
3. Permission denied -> `403 + AUTH_FORBIDDEN`.
4. Front no longer checks string fragments (`jwt`, `token`, etc.).

#### Exit gate
- `fetchWithAuth` auth decisions are code-based only.
- Legacy text heuristics removed.

#### Rollback
- Revert only code branching in frontend + payload additions in middleware.
- No schema changes in this phase.

---

### Phase B - Session model and dual-mode auth
Goal: introduce server-owned session without breaking current clients.

#### Scope
Backend:
- Add `AuthSession` Prisma model.
- Add cookie parser and cookie config by env.
- Introduce session services:
  - token sign/verify
  - refresh token generation/hash
  - session create/rotate/revoke
- Middleware accepts both:
  - cookie access token (new)
  - bearer token (legacy)

Frontend:
- no mandatory transport migration yet.

#### Files to touch
Schema/migrations:
- `apps/backend/prisma/schema.prisma`
- new migration under `apps/backend/prisma/migrations/*`

Backend runtime:
- `apps/backend/src/app.ts` (cookie parser + cookie env wiring)
- new `apps/backend/src/services/AuthTokenService.ts`
- new `apps/backend/src/services/AuthSessionService.ts`
- `apps/backend/src/controllers/AuthController.ts`
- `apps/backend/src/middleware/AuthMiddleware.ts`
- `apps/backend/src/routes/AuthRoutes.ts`

#### New env required
- `AUTH_ACCESS_TTL_MINUTES`
- `AUTH_REFRESH_IDLE_DAYS`
- `AUTH_REFRESH_ABSOLUTE_DAYS`
- `AUTH_REFRESH_PEPPER`
- `AUTH_COOKIE_DOMAIN`
- `AUTH_COOKIE_SECURE`
- `AUTH_COOKIE_SAMESITE`

#### Manual test checklist
1. Login issues cookies correctly in browser.
2. Existing bearer flow still works.
3. Logout current session clears cookies and revokes DB session.
4. Logout-all revokes all active sessions for user.
5. Refresh rotates refresh token and invalidates previous one.
6. Replay of old refresh triggers family revoke.

#### Exit gate
- DB `AuthSession` in use for new logins.
- Dual-mode auth working (cookie + bearer).
- Cookie/domain matrix document approved and validated in local + staging.
- Rotation policy (strict vs bounded tolerance) implemented exactly as chosen.

#### Rollback
- Disable cookie issue/use by feature flag.
- Keep bearer legacy path active.
- No destructive migration rollback needed if model is additive.

---

### Phase C - Frontend session-first migration
Goal: make frontend session state deterministic and centralized.

#### Scope
Frontend:
- `fetchWithAuth` sends `credentials: 'include'`.
- Add refresh-retry-once mechanism.
- Introduce global `AuthProvider` with finite state:
  - `unknown`
  - `authenticated`
  - `guest`
- Migrate route guards to provider.
- Keep temporary compatibility with legacy token reads while migrating screens.

#### Files to touch
Core:
- `apps/frontend/utils/apiClient.ts`
- new `apps/frontend/contexts/AuthContext.tsx` (or `providers/AuthProvider.tsx`)
- `apps/frontend/pages/_app.tsx`

Auth service/hooks:
- `apps/frontend/services/AuthService.ts`
- `apps/frontend/hooks/useValidateAuth.ts`

High-impact pages/components:
- `apps/frontend/components/NavBar.tsx`
- `apps/frontend/pages/index.tsx`
- `apps/frontend/pages/bookings.tsx`
- `apps/frontend/pages/perfil.tsx`
- `apps/frontend/pages/admin/*.tsx`

#### Critical concurrency decision
Implement single-flight refresh in frontend.
- If multiple requests hit 401 simultaneously, only one refresh runs.
- Others wait for refresh result.
- Prevents false logout due to rotation race.

#### Refresh endpoint contract (implementation reference)

Recommended endpoint:
- `POST /api/auth/session/refresh`

Response:
- `204 No Content` (or `200`) when refresh succeeds and new cookies are set.
- `401 + AUTH_REVOKED|AUTH_EXPIRED|AUTH_INVALID` when refresh is not recoverable.

Client-side behavior:
1. request fails with `401 AUTH_EXPIRED|AUTH_INVALID`
2. if request has not retried and no refresh is in flight: start refresh
3. wait for refresh result
4. success -> retry original request once
5. fail -> set guest state and stop retries

Never:
- retry refresh request itself
- retry original request more than once
- trigger refresh on `403`

#### Manual test checklist
1. Token expiry during navigation -> silent refresh -> request retries once -> user stays logged in.
2. Refresh expired/revoked -> clean transition to guest + redirect.
3. Multi-tab logout propagates correctly.
4. No screen shows authenticated UI when provider state is guest.
5. Home page no longer trusts stale `localStorage user` as auth truth.

#### Exit gate
- Provider is single auth truth in UI.
- Auth state transitions are deterministic.

#### Rollback
- Keep compatibility path to legacy token until all guards are migrated.

---

### Phase D - Legacy removal and passwordless readiness
Goal: remove fragile legacy and unify all login methods into session issuance.

#### Scope
Backend:
- Remove bearer fallback from middleware (after freeze window).
- Keep only cookie-based session transport.
- Keep magic link and OAuth callbacks ending in same session issuance.

Frontend:
- Remove `localStorage token` usage.
- Remove token-based guard logic.

Product:
- Optionally disable password login endpoint.

#### Files to touch
- `apps/backend/src/middleware/AuthMiddleware.ts`
- `apps/frontend/services/AuthService.ts`
- `apps/frontend/utils/apiClient.ts`
- any service using `getToken()` as primary auth check

#### Manual test checklist
1. Login methods (magic/google/apple) all produce same session behavior.
2. Password flow disabled/enabled by explicit feature flag.
3. Session list + logout-all works from profile/admin.

#### Exit gate
- No frontend dependency on bearer/local token.
- All auth methods converge to session cookies.

#### Rollback
- Feature flag to re-enable bearer for emergency window only.

## OptionalAuth policy audit (must do)

Current issue: optional auth may hide invalid-session states.

Decision matrix:
1. Public enrichment endpoint (safe guest fallback): keep optional auth.
2. Endpoint that influences auth UI decisions: do not silently fallback on invalid token.
3. For optional routes, include explicit auth diagnostics in response when token is present but invalid, e.g.:
   - `authState: "guest" | "authenticated" | "invalid_token"`

Initial review targets:
- `apps/backend/src/routes/BookingRoutes.ts` (`optionalAuthMiddleware` usage)
- `apps/backend/src/middleware/AuthMiddleware.ts` (optional branch semantics)
- frontend consumers in `useAvailability` and booking flows

## Production risk control

### Feature flags
Introduce controlled rollout flags:
- `AUTH_ENABLE_COOKIE_SESSIONS`
- `AUTH_ENABLE_REFRESH_ROTATION`
- `AUTH_ALLOW_BEARER_LEGACY`
- `AUTH_DISABLE_PASSWORD_LOGIN`

### Observability (minimum)
Track metrics/logs:
- login success/fail by method
- refresh success/fail/replay
- logout and logout-all counts
- `401/403` with code distribution
- unexpected auth state transitions in frontend

### SLO alerts
- Spike in `AUTH_INVALID` after release
- Spike in failed refresh rotations
- Increased forced logouts per active user

## Operational compatibility checklist

Validate these scenarios explicitly during rollout:

1. SSR vs CSR:
- If any server-side data fetching calls backend, define cookie forwarding behavior from Next server runtime.
- Ensure auth assumptions are not CSR-only.

2. Redirect semantics:
- Define post-login and post-logout redirect contract per route type (public, member, admin).
- Avoid double redirects (router + hard navigation race).

3. Multi-origin local development:
- Frontend and backend on different ports must keep cookie behavior deterministic.
- Document required local env values.

4. PWA/mobile web behavior (if applicable):
- Verify cookie persistence and session resume after app background/foreground cycles.
- Verify logout propagation across open app contexts/tabs.

5. Proxy/CDN behavior:
- Confirm `X-Forwarded-*` handling and secure cookie flags behind ingress/reverse proxy.

## Regression suite (manual + automated)

### Must-have automated tests
Backend:
- refresh rotation happy path
- refresh replay family revoke
- logout current session
- logout-all sessions
- auth middleware code emission

Frontend:
- api client refresh-retry-once
- provider state transitions
- guarded route redirect behavior

### Manual smoke flows
1. Login magic link -> navigate protected pages -> reload -> still logged in.
2. Two tabs open -> logout in one -> other updates promptly.
3. Force expired access token with valid refresh -> no user disruption.
4. Force expired refresh token -> clean logout and redirect.
5. Admin area redirect target remains stable after expiration/logout.

## Suggested implementation cadence
- Week 1: Phase A
- Week 2: Phase B (backend + migration + dual mode)
- Week 3: Phase C (provider + critical pages)
- Week 4: Phase D (legacy removal + passwordless alignment)

Do not overlap B/C/D in the same deploy window.

## Final recommendation
Do not start with OAuth UI or redirect polish.
Session contract first:
- backend owns session
- cookie transport
- session table
- stable auth codes
- `/session/me` as truth
- provider as single source of truth in frontend

Everything else (Google/Apple, better redirects, persistent UX) gets easier and safer only after this baseline exists.
