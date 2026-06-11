import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { sendAppError } from '../errors';
import { ArcaAuthService } from '../services/ArcaAuthService';

const authService = new ArcaAuthService();

type HealthStatus = 'ok' | 'degraded' | 'error';

export class FiscalHealthController {
  // GET /:slug/admin/fiscal-bandeja/health
  getHealth = async (req: Request, res: Response) => {
    try {
      const clubId = (req as any).clubId as number;

      const config = await prisma.configuracionFiscal.findFirst({
        where: { clubId },
        select: {
          id: true,
          facturacionHabilitada: true,
          usaHomologacion: true,
          certificadoPem: true,
          vencimientoCertificado: true,
          ultimoHealthcheckAt: true,
          ultimoHealthcheckOk: true
        }
      });

      if (!config) {
        return res.json({
          overall: 'degraded' as HealthStatus,
          checks: {
            config: { status: 'degraded', detail: 'Sin configuración fiscal.' },
            certificate: { status: 'unknown' },
            wsaa: { status: 'unknown' }
          },
          environment: null,
          checkedAt: new Date().toISOString()
        });
      }

      const checks: Record<string, { status: HealthStatus | 'unknown'; detail?: string; daysUntilExpiry?: number }> = {};

      // Config check
      checks.config = { status: 'ok' };

      // Certificate check
      const hasCert = !!config.certificadoPem;
      const certOk = hasCert && config.vencimientoCertificado;
      if (!certOk) {
        checks.certificate = { status: 'degraded', detail: hasCert ? 'Certificado sin fecha de vencimiento.' : 'Sin certificado cargado.' };
      } else {
        const expiresAt = new Date(config.vencimientoCertificado!);
        const now = new Date();
        const diffMs = expiresAt.getTime() - now.getTime();
        const daysUntilExpiry = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (daysUntilExpiry < 0) {
          checks.certificate = { status: 'error', detail: 'Certificado vencido.', daysUntilExpiry };
        } else if (daysUntilExpiry < 30) {
          checks.certificate = { status: 'degraded', detail: `Vence en ${daysUntilExpiry} días.`, daysUntilExpiry };
        } else {
          checks.certificate = { status: 'ok', daysUntilExpiry };
        }
      }

      // WSAA check — attempt to get/refresh a valid auth token
      try {
        await authService.getValidAuth(clubId);
        checks.wsaa = { status: 'ok' };
      } catch (err: any) {
        checks.wsaa = {
          status: 'degraded',
          detail: err?.message ?? 'No se pudo obtener token WSAA.'
        };
      }

      const overall: HealthStatus =
        Object.values(checks).some((c) => c.status === 'error')
          ? 'error'
          : Object.values(checks).some((c) => c.status === 'degraded')
          ? 'degraded'
          : 'ok';

      const checkedAt = new Date();
      await prisma.configuracionFiscal.update({
        where: { id: config.id },
        data: {
          ultimoHealthcheckAt: checkedAt,
          ultimoHealthcheckOk: overall === 'ok'
        }
      });

      return res.json({
        overall,
        checks,
        environment: config.usaHomologacion ? 'homologacion' : 'produccion',
        facturacionHabilitada: config.facturacionHabilitada,
        checkedAt: checkedAt.toISOString()
      });
    } catch (error) {
      return sendAppError(res, error, 'No se pudo realizar el health check fiscal');
    }
  };

  // POST /:slug/admin/fiscal-config/invalidate-auth
  invalidateAuth = async (req: Request, res: Response) => {
    try {
      const clubId = (req as any).clubId as number;
      await authService.invalidateAuth(clubId);
      return res.json({ ok: true, message: 'Cache de autenticación WSAA invalidado.' });
    } catch (error) {
      return sendAppError(res, error, 'No se pudo invalidar la autenticación');
    }
  };
}
