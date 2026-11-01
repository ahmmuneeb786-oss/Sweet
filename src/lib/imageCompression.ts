/**
 * Shrinks a photo before it's sent. Phone photos are often 3–12MB at
 * ~4000×3000; every receiver would download and decode that full size,
 * which is slow on weak phones and mobile data. 1600px on the long side is
 * still sharp on any phone screen and in the full-screen viewer, and comes
 * out around 150–400KB.
 *
 * Never makes things worse: GIFs (animation would be lost), small files and
 * anything that fails to decode are sent untouched, and if the result isn't
 * smaller than the original, the original is kept.
 */

const MAX_DIMENSION = 1600;
const QUALITY = 0.8;
const SKIP_BELOW_BYTES = 200 * 1024;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      // Applies the photo's EXIF rotation, so portrait shots stay upright.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall through — some browsers reject the options or the format
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < SKIP_BELOW_BYTES) {
    return file;
  }

  try {
    const source = await decode(file);
    const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
    const height = 'naturalHeight' in source ? source.naturalHeight : source.height;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if ('close' in source) source.close(); // free the full-size bitmap right away

    // WebP is smallest; browsers that can't encode it hand back a PNG instead,
    // so check what we actually got and use JPEG in that case.
    let blob = await canvasToBlob(canvas, 'image/webp', QUALITY);
    if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', QUALITY);
    canvas.width = canvas.height = 0; // release the canvas memory (matters on low-RAM phones)

    if (!blob || blob.size >= file.size) return file;

    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${baseName}.${ext}`, { type: blob.type, lastModified: Date.now() });
  } catch (err) {
    console.warn('Image compression failed, sending original:', err);
    return file;
  }
}
