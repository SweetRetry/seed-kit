import fs from 'node:fs';
import path from 'node:path';
import { glob as globAsync } from 'glob';

export interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

export interface GrepResult {
  matches: GrepMatch[];
  count: number;
}

export async function grepFiles(
  pattern: string,
  fileGlob: string,
  cwd?: string
): Promise<GrepResult> {
  const baseCwd = cwd ?? process.cwd();

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'g');
  } catch {
    throw new Error(`Invalid regex pattern: ${pattern}`);
  }

  const files = await globAsync(fileGlob, {
    cwd: baseCwd,
    dot: false,
    nodir: true,
  });

  const matches: GrepMatch[] = [];

  for (const relFile of files.sort()) {
    const abs = path.join(baseCwd, relFile);
    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      if (regex.test(lines[i])) {
        matches.push({
          file: abs,
          line: i + 1,
          content: lines[i].trim(),
        });
      }
    }
  }

  return { matches, count: matches.length };
}
