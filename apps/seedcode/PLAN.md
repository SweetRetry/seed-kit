# seedcode — Development Plan

> **Updated**: 2026-03-01 (Phase 6/7 value audit 2026-03-01; Architecture audit 2026-03-01; Gap analysis 2026-02-28)
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

## Phase 5 — Output Quality ✅

**Goal**: Make model output actually readable. Code blocks should look like code.

**Deliverable**: Syntax-highlighted code blocks, Markdown formatting, colored diffs.

### Tasks

#### Markdown Rendering
- [x] `ui/renderMarkdown.ts` — `marked` + `marked-terminal` render Markdown to ANSI (already existed)
- [x] Wire `renderMarkdown` into `MessageList.tsx` for completed assistant turns (`turn.done ? renderMarkdown(turn.content) : turn.content`)
- [x] Streaming turns stay plain text (content is incomplete mid-stream)

#### Diff Display
- [x] `ConfirmPrompt.tsx` — unified diff with green `+` / red `-` coloring, line numbers (already existed)
- [x] `tools/diffStats.ts` — `computeDiffStats(hunk)` returns `{ added, removed }` count
- [x] Wire diff stats into `ConfirmPrompt.tsx`: shows `+N -M lines` summary above diff block

#### Bash Output
- [x] `tools/bash.ts` — `truncateBashOutput(output)`: keeps first 100 + last 50 lines, injects `... N lines truncated ...` marker
- [x] Wire truncation into `tools/index.ts` bash execute — model never receives >150 lines raw
- [x] `ui/ToolCallView.tsx` — show bash stdout/stderr preview (up to 5 lines) in `done` state

### Key decisions
- Markdown already handled by `marked-terminal`; no custom parser needed
- Bash preview in ToolCallView is display-only; model context uses full truncated output

---

## Architecture Audit ✅ (2026-03-01)

**Goal**: Review tool design, system prompt, and sub-agent architecture against Claude Code's published tool design principles.

**Reference**: Claude Code team article on action space design (tool shaping, progressive disclosure, capability-driven evolution).

### Changes
- [x] Inject environment snapshot (CWD, git branch/status, platform, Node) into system prompt — saves 1-2 tool calls per session
- [x] Add "Don't use bash for X" rules — prevents model misusing bash over dedicated tools
- [x] Merge `listDisplays` + `screenshot` into single tool with optional `displayId` — tool count 17→16
- [x] Rewrite sub-agent system prompt with XML tags, tool selection decision tree, structured output format
- [x] Structure diagnostics output as separate `diagnostics` field instead of string concatenation
- [x] Extract shared `buildHunkFromPatch` to `diff-utils.ts` — deduplicate edit.ts + write.ts
- [x] Remove dead code: `buildContextWithSkill()` — defined but never called
- [x] Slim system prompt tool inventory to names only — detailed descriptions stay in tool definitions

### Key decisions
- `loadSkill` stays as tool (not slash command) — enables model-driven progressive disclosure + recursive file discovery
- Bar to add new tools is high — prefer skills/subagents for extending capabilities
- Sub-agent prompt uses XML tags (`<persona>`, `<context>`, `<task>`, `<constraints>`, `<format>`) per prompt engineering best practices

---

## Phase 6 — Hardening ✅ ← (was Phase 6 + 7, consolidated after value audit)

**Goal**: Fix real bugs and add the only reliability primitives that have clear ROI.

**Deliverable**: Abort signal propagation, network retry, atomic file writes.

> **Value audit (2026-03-01)**: Original Phase 6 (Reliability & Safety) and Phase 7 (Agent Power Features)
> were reviewed against actual usage patterns. Most planned items had low ROI:
>
> | Dropped | Reason |
> |---------|--------|
> | File undo / `.bak` rollback | git is a better undo mechanism; Claude Code doesn't have undo either |
> | `/undo` slash command | Same — git checkout / git diff covers this |
> | `--read-only` / `--no-bash` flags | Extremely narrow use case; `--dangerously-skip-permissions` already covers CI |
> | `r` key retry in MessageList | User can press ↑ + Enter; marginal UX gain |
> | Parallel agent progress UI | Sub-agents rarely run in parallel; current progress lines are adequate |
> | `memoryWrite` dedicated tool | Current prompt-instruction + edit/write approach works; usage frequency is low |
> | `memoryRead` tool | Memory is already injected into system prompt on every turn |
> | Smart structured compaction | Current naive `/compact` + 70% auto-trigger is adequate |
> | `/compact --aggressive` | No user demand |
> | Interrupt confirmation dialog | Ctrl+C should be instant; adding a y/n prompt makes it slower |
> | Interrupted session resume | Edge case; partial messages are hard to resume cleanly |

### Tasks

#### P1: Abort Signal Propagation (bug fix)
- [x] Pass `AbortController.signal` to `streamText()` so Ctrl+C cancels the HTTP request
- [x] Pass `AbortSignal` into `ToolLoopAgent.generate()` for sub-agents so parent interrupt kills child streams
- [x] `bash.ts`: added `runBashAsync` using `spawn` + kill on abort signal; main bash tool uses async version, sub-agents keep sync `runBash` (abort handled at agent level)

#### P2: Network Retry
- [x] `utils/retry.ts` — `withRetry()` exponential backoff (3 attempts, 1s/2s/4s, ±25% jitter); `classifyError()` categorizes errors
- [x] Wire into `useAgentStream`: auto-retry on 429/503; surface retry attempt + delay in UI as info banner
- [x] Distinguish error types: `auth` (stop) vs `rate_limit`/`network` (retry) vs `unknown` (stop)

