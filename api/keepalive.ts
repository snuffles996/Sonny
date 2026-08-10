import type { NextApiRequest, NextApiResponse } from 'next';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const now = new Date().toISOString();
  await redis.set('keepalive:last-ping', now);
  const val = await redis.get('keepalive:last-ping');

  return res.status(200).json({ ok: true, pinged: val });
}
