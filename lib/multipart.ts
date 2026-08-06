// Minimal, dependency-free multipart/form-data parser.
//
// Why: on some Node/undici + Next.js combinations, `request.formData()` hangs
// indefinitely on large uploads in `next start`. Reading the raw body bytes and
// parsing the boundary ourselves is robust and portable. Only handles the shape
// our app sends (a `file` part + a couple of text fields).
//
// Usage:
//   const raw = Buffer.from(await req.arrayBuffer());
//   const boundary = req.headers.get('content-type')?.match(/boundary=(.*)$/)?.[1];
//   if (!boundary) return error;
//   const parts = parseMultipart(raw, boundary);
//   parts.fields.profile_id; parts.file;  // { name, filename, type, buffer }

export interface MultipartField {
  name: string;
  value: string;
}
export interface MultipartFile {
  name: string;
  filename: string;
  type: string;
  buffer: Buffer;
}
export interface MultipartResult {
  fields: Record<string, string>;
  file?: MultipartFile;
  files: MultipartFile[];
}

export function parseMultipart(body: Buffer, boundary: string): MultipartResult {
  const result: MultipartResult = { fields: {}, files: [] };
  const delim = Buffer.from(`--${boundary}`);
  // Split on the boundary delimiter (CRLF--boundary or --boundary).
  // Start searching after the first delimiter.
  let pos = body.indexOf(delim);
  if (pos === -1) {
    // no boundary found — maybe just the parts without leading CRLF
    pos = -1;
  }

  const parts: Buffer[] = [];
  while (pos !== -1) {
    const next = body.indexOf(delim, pos + delim.length);
    const chunkStart = pos + delim.length;
    const chunkEnd = (next === -1 ? body.length : next);
    let chunk = body.subarray(chunkStart, chunkEnd);
    // Strip leading CRLF (separator before content) and the closing "--".
    if (chunk.length >= 2 && chunk[0] === 0x0d && chunk[1] === 0x0a) chunk = chunk.subarray(2);
    else if (chunk.length >= 2 && chunk[0] === 0x0d && chunk[1] === 0x0d) {}
    parts.push(chunk);
    if (next === -1) break;
    pos = next;
  }

  for (const part of parts) {
    // A closing "--" marker on its own line means the final part.
    const marker = part.indexOf(Buffer.from('\r\n\r\n'));
    const headerEnd = marker === -1 ? part.indexOf(Buffer.from('\n\n')) : marker;
    if (headerEnd === -1) continue;

    const headerBuf = part.subarray(0, headerEnd).toString('utf-8');
    const bodyBuf =
      marker === -1
        ? part.subarray(headerEnd + 2)
        : part.subarray(headerEnd + 4);

    const contentDisposition = headerBuf.match(/content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    if (!contentDisposition) continue;
    const name = contentDisposition[1];
    const filename = contentDisposition[2];
    const contentTypeMatch = headerBuf.match(/content-type:\s*([^\r\n]+)/i);
    const type = contentTypeMatch ? contentTypeMatch[1].trim() : '';

    if (filename) {
      const f: MultipartFile = { name, filename, type, buffer: bodyBuf };
      result.files.push(f);
      result.file = f;
    } else {
      result.fields[name] = bodyBuf.toString('utf-8').replace(/\r?\n$/, '');
    }
  }

  return result;
}