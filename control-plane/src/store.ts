// Control state in Redis (docs/08-state-and-memory.md). Interface first so tests can use a Map.
import { createClient } from 'redis';

export interface Store {
  /** SET NX with expiry. True if acquired. */
  acquire(key: string, ttlSeconds: number): Promise<boolean>;
  release(key: string): Promise<void>;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Append to a list (queued commands for a stopped container). */
  push(key: string, value: string): Promise<void>;
  /** Read and clear a list atomically. */
  drain(key: string): Promise<string[]>;
}

export const keys = {
  spawnLock: (k: string) => `codecrafter:lock:spawn:${k}`,
  thread: (k: string) => `codecrafter:thread:${k}`,
  lastActive: (k: string) => `codecrafter:lastActive:${k}`,
  slackSeen: (ts: string) => `codecrafter:slack:seen:${ts}`,
  delivery: (id: string) => `codecrafter:delivery:${id}`,
  commands: (k: string) => `codecrafter:commands:${k}`,
  crashReported: (name: string, startedAt: number) => `codecrafter:crash:${name}:${startedAt}`,
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
    async push(key, value) {
      await client.rPush(key, value);
      await client.expire(key, 7 * 24 * 3600);
    },
    async drain(key) {
      const [items] = (await client.multi().lRange(key, 0, -1).del(key).exec()) as unknown as [string[], number];
      return items ?? [];
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
    this.lists.delete(key);
  }
  lists = new Map<string, string[]>();
  async push(key: string, value: string) {
    this.lists.set(key, [...(this.lists.get(key) ?? []), value]);
  }
  async drain(key: string) {
    const items = this.lists.get(key) ?? [];
    this.lists.delete(key);
    return items;
  }
}
