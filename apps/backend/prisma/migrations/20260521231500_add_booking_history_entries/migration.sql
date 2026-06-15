CREATE TABLE IF NOT EXISTS "BookingHistoryEntry" (
  "id" TEXT NOT NULL,
  "clubId" INTEGER NOT NULL,
  "bookingId" INTEGER NOT NULL,
  "actorUserId" INTEGER,
  "actorLabel" TEXT,
  "action" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "detail" JSONB,
  "previousState" JSONB,
  "nextState" JSONB,
  "bookingParticipantId" TEXT,
  "paymentId" TEXT,
  "accountId" TEXT,
  "sourceEventId" TEXT,
  "idempotencyKey" TEXT,
  "metadata" JSONB,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BookingHistoryEntry_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BookingHistoryEntry_clubId_fkey'
  ) THEN
    ALTER TABLE "BookingHistoryEntry"
      ADD CONSTRAINT "BookingHistoryEntry_clubId_fkey"
      FOREIGN KEY ("clubId")
      REFERENCES "Club"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BookingHistoryEntry_bookingId_fkey'
  ) THEN
    ALTER TABLE "BookingHistoryEntry"
      ADD CONSTRAINT "BookingHistoryEntry_bookingId_fkey"
      FOREIGN KEY ("bookingId")
      REFERENCES "Booking"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BookingHistoryEntry_actorUserId_fkey'
  ) THEN
    ALTER TABLE "BookingHistoryEntry"
      ADD CONSTRAINT "BookingHistoryEntry_actorUserId_fkey"
      FOREIGN KEY ("actorUserId")
      REFERENCES "User"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BookingHistoryEntry_bookingParticipantId_fkey'
  ) THEN
    ALTER TABLE "BookingHistoryEntry"
      ADD CONSTRAINT "BookingHistoryEntry_bookingParticipantId_fkey"
      FOREIGN KEY ("bookingParticipantId")
      REFERENCES "BookingParticipant"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BookingHistoryEntry_paymentId_fkey'
  ) THEN
    ALTER TABLE "BookingHistoryEntry"
      ADD CONSTRAINT "BookingHistoryEntry_paymentId_fkey"
      FOREIGN KEY ("paymentId")
      REFERENCES "Payment"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BookingHistoryEntry_accountId_fkey'
  ) THEN
    ALTER TABLE "BookingHistoryEntry"
      ADD CONSTRAINT "BookingHistoryEntry_accountId_fkey"
      FOREIGN KEY ("accountId")
      REFERENCES "Account"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "BookingHistoryEntry_sourceEventId_key"
  ON "BookingHistoryEntry"("sourceEventId");

CREATE UNIQUE INDEX IF NOT EXISTS "BookingHistoryEntry_idempotencyKey_key"
  ON "BookingHistoryEntry"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "BookingHistoryEntry_clubId_bookingId_occurredAt_idx"
  ON "BookingHistoryEntry"("clubId", "bookingId", "occurredAt");

CREATE INDEX IF NOT EXISTS "BookingHistoryEntry_bookingId_occurredAt_idx"
  ON "BookingHistoryEntry"("bookingId", "occurredAt");

CREATE INDEX IF NOT EXISTS "BookingHistoryEntry_action_occurredAt_idx"
  ON "BookingHistoryEntry"("action", "occurredAt");

CREATE INDEX IF NOT EXISTS "BookingHistoryEntry_category_occurredAt_idx"
  ON "BookingHistoryEntry"("category", "occurredAt");

CREATE INDEX IF NOT EXISTS "BookingHistoryEntry_actorUserId_occurredAt_idx"
  ON "BookingHistoryEntry"("actorUserId", "occurredAt");

CREATE INDEX IF NOT EXISTS "BookingHistoryEntry_bookingParticipantId_occurredAt_idx"
  ON "BookingHistoryEntry"("bookingParticipantId", "occurredAt");

CREATE INDEX IF NOT EXISTS "BookingHistoryEntry_paymentId_occurredAt_idx"
  ON "BookingHistoryEntry"("paymentId", "occurredAt");

