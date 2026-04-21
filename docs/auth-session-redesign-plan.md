# Auth & Session Redesign Plan

## Goal
Move from short-lived JWT in `localStorage` to secure, long-lived session UX ("always logged in") with server-controlled sessions.

This plan is aligned with your current stack:
- Backend: Express + Prisma + PostgreSQL
- Frontend: Next.js pages router
- Current auth: password login + magic link
- Future auth: magic link only + Google OAuth + Apple OAuth

## Current state (hard truth)

### What exists today
- Access token JWT (`expiresIn: 6h`) generated in `AuthController.buildJwtToken`.
- Token stored in `localStorage` (`token`) and user snapshot in `localStorage` (`user`).
- Front decides expiration by parsing backend error text in `fetchWithAuth`.
- No refresh token, no session table, no server-side revocation list.

### Main weaknesses
1. XSS risk is high impact: token in `localStorage` is directly readable.
2. No real "indefinite" session UX without refresh rotation.
3. Session state source of truth is split (token, user snapshot, `/auth/me`, error message heuristics).
4. Some routes use `optionalAuthMiddleware`, invalid token can degrade silently to guest.
5. Logout is mostly client-side cleanup; backend does not own session lifecycle.

## Target architecture

### Core principle
The browser never reads auth tokens directly.
Use cookies:
- `tc_access` (HttpOnly, Secure, SameSite=Lax, short TTL, e.g. 15m)
- `tc_refresh` (HttpOnly, Secure, SameSite=Lax, long TTL, e.g. 30d idle / 180d max)

### New server-side entities
Add session ownership in DB.

Proposed Prisma model additions:

```prisma
model AuthSession {
  id               String   @id @default(cuid())
  userId           Int
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  refreshTokenHash String   @unique
  familyId         String
  parentSessionId  String?

  status           String   @default("ACTIVE") // ACTIVE | ROTATED | REVOKED | EXPIRED
  ip               String?
  userAgent        String?
  deviceLabel      String?

  createdAt        DateTime @default(now()) @db.Timestamptz(3)
  lastSeenAt       DateTime @default(now()) @db.Timestamptz(3)
  rotatedAt        DateTime? @db.Timestamptz(3)
  revokedAt        DateTime? @db.Timestamptz(3)
  expiresAt        DateTime  @db.Timestamptz(3)
  absoluteExpiresAt DateTime @db.Timestamptz(3)

  @@index([userId, status])
  @@index([familyId])
  @@index([expiresAt])
}
```

Also add relation in `User`:

```prisma
sessions AuthSession[]
```

Notes:
- Store only refresh hash, never raw refresh token.
- Keep `familyId` to detect replay and revoke entire chain if needed.

## API contract redesign

### New auth endpoints
- `POST /api/auth/session/login-password` (temporary while password exists)
- `POST /api/auth/session/login-magic` (for verify flow response)
- `GET /api/auth/oauth/google/start`
- `GET /api/auth/oauth/google/callback`
- `GET /api/auth/oauth/apple/start`
- `GET /api/auth/oauth/apple/callback`
- `POST /api/auth/session/refresh`
- `POST /api/auth/session/logout` (current device)
- `POST /api/auth/session/logout-all`
- `GET /api/auth/session/me`
- `GET /api/auth/session/list` (optional: "where logged in")

### Error contract (stop parsing strings)
Every auth failure returns machine code:

```json
{ "error": "Authentication failed", "code": "AUTH_EXPIRED" }
```

Auth codes:
- `AUTH_MISSING`
- `AUTH_INVALID`
- `AUTH_EXPIRED`
- `AUTH_REVOKED`
- `AUTH_FORBIDDEN`
- `AUTH_CONTEXT_INVALID`

Frontend must branch by `code`, never by message text.

## Backend changes by file

### 1) Cookies and parsing
- Update `apps/backend/src/app.ts`
  - Add `cookie-parser`.
  - Keep CORS with `credentials: true`.
  - Ensure frontend domain + cookie domain strategy is explicit by env.

### 2) Token/session services
Create:
- `apps/backend/src/services/AuthTokenService.ts`
  - Sign/verify access token.
  - Generate secure random refresh token.
  - Hash refresh token (sha256 + pepper).
- `apps/backend/src/services/AuthSessionService.ts`
  - Create session.
  - Rotate refresh session atomically.
  - Revoke session(s).
  - Detect replay and revoke family.

