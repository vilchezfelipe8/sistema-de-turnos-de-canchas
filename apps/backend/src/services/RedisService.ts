import { createClient } from 'redis';

type AppRedisClient = ReturnType<typeof createClient>;

let client: AppRedisClient | null = null;
let connectPromise: Promise<AppRedisClient | null> | null = null;

const getRedisUrl = () => {
  const value = process.env.REDIS_URL?.trim();
  return value ? value : null;
};

export class RedisService {
  static enabled() {
    return Boolean(getRedisUrl());
  }

  static async getClient() {
    if (!this.enabled()) return null;
    if (client?.isOpen) return client;
    if (connectPromise) return connectPromise;

    connectPromise = (async () => {
      const url = getRedisUrl();
      if (!url) return null;

      const nextClient = createClient({ url });
      nextClient.on('error', (error) => {
        console.error('[REDIS] connection error', error);
      });

      await nextClient.connect();
      client = nextClient;
      return client;
    })();

    try {
      return await connectPromise;
    } finally {
      connectPromise = null;
    }
  }
}
