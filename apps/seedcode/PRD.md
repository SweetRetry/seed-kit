# seedcode CLI — Product Requirements Document

> **Version**: 0.4.0-draft
> **Updated**: 2026-02-28
> **Status**: Phase 2 complete, Phase 3 in planning

---

## 1. Product Overview

`seedcode` is an interactive AI coding assistant CLI powered by ByteDance Seed 2.0 models (via `@seedkit-ai/ai-sdk-provider`). It runs as a REPL session in the terminal, allowing developers to ask questions, generate code, read/write/edit local files, and execute shell commands — all within a persistent conversation context.

**Target user**: Developers who want a fast, terminal-native AI coding loop without leaving their workflow.

**Product goal**: Achieve functional parity with Claude Code's core coding loop, constrained only by model quality differences (not tool or UX gaps).

**Default model**: `doubao-seed-1-8-251228`

---

## 2. Core User Journey

```
$ seedcode                     # start REPL
╭──────────────────────────────────────────────────╮
│ seedcode v0.0.1  model:doubao-seed-1-8  key:96a0…│
╰──────────────────────────────────────────────────╯

Type /help for available commands.
› help me refactor utils/format.ts to use modern TS

◆  [ read ] utils/format.ts  ✔
◆  [ edit ] utils/format.ts  +23 / -5 lines
│  Apply? (y/n) y
◆  ✔ utils/format.ts updated

seed  Done. I've replaced the callback pattern with async/await and added
      explicit return types throughout.

›
```

---

## 3. Feature Requirements

### 3.1 REPL Session

