import { prisma } from '../prisma';

async function main() {
  // Busca el primer club que tenga configuración fiscal
  const config = await prisma.configuracionFiscal.findFirst({
    select: { id: true, clubId: true }
  });

  if (!config) {
    console.error('❌ No hay configuración fiscal. Andá a Ajustes → Facturación y guardá los datos primero.');
    process.exit(1);
  }

  const { id: configuracionFiscalId, clubId } = config;
  console.log(`✅ Usando club ${clubId}, config ${configuracionFiscalId}`);

  const now = new Date();

  const facturas = [
    {
      id: 'test-factura-001',
      clubId,
      configuracionFiscalId,
      kind: 'INVOICE' as const,
      status: 'APPROVED' as const,
      originType: 'ACCOUNT' as const,
      originId: 'pay-test-001',
      idempotencyKey: 'seed-test-001',
      voucherClass: 'B' as const,
      comprobanteTipo: 6,
      comprobanteDescripcion: 'Factura B',
      puntoDeVenta: 1,
      numeroComprobante: 1,
      fechaEmision: now,
      receptorNombre: 'Juan Pérez',
      receptorDocNumero: '20345678901',
      receptorCondicionIva: 'CONSUMIDOR_FINAL' as const,
      importeNeto: 12397,
      importeIva: 2603,
      importeTotal: 15000,
      cae: '75123456789012',
      caeVencimiento: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
      intentoActual: 1,
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000)
    },
    {
      id: 'test-factura-002',
      clubId,
      configuracionFiscalId,
      kind: 'INVOICE' as const,
      status: 'APPROVED' as const,
      originType: 'ACCOUNT' as const,
      originId: 'pay-test-002',
      idempotencyKey: 'seed-test-002',
      voucherClass: 'B' as const,
      comprobanteTipo: 6,
      comprobanteDescripcion: 'Factura B',
      puntoDeVenta: 1,
      numeroComprobante: 2,
      fechaEmision: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      receptorNombre: 'María García',
      receptorDocNumero: '27987654321',
      receptorCondicionIva: 'CONSUMIDOR_FINAL' as const,
      importeNeto: 6612,
      importeIva: 1388,
      importeTotal: 8000,
      cae: '75123456789013',
      caeVencimiento: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
      intentoActual: 1,
      createdAt: new Date(now.getTime() - 25 * 60 * 60 * 1000)
    },
    {
      id: 'test-factura-003',
      clubId,
      configuracionFiscalId,
      kind: 'INVOICE' as const,
      status: 'TECHNICAL_ERROR' as const,
      originType: 'ACCOUNT' as const,
      originId: 'pay-test-003',
      idempotencyKey: 'seed-test-003',
      voucherClass: 'B' as const,
      comprobanteTipo: 6,
      comprobanteDescripcion: 'Factura B',
      puntoDeVenta: 1,
      fechaEmision: now,
      receptorNombre: 'Carlos López',
      receptorDocNumero: '20111222333',
      receptorCondicionIva: 'CONSUMIDOR_FINAL' as const,
      importeTotal: 5000,
      mensajeError: 'Error de conexión con el servicio WSAA. El servidor no respondió.',
      suggestedAction: 'RETRY_LATER',
      intentoActual: 2,
      ultimoIntentoAt: new Date(now.getTime() - 5 * 60 * 1000),
      createdAt: new Date(now.getTime() - 30 * 60 * 1000)
    },
    {
      id: 'test-factura-004',
      clubId,
      configuracionFiscalId,
      kind: 'INVOICE' as const,
      status: 'PENDING' as const,
      originType: 'ACCOUNT' as const,
      originId: 'pay-test-004',
      idempotencyKey: 'seed-test-004',
      voucherClass: 'A' as const,
      comprobanteTipo: 1,
      comprobanteDescripcion: 'Factura A',
      puntoDeVenta: 1,
      fechaEmision: now,
      receptorNombre: 'Empresa XYZ SRL',
      receptorDocNumero: '30123456780',
      receptorCondicionIva: 'RESPONSABLE_INSCRIPTO' as const,
      importeNeto: 41322,
      importeIva: 8678,
      importeTotal: 50000,
      intentoActual: 0,
      createdAt: new Date(now.getTime() - 10 * 60 * 1000)
    },
    {
      id: 'test-factura-005',
      clubId,
      configuracionFiscalId,
      kind: 'CREDIT_NOTE' as const,
      status: 'APPROVED' as const,
      originType: 'ACCOUNT' as const,
      originId: 'pay-test-001',
      idempotencyKey: 'seed-test-005',
      voucherClass: 'B' as const,
      comprobanteTipo: 8,
      comprobanteDescripcion: 'Nota de Crédito B',
      puntoDeVenta: 1,
      numeroComprobante: 1,
      fechaEmision: new Date(now.getTime() - 12 * 60 * 60 * 1000),
      receptorNombre: 'Juan Pérez',
      receptorDocNumero: '20345678901',
      receptorCondicionIva: 'CONSUMIDOR_FINAL' as const,
      importeTotal: 15000,
      cae: '75123456789099',
      caeVencimiento: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
      intentoActual: 1,
      createdAt: new Date(now.getTime() - 13 * 60 * 60 * 1000)
    },
    {
      id: 'test-factura-006',
      clubId,
      configuracionFiscalId,
      kind: 'INVOICE' as const,
      status: 'REJECTED' as const,
      originType: 'ACCOUNT' as const,
      originId: 'pay-test-006',
      idempotencyKey: 'seed-test-006',
      voucherClass: 'B' as const,
      comprobanteTipo: 6,
      comprobanteDescripcion: 'Factura B',
      puntoDeVenta: 1,
      fechaEmision: new Date(now.getTime() - 48 * 60 * 60 * 1000),
      receptorNombre: 'Pedro Sánchez',
      receptorDocNumero: '20555666777',
      receptorCondicionIva: 'CONSUMIDOR_FINAL' as const,
      importeTotal: 3200,
      mensajeError: 'AFIP rechazó el comprobante: CUIT receptor inválido.',
      suggestedAction: 'REQUIRE_RECEIVER_DATA_FIX',
      intentoActual: 1,
      createdAt: new Date(now.getTime() - 49 * 60 * 60 * 1000)
    }
  ];

  for (const f of facturas) {
    await prisma.factura.upsert({
      where: { id: f.id },
      update: {},
      create: f as any
    });
    console.log(`  → ${f.status.padEnd(15)} ${f.comprobanteDescripcion} — ${f.receptorNombre}`);
  }

  // Incidencias
  const incidents = [
    {
      id: 'test-incident-001',
      clubId,
      type: 'CERT_EXPIRY',
      title: 'Certificado AFIP vence en 20 días',
      detail: 'El certificado vence el 22/06/2026. Renovarlo antes del vencimiento evita interrupciones.',
      priority: 'MEDIUM',
      status: 'OPEN' as const,
      facturaId: null,
      createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
    },
    {
      id: 'test-incident-002',
      clubId,
      type: 'RECEIVER_DATA_INVALID',
      title: 'CUIT de receptor rechazado por AFIP',
      detail: 'La factura test-factura-006 fue rechazada por CUIT inválido. Corregir los datos del cliente.',
      priority: 'HIGH',
      status: 'OPEN' as const,
      facturaId: 'test-factura-006',
      createdAt: new Date(now.getTime() - 48 * 60 * 60 * 1000)
    },
    {
      id: 'test-incident-003',
      clubId,
      type: 'WSAA_AUTH_FAILURE',
      title: 'Falla repetida de autenticación WSAA',
      detail: 'Se registraron 3 fallos consecutivos de autenticación en las últimas 2 horas.',
      priority: 'LOW',
      status: 'RESOLVED' as const,
      facturaId: null,
      createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      resolvedAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000)
    }
  ];

  for (const inc of incidents) {
    await prisma.fiscalIncident.upsert({
      where: { id: inc.id },
      update: {},
      create: inc as any
    });
    console.log(`  → ${inc.status.padEnd(8)} [${inc.priority}] ${inc.title}`);
  }

  console.log('\n✅ Datos de prueba creados. Andá a /admin/facturacion para verlos.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
