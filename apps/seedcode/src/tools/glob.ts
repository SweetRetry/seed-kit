import { glob as globAsync } from 'glob';
import path from 'node:path';

export interface GlobResult {
  files: string[];
  count: number;
}

export async function globFiles(pattern: string, cwd?: string): Promise<GlobResult> {
  const baseCwd = cwd ?? process.cwd();
  const files = await globAsync(pattern, {
    cwd: baseCwd,
    dot: false,
    nodir: true,
  });

  const sorted = files.sort().map((f) => path.join(baseCwd, f));
  return { files: sorted, count: sorted.length };
}
