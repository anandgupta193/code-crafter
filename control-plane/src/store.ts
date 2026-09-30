// Control state in Redis (docs/08-state-and-memory.md). Interface first so tests can use a Map.
import { createClient } from 'redis';

export interface Store {
  /** SET NX with expiry. True if acquired. */
  acquire(key: string, ttlSeconds: number): Promise<boolean>;
  release(key: string): Promise<void>;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}

export const keys = {
  spawnLock: (k: string) => `codecrafter:lock:spawn:${k}`,
  thread: (k: string) => `codecrafter:thread:${k}`,
  lastActive: (k: string) => `codecrafter:lastActive:${k}`,
  slackSeen: (ts: string) => `codecrafter:slack:seen:${ts}`,
  delivery: (id: string) => `codecrafter:delivery:${id}`,
};

export async function connectRedis(url: string): Promise<Store> {
  const client = createClient({ url });
  client.on('error', (err) => process.stderr.write(`redis: ${String(err)}\n`));
  await client.connect();
  return {
    async acquire(key, ttl) {
      return (await client.set(key, String(Date.now()), { NX: true, EX: ttl })) === 'OK';
    },
    async release(key) {
      await client.del(key);
    },
    async get(key) {
      return (await client.get(key)) ?? undefined;
    },
    async set(key, value, ttl) {
      await client.set(key, value, ttl ? { EX: ttl } : undefined);
    },
    async del(key) {
      await client.del(key);
    },
  };
}

/** In-memory Store for tests. */
export class MemoryStore implements Store {
  data = new Map<string, string>();
  async acquire(key: string, _ttlSeconds?: number) {
    if (this.data.has(key)) return false;
    this.data.set(key, '1');
    return true;
  }
  async release(key: string) {
    this.data.delete(key);
  }
  async get(key: string) {
    return this.data.get(key);
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
  async del(key: string) {
    this.data.delete(key);
  }
}
