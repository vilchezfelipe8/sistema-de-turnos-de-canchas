# Sistema de Gestión de Turnos — Project Guide

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js (Pages Router) + TypeScript + Tailwind CSS |
| Backend | Express + TypeScript + Prisma ORM |
| DB | PostgreSQL (prod) / SQLite (dev) |
| Auth | JWT + Bcrypt |
| Monorepo | `apps/frontend` · `apps/backend` · `apps/wpp-service` |

---

## Project Structure

```
apps/
  frontend/
    pages/admin/          # Admin panel pages (one page = one feature)
    components/admin/     # Shared admin components
    utils/apiClient.ts    # Authenticated fetch wrapper (always use this)
    services/             # Frontend service layer (API calls)
  backend/
    src/
      modules/            # Feature modules (account/, booking/, cash/, payment/, …)
      services/           # Domain services
      controllers/        # Express route handlers
      repositories/       # DB access via Prisma
      routes/             # Express routers
```

---

## Admin Panel — Key Concepts

### Playground Pages vs Stable Pages
Pages with `-playground` suffix are in-progress rewrites. They coexist with the stable versions.
- Stable: `agenda.tsx`, `clientes.tsx`, `caja.tsx`
- Active rewrites: `agenda-playground2.tsx`, `clientes-playground2.tsx`, `pagos-playground.tsx`

When working on features, **always check which page is active** in `playgroundNavigation.ts`.

### Navigation
`apps/frontend/components/admin/playgroundNavigation.ts` — single source of truth for sidebar routes.
Current active routes: Calendario, Clientes, Caja, Tienda, Informes, Ajustes.

### Shell Components
- `AdminRouteShell` — wraps stable pages
- `AdminPlaygroundShell` — wraps playground pages (includes sidebar from `playgroundNavigation.ts`)
- `AgendaLikeRightSidebar` — slide-in right panel used for detail/actions within a page

---

## Payment Modal Pattern

All payment registration modals follow the same 3-step flow:
```
'form' → 'preconfirm' → 'result'
```

State controlled by: `*PaymentModalStep: null | 'form' | 'preconfirm' | 'result'`

### Quick Presets
```ts
type PaymentQuickPreset = 'FULL' | 'COURT_ONLY' | 'CUSTOM_ITEMS';
```
- `FULL` — Todo pendiente (total remaining)
- `COURT_ONLY` — Solo cancha (BOOKING items only)
- `CUSTOM_ITEMS` — Personalizado (per-item checkbox + custom amount input)

### Shared Modal Components
Located in `apps/frontend/components/admin/payments/`:
- `AdminPaymentFormModal` — form step shell (method, channel, concepts, amount)
- `AdminPaymentPreconfirmModal` — summary before submit
- Result step rendered inline

### Rules
- Amount must not exceed `maxAllowedAmount` (min of account remaining and concept-based total)
- Transfer method requires `channel` selection (BANK_ACCOUNT | VIRTUAL_WALLET)
- `appliedItems` — array of `{id, label, amount}` — built from `previewRows` at submit time, passed to result modal

---

## API Client

Always use `apiClient.ts` for authenticated requests. It handles:
- JWT injection
- 401 token refresh
- Club context header (`getActiveClubId()`, `getActiveClubSlug()`)
- Error parsing → throws with `.message`

Pattern:
```ts
import { apiClient } from '../utils/apiClient';
const data = await apiClient.get('/api/some-endpoint');
```

---

## Common Patterns

### Error handling in callbacks
```ts
try {
  setSubmitting(true);
  setError('');
  await someApiCall();
  showAdminToast('Acción completada.');
} catch (error) {
  reportUiError({ area: 'ComponentName', action: 'actionName' }, error);
  setError(extractErrorMessage(error, 'Mensaje de fallback.'));
} finally {
  setSubmitting(false);
}
```

### Toast notifications
```ts
showAdminToast('Mensaje breve.');  // auto-dismiss ~2.4s, max 4 queued
```

### Money formatting
```ts
formatMoney(amount)  // e.g. "$ 1.500,00"
```

### Derived state order in components
Declare `useCallback`/`useMemo` that depend on other derived values **after** those values are declared. TypeScript enforces TDZ for `const` even inside callbacks.

---

## TypeScript Check

```bash
npx tsc --noEmit -p apps/frontend/tsconfig.json
npx tsc --noEmit -p apps/backend/tsconfig.json
```

