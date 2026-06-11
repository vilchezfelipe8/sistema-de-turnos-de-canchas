import { randomBytes } from 'crypto';
import { RedisService } from './RedisService';

const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const OAUTH_STATE_PREFIX = 'oauth_state';

export type OAuthStateProvider = 'apple' | 'facebook';
export type OAuthStateIntent = 'login' | 'connect';

type OAuthStatePayload = {
  provider: OAuthStateProvider;
  returnTo: string;
  intent: OAuthStateIntent;
};

type MemoryStateRecord = {
  payload: OAuthStatePayload;
  expiresAt: number;
};

const memoryStateStore = new Map<string, MemoryStateRecord>();

const cleanupMemoryStore = (now = Date.now()) => {
  for (const [key, value] of memoryStateStore.entries()) {
    if (value.expiresAt <= now) {
      memoryStateStore.delete(key);
    }
  }
};

export class OAuthStateStore {
  getStateTtlMs() {
    return OAUTH_STATE_TTL_SECONDS * 1000;
  }

  normalizeReturnTo(value: string | null | undefined) {
    const raw = String(value || '').trim();
    if (!raw.startsWith('/')) return '/';
    if (raw.startsWith('//')) return '/';
    return raw;
  }

  async createState(provider: OAuthStateProvider, returnTo?: string | null, intent: OAuthStateIntent = 'login') {
    const state = randomBytes(24).toString('hex');
    const payload: OAuthStatePayload = {
      provider,
      returnTo: this.normalizeReturnTo(returnTo),
      intent
    };
    const ttlSeconds = Math.max(1, Math.floor(this.getStateTtlMs() / 1000));
    const redisClient = await RedisService.getClient();

    if (redisClient) {
      await redisClient.set(this.buildRedisKey(state), JSON.stringify(payload), {
        EX: ttlSeconds
      });
      return state;
    }

    cleanupMemoryStore();
    memoryStateStore.set(state, {
      payload,
      expiresAt: Date.now() + this.getStateTtlMs()
    });
    return state;
  }

  async consumeState(provider: OAuthStateProvider, state: string): Promise<{ returnTo: string; intent: OAuthStateIntent }> {
    const safeState = String(state || '').trim();
    if (!safeState) {
      throw new Error('OAUTH_STATE_INVALID');
    }

    const redisClient = await RedisService.getClient();
    const payload = redisClient
      ? await this.consumeRedisState(safeState, redisClient)
      : this.consumeMemoryState(safeState);

    if (!payload || payload.provider !== provider) {
      throw new Error('OAUTH_STATE_INVALID');
    }

    return {
      returnTo: this.normalizeReturnTo(payload.returnTo),
      intent: payload.intent === 'connect' ? 'connect' : 'login'
    };
  }

  async inspectState(provider: OAuthStateProvider, state: string): Promise<{ returnTo: string; intent: OAuthStateIntent }> {
    const safeState = String(state || '').trim();
    if (!safeState) {
      throw new Error('OAUTH_STATE_INVALID');
    }

    const redisClient = await RedisService.getClient();
    const payload = redisClient
      ? await this.inspectRedisState(safeState, redisClient)
      : this.inspectMemoryState(safeState);

    if (!payload || payload.provider !== provider) {
      throw new Error('OAUTH_STATE_INVALID');
    }

    return {
      returnTo: this.normalizeReturnTo(payload.returnTo),
      intent: payload.intent === 'connect' ? 'connect' : 'login'
    };
  }

  private buildRedisKey(state: string) {
    return `${OAUTH_STATE_PREFIX}:${state}`;
  }

  private async consumeRedisState(state: string, redisClient: NonNullable<Awaited<ReturnType<typeof RedisService.getClient>>>) {
    const key = this.buildRedisKey(state);
    const raw = await redisClient.get(key);
    await redisClient.del(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OAuthStatePayload;
    } catch {
      return null;
    }
  }

  private async inspectRedisState(state: string, redisClient: NonNullable<Awaited<ReturnType<typeof RedisService.getClient>>>) {
    const raw = await redisClient.get(this.buildRedisKey(state));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OAuthStatePayload;
    } catch {
      return null;
    }
  }

  private consumeMemoryState(state: string) {
    cleanupMemoryStore();
    const record = memoryStateStore.get(state);
    memoryStateStore.delete(state);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      return null;
    }
    return record.payload;
  }

  private inspectMemoryState(state: string) {
    cleanupMemoryStore();
    const record = memoryStateStore.get(state);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      memoryStateStore.delete(state);
      return null;
    }
    return record.payload;
  }
}
