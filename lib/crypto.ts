// AES-256-GCM encryption for app_config secrets (API keys).
//
// Key derivation: PBKDF2 of AUTH_SECRET with a static salt. Single-tenant
// self-hosted tool, so no KMS — the server is the trust boundary.
//
// Format: { ciphertext: base64(ciphertext || authTag), nonce: base64(IV) }.

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';

const SALT = 'job-bidder-app-config';
const ITERATIONS = 100_000;

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is not set — required to encrypt app secrets.');
  }
  return pbkdf2Sync(secret, SALT, ITERATIONS, 32, 'sha256');
}

export function encryptSecret(plaintext: string): { ciphertext: string; nonce: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Concatenate ciphertext + authTag so a single base64 blob round-trips cleanly.
  const blob = Buffer.concat([enc, tag]);
  return { ciphertext: blob.toString('base64'), nonce: iv.toString('base64') };
}

export function decryptSecret({ ciphertext, nonce }: { ciphertext: string; nonce: string }): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const tag = buf.subarray(buf.length - 16);
  const enc = buf.subarray(0, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf-8');
}