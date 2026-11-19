-- Compra de planes desde la app del club
ALTER TABLE "SubscriptionPlan" ADD COLUMN "sellOnline" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN "awaitingOnlinePayment" BOOLEAN NOT NULL DEFAULT false;
