import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Rough chars-to-tokens approximation (4 chars ≈ 1 token). */
function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function truncateToTokens(content: string, maxTokens: number): { text: string; truncated: boolean } {
  const maxChars = maxTokens * 4;
  if (content.length <= maxChars) return { text: content, truncated: false };
  return { text: content.slice(0, maxChars), truncated: true };
}

export interface AgentsMdResult {
  globalContent: string | null;
  projectContent: string | null;
  warnings: string[];
}

/**
 * Discover and load AGENTS.md from:
 *  - Global: `~/.seedcode/AGENTS.md`
 *  - Project: `AGENTS.md` at the repo root (`.git` sibling — no upward walking)
 */
export function loadAgentsMd(cwd: string): AgentsMdResult {
  const warnings: string[] = [];

  // Global AGENTS.md
  const globalPath = path.join(os.homedir(), '.seedcode', 'AGENTS.md');
  let globalContent: string | null = null;
  if (fs.existsSync(globalPath)) {
    const raw = fs.readFileSync(globalPath, 'utf-8');
    const { text, truncated } = truncateToTokens(raw, 4000);
    globalContent = text;
    if (truncated) {
      warnings.push(`Global AGENTS.md truncated to ~4k tokens (file is ~${charsToTokens(raw.length)}k tokens).`);
    }
  }

  // Project AGENTS.md — only at .git sibling level
  let projectContent: string | null = null;
  const gitDir = path.join(cwd, '.git');
  if (fs.existsSync(gitDir)) {
    const projectPath = path.join(cwd, 'AGENTS.md');
    if (fs.existsSync(projectPath)) {
      const raw = fs.readFileSync(projectPath, 'utf-8');
      const { text, truncated } = truncateToTokens(raw, 8000);
      projectContent = text;
      if (truncated) {
        warnings.push(`Project AGENTS.md truncated to ~8k tokens (file is ~${charsToTokens(raw.length)}k tokens).`);
      }
    }
  }

  return { globalContent, projectContent, warnings };
}