CREATE INDEX IF NOT EXISTS "BookingHistoryEntry_accountId_occurredAt_idx"
  ON "BookingHistoryEntry"("accountId", "occurredAt");

WITH resolved_events AS (
  SELECT
    e.id AS event_id,
    e."clubId" AS club_id,
    e.type AS legacy_type,
    e.payload,
    e."createdAt" AS created_at,
    COALESCE(
      CASE
        WHEN NULLIF(e.payload->>'bookingId', '') ~ '^[0-9]+$' THEN (e.payload->>'bookingId')::INTEGER
        ELSE NULL
      END,
      CASE
        WHEN NULLIF(e.payload->>'sourceBookingId', '') ~ '^[0-9]+$' THEN (e.payload->>'sourceBookingId')::INTEGER
        ELSE NULL
      END,
      CASE
        WHEN a."sourceId" ~ '^[0-9]+$' THEN a."sourceId"::INTEGER
        ELSE NULL
      END
    ) AS booking_id,
    COALESCE(
      CASE
        WHEN NULLIF(e.payload->>'actorUserId', '') ~ '^[0-9]+$' THEN (e.payload->>'actorUserId')::INTEGER
        ELSE NULL
      END,
      CASE
        WHEN NULLIF(e.payload->>'userId', '') ~ '^[0-9]+$' THEN (e.payload->>'userId')::INTEGER
        ELSE NULL
      END,
      CASE
        WHEN NULLIF(e.payload->>'createdByUserId', '') ~ '^[0-9]+$' THEN (e.payload->>'createdByUserId')::INTEGER
        ELSE NULL
      END
    ) AS actor_user_id,
    NULLIF(e.payload->>'accountId', '') AS account_id,
    NULLIF(e.payload->>'paymentId', '') AS payment_id
  FROM "Event" e
  LEFT JOIN "Account" a
    ON a.id = NULLIF(e.payload->>'accountId', '')
   AND a."clubId" = e."clubId"
   AND a."sourceType" = 'BOOKING'
),
legacy_event_history AS (
  SELECT
    'bhe_' || re.event_id AS id,
    re.club_id AS club_id,
    b.id AS booking_id,
    re.actor_user_id,
    NULL::TEXT AS actor_label,
    CASE UPPER(re.legacy_type)
      WHEN 'BOOKING_CLIENT_CHANGED' THEN 'BOOKING_OWNER_CHANGED'
      WHEN 'PRODUCT_SOLD' THEN 'BOOKING_CONSUMPTION_ADDED'
      WHEN 'PRODUCT_REMOVED' THEN 'BOOKING_CONSUMPTION_REMOVED'
      ELSE UPPER(re.legacy_type)
    END AS action,
    CASE
      WHEN UPPER(re.legacy_type) IN ('BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CONFIRMED', 'BOOKING_COMPLETED', 'BOOKING_CANCELLED', 'BOOKING_CLIENT_CHANGED', 'BOOKING_NOTES_UPDATED') THEN 'BOOKING'
      WHEN UPPER(re.legacy_type) IN ('BOOKING_PARTICIPANT_ADDED', 'BOOKING_PARTICIPANT_REMOVED') THEN 'PARTICIPANT'
      WHEN UPPER(re.legacy_type) = 'PAYMENT_RECEIVED' THEN 'PAYMENT'
      WHEN UPPER(re.legacy_type) IN ('PRODUCT_SOLD', 'PRODUCT_REMOVED') THEN 'CONSUMPTION'
      WHEN UPPER(re.legacy_type) = 'BOOKING_BILLING_CONFIG_UPDATED' THEN 'BILLING'
      ELSE 'BOOKING'
    END AS category,
    COALESCE(NULLIF(re.payload->>'source', ''), 'SYSTEM_BACKFILL') AS source,
    CASE UPPER(re.legacy_type)
      WHEN 'BOOKING_CREATED' THEN 'Reserva creada'
      WHEN 'BOOKING_RESCHEDULED' THEN 'Reserva reprogramada'
      WHEN 'BOOKING_CONFIRMED' THEN 'Reserva confirmada'
      WHEN 'BOOKING_COMPLETED' THEN 'Reserva finalizada'
      WHEN 'BOOKING_CANCELLED' THEN 'Reserva cancelada'
      WHEN 'BOOKING_PARTICIPANT_ADDED' THEN 'Participante agregado'
      WHEN 'BOOKING_PARTICIPANT_REMOVED' THEN 'Participante eliminado'
      WHEN 'BOOKING_BILLING_CONFIG_UPDATED' THEN 'Configuración de cobro actualizada'
      WHEN 'BOOKING_CLIENT_CHANGED' THEN 'Titular cambiado'
      WHEN 'BOOKING_NOTES_UPDATED' THEN 'Notas actualizadas'
      WHEN 'PAYMENT_RECEIVED' THEN 'Pago recibido'
      WHEN 'PRODUCT_SOLD' THEN 'Consumo agregado'
      WHEN 'PRODUCT_REMOVED' THEN 'Consumo eliminado'
      ELSE 'Actualización registrada'
    END AS summary,
    re.payload AS detail,
    NULL::JSONB AS "previousState",
    NULL::JSONB AS "nextState",
    NULL::TEXT AS booking_participant_id,
    re.payment_id,
    re.account_id,
    re.event_id AS source_event_id,
    'backfill:event:' || re.event_id AS idempotency_key,
    jsonb_build_object('legacyEventType', re.legacy_type, 'backfilledAt', CURRENT_TIMESTAMP) AS metadata,
    re.created_at AS occurred_at,
    re.created_at AS created_at
  FROM resolved_events re
  JOIN "Booking" b
    ON b.id = re.booking_id
   AND b."clubId" = re.club_id
  WHERE re.booking_id IS NOT NULL
),
inserted_legacy AS (
  INSERT INTO "BookingHistoryEntry" (
    "id",
    "clubId",
    "bookingId",
    "actorUserId",
    "actorLabel",
    "action",
    "category",
    "source",
    "summary",
    "detail",
    "previousState",
    "nextState",
    "bookingParticipantId",
    "paymentId",
    "accountId",
    "sourceEventId",
    "idempotencyKey",
    "metadata",
    "occurredAt",
    "createdAt"
  )
  SELECT
    leh.id,
    leh.club_id,
    leh.booking_id,
    leh.actor_user_id,
    leh.actor_label,
    leh.action,
    leh.category,
    leh.source,
    leh.summary,
    leh.detail,
    leh."previousState",
    leh."nextState",
    leh.booking_participant_id,
    leh.payment_id,
    leh.account_id,
    leh.source_event_id,
    leh.idempotency_key,
    leh.metadata,
    leh.occurred_at,
    leh.created_at
  FROM legacy_event_history leh
  WHERE NOT EXISTS (
    SELECT 1
    FROM "BookingHistoryEntry" bhe
    WHERE bhe."sourceEventId" = leh.source_event_id
       OR bhe."idempotencyKey" = leh.idempotency_key
  )
  RETURNING "bookingId"
)
INSERT INTO "BookingHistoryEntry" (
  "id",
  "clubId",
  "bookingId",
  "action",
  "category",
  "source",
  "summary",
  "metadata",
  "occurredAt",
  "createdAt",
  "idempotencyKey"
)
SELECT
  'bhe_booking_created_' || b.id,
  b."clubId",
  b.id,
  'BOOKING_CREATED',
  'BOOKING',
  'SYSTEM_BACKFILL',
  'Reserva registrada',
  jsonb_build_object('kind', 'MINIMAL_BOOKING_CREATED_BACKFILL'),
  b."createdAt",
  CURRENT_TIMESTAMP,
  'backfill:booking-created:' || b.id
FROM "Booking" b
WHERE NOT EXISTS (
  SELECT 1
  FROM "BookingHistoryEntry" bhe
  WHERE bhe."bookingId" = b.id
)
ON CONFLICT ("idempotencyKey") DO NOTHING;
