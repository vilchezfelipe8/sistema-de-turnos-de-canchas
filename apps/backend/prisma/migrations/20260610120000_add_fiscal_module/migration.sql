-- CreateEnum
CREATE TYPE "FiscalCondition" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'OTRO');

-- CreateEnum
CREATE TYPE "FiscalProvider" AS ENUM ('ARCA', 'NONE', 'OTRO');

-- CreateEnum
CREATE TYPE "FiscalMode" AS ENUM ('OBLIGATORIA', 'OPCIONAL', 'DESHABILITADA');

-- CreateEnum
CREATE TYPE "FiscalVoucherKind" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "FiscalVoucherStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'APPROVED', 'APPROVED_WITH_OBSERVATIONS', 'REJECTED', 'TECHNICAL_ERROR', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FiscalOriginType" AS ENUM ('BOOKING', 'ACCOUNT', 'ACCOUNT_ITEM', 'MANUAL', 'REFUND');

-- CreateEnum
CREATE TYPE "FiscalItemType" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "FiscalIncidentStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "FiscalVoucherClass" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "FiscalVoucherVariant" AS ENUM ('STANDARD', 'PAGO_EN_CBU_INFORMADA', 'OPERACION_SUJETA_A_RETENCION');

-- AlterTable
ALTER TABLE "CashRegister" ADD COLUMN "fiscalPointOfSaleId" TEXT;

