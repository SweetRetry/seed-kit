import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

// Configure marked with terminal renderer once at module load
marked.use(
  markedTerminal({
    // Keep code blocks readable at typical terminal widths
    width: process.stdout.columns || 80,
    // Reflect actual terminal capability for colours
    reflowText: false,
  })
);

/**
 * Render a Markdown string to ANSI-coloured terminal text.
 * Falls back to the raw string if parsing throws.
 */
export function renderMarkdown(text: string): string {
  try {
    // marked.parse returns string when not in async mode
    return marked.parse(text) as string;
  } catch {
    return text;
  }
}
