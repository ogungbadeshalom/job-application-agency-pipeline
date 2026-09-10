import { db } from '@/lib/db';

// Bearer-token auth for the laptop/residential agent. Reads the expected token
// from app_config (set via Admin Settings). Constant-time-ish compare.
export async function verifyAgentToken(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return false;
  const expected = await db.getScrapeAgentToken();
  if (!expected) return false;
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}