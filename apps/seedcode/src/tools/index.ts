import { z } from 'zod';
import { tool } from 'ai';
import { readFile } from './read.js';
import { computeDiff, writeFile } from './write.js';
import { computeEditDiff, applyEdit } from './edit.js';
import { globFiles } from './glob.js';
import { grepFiles } from './grep.js';
import { runBash } from './bash.js';
import { webSearch, webFetch } from '@seedkit-ai/tools';

export type ToolName = 'read' | 'edit' | 'write' | 'glob' | 'grep' | 'bash' | 'webSearch' | 'webFetch';

export type PendingConfirm = {
  toolName: ToolName;
  description: string;
  /** For edit tool: inline diff lines to show */
  diffLines?: { removed: string[]; added: string[] };
  /** Resolve with true=approved, false=denied */
  resolve: (approved: boolean) => void;
};

// Callback so the agent loop can request confirmation from the UI
export type ConfirmFn = (pending: PendingConfirm) => void;

/** Sentinel field present on all tool error responses. UI checks this to determine status. */
export interface ToolError {
  error: string;
}

export function isToolError(output: unknown): output is ToolError {
  return typeof output === 'object' && output !== null && 'error' in output;
}

export function buildTools(opts: {
  cwd: string;
  confirm: ConfirmFn;
  skipConfirm: boolean;
}) {
  const { cwd, confirm, skipConfirm } = opts;

  const requestConfirm = (
    toolName: ToolName,
    description: string,
    diffLines?: { removed: string[]; added: string[] }
  ): Promise<boolean> => {
    if (skipConfirm) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      confirm({ toolName, description, diffLines, resolve });
    });
  };

  return {
    read: tool({
      description: 'Read the contents of a file. Returns the content and line count.',
      inputSchema: z.object({
        path: z.string().describe('Path to the file to read (absolute or relative to CWD)'),
      }),
      execute: async ({ path: filePath }): Promise<{ content: string; lineCount: number; warning?: string } | ToolError> => {
        try {
          const { content, lineCount, warning } = readFile(filePath);
          return { content, lineCount, ...(warning ? { warning } : {}) };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    edit: tool({
      description:
        'Apply a targeted find-and-replace patch to a file. old_string must match exactly once. Safer than write for modifying existing files.',
      inputSchema: z.object({
        path: z.string().describe('Path to the file to edit'),
        old_string: z.string().describe('Exact text to find — must appear exactly once in the file'),
        new_string: z.string().describe('Text to replace it with'),
      }),
      execute: async ({ path: filePath, old_string, new_string }): Promise<{ success: true; message: string } | ToolError> => {
        try {
          const diff = computeEditDiff(filePath, old_string, new_string);
          if ('error' in diff) return diff;

          const approved = await requestConfirm(
            'edit',
            `Edit ${filePath}`,
            { removed: diff.removedLines, added: diff.addedLines }
          );
          if (!approved) {
            return { error: 'User denied edit operation.' };
          }

          const result = applyEdit(filePath, old_string, new_string);
          if ('error' in result) return result;
          return { success: true, message: result.message };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    write: tool({
      description:
        'Write content to a file. Shows a diff summary before writing and waits for confirmation.',
      inputSchema: z.object({
        path: z.string().describe('Path to the file to write'),
        content: z.string().describe('Content to write to the file'),
      }),
      execute: async ({ path: filePath, content }): Promise<{ success: true; message: string } | ToolError> => {
        try {
          const diff = computeDiff(filePath, content);
          const description =
            diff.oldContent === null
              ? `Create new file: ${filePath} (+${diff.added} lines)`
              : `Modify ${filePath}: +${diff.added} / -${diff.removed} lines`;

          const approved = await requestConfirm('write', description);
          if (!approved) {
            return { error: 'User denied write operation.' };
          }

          writeFile(filePath, content);
          return {
            success: true,
            message:
              diff.oldContent === null
                ? `Created ${filePath} (${diff.added} lines)`
                : `Updated ${filePath} (+${diff.added} / -${diff.removed})`,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    glob: tool({
      description: 'Match files using a glob pattern. Returns matching file paths and count.',
      inputSchema: z.object({
        pattern: z.string().describe('Glob pattern (e.g. "src/**/*.ts")'),
        cwd: z.string().optional().describe('Directory to search from (default: startup CWD)'),
      }),
      execute: async ({ pattern, cwd: overrideCwd }): Promise<{ files: string[]; count: number } | ToolError> => {
        try {
          return await globFiles(pattern, overrideCwd ?? cwd);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    grep: tool({
      description:
        'Search file contents with a regex pattern. Returns matching lines with file and line number.',
      inputSchema: z.object({
        pattern: z.string().describe('Regex pattern to search for'),
        fileGlob: z.string().describe('Glob pattern to select which files to search'),
        cwd: z.string().optional().describe('Directory to search from (default: startup CWD)'),
      }),
      execute: async ({ pattern, fileGlob, cwd: overrideCwd }): Promise<{ matches: unknown[]; count: number } | ToolError> => {
        try {
          return await grepFiles(pattern, fileGlob, overrideCwd ?? cwd);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    bash: tool({
      description:
        'Run a shell command. Sandboxed: cannot escape the startup CWD, dangerous commands are blocked.',
      inputSchema: z.object({
        command: z.string().describe('Shell command to run'),
      }),
      execute: async ({ command }): Promise<{ stdout: string; stderr: string; exitCode: number } | ToolError> => {
        try {
          const approved = await requestConfirm('bash', `Run shell command: ${command}`);
          if (!approved) {
            return { error: 'User denied bash execution.' };
          }
          return runBash(command, cwd);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    webSearch: tool({
      description:
        'Search the web using DuckDuckGo. Returns results with title, URL, and description. Use this when you need current information or documentation not in your context.',
      inputSchema: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().int().min(1).max(10).optional().default(5).describe('Max results (default: 5)'),
      }),
      execute: async ({ query, limit }): Promise<{ query: string; results: { title: string; url: string; description: string }[] } | ToolError> => {
        try {
          return await webSearch(query, limit);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    webFetch: tool({
      description:
        'Fetch a URL and extract its main content as Markdown. Use after webSearch to read documentation, blog posts, or any web page.',
      inputSchema: z.object({
        url: z.string().url().describe('URL to fetch'),
      }),
      execute: async ({ url }): Promise<{ url: string; title: string; markdown: string; truncated: boolean } | ToolError> => {
        try {
          return await webFetch(url);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}

export type Tools = ReturnType<typeof buildTools>;