Known pre-existing errors (do not fix unless explicitly tasked):
- `index.tsx` / `index-playground.tsx` — `IoFootballOutline`/`IoTennisballOutline` JSX type error
- `tailwind.config.ts` — isolatedModules warning

---

## Dev Commands

```bash
# Frontend
cd apps/frontend && npm run dev        # http://localhost:3000

# Backend
cd apps/backend && npm run dev         # http://localhost:4000

# DB migration
cd apps/backend && npx prisma migrate dev --name <name>

# DB seed
cd apps/backend && npx prisma db seed
```

---

## Backend Domain Modules

| Module | Responsibility |
|--------|---------------|
| `account/` | Cuentas (open/close/items/payments) |
| `booking/` | Reservas de canchas |
| `cash/` | Caja (turnos, movimientos, cierre) |
| `payment/` | Pagos y devoluciones |
| `client/` | Gestión de clientes |
| `recurring/` | Reservas recurrentes |
| `integration/` | Integraciones externas |

---

## Conventions

- State setters: `set<FeatureName><StateDescription>` (e.g. `setAccountPaymentAmountDraft`)
- Pending items derived via `useMemo` from account detail — never stored in raw state
- Club-scoped: all API calls include active club context automatically via `apiClient`
- Playground pages are large single-file components by design — do not split unless explicitly asked

---

## Admin Migration State (updated 2026-04-27)

### Already migrated ✅
- `AdminPlaygroundShell` + `AdminRouteShell` — main shell, working well. **Do not touch.**
- `_app.tsx` — `ActiveClubProvider` + `AuthProvider` correctly nested, clean notices system.
- `ActiveClubContext` — well implemented with `StorageEvent` sync.
- `agenda.tsx` → re-exports `agenda-playground2.tsx`
- `clientes.tsx` → re-exports `clientes-playground2.tsx`
- `caja.tsx` → re-exports `pagos-playground.tsx`
- `ajustes.tsx` — migrated, subtabs: Club, Canchas (+ coming soon)
- `tienda.tsx` — migrated, subtabs: Productos, Servicios, Inventario
- `informes.tsx` — migrated, subtabs present
- `facturacion.tsx`, `mensajes.tsx`, `reservas.tsx` — migrated with `AdminComingSoonPanel`
- Tab components: `AdminTabClub`, `AdminTabCourts`, `AdminTabProducts`, `AdminTabServices`, `AdminTabRefunds`, `AdminTabStatistics`
- Backend invariants: `confirmBooking` creates account inside `prisma.$transaction` ✅, `completeBooking` validates account exists and fails explicitly ✅

### Agenda componentization state
`agenda-playground2.tsx` — Phase 1 and partial Phase 2 of the componentization plan are done:
- Already extracted: `BookingDrawerShell`, `bookingDrawerReducer`, `AgendaToolbar`, `AgendaBookingBlock`, `AgendaSlotLayer`, `AgendaTimeGutter`, `AgendaSelectionPreview`, `BookingHoverCard`
- Still 12,800+ lines, 139 `useState`, 47 `useEffect`, 74 `useMemo`, 62 `useCallback`
- Phase 3 (hook extraction: `useAgendaSchedule`, `useAgendaDragAndDrop`, `useBookingDrawerController`) not started yet

### Known issues

**1. Broken `activeItem` — sidebar highlights nothing**
Fix: change to the correct label from `playgroundNavigation.ts`.

| Page | activeItem used | Fix → |
|------|----------------|-------|
| `canchas.tsx` | `"Canchas"` | `"Ajustes"` |
| `products.tsx` | `"Productos"` | `"Tienda"` |
| `services.tsx` | `"Servicios"` | `"Tienda"` |
| `cash-playground.tsx` | `"Pagos"` | `"Caja"` |
| `cash-playground2.tsx` | `"Pagos"` | `"Caja"` |

**2. Old layout systems — safe to delete**
`AdminLayout.tsx` + `AdminSidebar.tsx` + `DashboardLayout.tsx` + `Sidebar.tsx` are only used by `metrics.tsx` and each other. `metrics.tsx` has `getServerSideProps` returning `notFound: true` in production — it's a dev/debug page. Safe to migrate `metrics.tsx` to a minimal layout and delete all four old layout files.

**3. Duplicate / orphaned pages**

