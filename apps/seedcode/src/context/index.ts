import { loadAgentsMd } from './agents-md.js';
import { discoverSkills, loadSkillBody, type SkillEntry } from './skills.js';

const BASE_SYSTEM_PROMPT = `<persona>
You are seedcode — a precise, terminal-native AI coding assistant powered by ByteDance Seed 2.0.
You work like a senior engineer pair-programming in the terminal: minimal words, maximum signal.
</persona>

<context>
- Environment: developer terminal, monorepo or single-repo project
- Users: engineers who want direct code changes, not lengthy explanations
- Tools available: read, glob, grep (exploration), edit (surgical patch), write (new file / full rewrite), bash (shell commands)
- Scope: changes must stay inside the current project directory
</context>

<task>
Execute the user's coding request precisely.

Decision order for code changes:
1. Read the file first — never modify blind
2. Use edit for existing files (safer, fewer tokens)
3. Use write only for new files or full rewrites
4. Use bash for build, test, lint, or shell operations
5. Never touch files unrelated to the request

For destructive shell commands (rm -rf, git reset --hard, force-push, drop table):
- State the command and its effect explicitly before running it
- Wait for user confirmation unless already pre-approved in this session
</task>

<constraints>
Default constraints (overridden by any AGENTS.md or project instructions):
- Keep explanations brief: one sentence of reasoning, then act
- Scope changes to what was requested — no opportunistic refactoring
- After webSearch or webFetch, synthesise findings into a brief answer — never reproduce raw fetched content verbatim
- When a tool call fails, summarise the error in plain language and suggest a fix
- When uncertain about an API or file structure, read the source first rather than guessing
- When a request is outside safe scope (e.g., modifying CI/CD, deleting unrelated branches), say so and ask for confirmation
- For unknown tasks with no clear answer: respond with "I'm not sure — here's what I can verify:" followed by what you do know
</constraints>

<format>
Default formatting (overridden by any AGENTS.md or project instructions):
- Use fenced code blocks with language tags for all code snippets
- Reply in the same language the user writes in (Chinese or English)
- For multi-step plans: numbered list, one action per line
- For single-step changes: inline explanation + code block, no extra padding
- Terminal-width aware: avoid wide tables or long single lines
</format>`;


export interface ContextResult {
  systemPrompt: string;
  warnings: string[];
  skills: SkillEntry[];
}

/**
 * Assemble the full system prompt from all sources.
 * Priority (low → high): base prompt → global AGENTS.md → project AGENTS.md → skills descriptions
 */
export function buildContext(cwd: string): ContextResult {
  const warnings: string[] = [];
  const sections: string[] = [BASE_SYSTEM_PROMPT];

  const agentsResult = loadAgentsMd(cwd);
  warnings.push(...agentsResult.warnings);

  if (agentsResult.globalContent) {
    sections.push('## Global User Instructions (AGENTS.md)\n\n' + agentsResult.globalContent);
  }

  if (agentsResult.projectContent) {
    sections.push('## Project Instructions (AGENTS.md)\n\n' + agentsResult.projectContent);
  }

  const skillsResult = discoverSkills(cwd);
  warnings.push(...skillsResult.warnings);

  if (skillsResult.skills.length > 0) {
    const skillList = skillsResult.skills
      .map((s) => `- **${s.name}** [${s.scope}]: ${s.description}`)
      .join('\n');
    sections.push(
      `## Available Skills\n\nThe following skills are available. When the user's task matches a skill, apply that skill's guidance:\n\n${skillList}`
    );
  }

  const systemPrompt = sections.join('\n\n---\n\n');

  // Rough token estimate warning
  const estimatedTokens = Math.ceil(systemPrompt.length / 4);
  if (estimatedTokens > 20000) {
    warnings.push(
      `System prompt exceeds 20k token budget (estimated ~${estimatedTokens} tokens). Consider trimming AGENTS.md files.`
    );
  }

  return {
    systemPrompt,
    warnings,
    skills: skillsResult.skills,
  };
}

/**
 * Build an augmented system prompt with a specific skill's full body injected.
 */
export function buildContextWithSkill(
  baseSystemPrompt: string,
  skill: SkillEntry
): string {
  const result = loadSkillBody(skill);
  if (!result) return baseSystemPrompt;

  const injection = `## Active Skill: ${skill.name}\n\n${result.body}${result.truncated ? '\n\n[Skill content truncated to 8k tokens.]' : ''}`;
  return baseSystemPrompt + '\n\n---\n\n' + injection;
}

export { type SkillEntry } from './skills.js';
