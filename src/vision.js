// Claude can look at images, but Telegram hands us a file_id, not bytes.
// This module turns an attached photo/document into a base64 block for the API.

// Anthropic's per-image limit is 5 MB; Telegram photos are well under that, but a
// document can be anything, so check before downloading.
const MAX_BYTES = 5 * 1024 * 1024;

const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export class ImageTooLargeError extends Error {
  constructor(bytes) {
    super(`image is ${(bytes / 1024 / 1024).toFixed(1)} MB, limit is 5 MB`);
    this.name = 'ImageTooLargeError';
  }
}

/**
 * Describe the image attached to a message, if any. Telegram sends photos as an
 * array of sizes, smallest first — the last one is the best we can get.
 */
export function pickAttachment(message) {
  const photos = message?.photo;
  if (photos && photos.length > 0) {
    const largest = photos[photos.length - 1];
    // Telegram always re-encodes photos as JPEG.
    return { fileId: largest.file_id, mediaType: 'image/jpeg', kind: 'photo' };
  }

  const doc = message?.document;
  if (doc && SUPPORTED.has(doc.mime_type)) {
    return {
      fileId: doc.file_id,
      mediaType: doc.mime_type,
      kind: 'document',
      size: doc.file_size,
      fileName: doc.file_name || '',
    };
  }

  return null;
}

/** A document we can't read (PDF, archive, video...). */
export function isUnsupportedDocument(message) {
  const doc = message?.document;
  return Boolean(doc) && !SUPPORTED.has(doc.mime_type);
}

export async function downloadAttachment(telegram, attachment) {
  if (attachment.size && attachment.size > MAX_BYTES) {
    throw new ImageTooLargeError(attachment.size);
  }

  // A single dropped connection shouldn't cost the user their picture: Telegram
  // downloads do fail transiently (DNS hiccup inside the container, mostly).
  const ATTEMPTS = 3;
  let lastError;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const link = await telegram.getFileLink(attachment.fileId);
      const res = await fetch(link.href, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_BYTES) throw new ImageTooLargeError(bytes.length);

      return {
        mediaType: attachment.mediaType,
        data: bytes.toString('base64'),
        sizeKb: Math.round(bytes.length / 1024),
      };
    } catch (err) {
      if (err instanceof ImageTooLargeError) throw err;
      lastError = err;
      const cause = err.cause?.code || err.cause?.message;
      console.warn(
        `attachment download ${attempt}/${ATTEMPTS} failed: ${err.message}${cause ? ` (${cause})` : ''}`
      );
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }

  throw lastError;
}

/** The API block shape. Goes into the last user turn next to the text. */
export function toImageBlock(image) {
  return {
    type: 'image',
    source: { type: 'base64', media_type: image.mediaType, data: image.data },
  };
}
