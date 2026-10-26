import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { generateResumePdf } from '@/lib/pdf';
import { db } from '@/lib/db';

// POST /api/pdf  { text } -> application/pdf blob
// Renders plain-text resume content to a simple, clean PDF with pdf-lib.
// Per-profile download control: if the requesting user's profile has
// allow_resume_download = false, the client cannot download tailored-resume PDFs
// (view stays allowed; only the PDF endpoint + download button are gated).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Respect per-profile download lock for the requesting user's profile.
  if (session.user?.profile_id) {
    const profile = await db.getProfile(session.user.profile_id).catch(() => null);
    if (profile && profile.allow_resume_download === false) {
      return NextResponse.json({ error: 'Resume downloads disabled for this profile' }, { status: 403 });
    }
  }

  const { text } = await req.json().catch(() => ({}) as { text?: string });
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

  try {
    // Design-sync (Oct 26): the client download must use the SAME renderer as
    // the Resume Lab — renderResumePdf with the profile's design preset and
    // real contact line — not the old pdf-lib plain renderer.
    if (session.user?.profile_id) {
      const profile = await db.getProfile(session.user.profile_id).catch(() => null);
      if (profile) {
        const { renderResumePdf } = await import('@/lib/resume-pdf');
        const { resumeTextToData } = await import('@/lib/resume-text');
        const data = resumeTextToData(text);
        if (data && (data.experience.length || data.summary.length)) {
          const c = (profile.resume_data as any)?.contact || {};
          const realContact = [profile.email, c.phone, c.location].filter(Boolean).join(' · ');
          if (realContact) data.contact = realContact;
          const preset = ((profile.resume_design as string) || 'classic') as any;
          const buf = await renderResumePdf(data, preset);
          return new NextResponse(new Uint8Array(buf), {
            status: 200,
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Length': String(buf.length),
              'Content-Disposition': 'attachment; filename="tailored-resume.pdf"',
            },
          });
        }
      }
    }
    // Fallback for texts that don't parse (shouldn't happen for tailored resumes).
    const bytes = await generateResumePdf(text);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="tailored-resume.pdf"',
      },
    });
  } catch (e) {
    // Always surface a useful message — sometimes pdf-lib throws a non-Error.
    const message =
      e instanceof Error
        ? `${e.message}`
        : (typeof e === 'string' ? e : JSON.stringify(e));
    console.error('PDF generation failed:', e);
    return NextResponse.json(
      { error: `PDF generation failed: ${message}` },
      { status: 500 }
    );
  }
}