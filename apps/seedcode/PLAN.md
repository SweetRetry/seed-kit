# seedcode — Development Plan

> **Updated**: 2026-02-28
> **Goal**: Functional parity with Claude Code's core coding loop, constrained only by model quality.
> Each phase is a fully usable milestone. Later phases build on earlier ones without breaking them.

---

## Phase 1 — Minimal Working Shell ✅

**Goal**: A user can start `seedcode`, get prompted for an API key on first run, have a conversation with the model, and get streaming responses.

### Tasks
- [x] `config/schema.ts` — Zod schema for `~/.seedcode/config.json`
- [x] `config/index.ts` — load config, merge with env + CLI flags
- [x] `tsup.config.ts` — ESM build, shebang, `chmod +x`
- [x] `src/index.ts` — parse CLI flags via `commander`
- [x] `repl.tsx` — single `render(<App />)`, ink stays mounted
- [x] `ui/ReplApp.tsx` — streaming loop, slash dispatch, state management
- [x] `ui/InputBox.tsx` — `useInput` keyboard handler
- [x] `ui/MessageList.tsx` — `<Static>` for completed turns
- [x] `ui/SetupWizard.tsx` — first-run API key prompt (pure ink)
- [x] Ctrl+C: interrupt streaming → exit
- [x] Slash: `/exit`, `/quit`, `/help`, `/status`

### Key decisions
- No `@clack/prompts` inside the REPL — mixing with ink causes terminal flicker
- `tsx watch` breaks ink — dev: `tsup && node dist/index.js`
- `conf` dropped — replaced with plain `node:fs` at `~/.seedcode/config.json`
- `<Static>` for message history — prevents redraw on keystroke
- Streaming throttled at 50ms

---

## Phase 2 — Agent Loop with Tools ✅

**Goal**: The model can read/write files, search the codebase, run shell commands, and ask for confirmation before making changes.

### Tasks
- [x] `tools/index.ts` — tool registry, `buildTools()`, `ConfirmFn` Promise pattern
- [x] `tools/read.ts` — read file + deny list (`~/.ssh`, `~/.aws`, etc.)
- [x] `tools/write.ts` — full-file write with `+added / -removed` confirmation
- [x] `tools/glob.ts` — glob pattern file match
- [x] `tools/grep.ts` — regex search across files
- [x] `tools/bash.ts` — sandboxed shell (denylist + CWD boundary + timeout)
- [x] `ui/ToolCallView.tsx` — ink component for tool call status line
- [x] Wire `streamText` with tools (`stopWhen: stepCountIs(20)`)
- [x] `onStepFinish` → commit tool call lines to `<Static>`
- [x] `InputBox` `waitingForConfirm` mode — suspend text input during y/n prompt
- [x] Hard limit: 20 tool steps per turn
- [x] `--dangerously-skip-permissions` flag (blocked on TTY)
- [x] Slash: `/clear`, `/model <id>`, `/thinking`

### Key decisions
- ai@6: `tool()` uses `inputSchema` (not `parameters`), `execute` receives `input` (not `args`)
- `stopWhen: stepCountIs(N)` replaces `maxSteps`
- `onStepFinish` step: `.toolCalls[].input`, `.toolResults[].output`
- Confirmation via Promise — `tools/index.ts` creates one Promise per confirm, resolved by `y/n` keypress
- `minimatch` + `glob` added as runtime deps

---

## Phase 3a — Context Foundation + Edit Tool ✅

**Goal**: Close the two biggest gaps vs Claude Code — system prompt context awareness and surgical file editing.

**Deliverable**: `seedcode` reads project conventions automatically and edits files safely without full-file overwrites.

### Tasks

#### Edit Tool
- [x] `tools/edit.ts` — patch-based file edit (old_string → new_string, exactly-once validation, inline diff)
- [x] Register `edit` in `tools/index.ts`; `PendingConfirm` carries `diffLines` for UI rendering

#### System Prompt + Context Assembly
- [x] `context/agents-md.ts` — global (4k) + project (8k) AGENTS.md discovery, truncation with warnings
- [x] `context/skills.ts` — scan `~/.agents/skills/` + `.seedcode/skills/`, YAML frontmatter via Zod, 2k budget
- [x] `context/index.ts` — compose system prompt; `buildContextWithSkill()` for on-demand injection
- [x] Wire context into `streamText` `system` param in `ReplApp.tsx`
- [x] `/clear` — reset history AND reload context from disk
- [x] Startup warning if context exceeds 20k token budget

