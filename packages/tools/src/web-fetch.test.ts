import { describe, test, expect, vi, afterEach } from 'vitest';
import { extractContent } from './web-fetch.js';
import { webFetch } from './web-fetch.js';

// ---------------------------------------------------------------------------
// extractContent — pure function, no network
// ---------------------------------------------------------------------------

describe('extractContent', () => {
  test('extracts article title and body from well-structured HTML', () => {
    const html = `<!DOCTYPE html><html><head><title>My Article</title></head>
    <body>
      <article>
        <h1>My Article</h1>
        <p>This is the main content of the article with enough text to satisfy Readability's minimum length requirements. We need several sentences here.</p>
        <p>Another paragraph with more content to make sure Readability parses this correctly and does not fall back.</p>
      </article>
    </body></html>`;

    const result = extractContent(html, 'https://example.com/article');

    expect(result.title).toBe('My Article');
    expect(result.markdown).toContain('main content');
    expect(result.truncated).toBe(false);
  });

  test('strips script and style tags from output', () => {
    const html = `<!DOCTYPE html><html><head><title>Clean</title></head>
    <body>
      <script>alert('xss')</script>
      <style>.foo { color: red }</style>
      <p>Visible paragraph content that should appear in the output markdown.</p>
    </body></html>`;

    const result = extractContent(html, 'https://example.com');

    expect(result.markdown).not.toContain("alert('xss')");
    expect(result.markdown).not.toContain('.foo { color: red }');
  });

  test('falls back to body content when Readability cannot extract article', () => {
    // Minimal HTML — no semantic article structure, too short for Readability
    const html = `<html><head><title>Fallback Page</title></head><body><p>Hi</p></body></html>`;

    const result = extractContent(html, 'https://example.com');

    // Should not throw; markdown must contain something
    expect(typeof result.markdown).toBe('string');
    expect(result.truncated).toBe(false);
  });

  test('truncates content exceeding 20000 chars and appends truncation marker', () => {
    const longParagraph = 'x'.repeat(25_000);
    const html = `<!DOCTYPE html><html><head><title>Long</title></head>
    <body><p>${longParagraph}</p></body></html>`;

    const result = extractContent(html, 'https://example.com');

    expect(result.markdown.length).toBeLessThanOrEqual(20_000 + 100); // marker overhead
    expect(result.truncated).toBe(true);
    expect(result.markdown).toContain('[content truncated]');
  });

  test('uses document title when Readability falls back', () => {
    const html = `<html><head><title>Fallback Title</title></head><body><p>Short</p></body></html>`;

    const result = extractContent(html, 'https://example.com');

    // title should come from <title> tag
    expect(result.title).toBe('Fallback Title');
  });
});

// ---------------------------------------------------------------------------
// extractContent — token optimizations
// ---------------------------------------------------------------------------

describe('extractContent token optimizations', () => {
  test('strips anchor-only links, keeping link text', () => {
    const html = `<!DOCTYPE html><html><head><title>Docs</title></head>
    <body><article>
      <h2><a href="#installation">Installation</a></h2>
      <p>Run the command to get started. This paragraph has enough content for Readability.</p>
      <p>More details about the installation process and configuration options available.</p>
    </article></body></html>`;

    const result = extractContent(html, 'https://example.com');

    // anchor link [text](#hash) should become plain text
    expect(result.markdown).not.toMatch(/\[.*?\]\(#[^)]+\)/);
    expect(result.markdown).toContain('Installation');
  });

  test('collapses multiple blank lines into a single blank line', () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head>
    <body><article>
      <p>First paragraph with sufficient content for Readability to parse correctly.</p>
      <hr/><hr/><hr/>
      <p>Second paragraph after multiple horizontal rules and blank spacing.</p>
    </article></body></html>`;

    const result = extractContent(html, 'https://example.com');

    // no more than one consecutive blank line
    expect(result.markdown).not.toMatch(/\n{3,}/);
  });

  test('does not strip anchor-style links inside fenced code blocks', () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head>
    <body><article>
      <p>Example showing Markdown syntax. This needs enough text for Readability to parse it.</p>
      <pre><code class="language-markdown">[link text](#anchor-target)</code></pre>
      <p>The code block above should remain unchanged after processing.</p>
    </article></body></html>`;

    const result = extractContent(html, 'https://example.com');

    expect(result.markdown).toContain('[link text](#anchor-target)');
  });

  test('does not strip anchor-style links inside inline code spans', () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head>
    <body><article>
      <p>Use <code>[text](#id)</code> syntax to create anchor links in Markdown.</p>
      <p>This paragraph has enough content for Readability to extract the article correctly.</p>
    </article></body></html>`;

    const result = extractContent(html, 'https://example.com');

    expect(result.markdown).toContain('[text](#id)');
  });

  test('removes * * * horizontal rule noise', () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head>
    <body><article>
      <p>Content before the divider. This needs to be long enough for Readability.</p>
      <hr/>
      <p>Content after the divider. Adding more text to ensure parsing succeeds.</p>
    </article></body></html>`;

    const result = extractContent(html, 'https://example.com');

    expect(result.markdown).not.toContain('* * *');
  });
});

// ---------------------------------------------------------------------------
// webFetch — mocks global fetch
// ---------------------------------------------------------------------------

describe('webFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('throws on non-OK HTTP status', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(null, { status: 404, statusText: 'Not Found' })
    );

    await expect(webFetch('https://example.com/missing')).rejects.toThrow('HTTP 404');
  });

  test('returns raw text for non-HTML content types', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response('{"key":"value"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result = await webFetch('https://api.example.com/data');

    expect(result.markdown).toBe('{"key":"value"}');
    expect(result.truncated).toBe(false);
    expect(result.title).toBe('https://api.example.com/data');
  });

  test('truncates non-HTML content longer than 20000 chars', async () => {
    const big = 'a'.repeat(25_000);
    vi.stubGlobal('fetch', async () =>
      new Response(big, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    );

    const result = await webFetch('https://example.com/big.txt');

    expect(result.truncated).toBe(true);
    expect(result.markdown.length).toBeLessThanOrEqual(20_000);
  });

  test('extracts article from HTML response', async () => {
    const html = `<!DOCTYPE html><html><head><title>SDK Docs</title></head>
    <body>
      <article>
        <h1>SDK Docs</h1>
        <p>Install with npm install my-sdk — this is the documentation page with enough text.</p>
        <p>Additional content paragraph to ensure Readability processes this page correctly.</p>
      </article>
    </body></html>`;

    vi.stubGlobal('fetch', async () =>
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    );

    const result = await webFetch('https://docs.example.com');

    expect(result.title).toBeTruthy();
    expect(result.markdown).toContain('npm install my-sdk');
    expect(result.truncated).toBe(false);
    expect(result.url).toBe('https://docs.example.com');
  });
});
