import { createHash, randomBytes } from 'crypto';

const DEFAULT_MAGIC_LINK_TTL_MINUTES = 15;

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export const normalizeEmail = (email: string): string => String(email || '').trim().toLowerCase();

export const generateMagicLinkToken = (): string => {
  // 32 bytes entropy -> 64 hex chars.
  return randomBytes(32).toString('hex');
};

export const hashMagicLinkToken = (token: string): string => {
  return createHash('sha256').update(token).digest('hex');
};

export const getMagicLinkTtlMinutes = (): number => {
  return parsePositiveInt(process.env.MAGIC_LINK_TTL_MINUTES, DEFAULT_MAGIC_LINK_TTL_MINUTES);
};

export const getMagicLinkExpiresAt = (): Date => {
  const ttlMinutes = getMagicLinkTtlMinutes();
  return new Date(Date.now() + ttlMinutes * 60_000);
};
