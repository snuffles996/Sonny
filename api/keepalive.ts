import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv(); // uses UPSTASH_REDIS_REST_URL / TOKEN env vars already in your Vercel project

export default async function handler(req, res) {
  // simple auth so randoms can't hit this
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const now = new Date().toISOString();
  await redis.set('keepalive:last-ping', now);
  const val = await redis.get('keepalive:last-ping');

  return res.status(200).json({ ok: true, pinged: val });
}
