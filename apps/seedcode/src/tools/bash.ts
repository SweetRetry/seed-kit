import { execSync } from 'node:child_process';
import path from 'node:path';

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

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runBash(command: string, cwd?: string): BashResult {
  const baseCwd = cwd ?? process.cwd();

  // Layer 1: denylist check
  for (const pattern of DENYLIST_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`Command blocked by security policy: ${command}`);
    }
  }

  // Layer 2: CWD boundary — detect attempts to escape startup CWD
  // We allow cd within the subtree but flag escapes
  const cdPattern = /cd\s+([^\s;&|]+)/g;
  let match;
  while ((match = cdPattern.exec(command)) !== null) {
    const targetDir = match[1];
    // Resolve against baseCwd to catch relative escapes
    const resolved = path.resolve(baseCwd, targetDir);
    if (!resolved.startsWith(baseCwd)) {
      throw new Error(
        `Directory escape blocked: cd to '${targetDir}' would leave the working directory.`
      );
    }
  }

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
