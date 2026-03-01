import { execSync, spawn } from 'node:child_process';

const DENYLIST_PATTERNS = [
  /rm\s+-rf\s+\/(?:\s|$)/,
  /rm\s+-rf\s+~(?:\s|$)/,
  /rm\s+-rf\s+\$HOME(?:\s|$)/,
  /curl[^|]+\|\s*(?:ba)?sh/,
  /wget[^|]+\|\s*(?:ba)?sh/,
  /:\s*\(\s*\)\s*\{.*:\|:&?\s*\}.*:/, // fork bomb
  />\s*\/dev\/sd[a-z]/,
  /mkfs\./,
  /dd\s+if=.+of=\/dev\//,
];

const TRUNCATE_HEAD = 100;
const TRUNCATE_TAIL = 50;

/**
 * Truncate bash output to keep first 100 + last 50 lines.
 * Injects a marker showing how many lines were dropped.
 */
export function truncateBashOutput(output: string): string {
  if (!output) return output;
  const lines = output.split('\n');
  const total = lines.length;
  if (total <= TRUNCATE_HEAD + TRUNCATE_TAIL) return output;

  const dropped = total - TRUNCATE_HEAD - TRUNCATE_TAIL;
  return [
    ...lines.slice(0, TRUNCATE_HEAD),
    `... ${dropped} lines truncated ...`,
    ...lines.slice(total - TRUNCATE_TAIL),
  ].join('\n');
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function checkDenylist(command: string): void {
  for (const pattern of DENYLIST_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`Command blocked by security policy: ${command}`);
    }
  }
}

/** Synchronous bash — used by sub-agents where abort is handled at the agent level. */
export function runBash(command: string, cwd?: string): BashResult {
  const baseCwd = cwd ?? process.cwd();
  checkDenylist(command);

  try {
    const stdout = execSync(command, {
      cwd: baseCwd,
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number; message?: string };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? String(err),
      exitCode: e.status ?? 1,
    };
  }
}

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

/**
 * Async bash with AbortSignal support.
 * Kills the child process tree when the signal fires.
 */
export function runBashAsync(command: string, cwd?: string, signal?: AbortSignal): Promise<BashResult> {
  const baseCwd = cwd ?? process.cwd();
  checkDenylist(command);

  if (signal?.aborted) {
    return Promise.resolve({ stdout: '', stderr: 'Aborted', exitCode: 130 });
  }

  return new Promise<BashResult>((resolve) => {
    const child = spawn('sh', ['-c', command], {
      cwd: baseCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutLen = 0;
    let stderrLen = 0;
    let killed = false;

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      if (!killed) {
        killed = true;
        child.kill('SIGTERM');
      }
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => {
      if (!killed) {
        killed = true;
        child.kill('SIGTERM');
      }
    }, TIMEOUT_MS);

    child.stdout!.on('data', (chunk: Buffer) => {
      stdoutLen += chunk.length;
      if (stdoutLen <= MAX_BUFFER) stdout += chunk.toString('utf-8');
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      stderrLen += chunk.length;
      if (stderrLen <= MAX_BUFFER) stderr += chunk.toString('utf-8');
    });

    child.on('close', (code) => {
      cleanup();
      resolve({
        stdout,
        stderr: killed && signal?.aborted ? stderr || 'Aborted' : stderr,
        exitCode: code ?? (killed ? 130 : 1),
      });
    });

    child.on('error', (err) => {
      cleanup();
      resolve({ stdout: '', stderr: err.message, exitCode: 1 });
    });
  });
}