#### P3: Atomic File Writes
- [x] `tools/write.ts` + `tools/edit.ts` — write to `.tmp.{pid}` then `fs.renameSync` to target path

### Key decisions
- File undo deliberately omitted — git is the safety net; adding `.bak` files creates cleanup burden with near-zero value
- Permission tiers deferred until real user demand surfaces
- Parallel agent UI deferred — current `agentProgressLines` is adequate for the single-agent-at-a-time common case
- memoryWrite deferred — prompt-based approach works, dedicated tool adds complexity without proportional benefit
- `runBashAsync` (spawn-based) for main agent; `runBash` (execSync) kept for sub-agents — sub-agent abort is handled at `ToolLoopAgent.generate()` level, no need for per-command signal
- `AbortError` from `streamText` caught silently (not shown as error) — user already sees the Ctrl+C effect
- Retry wraps the entire `streamText` + stream iteration block — if a transient error occurs mid-stream, the full attempt is retried from scratch
- Atomic write uses `.tmp.{pid}` suffix — PID ensures no collision between concurrent processes

---

## Phase 7 — Distribution & DX ← (was Phase 8, promoted after Phase 6/7 consolidation)

**Goal**: Make seedcode easy to install, configure, extend, and debug. Publishable package.

**Deliverable**: One-command install, diagnostic mode, skills authoring guide.

### Tasks

#### Distribution
- [ ] `README.md` — hero section, `npx seedcode` quickstart, AGENTS.md example, skill authoring guide
- [ ] npm publish config: `publishConfig.access=public`, `files: ["dist"]`, `bin.seedcode`
- [ ] Verify `npx seedcode` works from a clean environment
- [ ] `turbo.json` — add `seedcode#build` and `seedcode#typecheck` tasks
- [ ] GitHub Actions: `ci.yml` — typecheck + build on PR; publish on tag `seedcode@*`

#### Diagnostics & Debugging
- [ ] `--debug` CLI flag — log raw API requests/responses to `~/.seedcode/debug/{date}.log`
- [ ] `/debug` slash command — show last API call timing, token breakdown, model used
- [ ] `--dry-run` flag — run agent loop but skip write/edit/bash execution (show what would happen)
- [ ] Cleaner startup error messages: missing API key → friendly wizard prompt, not raw error

#### Skills Authoring
- [ ] `seedcode init skill <name>` subcommand — scaffold `.seedcode/skills/<name>.md` with frontmatter template
- [ ] Validate skill YAML on load; show friendly error if malformed (currently silently skipped)
- [ ] `/skills validate` — check all discovered skills for frontmatter correctness

### Key decisions
- Debug log is append-only, truncated at 50MB
- `--dry-run` still shows diffs and tool descriptions, just skips execution

---

## Backlog — On-Demand Features

> Items moved from original Phase 6/7. Pull into a sprint only when real user demand surfaces.

- [ ] `memoryWrite` dedicated tool — if prompt-based memory writes prove unreliable
- [ ] Parallel agent progress UI (`AgentProgressView.tsx`) — if multi-agent workflows become common
- [ ] Smart structured compaction (`context/compact.ts`) — if naive summary proves inadequate for long sessions
- [ ] `--read-only` / `--no-bash` permission tiers — if requested by users
- [ ] Interrupted session resume — if partial session recovery becomes a real need

---

## Dependency Map

```
Phase 1 (config + REPL)
    ↓
Phase 2 (tools + agent loop)
    ↓
Phase 3a (edit tool + context)      ← closes biggest Claude Code gaps
    ↓
Phase 3b (UX parity)                ← everyday interaction quality
    ↓
Phase 3c (session management)       ← persist + resume conversations
    ↓
Phase 4 (polish + publish)          ← distributable package (TODO)
    ↓
Phase 5 (output quality)            ← readable, highlighted output
    ↓
Architecture Audit                  ← tool design review, prompt engineering
    ↓
Phase 6 (hardening)                 ← abort fix, retry, atomic writes
    ↓
Phase 7 (distribution & DX)         ← npm publish, debug, skills DX
```

## Gap Tracker (vs Claude Code)

| Gap | Closes in |
|-----|-----------|
| Edit tool (patch vs full overwrite) | Phase 3a ✅ |
| System prompt + identity | Phase 3a ✅ |
| AGENTS.md / project context | Phase 3a ✅ |
| Skills system | Phase 3a ✅ |
| Command history (↑↓) | Phase 3b ✅ |
| Multiline input | Phase 3b ✅ |
| Token usage visibility | Phase 3b ✅ |
| `/compact` context compaction | Phase 3b ✅ |
| Large file truncation warning | Phase 3b ✅ |
| Session persistence (auto-save) | Phase 3c ✅ |
| Session list + resume | Phase 3c ✅ |
| Markdown / syntax highlight rendering | Phase 5 ✅ |
| Colored unified diff display | Phase 5 ✅ |
| Bash output streaming + auto-truncation | Phase 5 ✅ |
| Environment snapshot in system prompt | Audit ✅ |
| Tool misuse prevention ("Don't" rules) | Audit ✅ |
| Merge listDisplays + screenshot | Audit ✅ |
| Sub-agent prompt quality | Audit ✅ |
| Structured diagnostics output | Audit ✅ |
| Abort signal propagation (bug fix) | Phase 6 ✅ |
| Network retry (429/503) | Phase 6 ✅ |
| Atomic file writes | Phase 6 ✅ |
| npm publish / `npx seedcode` | Phase 7 |
| Debug mode + dry-run | Phase 7 |
| Skills authoring CLI | Phase 7 |
| Model quality | Out of scope (provider constraint) |
