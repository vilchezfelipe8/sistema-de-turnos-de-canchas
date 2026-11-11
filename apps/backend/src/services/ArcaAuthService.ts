import forge from 'node-forge';
import { prisma } from '../prisma';
import { RedisService } from './RedisService';
import { ArcaSoapClient } from './ArcaSoapClient';
import { acquireDistributedLock } from '../utils/distributedLock';
import { decryptIntegrationSecret } from '../utils/integrationSecrets';
import { arcaConfig, type ArcaEnvironment } from '../utils/arcaConfig';

// §7 — 15 min margin: renew when less than this remains before expiry
const AUTH_REFRESH_MARGIN_MS = 15 * 60 * 1000;
// §7 — max time to hold refresh lock; a WSAA call should be well under this
const REFRESH_LOCK_TTL_MS = 30_000;
// How long to wait if another worker is holding the refresh lock
const LOCK_WAIT_MS = 1_500;
// Clock skew allowed when building the TRA (5 min before/after)
const TRA_TIME_SKEW_MS = 5 * 60 * 1000;

const redisKey = (clubId: number) => `arca:wsaa:club:${clubId}:service:wsfe`;
const lockKey = (clubId: number) => `arca:wsaa:club:${clubId}:service:wsfe:refresh-lock`;

type CachedTicket = { token: string; sign: string; expirationTime: string };

const isStillValid = (expirationTime: string): boolean => {
  const expiresAt = Date.parse(expirationTime);
  return Number.isFinite(expiresAt) && expiresAt - Date.now() > AUTH_REFRESH_MARGIN_MS;
};

