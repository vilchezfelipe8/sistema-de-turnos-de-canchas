import { randomUUID } from 'crypto';

const normalizePrefix = (prefix: string) =>
  String(prefix || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 4) || 'COD';

export const generateDisplayCode = (prefix: string) => {
  const safePrefix = normalizePrefix(prefix);
  const token = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${safePrefix}-${token}`;
};
