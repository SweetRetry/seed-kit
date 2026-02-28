declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked';

  interface TerminalRendererOptions {
    /** Terminal width for reflowing text (default: 80) */
    width?: number;
    /** Reflow text to fit terminal width */
    reflowText?: boolean;
    /** First-heading level (default: 1) */
    firstHeading?: number;
    /** Horizontal rule character */
    hr?: string;
    /** Show section prefix for headings */
    showSectionPrefix?: boolean;
    /** Unescape HTML entities */
    unescape?: boolean;
    /** Enable emoji rendering */
    emoji?: boolean;
    /** Padding for blockquotes */
    blockquote?: string;
  }

  export function markedTerminal(
    options?: TerminalRendererOptions,
    highlightOptions?: Record<string, unknown>
  ): MarkedExtension;

  export default class Renderer {}
}
