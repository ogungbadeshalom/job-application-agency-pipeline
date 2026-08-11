// Local-disk file storage.
//
// Files (uploaded base resumes, tailored-resume PDFs) live under a single
// root directory (STORAGE_DIR env, default ./data/uploads). DB rows store a
// relative path like "resumes/p1/original.pdf"; this module only ever touches
// paths inside the root (no path traversal).

import { mkdir, writeFile, readFile, rm, stat } from 'fs/promises';
import { normalize, resolve, dirname } from 'path';
import crypto from 'crypto';

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function rootDir(): string {
  const d = process.env.STORAGE_DIR || './data/uploads';
  return resolve(process.cwd(), d);
}

function safePath(rel: string): string {
  const base = resolve(rootDir());
  const full = resolve(base, normalize(rel));
  if (!full.startsWith(base)) throw new Error('Invalid storage path');
  return full;
}

// Write bytes to a relative path inside storage. Creates parent dirs.
export async function writeStorage(rel: string, data: Buffer | string): Promise<void> {
  const p = safePath(rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, data);
}

export async function readStorage(rel: string): Promise<Buffer> {
  return readFile(safePath(rel));
}

export async function removeStorage(rel: string): Promise<void> {
  const p = safePath(rel);
  if (await exists(p)) await rm(p, { force: true });
}

export async function statStorage(rel: string): Promise<{ size: number; mtime: Date } | null> {
  const p = safePath(rel);
  try {
    const s = await stat(p);
    return { size: s.size, mtime: s.mtime };
  } catch {
    return null;
  }
}

// Generate a unique relative path for a new file under a logical folder.
export function newStoragePath(folder: string, ext: string): string {
  const name = crypto.randomBytes(8).toString('hex');
  // Ensure the extension is separated by a dot so downstream code (file serving,
  // MIME detection) can read it: pass 'pdf' or 'resume.csv' or '.pdf'.
  const dot = ext.startsWith('.') ? '' : '.';
  return `${folder}/${name}${dot}${ext}`;
}