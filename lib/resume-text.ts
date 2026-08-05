// Extract plain text from an uploaded resume file (PDF or DOCX).
// Server-only. Used by the resume upload flow.
//
// pdf-parse v2 API: new PDFParse({ data: Uint8Array }).getText() -> { text }

type PDFParseType = {
  new (options: { data: Uint8Array }): { getText(): Promise<{ text: string }> };
};

export async function extractResumeText(
  buffer: Buffer,
  mimetype: string
): Promise<string> {
  if (mimetype === 'application/pdf') {
    try {
      const mod = (await import('pdf-parse')) as unknown as { PDFParse: PDFParseType };
      const parser = new mod.PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      return (result.text || '').trim();
    } catch (e) {
      throw new Error(`PDF parse failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  const isDocx =
    mimetype ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (isDocx) {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ buffer });
    return (result.value || '').trim();
  }

  // Plain text fallback.
  return buffer.toString('utf-8').trim();
}
