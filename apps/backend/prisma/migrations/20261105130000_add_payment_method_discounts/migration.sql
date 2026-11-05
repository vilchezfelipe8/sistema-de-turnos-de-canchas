-- Descuento por medio de pago (precio efectivo vs precio de lista), en % por método.
ALTER TABLE "ClubSettings" ADD COLUMN "paymentMethodDiscounts" JSONB;
