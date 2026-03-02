import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const publisher = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
export const subscriber = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

let connected = false;

export async function connectRedis(): Promise<boolean> {
  try {
    await publisher.connect();
    await subscriber.connect();
    connected = true;
    console.log('Redis connected');
    return true;
  } catch (err) {
    console.warn('Redis unavailable, SSE disabled:', (err as Error).message);
    return false;
  }
}

export function isRedisConnected() { return connected; }

export async function publishEvent(channel: string, data: Record<string, any>) {
  if (!connected) return;
  try {
    await publisher.publish(channel, JSON.stringify(data));
  } catch {}
}

export async function setLiveKey(key: string, value: string, ttl?: number) {
  if (!connected) return;
  try {
    if (ttl) await publisher.setex(key, ttl, value);
    else await publisher.set(key, value);
  } catch {}
}
