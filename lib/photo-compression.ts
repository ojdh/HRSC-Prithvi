export const PHOTO_LIMIT_BYTES = 2 * 1024 * 1024;

const JPEG_QUALITY = 0.85;
// Portraits never need more than this, so very large camera photos start smaller.
const MAX_EDGE_PX = 2560;
const MIN_EDGE_PX = 320;
// Cropped portraits are square and shown at avatar sizes, so this is ample.
const CROP_EDGE_PX = 1024;
const MAX_ENCODES = 6;
// Aim slightly under the limit so the next encode is unlikely to overshoot.
const SIZE_MARGIN = 0.95;

export type CropArea = { x: number; y: number; width: number; height: number };

export class PhotoTooLargeError extends Error {
  constructor() {
    super('This photo could not be reduced below 2 MB. Choose a smaller photo.');
  }
}

export class PhotoUnreadableError extends Error {
  constructor() {
    super('This photo could not be read. Choose a JPG, PNG or WebP image.');
  }
}

// Photos over the limit are re-encoded as JPEG in the browser, scaled down
// until they fit. The server still enforces the limit independently.
export async function compressPhoto(file: File): Promise<File> {
  if (file.size <= PHOTO_LIMIT_BYTES) return file;

  const bitmap = await decode(file);
  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const blob = await fitWithinLimit((scale) => encodeJpeg(bitmap, scale), {
      limit: PHOTO_LIMIT_BYTES,
      initialScale: Math.min(1, MAX_EDGE_PX / longEdge),
      minScale: Math.min(1, MIN_EDGE_PX / longEdge),
    });
    return jpegFile(blob, file.name);
  } finally {
    bitmap.close();
  }
}

// The square region chosen in the crop dialog (in source pixels), scaled down to at most CROP_EDGE_PX a side.
export async function cropPhoto(file: File, area: CropArea): Promise<File> {
  const bitmap = await decode(file);
  try {
    const edge = Math.max(1, Math.round(Math.min(area.width, CROP_EDGE_PX)));
    const blob = await renderJpeg(edge, edge, (context) => context.drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, edge, edge));
    return jpegFile(blob, file.name);
  } finally {
    bitmap.close();
  }
}

export async function fitWithinLimit(
  encode: (scale: number) => Promise<Blob>,
  { limit, initialScale, minScale }: { limit: number; initialScale: number; minScale: number },
): Promise<Blob> {
  let scale = initialScale;
  for (let attempt = 0; attempt < MAX_ENCODES; attempt++) {
    const blob = await encode(scale);
    if (blob.size <= limit) return blob;
    if (scale <= minScale) break;
    // Encoded size tracks pixel count, which is proportional to scale squared.
    const shrink = Math.min(0.9, Math.sqrt(limit / blob.size) * SIZE_MARGIN);
    scale = Math.max(minScale, scale * shrink);
  }
  throw new PhotoTooLargeError();
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch (error) {
    if (error instanceof DOMException) throw new PhotoUnreadableError();
    throw error;
  }
}

function encodeJpeg(bitmap: ImageBitmap, scale: number): Promise<Blob> {
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
  return renderJpeg(width, height, (context) => context.drawImage(bitmap, 0, 0, width, height));
}

async function renderJpeg(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable for photo encoding.');
  // JPEG has no transparency; flatten PNG/WebP alpha onto white instead of black.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  draw(context);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error(`Photo encoding produced no image at ${width}x${height}.`);
  return blob;
}

function jpegFile(blob: Blob, name: string) {
  return new File([blob], name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' });
}