| Old route | New equivalent | Action |
|-----------|---------------|--------|
| `/admin/settings` | `/admin/ajustes` | Redirect or delete |
| `/admin/canchas` | `/admin/ajustes?tab=canchas` | Redirect or delete |
| `/admin/statistics` | `/admin/informes` | Redirect or delete |
| `/admin/products` | `/admin/tienda?tab=productos` | Redirect or delete |
| `/admin/services` | `/admin/tienda?tab=servicios` | Redirect or delete |
| `/admin/cash` | `/admin/caja` | Same re-export, delete one |
| `/admin/devoluciones` | Tab inside `/admin/caja` (REFUNDS tab already exists) | Redirect + delete |
| `/admin/cuentas` | TBD — migrate as tab first | 1,015 lines, not migrated |
| `/admin/metrics` | Dev tool, `notFound` in prod | Keep or migrate to dev tool |

**4. Abandoned playground files — confirmed**
- `cash-playground2.tsx` — abandoned experiment, not linked from sidebar or any re-export. **Delete.**
- `cash-playground.tsx` — broken `activeItem`, not the definitive version. **Delete.**
- `clientes-playground.tsx` — only `clientes-playground2` is active. **Delete.**
- Definitive files: `pagos-playground.tsx` (caja), `agenda-playground2.tsx` (agenda), `clientes-playground2.tsx` (clientes)

**5. `cuentas.tsx` — 1,015 lines, not migrated**
- Does not use `AdminRouteShell` — manually replicates auth-check (old pattern)
- Reads club slug from `localStorage` directly, ignoring `ActiveClubContext` that already exists
- 34 `useState` all inline in the page component, no hooks extracted
- `activeItem="Caja"` is conceptually correct
- Migration path: (1) switch to `AdminRouteShell` + `useActiveClub()`, (2) move as tab in Caja, (3) extract hooks `useAccounts`, `useClubProducts`, `useClubServices`

**6. `pagos-playground.tsx` (active caja) — 2,859 lines, 54 `useState`**
Works and is active. Uses `hasAdminAccess` and `useValidateAuth` correctly. Already has REFUNDS tab, making `/admin/devoluciones` redundant.

**7. `AdminTabBookings.tsx` — likely dead code**
Has `import { useParams } from 'react-router-dom'` used on line 321 — wrong router for Next.js. Not imported in any active admin page. Confirm and delete if unused; if used, replace `useParams` with `useRouter`.

**8. Auth: CLAUDE.md mentions JWT but migration plan targets cookies**
`auth-session-redesign-plan.md` documents migration to cookie-based auth. The JWT references in this file reflect current state, not future direction. Update this file when the migration is done.

### Priorities

**Do now (low risk, high impact):**
1. Fix `activeItem` in `canchas`, `products`, `services`, `cash-playground`, `cash-playground2` — 1-line fix each
2. Delete abandoned playgrounds: `cash-playground2.tsx`, `cash-playground.tsx`, `clientes-playground.tsx`
3. Delete old layouts: `AdminLayout.tsx`, `AdminSidebar.tsx`, `DashboardLayout.tsx`, `Sidebar.tsx` — migrate `metrics.tsx` first
4. Redirect duplicate pages (`settings`, `canchas`, `statistics`, `products`, `services`, `cash`) to their new equivalents

**Do soon:**
1. Migrate `devoluciones.tsx` → redirect to `/admin/caja` and delete (REFUNDS tab already exists)
2. Migrate `cuentas.tsx` step 1: replace auth-check + localStorage with `AdminRouteShell` + `useActiveClub()`
3. Migrate `cuentas.tsx` step 2: move as tab inside Caja (with redirect from old URL)
4. Confirm `AdminTabBookings.tsx` is dead code → delete

**Later:**
1. Extract hooks from `cuentas.tsx`: `useAccounts`, `useClubProducts`, `useClubServices`
2. Extract hooks from `agenda-playground2.tsx` (Phase 3): `useAgendaSchedule`, `useAgendaDragAndDrop`, `useBookingDrawerController`
3. Auth migration to cookies — update this file when done

**Do NOT:**
- Touch `AdminPlaygroundShell` — it's well built and stable
- Componentize `pagos-playground.tsx` or `agenda-playground2.tsx` now — finish structural cleanup first
- Move Cuentas into Caja if it changes live URLs without a redirect in place first
- Componentize `cuentas.tsx` all at once
