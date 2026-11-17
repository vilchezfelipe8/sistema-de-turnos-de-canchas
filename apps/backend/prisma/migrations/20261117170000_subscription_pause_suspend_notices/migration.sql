-- Planes: suspender al socio tras X días de mora, y avisos de cuota nueva, mora y fin de plazo.
ALTER TABLE "SubscriptionPlan" ADD COLUMN "suspendMemberAfterDays" INTEGER;
ALTER TYPE "NotificationEventType" ADD VALUE 'SUBSCRIPTION_RENEWED';
ALTER TYPE "NotificationEventType" ADD VALUE 'SUBSCRIPTION_PAST_DUE';
ALTER TYPE "NotificationEventType" ADD VALUE 'SUBSCRIPTION_EXPIRING';
