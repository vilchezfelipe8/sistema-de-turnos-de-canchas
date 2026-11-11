-- Índices declarados en schema.prisma que faltaban en 20260610120000_add_fiscal_module.
-- FiscalAuthTicket(clubId, service) es único: ArcaAuthService hace upsert por esa clave.

-- CreateIndex
CREATE INDEX "CashRegister_fiscalPointOfSaleId_idx" ON "CashRegister"("fiscalPointOfSaleId");

-- CreateIndex
CREATE INDEX "FiscalAuthTicket_expirationTime_idx" ON "FiscalAuthTicket"("expirationTime");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalAuthTicket_clubId_service_key" ON "FiscalAuthTicket"("clubId", "service");

-- CreateIndex
CREATE INDEX "FiscalVoucherItem_facturaId_idx" ON "FiscalVoucherItem"("facturaId");