| Feature | Description | Priority | Status |
|---------|-------------|----------|--------|
| Persistent conversation | Messages accumulate in-session context | P0 | ✅ Done |
| Streaming output | Stream tokens as they arrive | P0 | ✅ Done |
| Graceful exit | `/exit`, `/quit`, or Ctrl+C | P0 | ✅ Done |
| Session banner | Version, model, masked API key | P0 | ✅ Done |
| Command history | ↑↓ keys recall previous inputs | P1 | Phase 3b |
| Multiline input | `\` continuation line | P1 | Phase 3b |
| `/compact` | Summarize history to reduce context size | P1 | Phase 3b |

### 3.2 Tool Calls (Agent Loop)

Tools are minimal and semantically clear — a small set of composable primitives.

**Design principle**: `bash` is the universal escape hatch. Dedicated tools exist only when they provide meaningful permission semantics or richer model hints. **`edit` is a first-class tool** — not just `write` — because patch-level changes are safer and more reliable than full-file overwrites.

| Tool | Description | Needs Confirm | Priority | Status |
|------|-------------|--------------|----------|--------|
| `read` | Read a local file by path | No | P0 | ✅ Done |
| `edit` | Apply a targeted find-and-replace patch to a file | Yes | P0 | Phase 3a |
| `write` | Create or overwrite a file with full content | Yes | P0 | ✅ Done |
| `glob` | List files matching a glob pattern | No | P0 | ✅ Done |
| `grep` | Regex search across files | No | P0 | ✅ Done |
| `bash` | Execute any shell command | Yes | P1 | ✅ Done |

**Why `edit` is separate from `write`**:
- `write` replaces the entire file — safe for new files, risky for existing ones
- `edit` applies a surgical patch (`old_string` → `new_string`) — the model only needs to supply the changed region, reducing both token usage and the risk of accidentally overwriting unrelated content
- Mirrors how Claude Code handles file modification in practice

**Permission model**:
- Read-only tools (`read`, `glob`, `grep`) run silently — no confirmation needed
- `edit` requires confirmation showing the changed lines
- `write` requires confirmation showing `+added / -removed` line delta
- `bash` always requires confirmation

**Tool call rendering**:
```
◆  [ read ] src/index.ts  ✔  (142 lines)
◆  [ edit ] utils/format.ts
│  -  const result = callback(data)
│  +  const result = await fn(data)
│  Apply? (y/n)
◆  [ bash ] pnpm typecheck
│  Run? (y/n)
```

**Agent loop limits**:
- Maximum **20 tool call steps** per turn (hard limit). Stop and notify user if reached.
- **Ctrl+C**: first press interrupts current turn; second press exits the session.

**Working directory**: All relative paths resolved against CWD at startup. Never changes during a session.

### 3.3 Security Model

**bash sandbox** — three mandatory layers:

| Layer | Mechanism | What it catches |
|-------|-----------|----------------|
| 1. Command parsing | Detect directory escape | `cd /outside`, `cd .. && rm` chains |
| 2. CWD boundary | File ops must stay within startup CWD subtree | Path traversal, symlink escape |
| 3. Denylist | Block known high-risk patterns | `rm -rf /`, `rm -rf ~`, `curl\|sh`, fork bomb |

**Read-only tool path access** — built-in deny list (no config required):
```
~/.ssh/**   ~/.aws/**   ~/.config/**   ~/.env*
```

**Skip-permissions flag**:
```
--dangerously-skip-permissions   Skip ALL tool confirmation prompts
```
CI/non-interactive only. Blocked when stdin is a TTY.

### 3.4 System Prompt & Context Loading

Before the first user message, seedcode assembles a system prompt from multiple sources. Loading order (lowest → highest priority):

1. **Base system prompt** — hardcoded identity + tool usage guidance
2. **Global AGENTS.md** — `~/.seedcode/AGENTS.md`
3. **Project AGENTS.md** — `AGENTS.md` at repo root (`.git` sibling)
4. **Skills descriptions** — `~/.agents/skills/` + `.seedcode/skills/` (names + descriptions only)

**Token budget**:

| Source | Soft limit | On overflow |
|--------|-----------|------------|
| Base prompt | ~1k tokens | Fixed |
| Global AGENTS.md | 4k tokens | Truncate from bottom, warn |
| Project AGENTS.md | 8k tokens | Truncate from bottom, warn |
| Skills descriptions (all) | 2k tokens | Drop lowest-priority, warn |
| Full skill body (on trigger) | 8k tokens per skill | Truncate from bottom, warn |

Total context budget: **20k tokens**. Project content takes priority over global on overflow.

On `/clear`: conversation history is reset AND all context is re-read from disk.

### 3.5 AGENTS.md Support

**Two scopes**:

| Scope | Location | Purpose |
|-------|----------|---------|
| Global | `~/.seedcode/AGENTS.md` | Personal preferences across all projects |
| Project | `AGENTS.md` at repo root | Project-specific commands and conventions |

Discovery: find `.git` → read `AGENTS.md` at same level. No walking, no merging.

**Example** `AGENTS.md` (project root):
```markdown
# MyProject

## Commands
pnpm test        # run tests
pnpm build       # build

## Stack
Next.js 15, TypeScript, Tailwind, Drizzle ORM

## Never
- Commit directly to main
- Use `any` type
```

### 3.6 Agent Skills Support (P1)

**Directory structure**:
```
~/.agents/skills/        # global
.seedcode/skills/        # project-local (takes precedence on name conflict)
└── skill-name/
    ├── SKILL.md         # Required: YAML frontmatter + instructions
    └── references/      # Optional detailed docs
```

**`SKILL.md` frontmatter**:
```yaml
---
name: my-skill
description: What this skill does and when to use it
---
```

**Loading strategy** (progressive disclosure):
- **Startup**: names + descriptions only (~100 tokens for 50 skills)
- **On trigger**: full `SKILL.md` body injected into system prompt
- Trigger is automatic (model decides) or manual (`/skill <name>`)

### 3.7 Configuration

Config file: `~/.seedcode/config.json`

```json
{
  "apiKey": "your-ark-api-key",
  "model": "doubao-seed-1-8-251228",
  "thinking": false,
  "autoApprove": false
}
```

API key priority: `--api-key` flag > `ARK_API_KEY` env > config file.

**Error handling**:
- API / network error: display message, return to prompt
- 401 invalid API key: clear message, no retry

### 3.8 CLI Flags & Slash Commands

#### Startup flags

```
seedcode [options]

Options:
  -m, --model <id>                   Override default model
  -k, --api-key <key>                Override API key
  --thinking                         Enable extended thinking mode
  --dangerously-skip-permissions     Skip ALL tool confirmations (CI only)
  -v, --version                      Print version
  -h, --help                         Print help
```

#### In-session slash commands

| Command | Action | Status |
|---------|--------|--------|
| `/help` | List all slash commands | ✅ Done |
| `/exit`, `/quit` | End session | ✅ Done |
| `/clear` | Clear history + reload AGENTS.md & skills | ✅ Done (reload: Phase 3a) |
| `/model <id>` | Switch model mid-session | ✅ Done |
| `/thinking` | Toggle thinking mode | ✅ Done |
| `/status` | Show model, token usage, session info | ✅ Done (token usage: Phase 3b) |
| `/compact` | Summarize history to reduce context | Phase 3b |
| `/skills` | List all discovered skills | Phase 3a |
| `/skill <name>` | Manually activate a skill | Phase 3a |

---

## 4. Architecture

```
src/
├── index.ts           # Entry: parse flags, run REPL
├── repl.tsx           # ink render wrapper + session lifecycle
├── commands/
│   └── slash.ts       # Slash command dispatcher
├── tools/
│   ├── index.ts       # Tool registry (Zod inputSchema + handlers)
│   ├── read.ts        # Read file (deny list enforced)
│   ├── edit.ts        # Patch file (old_string → new_string)  ← Phase 3a
│   ├── write.ts       # Write file (full overwrite)
│   ├── glob.ts        # Glob pattern match
│   ├── grep.ts        # Regex search across files
│   └── bash.ts        # Sandboxed shell execution
├── context/
│   ├── index.ts       # Compose system prompt from all sources  ← Phase 3a
│   ├── agents-md.ts   # AGENTS.md discovery & injection         ← Phase 3a
│   └── skills.ts      # Skills discovery & loading              ← Phase 3a
├── config/
│   ├── index.ts       # Load/save config
│   └── schema.ts      # Zod schema
└── ui/
    ├── ReplApp.tsx          # Top-level ink app: state, streaming, slash dispatch
    ├── InputBox.tsx         # Keyboard handler + cursor + history (Phase 3b)
    ├── MessageList.tsx      # <Static> completed turns + live streaming turn
    ├── SetupWizard.tsx      # First-run API key prompt
    └── ToolCallView.tsx     # Tool call status line
```

### Key design decisions

1. **`edit` over `write` for existing files** — surgical patches reduce token cost and risk; full `write` kept for new file creation.
2. **ink-only inside REPL** — single persistent `render(<App />)`. No `@clack/prompts` mixing. `<Static>` for completed turns prevents redraw on keystroke. Streaming throttled to 50ms flushes.
3. **Tool confirmation via Promise** — `tools/index.ts` returns a Promise per confirm request, resolved by `y/n` keypress in `InputBox`. Normal text input is suspended while confirmation is pending.
4. **ai@6 `streamText`** — uses `stopWhen: stepCountIs(20)` (not `maxSteps`). `tool()` uses `inputSchema` (not `parameters`). Tool results accessed via `.output` (not `.result`).
5. **Context assembly in `context/index.ts`** — all system prompt construction centralised. `/clear` triggers a full re-read from disk.
6. **History in memory only** — no session persistence, no server-side storage.

---

## 5. Non-Goals (v0)

- No web/browser interface
- No plugin system
- No multi-agent orchestration
- No project-level context indexing / RAG
- No session persistence across restarts
- No server-side context storage (`store=false`)

---

## 6. Resolved Decisions

| Question | Decision |
|----------|----------|
| `edit` vs `write` for modifications | `edit` (patch) for existing files; `write` (full overwrite) for new files |
| Skill activation | Automatic — model decides from descriptions. User can force-activate via `/skill <name>` |
| `--context <file>` flag | Not implemented — reference files in conversation or via AGENTS.md |
| Config file location | `~/.seedcode/config.json` (plain fs, not `conf` lib — avoids platform-specific paths) |
| Confirmation UI | Inline ink component, `y/n` captured by `InputBox` in `waitingForConfirm` mode |
