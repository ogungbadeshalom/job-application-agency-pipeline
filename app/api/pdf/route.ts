import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { generateResumePdf } from '@/lib/pdf';

// POST /api/pdf  { text } -> application/pdf blob
// Renders plain-text resume content to a simple, clean PDF with pdf-lib.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { text } = await req.json().catch(() => ({}) as { text?: string });
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

  try {
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