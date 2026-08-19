import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { getSession } from '@/lib/auth';

// GET /api/backups/[name]  (admin) — stream a backup archive for download.
// The backup dir is produced by backup_job_bidder.sh. Filename is validated so
// a caller can't navigate outside the backup directory (path traversal guard).
const BACKUP_DIR = '/root/job-bidder-backups';

export async function GET(
  _req: Request,
  { params }: { params: { name: string } }
) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const name = decodeURIComponent(params.name);
  // Reject anything that isn't a plain .tar.gz filename (blocks ../, /, etc.).
  if (!/^[A-Za-z0-9._-]+\.tar\.gz$/.test(name)) {
    return NextResponse.json({ error: 'Bad filename' }, { status: 400 });
  }

  const filePath = path.join(BACKUP_DIR, name);
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const buf = await fs.readFile(filePath);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Content-Length': String(stat.size),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
  }
}