### 3) Controller split
Refactor `AuthController`:
- Keep user profile methods (`/me`, `PATCH /me`) separated from session methods.
- Move cookie issuing/clearing to helper functions.
- Magic link verify should finish by issuing session cookies, not returning token for `localStorage`.

### 4) Middleware
Replace current auth verification path:
- `AuthMiddleware.ts` should read access token from cookie first.
- Optional support for `Authorization: Bearer` only during migration window.
- Return standardized error codes.

### 5) DB migration
Create migration adding `AuthSession` model and indexes.
Backfill: none needed.

## Frontend redesign

### 1) Remove token storage
In `apps/frontend/services/AuthService.ts`:
- Remove `localStorage.setItem('token', ...)`.
- Keep only non-sensitive user snapshot (optional) and rely on `/api/auth/session/me`.
- `logout()` should call backend endpoint then clear client cache.

### 2) API client behavior
In `apps/frontend/utils/apiClient.ts`:
- Always send `credentials: 'include'`.
- On `401` with code `AUTH_EXPIRED` or `AUTH_INVALID`, try single refresh call.
- If refresh succeeds, retry original request once.
- If refresh fails, emit logout event and redirect.

### 3) Single auth source of truth
Create `AuthProvider` + `useAuth()`:
- boot: call `/api/auth/session/me`
- state: `unknown | authenticated | guest`
- user data from backend only
- subscribe to login/logout events

Then migrate pages/hooks (`useValidateAuth`, `NavBar`, `/`, `/bookings`, `/perfil`, `/admin/*`) to this provider.

### 4) Multi-tab sync
- Use `BroadcastChannel('auth')` for login/logout sync.
- Keep `storage` fallback for unsupported browsers.

## OAuth + passwordless specifics

### Magic link
- Keep existing token table `MagicLoginToken`.
- On verify success:
  - consume token
  - create/locate user
  - issue session cookies via session service

### Google / Apple
- Use Authorization Code flow with PKCE.
- Validate `state` and `nonce` server-side.
- Link policy:
  - same verified email => same user
  - if email hidden/unavailable (Apple relay edge), create pending-link flow

### Account linking policy
Decide and enforce once:
- Primary key for identity: verified email.
- Phone and DNI as secondary signals, never silent hard-merge without audit.

## Session lifetime policy (recommended)

To feel "indefinite" while staying safe:
- Access token: 15 minutes.
- Refresh idle timeout: 30 days (rotating).
- Absolute timeout: 180 days.
- Refresh on activity.
- Logout-all available in profile.

## Migration plan (safe rollout)

### Phase 0 - hardening prep (no UX break)
- Add auth error codes.
- Stop message parsing in frontend.
- Keep existing bearer behavior.

### Phase 1 - dual mode
- Backend accepts cookie and bearer.
- Login endpoints issue both (temporary): cookie + response token.
- Front starts using cookies + `credentials: include`.

### Phase 2 - session first
- Remove token usage in frontend.
- Add refresh endpoint integration and retry-once logic.
- Add session table and rotation.

### Phase 3 - remove legacy
- Delete bearer token fallback from frontend.
- Remove password endpoint if product decision confirms.
- Keep magic link + OAuth only.

## Concrete todo list for implementation

1. Prisma
- Add `AuthSession` model + `User.sessions` relation.
- Create migration.

2. Backend
- Install `cookie-parser`.
- Create `AuthTokenService` and `AuthSessionService`.
- Add session endpoints (`refresh`, `logout`, `logout-all`, `me`).
- Refactor `AuthMiddleware` to cookie-based auth.
- Standardize auth error codes.

3. Frontend
- Update `fetchWithAuth` to `credentials: include` + refresh/retry-once.
- Refactor `AuthService` (remove local token operations).
- Introduce `AuthProvider` and migrate `useValidateAuth`.
- Update route guards to provider state.

4. Product
- Add "logged in devices" UI (optional but recommended).
- Add "logout all devices" action.

## Non-negotiable security checks
- Cookies: HttpOnly + Secure + SameSite.
- Refresh token rotation on every refresh.
- Replay detection => revoke entire family.
- Rate limiting on login/magic/refresh.
- Audit log for session create/revoke/refresh anomalies.

## Success criteria
- User remains logged in across browser restarts without frequent re-login.
- Stolen old refresh token cannot be reused after rotation.
- Frontend no longer depends on error text matching for auth decisions.
- Auth state is consistent across tabs and routes.
- Magic link, Google, and Apple all end in the same session mechanism.
