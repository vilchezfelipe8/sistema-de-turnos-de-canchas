import crypto from 'crypto';
import { RedisService } from '../services/RedisService';

type LockHandle = {
  key: string;
  token: string;
  release: () => Promise<void>;
};

export const acquireDistributedLock = async (key: string, ttlMs: number): Promise<LockHandle | null> => {
  const client = await RedisService.getClient();
  if (!client) return null;

  const token = crypto.randomUUID();
  const result = await client.set(key, token, {
    PX: ttlMs,
    NX: true
  });

  if (result !== 'OK') {
    return null;
  }

  return {
    key,
    token,
    release: async () => {
      const current = await client.get(key);
      if (current === token) {
        await client.del(key);
      }
    }
  };
};
