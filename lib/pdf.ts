// Plain-text -> PDF using pdf-lib. Server-only.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function generateResumePdf(text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  const fontSize = 10.5;
  const lineHeight = fontSize * 1.4;
  const pageWidth = 612; // US Letter
  const pageHeight = 792;
  const contentWidth = pageWidth - margin * 2;

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // Word-wrap to content width; break on explicit newlines too.
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine.trim() === '') {
      lines.push('');
      continue;
    }
    const words = rawLine.split(/\s+/);
    let current = '';
    for (const w of words) {
      const candidate = current ? `${current} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, fontSize) > contentWidth) {
        if (current) lines.push(current);
        current = w;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }

  for (const line of lines) {
    if (y < margin) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    // Heuristic: a line that is short, ALL CAPS, or a divider => bold heading.
    const isHeading =
      /[─=]{3,}/.test(line) ||
      (/^[A-Z0-9 /&-]+$/.test(line) && line.length <= 40 && line.length > 0);
    const useFont = isHeading ? bold : font;
    page.drawText(line, {
      x: margin,
      y,
      size: fontSize,
      font: useFont,
      color: rgb(0.12, 0.13, 0.14),
    });
    y -= lineHeight;
  }

  return pdf.save();
}
