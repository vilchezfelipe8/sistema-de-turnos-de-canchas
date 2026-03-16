import crypto from 'crypto';

const ENCRYPTION_PREFIX = 'enc:v1';

type EncryptedJsonEnvelope = {
  __enc_v1: string;
};

const parseKey = (raw: string) => {
  const value = raw.trim();
  if (!value) throw new Error('PAYMENT_SECRETS_ENCRYPTION_KEY vacia');

  if (value.startsWith('hex:')) {
    const decoded = Buffer.from(value.slice(4), 'hex');
    if (decoded.length !== 32) throw new Error('PAYMENT_SECRETS_ENCRYPTION_KEY debe tener 32 bytes (hex)');
    return decoded;
  }

  if (value.startsWith('base64:')) {
    const decoded = Buffer.from(value.slice(7), 'base64');
    if (decoded.length !== 32) throw new Error('PAYMENT_SECRETS_ENCRYPTION_KEY debe tener 32 bytes (base64)');
    return decoded;
  }

  // Fallback auto-detect: 64 hex chars or base64
  if (/^[a-fA-F0-9]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }

  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 32) {
    return decoded;
  }

  throw new Error(
    'Formato invalido para PAYMENT_SECRETS_ENCRYPTION_KEY. Usa hex:<64hex> o base64:<44chars>'
  );
};

const getEncryptionKey = () => {
  const raw = process.env.PAYMENT_SECRETS_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) {
    throw new Error('Falta PAYMENT_SECRETS_ENCRYPTION_KEY para cifrar/descifrar secretos de pago');
  }
  return parseKey(raw);
};

const isEncryptedText = (value: unknown): value is string => {
  return typeof value === 'string' && value.startsWith(`${ENCRYPTION_PREFIX}:`);
};

export const encryptTextSecret = (plaintext: string) => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
};

export const decryptTextSecret = (ciphertext: string) => {
  const key = getEncryptionKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== ENCRYPTION_PREFIX) {
    throw new Error('Formato de secreto cifrado invalido');
  }

  const iv = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  const encrypted = Buffer.from(parts[4], 'base64url');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
};

export const encryptJsonSecret = (payload: Record<string, unknown>): EncryptedJsonEnvelope => {
  const raw = JSON.stringify(payload || {});
  return { __enc_v1: encryptTextSecret(raw) };
};

export const decryptJsonSecret = (value: unknown): Record<string, unknown> => {
  // Backward compatibility: payload plano legacy
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const maybeEnvelope = value as Record<string, unknown>;
    if (typeof maybeEnvelope.__enc_v1 === 'string') {
      const decrypted = decryptTextSecret(maybeEnvelope.__enc_v1);
      const parsed = JSON.parse(decrypted);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Payload de credenciales descifrado invalido');
      }
      return parsed as Record<string, unknown>;
    }
    return maybeEnvelope;
  }

  if (typeof value === 'string') {
    if (isEncryptedText(value)) {
      const decrypted = decryptTextSecret(value);
      const parsed = JSON.parse(decrypted);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Payload de credenciales descifrado invalido');
      }
      return parsed as Record<string, unknown>;
    }

    // Legacy stringified JSON
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // plain legacy text, no-op below
    }
  }

  return {};
};

export const decryptMaybeEncryptedText = (value: string | null | undefined) => {
  if (!value) return null;
  if (!isEncryptedText(value)) return value;
  return decryptTextSecret(value);
};

export const encryptMaybeText = (value: string | null | undefined) => {
  if (!value || !value.trim()) return null;
  return encryptTextSecret(value.trim());
};