#### Slash Commands
- [x] `/skills` — list discovered skills with `[global]` / `[project]` tag + active marker
- [x] `/skill <name>` — force-activate a skill into current context

---

## Phase 3c — Session Management ✅

**Goal**: Persist conversation history per project directory; resume past sessions.

**Deliverable**: Every session is auto-saved to `~/.seedcode/projects/{cwd-slug}/`. Users can list and resume past sessions.

### Tasks

- [x] `sessions/index.ts` — `createSession`, `saveSession`, `loadSession`, `listSessions`, `resolveSessionId`, `deleteSession`
- [x] Storage layout: `~/.seedcode/projects/{cwd-slug}/{uuid}.jsonl` + `sessions-index.json`
- [x] `ReplApp.tsx` — auto-create session ID on mount; auto-save after every completed turn; new session ID on `/clear`
- [x] `/sessions` — list past sessions for current CWD (newest first, firstPrompt preview, git branch)
- [x] `/resume <id-prefix>` — load messages from past session, rebuild display
- [x] `/status` — shows short session ID
- [x] `SessionState` extended: `sessionId`, `cwd`

### Key decisions
- CWD slug mirrors Claude Code convention: `/Users/foo/proj` → `-Users-foo-proj`
- JSONL format: one `ModelMessage` per line (compatible with AI SDK v6 `ModelMessage`)
- First 8 chars of UUID used as user-facing ID prefix (sufficient for unambiguous resolution)
- `/resume` rebuilds `<Static>` turns from loaded messages so conversation history is visible
- Save only on successful turn completion (not on error/abort) to avoid corrupting state

---

## Phase 3b — UX Parity ✅

**Goal**: Eliminate UX gaps vs Claude Code on everyday interactions.

**Deliverable**: Command history, multiline input, token visibility, context compaction.

### Tasks

#### Input UX
- [x] **Command history** — ↑/↓ recall within session, ring buffer max 100, saves draft while browsing
- [x] **Multiline input** — `\` at end of line continues; prompt shows `… ` + previous lines; Enter submits

#### Context Management
- [x] **Token counter** — accumulated from `streamText` `onFinish` usage; shown in `/status`
- [x] `/compact` — summarise conversation to ≤500 words via `generateText`; shows token delta
- [x] `SessionState` extended: `totalTokens`, `availableSkills`, `activeSkills`

#### Large File Handling
- [x] `tools/read.ts` — warn if file > 500 lines; warning surfaced in tool output

---

## Phase 4 — Polish & Distribution

**Goal**: Publishable package. Ready for `npm install -g seedcode`.

### Tasks
- [ ] `README.md` — install, quickstart, config reference, AGENTS.md example
- [ ] npm publish config (`publishConfig`, `files`, `bin`)
- [ ] Verify `npx seedcode` works from a clean environment
- [ ] Add to turbo pipeline (`build`, `typecheck`)
- [ ] `/status` shows accumulated token usage (after Phase 3b)

---

## Dependency Map

```
Phase 1 (config + REPL)
    ↓
Phase 2 (tools + agent loop)
    ↓
Phase 3a (edit tool + context)   ← closes biggest Claude Code gaps
    ↓
Phase 3b (UX parity)             ← everyday interaction quality
    ↓
Phase 3c (session management)    ← persist + resume conversations
    ↓
Phase 4 (polish + publish)
```

## Gap Tracker (vs Claude Code)

| Gap | Closes in |
|-----|-----------|
| Edit tool (patch vs full overwrite) | Phase 3a |
| System prompt + identity | Phase 3a |
| AGENTS.md / project context | Phase 3a |
| Skills system | Phase 3a |
| Command history (↑↓) | Phase 3b |
| Multiline input | Phase 3b |
| Token usage visibility | Phase 3b |
| `/compact` context compaction | Phase 3b |
| Large file truncation warning | Phase 3b |
| Session persistence (auto-save) | Phase 3c |
| Session list + resume | Phase 3c |
| Model quality | Out of scope (provider constraint) |
