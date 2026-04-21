# Invariantes de Negocio

Reglas que deben cumplirse siempre. Están **documentadas** y **enforcadas en SQL** donde es posible.

---

## 1. Un booking pertenece a un club

- **Modelo:** `Booking.clubId` FK a `Club`
- **Enforcement:** Trigger `ensure_booking_same_club` verifica que `Booking.court.clubId` y `Booking.activity.clubId` coincidan con `Booking.clubId`
- **Migración:** `20260307060000_harden_integrity_and_retire_event_queue`

---

## 2. Una account pertenece a un club

- **Modelo:** `Account.clubId` FK a `Club`
- **Enforcement:** FK + trigger `ensure_ledger_entry_same_club` para `LedgerEntry` referenciando `Account`
- **Unicidad:** `Account_clubId_sourceType_sourceId_key` — una sola cuenta por (club, sourceType, sourceId)

---

## 3. Un payment pertenece a una account

- **Modelo:** `Payment.accountId` FK a `Account`
- **Enforcement:** FK. Trigger `ensure_payment_cash_shift_same_club` verifica que `Payment` → `Account` → `Club` y `CashShift` → `CashRegister` → `Club` coincidan cuando hay `cashShiftId`

---

## 4. Un shift abierto por register

- **Modelo:** `CashShift` con `status = OPEN`
- **Enforcement:** Índice parcial único `CashShift_one_open_per_register_key` sobre `(cashRegisterId)` WHERE `status = 'OPEN'`
- **Migración:** `20260307060000_harden_integrity_and_retire_event_queue`

---

## 5. No overlap de bookings por cancha

- **Modelo:** `Booking` con `courtId`, `startDateTime`, `endDateTime`
- **Enforcement:** Constraint `EXCLUDE USING gist` con `btree_gist`:
  - `(courtId WITH =, tsrange(startDateTime, endDateTime) WITH &&)`
- **Migración:** `20260306193000_booking_overlap_exclusion_constraint`, `20260306213000_saas_architecture_phase2`

---

## 6. CashRegister única por (club, name)

- **Enforcement:** `CashRegister_clubId_name_key` UNIQUE
- **Migración:** `20260307060000_harden_integrity_and_retire_event_queue`

---

## 7. Court.activityType pertenece al mismo club

- **Enforcement:** Trigger `ensure_court_activity_same_club`
- **Migración:** `20260307060000_harden_integrity_and_retire_event_queue`

---

## 8. CourtPriceRule pertenece al mismo club que Court

- **Enforcement:** Trigger `ensure_court_price_rule_same_club`
- **Migración:** `20260307060000_harden_integrity_and_retire_event_queue`

---

## 9. CashMovement.clubId coherente con CashShift

- **Enforcement:** Trigger `ensure_cash_movement_same_club`
- **Migración:** `20260307060000_harden_integrity_and_retire_event_queue`

---

## 10. LedgerEntry.clubId coherente con Account

- **Enforcement:** Trigger `ensure_ledger_entry_same_club`
- **Migración:** `20260307060000_harden_integrity_and_retire_event_queue`

---

## Verificación pre-vuelo

Ejecutar antes de aplicar constraints o migraciones:

```bash
npm run preflight:stabilization
```

Si hay errores (duplicados, mismatches), corregir con:

```bash
npm run fix:stabilization-data
```

(Revisar con `DRY_RUN=true` primero.)
