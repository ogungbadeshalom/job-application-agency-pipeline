import { db } from '@/lib/db';

// Bearer-token auth for the proof-capture Chrome extension. The extension runs
// on EXTERNAL job sites (greenhouse.com etc.) but must call pitchr.com.ng, so
// cookie/session auth won't work — each worker has a long random `proof_token`
// they paste into the extension once. Resolves the token to the worker's user id.
export async function getWorkerIdFromProofToken(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  return db.resolveProofToken(token);
}