import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getSession } from '@/lib/auth';

// GET /api/backups  (admin) — list available backup archives (name + size + time)
// so the admin UI can offer a Download button per backup.
const BACKUP_DIR = '/root/job-bidder-backups';

export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const names = await fs.readdir(BACKUP_DIR);
    const items = [];
    for (const name of names) {
      if (!name.endsWith('.tar.gz')) continue;
      try {
        const st = await fs.stat(path.join(BACKUP_DIR, name));
        items.push({
          name,
          size: st.size,
          mtime: st.mtime.toISOString(),
          url: `/api/backups/${encodeURIComponent(name)}`,
        });
      } catch {
        /* skip unreadable */
      }
    }
    items.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));
    return NextResponse.json({ backups: items });
  } catch {
    return NextResponse.json({ backups: [] });
  }
}