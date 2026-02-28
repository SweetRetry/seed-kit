import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readMedia } from './read-media.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal PNG buffer (1×1 pixel, valid magic bytes). */
function makePngBytes(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    ...new Array(16).fill(0),
  ]);
}

/** Build a minimal JPEG buffer. */
function makeJpegBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)]);
}

/** Build a minimal PDF buffer. */
function makePdfBytes(): Uint8Array {
  return new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new Array(16).fill(0)]); // %PDF
}

/** Build a minimal MP4 buffer. */
function makeMp4Bytes(): Uint8Array {
  // ftyp box with size 0x00000018
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, ...new Array(16).fill(0),
  ]);
}

// ---------------------------------------------------------------------------
// Remote URL tests (fetch mock)
// ---------------------------------------------------------------------------

describe('readMedia — remote URLs', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(bytes: Uint8Array, contentType: string) {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (h: string) => (h === 'content-type' ? contentType : null) },
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    });
  }

  it('fetches a PNG and returns correct mediaType + data URL', async () => {
    const bytes = makePngBytes();
    mockFetch(bytes, 'image/png');

    const result = await readMedia('https://example.com/photo.png');

    expect(result.source).toBe('https://example.com/photo.png');
    expect(result.mediaType).toBe('image/png');
    expect(result.byteSize).toBe(bytes.byteLength);
    expect(result.data).toMatch(/^data:image\/png;base64,/);
  });

  it('fetches a JPEG and detects type from magic bytes (overrides content-type)', async () => {
    const bytes = makeJpegBytes();
    // Content-Type says webp but magic bytes say jpeg — magic wins
    mockFetch(bytes, 'image/webp');

    const result = await readMedia('https://example.com/img');

    expect(result.mediaType).toBe('image/jpeg');
  });

  it('fetches a PDF and returns application/pdf', async () => {
    const bytes = makePdfBytes();
    mockFetch(bytes, 'application/pdf');

    const result = await readMedia('https://example.com/doc.pdf');

    expect(result.mediaType).toBe('application/pdf');
    expect(result.data).toMatch(/^data:application\/pdf;base64,/);
  });

  it('fetches an MP4 and returns video/mp4', async () => {
    const bytes = makeMp4Bytes();
    mockFetch(bytes, 'video/mp4');

    const result = await readMedia('https://example.com/clip.mp4');

    expect(result.mediaType).toBe('video/mp4');
    expect(result.data).toMatch(/^data:video\/mp4;base64,/);
  });

  it('falls back to Content-Type when magic bytes are unknown', async () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, ...new Array(20).fill(0)]);
    mockFetch(bytes, 'audio/mpeg');

    const result = await readMedia('https://example.com/audio');

    expect(result.mediaType).toBe('audio/mpeg');
  });

  it('falls back to extension when Content-Type is opaque (mp4)', async () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, ...new Array(20).fill(0)]);
    mockFetch(bytes, 'application/octet-stream');

    const result = await readMedia('https://example.com/video.mp4');

    expect(result.mediaType).toBe('video/mp4');
  });

  it('throws on HTTP error response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => null },
    });

    await expect(readMedia('https://example.com/missing.png')).rejects.toThrow(
      'HTTP 404',
    );
  });

  it('throws when file exceeds size limit', async () => {
    // Create a fake 51 MB array (just set byteLength via ArrayBuffer)
    const bigBuffer = new ArrayBuffer(51 * 1024 * 1024);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'image/png' },
      arrayBuffer: () => Promise.resolve(bigBuffer),
    });

    await expect(readMedia('https://example.com/huge.png')).rejects.toThrow(
      'File too large',
    );
  });

  it('produces a valid base64-decodable data URL', async () => {
    const bytes = makePngBytes();
    mockFetch(bytes, 'image/png');

    const result = await readMedia('https://example.com/photo.png');

    // Strip prefix and decode
    const b64 = result.data.replace('data:image/png;base64,', '');
    const decoded = Buffer.from(b64, 'base64');
    expect(decoded.length).toBe(bytes.byteLength);
    expect(decoded[0]).toBe(0x89); // PNG magic byte
  });
});

// ---------------------------------------------------------------------------
// Local file tests
// ---------------------------------------------------------------------------

describe('readMedia — local files', () => {
  let tmpFile: string;

  afterEach(async () => {
    try {
      const { unlink } = await import('node:fs/promises');
      if (tmpFile) await unlink(tmpFile);
    } catch {
      // ignore
    }
  });

  it('reads a local PNG file', async () => {
    const bytes = makePngBytes();
    tmpFile = join(tmpdir(), `test-read-media-${Date.now()}.png`);
    await writeFile(tmpFile, bytes);

    const result = await readMedia(tmpFile);

    expect(result.source).toBe(tmpFile);
    expect(result.mediaType).toBe('image/png');
    expect(result.byteSize).toBe(bytes.byteLength);
    expect(result.data).toMatch(/^data:image\/png;base64,/);
  });

  it('reads a local PDF file', async () => {
    const bytes = makePdfBytes();
    tmpFile = join(tmpdir(), `test-read-media-${Date.now()}.pdf`);
    await writeFile(tmpFile, bytes);

    const result = await readMedia(tmpFile);

    expect(result.mediaType).toBe('application/pdf');
  });

  it('infers MIME from extension when magic bytes are unrecognized (mov)', async () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, ...new Array(16).fill(0)]);
    tmpFile = join(tmpdir(), `test-read-media-${Date.now()}.mov`);
    await writeFile(tmpFile, bytes);

    const result = await readMedia(tmpFile);

    expect(result.mediaType).toBe('video/quicktime');
  });

  it('throws on non-existent local file', async () => {
    await expect(readMedia('/tmp/definitely-does-not-exist-12345.png')).rejects.toThrow();
  });
});
