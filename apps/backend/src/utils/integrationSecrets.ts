import crypto from 'crypto';

const isProduction = process.env.NODE_ENV === 'production';

const rawKey =
  String(process.env.INTEGRATION_SECRETS_KEY || '').trim() ||
  (isProduction ? '' : 'dev-integration-secrets-key');

if (isProduction && (!rawKey || rawKey === 'dev-integration-secrets-key')) {
  throw new Error('Invalid integration secrets config: configure INTEGRATION_SECRETS_KEY in production.');
}

const deriveKey = (value: string) => crypto.createHash('sha256').update(value).digest();

const encryptionKey = deriveKey(rawKey);

export const encryptIntegrationSecret = (plainText: string): string => {
  const text = String(plainText || '');
  if (!text) return '';

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
};

export const decryptIntegrationSecret = (payload: string | null | undefined): string | null => {
  const raw = String(payload || '').trim();
  if (!raw) return null;

  const [ivPart, tagPart, encryptedPart] = raw.split('.');
  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error('Invalid encrypted integration secret payload.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey,
    Buffer.from(ivPart, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64url')),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
};
