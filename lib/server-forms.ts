import { ClubError, check } from './server-club';

// Parses a multipart body of at most maxBytes. The limit is enforced while the
// body is read, so a request without a Content-Length header (or one that
// understates it) is refused before it is buffered past the limit.
export async function readForm(req: Request, maxBytes: number, tooLarge: string): Promise<FormData> {
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
  return new Response(body, { headers: { 'Content-Type': req.headers.get('content-type') ?? '' } }).formData();
}