-- CreateTable
CREATE TABLE "ConfiguracionFiscal" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "facturacionHabilitada" BOOLEAN NOT NULL DEFAULT false,
    "proveedorFiscal" "FiscalProvider" NOT NULL DEFAULT 'NONE',
    "modoFacturacion" "FiscalMode" NOT NULL DEFAULT 'DESHABILITADA',
    "paisFiscal" TEXT NOT NULL DEFAULT 'AR',
    "razonSocial" TEXT,
    "cuit" TEXT,
    "condicionIva" "FiscalCondition",
    "ingresosBrutos" TEXT,
    "inicioActividadesAt" TIMESTAMPTZ(3),
    "usaHomologacion" BOOLEAN NOT NULL DEFAULT true,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "certificadoPem" TEXT,
    "clavePrivadaPem" TEXT,
    "clavePrivadaPassphrase" TEXT,
    "certificadoSerial" TEXT,
    "certificadoSubject" TEXT,
    "vencimientoCertificado" TIMESTAMPTZ(3),
    "onboardingStatus" TEXT,
    "ultimoHealthcheckAt" TIMESTAMPTZ(3),
    "ultimoHealthcheckOk" BOOLEAN,
    "observaciones" TEXT,
    "defaultPuntoDeVentaFiscalId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ConfiguracionFiscal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PuntoDeVentaFiscal" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "configuracionFiscalId" TEXT NOT NULL,
    "nombre" TEXT,
    "puntoDeVenta" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PuntoDeVentaFiscal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Factura" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "configuracionFiscalId" TEXT NOT NULL,
    "puntoDeVentaFiscalId" TEXT,
    "kind" "FiscalVoucherKind" NOT NULL,
    "status" "FiscalVoucherStatus" NOT NULL DEFAULT 'PENDING',
    "originType" "FiscalOriginType" NOT NULL,
    "originId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "bookingId" INTEGER,
    "accountId" TEXT,
    "voucherClass" "FiscalVoucherClass",
    "voucherVariant" "FiscalVoucherVariant" NOT NULL DEFAULT 'STANDARD',
    "comprobanteTipo" INTEGER,
    "comprobanteDescripcion" TEXT,
    "puntoDeVenta" INTEGER,
    "numeroComprobante" INTEGER,
    "concepto" INTEGER,
    "fechaEmision" TIMESTAMPTZ(3) NOT NULL,
    "fechaServicioDesde" TIMESTAMPTZ(3),
    "fechaServicioHasta" TIMESTAMPTZ(3),
    "fechaVencimientoPago" TIMESTAMPTZ(3),
    "receptorDocTipo" INTEGER,
    "receptorDocNumero" TEXT,
    "receptorNombre" TEXT,
    "receptorDomicilio" TEXT,
    "receptorCondicionIva" "FiscalCondition",
    "receptorCondicionIvaArcaId" INTEGER,
    "monedaCodigo" TEXT NOT NULL DEFAULT 'PES',
    "monedaCotizacion" DECIMAL(12,6) NOT NULL DEFAULT 1,
    "importeNeto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "importeIva" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "importeExento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "importeTributos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "importeTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cae" TEXT,
    "caeVencimiento" TIMESTAMPTZ(3),
    "resultadoArca" TEXT,
    "qrPayloadBase64" TEXT,
    "qrUrl" TEXT,
    "pdfUrl" TEXT,
    "internalReceiptUrl" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "normalizedResult" JSONB,
    "fiscalCalculationSnapshot" JSONB,
    "observacionesArca" JSONB,
    "erroresArca" JSONB,
    "mensajeError" TEXT,
    "suggestedAction" TEXT,
    "intentoActual" INTEGER NOT NULL DEFAULT 0,
    "ultimoIntentoAt" TIMESTAMPTZ(3),
    "comprobanteAsociadoId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Factura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalVoucherItem" (
    "id" TEXT NOT NULL,
    "facturaId" TEXT NOT NULL,
    "originType" "FiscalOriginType",
    "originId" TEXT,
    "itemType" "FiscalItemType" NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxableBase" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "snapshot" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FiscalVoucherItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalAuthTicket" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "configuracionFiscalId" TEXT,
    "service" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sign" TEXT NOT NULL,
    "generationTime" TIMESTAMPTZ(3) NOT NULL,
    "expirationTime" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FiscalAuthTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalIncident" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "configuracionFiscalId" TEXT,
    "facturaId" TEXT,
    "status" "FiscalIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "priority" TEXT,
    "assignedToUserId" INTEGER,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FiscalIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracionFiscal_clubId_key" ON "ConfiguracionFiscal"("clubId");

-- CreateIndex
CREATE INDEX "ConfiguracionFiscal_activo_idx" ON "ConfiguracionFiscal"("activo");

-- CreateIndex
CREATE INDEX "ConfiguracionFiscal_proveedorFiscal_modoFacturacion_idx" ON "ConfiguracionFiscal"("proveedorFiscal", "modoFacturacion");

-- CreateIndex
CREATE INDEX "ConfiguracionFiscal_paisFiscal_idx" ON "ConfiguracionFiscal"("paisFiscal");

-- CreateIndex
CREATE INDEX "ConfiguracionFiscal_cuit_idx" ON "ConfiguracionFiscal"("cuit");

-- CreateIndex
CREATE INDEX "PuntoDeVentaFiscal_clubId_idx" ON "PuntoDeVentaFiscal"("clubId");

-- CreateIndex
CREATE INDEX "PuntoDeVentaFiscal_configuracionFiscalId_idx" ON "PuntoDeVentaFiscal"("configuracionFiscalId");

-- CreateIndex
CREATE INDEX "PuntoDeVentaFiscal_activo_idx" ON "PuntoDeVentaFiscal"("activo");

-- CreateIndex
CREATE INDEX "PuntoDeVentaFiscal_clubId_puntoDeVenta_idx" ON "PuntoDeVentaFiscal"("clubId", "puntoDeVenta");

-- CreateIndex
CREATE INDEX "Factura_clubId_status_createdAt_idx" ON "Factura"("clubId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Factura_clubId_originType_originId_idx" ON "Factura"("clubId", "originType", "originId");

-- CreateIndex
CREATE INDEX "Factura_clubId_puntoDeVenta_comprobanteTipo_numeroComproban_idx" ON "Factura"("clubId", "puntoDeVenta", "comprobanteTipo", "numeroComprobante");

-- CreateIndex
CREATE INDEX "Factura_bookingId_idx" ON "Factura"("bookingId");

-- CreateIndex
CREATE INDEX "Factura_accountId_idx" ON "Factura"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Factura_clubId_idempotencyKey_key" ON "Factura"("clubId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "FiscalIncident_clubId_status_createdAt_idx" ON "FiscalIncident"("clubId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FiscalIncident_facturaId_idx" ON "FiscalIncident"("facturaId");

-- AddForeignKey
ALTER TABLE "CashRegister" ADD CONSTRAINT "CashRegister_fiscalPointOfSaleId_fkey" FOREIGN KEY ("fiscalPointOfSaleId") REFERENCES "PuntoDeVentaFiscal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfiguracionFiscal" ADD CONSTRAINT "ConfiguracionFiscal_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfiguracionFiscal" ADD CONSTRAINT "ConfiguracionFiscal_defaultPuntoDeVentaFiscalId_fkey" FOREIGN KEY ("defaultPuntoDeVentaFiscalId") REFERENCES "PuntoDeVentaFiscal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuntoDeVentaFiscal" ADD CONSTRAINT "PuntoDeVentaFiscal_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuntoDeVentaFiscal" ADD CONSTRAINT "PuntoDeVentaFiscal_configuracionFiscalId_fkey" FOREIGN KEY ("configuracionFiscalId") REFERENCES "ConfiguracionFiscal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_configuracionFiscalId_fkey" FOREIGN KEY ("configuracionFiscalId") REFERENCES "ConfiguracionFiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_puntoDeVentaFiscalId_fkey" FOREIGN KEY ("puntoDeVentaFiscalId") REFERENCES "PuntoDeVentaFiscal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_comprobanteAsociadoId_fkey" FOREIGN KEY ("comprobanteAsociadoId") REFERENCES "Factura"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalVoucherItem" ADD CONSTRAINT "FiscalVoucherItem_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "Factura"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalAuthTicket" ADD CONSTRAINT "FiscalAuthTicket_configuracionFiscalId_fkey" FOREIGN KEY ("configuracionFiscalId") REFERENCES "ConfiguracionFiscal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalIncident" ADD CONSTRAINT "FiscalIncident_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalIncident" ADD CONSTRAINT "FiscalIncident_configuracionFiscalId_fkey" FOREIGN KEY ("configuracionFiscalId") REFERENCES "ConfiguracionFiscal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalIncident" ADD CONSTRAINT "FiscalIncident_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "Factura"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalIncident" ADD CONSTRAINT "FiscalIncident_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
