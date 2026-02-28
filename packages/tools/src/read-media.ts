/**
 * readMedia — fetch a remote or local file (image / video / PDF / audio) and
 * return its content as a base64-encoded data-URL string together with the
 * detected MIME type.
 *
 * The returned value can be passed directly to AI SDK v6 as a `file` content
 * part, which the `@seedkit-ai/ai-sdk-provider` converts to the appropriate
 * Seed API format:
 *
 *   image/*         → image_url / input_image
 *   video/mp4|avi|mov → video_url / input_video  (only these 3 are supported)
 *   application/pdf → input_file
 *
 * Note: audio is NOT supported by Seed models.
 *
 * Example usage with streamText:
 *
 *   const media = await readMedia('https://example.com/chart.png');
 *   await streamText({
 *     model: seed.chat('doubao-seed-1-6-vision-250815'),
 *     messages: [{
 *       role: 'user',
 *       content: [
 *         { type: 'text', text: 'Describe this image.' },
 *         { type: 'file', mediaType: media.mediaType, data: media.data },
 *       ],
 *     }],
 *   });
 */

import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

/** Maximum bytes we will buffer (50 MB — generous for video frames) */
const MAX_BYTES = 50 * 1024 * 1024;

export interface ReadMediaOutput {
  /** Original source passed to the function */
  source: string;
  /** Detected or inferred MIME type, e.g. "image/png", "video/mp4", "application/pdf" */
  mediaType: string;
  /**
   * File content as a base64-encoded data-URL string,
   * e.g. "data:image/png;base64,iVBOR..."
   * Ready to pass as `data` in an AI SDK v6 `file` content part.
   */
  data: string;
  /** Byte size of the original (pre-encoding) content */
  byteSize: number;
}

// ---------------------------------------------------------------------------
// MIME type helpers
// ---------------------------------------------------------------------------

// Formats confirmed supported by Seed models (Chat API & Responses API docs).
// Image: any image/* MIME is accepted — no explicit format whitelist in docs.
// Video: only mp4 / avi / mov (Chat API doc); audio understanding not supported.
// Document: only application/pdf.
const EXT_TO_MIME: Record<string, string> = {
  // images — Seed accepts image/* generically; common formats listed here
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  // video — only these three formats are documented as supported
  mp4: 'video/mp4',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  // document
  pdf: 'application/pdf',
};

/**
 * Infer MIME type from a Content-Type header value, stripping parameters.
 * Falls back to undefined when the header is absent or opaque.
 */
function parseMimeFromContentType(contentType: string | null): string | undefined {
  if (!contentType) return undefined;
  const mime = contentType.split(';')[0]?.trim().toLowerCase();
  if (!mime || mime === 'application/octet-stream') return undefined;
  return mime;
}

/**
 * Infer MIME type from a file extension in a URL path or local path.
 */
function inferMimeFromPath(source: string): string | undefined {
  const ext = extname(source).replace(/^\./, '').toLowerCase();
  return ext ? EXT_TO_MIME[ext] : undefined;
}

// ---------------------------------------------------------------------------
// Magic-byte sniffing (fast, no deps)
// ---------------------------------------------------------------------------

const MAGIC: Array<{ bytes: number[]; mime: string }> = [
  // images
  { bytes: [0xff, 0xd8, 0xff], mime: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png' },
  { bytes: [0x47, 0x49, 0x46], mime: 'image/gif' },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' }, // RIFF….WEBP — refined below
  { bytes: [0x42, 0x4d], mime: 'image/bmp' },
  { bytes: [0x49, 0x49, 0x2a, 0x00], mime: 'image/tiff' },
  { bytes: [0x4d, 0x4d, 0x00, 0x2a], mime: 'image/tiff' },
  // video — mp4 (ftyp box), avi (RIFF….AVI), mov share ftyp with mp4
  { bytes: [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], mime: 'video/mp4' },
  { bytes: [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], mime: 'video/mp4' },
  // PDF
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf' }, // %PDF
];

function sniffMime(buf: Uint8Array): string | undefined {
  for (const { bytes, mime } of MAGIC) {
    if (bytes.every((b, i) => buf[i] === b)) return mime;
  }
  // RIFF container: disambiguate WEBP (image) vs AVI (video)
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
  ) {
    const subtype = String.fromCharCode(buf[8]!, buf[9]!, buf[10]!, buf[11]!);
    if (subtype === 'WEBP') return 'image/webp';
    if (subtype === 'AVI ') return 'video/x-msvideo';
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Buffer → data-URL
// ---------------------------------------------------------------------------

function toDataUrl(buf: Uint8Array, mediaType: string): string {
  // Node.js Buffer.from(buf).toString('base64') is efficient; we accept
  // Uint8Array so it works in both Buffer and pure-Uint8Array environments.
  const b64 = Buffer.from(buf).toString('base64');
  return `data:${mediaType};base64,${b64}`;
}

// ---------------------------------------------------------------------------
// HTTP fetch helper
// ---------------------------------------------------------------------------

async function fetchRemote(url: string): Promise<{ buf: Uint8Array; mediaType: string }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; SeedcodeBot/1.0; +https://github.com/SweetRetry/seedkit-ai)',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} — ${url}`);
  }

  const contentType = response.headers.get('content-type');
  const headerMime = parseMimeFromContentType(contentType);
  const extMime = inferMimeFromPath(url);

  const arrayBuffer = await response.arrayBuffer();
  const buf = new Uint8Array(arrayBuffer);

  if (buf.byteLength > MAX_BYTES) {
    throw new Error(
      `File too large: ${buf.byteLength} bytes exceeds limit of ${MAX_BYTES} bytes (${url})`,
    );
  }

  const sniffed = sniffMime(buf);
  // Priority: magic bytes > Content-Type header > path extension
  const mediaType = sniffed ?? headerMime ?? extMime ?? 'application/octet-stream';

  return { buf, mediaType };
}

// ---------------------------------------------------------------------------
// Local file helper
// ---------------------------------------------------------------------------

async function readLocal(path: string): Promise<{ buf: Uint8Array; mediaType: string }> {
  const rawBuffer = await readFile(path);
  const buf = new Uint8Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength);

  if (buf.byteLength > MAX_BYTES) {
    throw new Error(
      `File too large: ${buf.byteLength} bytes exceeds limit of ${MAX_BYTES} bytes (${path})`,
    );
  }

  const sniffed = sniffMime(buf);
  const extMime = inferMimeFromPath(path);
  const mediaType = sniffed ?? extMime ?? 'application/octet-stream';

  return { buf, mediaType };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a media file from a remote URL or local filesystem path.
 *
 * @param source  HTTP/HTTPS URL or absolute/relative local file path.
 * @returns       `ReadMediaOutput` with `mediaType` and base64 `data` URL.
 *
 * @throws        When the file exceeds 50 MB, the URL returns an error status,
 *                or the local path does not exist.
 */
export async function readMedia(source: string): Promise<ReadMediaOutput> {
  const isRemote = source.startsWith('http://') || source.startsWith('https://');

  const { buf, mediaType } = isRemote
    ? await fetchRemote(source)
    : await readLocal(source);

  return {
    source,
    mediaType,
    data: toDataUrl(buf, mediaType),
    byteSize: buf.byteLength,
  };
}
