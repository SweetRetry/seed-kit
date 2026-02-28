import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { minimatch } from 'minimatch';

const DENY_LIST = [
  '**/.ssh/**',
  '**/.aws/**',
  '**/.config/**',
  '**/.env*',
];

function isDenied(filePath: string): boolean {
  const home = os.homedir();
  const abs = path.resolve(filePath);
  const rel = abs.startsWith(home) ? abs.slice(home.length + 1) : abs;
  return DENY_LIST.some((pattern) => minimatch(rel, pattern, { dot: true }));
}

const LARGE_FILE_WARN_LINES = 500;

export interface ReadResult {
  content: string;
  lineCount: number;
  warning?: string;
}

export function readFile(filePath: string): ReadResult {
  const abs = path.resolve(filePath);

  if (isDenied(abs)) {
    throw new Error(`Access denied: ${filePath} is in the restricted path list.`);
  }

  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = fs.statSync(abs);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  const content = fs.readFileSync(abs, 'utf-8');
  const lineCount = content.split('\n').length;

  const warning =
    lineCount > LARGE_FILE_WARN_LINES
      ? `Large file: ${lineCount} lines. Consider reading a specific line range if you only need part of it.`
      : undefined;

  return { content, lineCount, warning };
}
