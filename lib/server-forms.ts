import { ClubError, check } from './server-club';

// Parses a multipart body of at most maxBytes.
export async function readForm(req: Request, maxBytes: number, tooLarge: string): Promise<FormData> {
  const body = await readBody(req, maxBytes, tooLarge);
  return new Response(body, { headers: { 'Content-Type': req.headers.get('content-type') ?? '' } }).formData();
}

// Parses a JSON object body of at most maxBytes.
export async function readJson(req: Request, maxBytes: number, tooLarge: string): Promise<Record<string, unknown>> {
  const text = new TextDecoder().decode(await readBody(req, maxBytes, tooLarge));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new ClubError('The request could not be read. Refresh and try again.');
    throw error;
  }
  check(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'The request could not be read. Refresh and try again.');
  return parsed as Record<string, unknown>;
}

// The limit is enforced while the body is read, so a request without a Content-Length
// header (or one that understates it) is refused before it is buffered past the limit.
async function readBody(req: Request, maxBytes: number, tooLarge: string): Promise<Uint8Array<ArrayBuffer>> {
  check((Number(req.headers.get('content-length')) || 0) <= maxBytes, tooLarge, 413);
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ClubError(tooLarge, 413);
      }
      chunks.push(value);
    }
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}
