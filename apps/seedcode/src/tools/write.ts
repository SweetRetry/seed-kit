import fs from 'node:fs';
import path from 'node:path';

export interface WriteDiff {
  added: number;
  removed: number;
  oldContent: string | null;
}

export function computeDiff(filePath: string, newContent: string): WriteDiff {
  const abs = path.resolve(filePath);

  if (!fs.existsSync(abs)) {
    const newLines = newContent.split('\n').length;
    return { added: newLines, removed: 0, oldContent: null };
  }

  const oldContent = fs.readFileSync(abs, 'utf-8');
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Simple line-based diff: count added/removed lines
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  const removed = oldLines.filter((l) => !newSet.has(l)).length;
  const added = newLines.filter((l) => !oldSet.has(l)).length;

  return { added, removed, oldContent };
}

export function writeFile(filePath: string, content: string): void {
  const abs = path.resolve(filePath);
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}
