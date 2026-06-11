import { prisma } from '../prisma';

const THRESHOLDS_DAYS = [90, 30, 7];

export class FiscalCertExpiryChecker {
  async run(): Promise<void> {
    const now = new Date();
    const maxHorizonMs = THRESHOLDS_DAYS[0] * 24 * 60 * 60 * 1000;
    const horizon = new Date(now.getTime() + maxHorizonMs);

    const configs = await prisma.configuracionFiscal.findMany({
      where: {
        certificadoPem: { not: null },
        facturacionHabilitada: true,
        vencimientoCertificado: { lte: horizon }
      },
      select: { id: true, clubId: true, vencimientoCertificado: true }
    });

    for (const config of configs) {
      const expiresAt = new Date(config.vencimientoCertificado!);
      const diffMs = expiresAt.getTime() - now.getTime();
      const daysUntilExpiry = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      // Find the most urgent threshold that applies
      const threshold = THRESHOLDS_DAYS.find((t) => daysUntilExpiry <= t);
      if (threshold === undefined) continue;

      const priority = daysUntilExpiry < 0 ? 'CRITICAL' : daysUntilExpiry <= 7 ? 'HIGH' : daysUntilExpiry <= 30 ? 'MEDIUM' : 'LOW';
      const title = daysUntilExpiry < 0
        ? 'Certificado AFIP vencido'
        : `Certificado AFIP vence en ${daysUntilExpiry} días`;
      const detail = daysUntilExpiry < 0
        ? `El certificado venció el ${expiresAt.toLocaleDateString('es-AR')}. Renovarlo es urgente para continuar emitiendo comprobantes.`
        : `El certificado vence el ${expiresAt.toLocaleDateString('es-AR')}. Renovarlo antes del vencimiento evita interrupciones en la facturación.`;

      // Only create if there's no open incident of this type for this club
      const existing = await prisma.fiscalIncident.findFirst({
        where: {
          clubId: config.clubId,
          type: 'CERT_EXPIRY',
          status: 'OPEN'
        }
      });

      if (existing) continue;

      await prisma.fiscalIncident.create({
        data: {
          clubId: config.clubId,
          type: 'CERT_EXPIRY',
          title,
          detail,
          priority,
          status: 'OPEN'
        }
      });

      console.log(`[FiscalCertExpiryChecker] Incidencia creada — club ${config.clubId}, días restantes: ${daysUntilExpiry}`);
    }
  }
}
