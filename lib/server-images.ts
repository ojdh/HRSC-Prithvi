import { check } from './server-club';
import { PHOTO_LIMIT_BYTES } from './photo-compression';

export type UploadedImage = { bytes: Uint8Array; type: string };

// Validates an uploaded photo before anything is stored: present, at most 2 MB,
// and a real JPG, PNG or WebP by its file signature rather than its stated type.
export async function readImage(file: FormDataEntryValue | null): Promise<UploadedImage> {
  check(file instanceof File && file.size > 0 && file.size <= PHOTO_LIMIT_BYTES, 'Choose a JPG, PNG or WebP photo up to 2 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer()), type = imageType(bytes);
  check(type, 'Only JPG, PNG and WebP images are supported.');
  return { bytes, type };
}

function imageType(bytes: Uint8Array) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'image/png';
  const text = new TextDecoder();
  if (text.decode(bytes.slice(0, 4)) === 'RIFF' && text.decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