// Build the Ticket de Requerimiento de Acceso (TRA) XML for WSAA
const buildTraXml = (service: string): string => {
  const now = Date.now();
  const generationTime = new Date(now - TRA_TIME_SKEW_MS).toISOString();
  const expirationTime = new Date(now + TRA_TIME_SKEW_MS).toISOString();
  const uniqueId = Math.floor(now / 1000);

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header>` +
    `<uniqueId>${uniqueId}</uniqueId>` +
    `<generationTime>${generationTime}</generationTime>` +
    `<expirationTime>${expirationTime}</expirationTime>` +
    `</header>` +
    `<service>${service}</service>` +
    `</loginTicketRequest>`
  );
};

// Sign TRA XML as CMS/PKCS#7 detached, base64-encoded — required by WSAA
const signCms = (traXml: string, certPem: string, keyPem: string): string => {
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);
  const p7 = forge.pkcs7.createSignedData();

  p7.content = forge.util.createBuffer(traXml, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() }
    ]
  });

  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(der, 'binary').toString('base64');
};

export type ArcaAuth = {
  token: string;
  sign: string;
  cuit: string;
  expirationTime: string;
};

export class ArcaAuthService {
  private readonly soapClient = new ArcaSoapClient();

  async getValidAuth(clubId: number): Promise<ArcaAuth> {
    const config = await this.loadConfig(clubId);
    const cuit = config.cuit!;
    const environment: ArcaEnvironment = config.usaHomologacion ? 'TEST' : 'PRODUCTION';

    // 1. Redis cache (primary)
    const cached = await this.getFromRedis(clubId);
    if (cached && isStillValid(cached.expirationTime)) {
      return { ...cached, cuit };
    }

    // 2. DB fallback — repopulates Redis if Redis was down
    const dbTicket = await prisma.fiscalAuthTicket.findUnique({
      where: { clubId_service: { clubId, service: 'wsfe' } }
    });
    if (dbTicket && isStillValid(dbTicket.expirationTime.toISOString())) {
      const entry: CachedTicket = {
        token: dbTicket.token,
        sign: dbTicket.sign,
        expirationTime: dbTicket.expirationTime.toISOString()
      };
      await this.setInRedis(clubId, entry);
      return { ...entry, cuit };
    }

    // 3. Refresh via WSAA, protected by distributed lock
    return this.doRefresh(clubId, cuit, environment, config.certificadoPem, config.clavePrivadaPem);
  }

  async refreshAuth(clubId: number): Promise<ArcaAuth> {
    const config = await this.loadConfig(clubId);
    const environment: ArcaEnvironment = config.usaHomologacion ? 'TEST' : 'PRODUCTION';
    return this.doRefresh(clubId, config.cuit!, environment, config.certificadoPem, config.clavePrivadaPem);
  }

  async invalidateAuth(clubId: number): Promise<void> {
    const redis = await RedisService.getClient();
    if (redis) await redis.del(redisKey(clubId));
  }

  // --- private ---

  private async loadConfig(clubId: number) {
    const config = await prisma.configuracionFiscal.findUnique({ where: { clubId } });
    if (!config) {
      throw new Error(`ConfiguracionFiscal no encontrada para club ${clubId}`);
    }
    if (!config.facturacionHabilitada || config.proveedorFiscal !== 'ARCA') {
      throw new Error(`Facturacion ARCA no habilitada para club ${clubId}`);
    }
    if (!config.cuit) {
      throw new Error(`CUIT faltante en ConfiguracionFiscal del club ${clubId}`);
    }
    return config;
  }

  private async doRefresh(
    clubId: number,
    cuit: string,
    environment: ArcaEnvironment,
    certificateEnc: string | null,
    privateKeyEnc: string | null
  ): Promise<ArcaAuth> {
    const lock = await acquireDistributedLock(lockKey(clubId), REFRESH_LOCK_TTL_MS);

    if (!lock) {
      // Another worker is refreshing — wait briefly then retry cache
      await new Promise<void>((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
      const retried = await this.getFromRedis(clubId);
      if (retried && isStillValid(retried.expirationTime)) {
        return { ...retried, cuit };
      }
      // Still stale — proceed without lock (lose thundering-herd protection but maintain correctness)
    }

    try {
      if (!certificateEnc || !privateKeyEnc) {
        throw new Error('Certificado o clave privada faltante');
      }

      const certPem = decryptIntegrationSecret(certificateEnc);
      const keyPem = decryptIntegrationSecret(privateKeyEnc);
      if (!certPem || !keyPem) {
        throw new Error('No se pudo descifrar certificado o clave');
      }

      const traXml = buildTraXml(arcaConfig.wsaaService);
      const cms = signCms(traXml, certPem, keyPem);
      const ticket = await this.soapClient.loginCms(environment, cms);

      if (!ticket.token || !ticket.sign) {
        throw new Error('WSAA no devolvio token o sign');
      }

      const entry: CachedTicket = {
        token: ticket.token,
        sign: ticket.sign,
        expirationTime: ticket.expirationTime
      };

      // Fire-and-forget both persistence paths; failure is non-fatal
      await Promise.allSettled([
        this.setInRedis(clubId, entry),
        this.persistToDb(clubId, entry)
      ]);

      return { ...entry, cuit };
    } finally {
      await lock?.release();
    }
  }

  private async getFromRedis(clubId: number): Promise<CachedTicket | null> {
    const redis = await RedisService.getClient();
    if (!redis) return null;
    try {
      const raw = await redis.get(redisKey(clubId));
      if (!raw) return null;
      return JSON.parse(raw) as CachedTicket;
    } catch {
      return null;
    }
  }

  private async setInRedis(clubId: number, entry: CachedTicket): Promise<void> {
    const redis = await RedisService.getClient();
    if (!redis) return;
    try {
      const expiresAt = Date.parse(entry.expirationTime);
      // Expire the Redis key at the same time we'd need to refresh (expiry - margin)
      const ttlMs = Number.isFinite(expiresAt)
        ? Math.max(expiresAt - Date.now() - AUTH_REFRESH_MARGIN_MS, 60_000)
        : 5 * 60 * 1000;
      await redis.set(redisKey(clubId), JSON.stringify(entry), { PX: ttlMs });
    } catch {
      // non-fatal
    }
  }

  private async persistToDb(clubId: number, entry: CachedTicket): Promise<void> {
    try {
      await prisma.fiscalAuthTicket.upsert({
        where: { clubId_service: { clubId, service: 'wsfe' } },
        create: {
          clubId,
          service: 'wsfe',
          token: entry.token,
          sign: entry.sign,
          generationTime: new Date(),
          expirationTime: new Date(entry.expirationTime)
        },
        update: {
          token: entry.token,
          sign: entry.sign,
          generationTime: new Date(),
          expirationTime: new Date(entry.expirationTime)
        }
      });
    } catch {
      // non-fatal — Redis is the primary cache; DB is just the fallback
    }
  }
}
