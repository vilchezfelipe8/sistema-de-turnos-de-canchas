type PaymentFingerprintInput = {
  accountId: string;
  amount: number;
  method: string;
  channel?: string;
  collectorAccountLabel?: string;
  externalReference?: string;
  source?: string;
  cashShiftId?: string;
  allocations?: Array<{
    accountItemId: string;
    amount: number;
  }>;
};

const TTL_MS = 15_000;
const fingerprintCache = new Map<string, { key: string; expiresAt: number }>();

const buildFingerprint = (input: PaymentFingerprintInput) => {
  const normalizedAllocations = Array.isArray(input.allocations)
    ? input.allocations
        .map((allocation) => ({
          accountItemId: String(allocation.accountItemId || ''),
          amount: Number(allocation.amount || 0).toFixed(2)
        }))
        .filter((allocation) => allocation.accountItemId && Number(allocation.amount) > 0)
        .sort((a, b) => a.accountItemId.localeCompare(b.accountItemId))
    : [];

  return JSON.stringify({
    accountId: input.accountId,
    amount: Number(input.amount || 0).toFixed(2),
    method: input.method,
    channel: input.channel || 'AUTO',
    collectorAccountLabel: String(input.collectorAccountLabel || '').trim() || null,
    externalReference: String(input.externalReference || '').trim() || null,
    source: input.source || 'POS',
    cashShiftId: input.cashShiftId || null,
    allocations: normalizedAllocations
  });
};

const generateRandomKey = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `payment_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

export const getPaymentIdempotencyKey = (input: PaymentFingerprintInput) => {
  const now = Date.now();

  fingerprintCache.forEach((entry, fingerprint) => {
    if (entry.expiresAt <= now) {
      fingerprintCache.delete(fingerprint);
    }
  });

  const fingerprint = buildFingerprint(input);
  const cached = fingerprintCache.get(fingerprint);
  if (cached && cached.expiresAt > now) {
    return cached.key;
  }

  const key = generateRandomKey();
  fingerprintCache.set(fingerprint, {
    key,
    expiresAt: now + TTL_MS
  });
  return key;
};
