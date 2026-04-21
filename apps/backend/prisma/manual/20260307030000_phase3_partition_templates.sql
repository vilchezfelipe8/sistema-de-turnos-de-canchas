-- Plantillas para rollout manual cuando el volumen justifique particionar.
-- No ejecutar sin plan de migración, ventanas de mantenimiento y validación previa.

-- Example: Event / Outbox monthly partitioning
-- ALTER TABLE "Event" PARTITION BY RANGE ("createdAt");
-- CREATE TABLE "Event_2026_03" PARTITION OF "Event"
--   FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- ALTER TABLE "OutboxMessage" PARTITION BY RANGE ("createdAt");
-- CREATE TABLE "OutboxMessage_2026_03" PARTITION OF "OutboxMessage"
--   FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- Example: AuditLog monthly partitioning
-- ALTER TABLE "AuditLog" PARTITION BY RANGE ("createdAt");
-- CREATE TABLE "AuditLog_2026_03" PARTITION OF "AuditLog"
--   FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
