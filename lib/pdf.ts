// Plain-text -> PDF using pdf-lib. Server-only.
//
// pdflib's built-in (StandardFonts) only support WinAnsi. If the AI-tailored
// resume text contains characters outside WinAnsi (curly quotes, em dashes,
// bullets, ellipses, etc.), drawing those glyphs throws a non-Error. We
// sanitize the input first by:
//   - mapping common Unicode punctuation to ASCII equivalents
//   - stripping any remaining codepoints outside WinAnsi (× PDF-safe)
//
// That makes pdf generation robust against arbitrary AI output, and also
// avoids crashing the route handler on an unhandled glyph error.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Map common Unicode characters our resume input tends to contain to ASCII
// equivalents that the StandardFonts can encode.
const PUNCT_FIX: Record<string, string> = {
  '—': '--',  // em dash —
  '–': '-',   // en dash –
  '‘': "'",   // left single quote '
  '’': "'",   // right single quote '
  '“': '"',   // left double quote "
  '”': '"',   // right double quote "
  '…': '...', // ellipsis …
  '•': '*',   // bullet •
  ' ': ' ',   // non-breaking space
  '‐': '-',   // hyphen
  '‑': '-',   // non-breaking hyphen
  '‒': '-',   // figure dash
  '―': '-',   // horizontal bar
  '●': '*',   // black circle
  '■': '*',   // black square
  '°': 'deg', // degree °
  '±': '+/-', // plus-minus ±
  '×': 'x',   // multiplication ×
  '→': '->',  // arrow →
  '​': '',    // zero-width space
};

// WinAnsi supports only codepoints 0x00–0xFF (with a few gaps in the
// 0x80–0x9F range). Drop anything outside 0x00–0xFF or in the gap.
function sanitizeForWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    if (PUNCT_FIX[ch] !== undefined) {
      out += PUNCT_FIX[ch];
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0xff) {
      out += ch; // standard ASCII or any WinAnsi-supported Latin-1 byte
    } else {
      // Replace unknown chars with '?' so the line still renders. Better
      // than throwing and 500'ing the user.
      out += '?';
    }
  }
  return out;
}

export async function generateResumePdf(text: string): Promise<Uint8Array> {
  const safe = sanitizeForWinAnsi(text);
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
  for (const rawLine of safe.split('\n')) {
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
    const isHeading =
      /[=]{3,}/.test(line) ||
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