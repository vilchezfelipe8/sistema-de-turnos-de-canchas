-- Qué cubre cada intento de pago online: la cuenta entera (null, como hasta ahora) o partes
-- puntuales de una reserva por jugador ({ scope, items: [{ accountItemId, amount }], payer }).
ALTER TABLE "OnlinePaymentAttempt" ADD COLUMN "target" JSONB;
