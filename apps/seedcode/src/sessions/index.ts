import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';

// ── Storage layout ───────────────────────────────────────────────────────────
//  ~/.seedcode/projects/{cwd-slug}/
//    sessions-index.json   — metadata list
//    {uuid}.jsonl          — one JSON line per ModelMessage

const SEEDCODE_DIR = path.join(os.homedir(), '.seedcode');

/** Convert an absolute CWD to the slug Claude Code uses, e.g. /Users/foo/proj → -Users-foo-proj */
function cwdSlug(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

function projectDir(cwd: string): string {
  return path.join(SEEDCODE_DIR, 'projects', cwdSlug(cwd));
}

function indexPath(cwd: string): string {
  return path.join(projectDir(cwd), 'sessions-index.json');
}

function sessionPath(cwd: string, sessionId: string): string {
  return path.join(projectDir(cwd), `${sessionId}.jsonl`);
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionEntry {
  sessionId: string;
  firstPrompt: string;
  messageCount: number;
  created: string;   // ISO
  modified: string;  // ISO
  gitBranch: string;
}

interface SessionsIndex {
  version: 1;
  entries: SessionEntry[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(cwd: string): void {
  fs.mkdirSync(projectDir(cwd), { recursive: true });
}

function readIndex(cwd: string): SessionsIndex {
  try {
    const raw = fs.readFileSync(indexPath(cwd), 'utf-8');
    return JSON.parse(raw) as SessionsIndex;
  } catch {
    return { version: 1, entries: [] };
  }
}

function writeIndex(cwd: string, index: SessionsIndex): void {
  ensureDir(cwd);
  fs.writeFileSync(indexPath(cwd), JSON.stringify(index, null, 2));
}

function readGitBranch(cwd: string): string {
  try {
    const headFile = path.join(cwd, '.git', 'HEAD');
    const head = fs.readFileSync(headFile, 'utf-8').trim();
    return head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : head.slice(0, 8);
  } catch {
    return '';
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Create a new session and return its ID. */
export function createSession(cwd: string): string {
  const sessionId = randomUUID();
  ensureDir(cwd);
  return sessionId;
}

/**
 * Persist the current message list to disk.
 * Called after every user turn and on exit.
 */
export function saveSession(
  cwd: string,
  sessionId: string,
  messages: ModelMessage[],
): void {
  if (messages.length === 0) return;

  ensureDir(cwd);

  const jsonl = messages
    .map((m) => JSON.stringify(m))
    .join('\n');
  fs.writeFileSync(sessionPath(cwd, sessionId), jsonl, 'utf-8');

  const firstUserMsg = messages.find((m) => m.role === 'user');
  const firstPrompt =
    typeof firstUserMsg?.content === 'string'
      ? firstUserMsg.content.slice(0, 120)
      : '';

  const index = readIndex(cwd);
  const existing = index.entries.findIndex((e) => e.sessionId === sessionId);
  const now = new Date().toISOString();

  const entry: SessionEntry = {
    sessionId,
    firstPrompt,
    messageCount: messages.length,
    created: existing >= 0 ? index.entries[existing].created : now,
    modified: now,
    gitBranch: readGitBranch(cwd),
  };

  if (existing >= 0) {
    index.entries[existing] = entry;
  } else {
    index.entries.push(entry);
  }

  writeIndex(cwd, index);
}

/** Load messages from a saved session JSONL file. Returns [] if not found. */
export function loadSession(cwd: string, sessionId: string): ModelMessage[] {
  try {
    const raw = fs.readFileSync(sessionPath(cwd, sessionId), 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ModelMessage);
  } catch {
    return [];
  }
}

/** List all sessions for the given CWD, newest first. */
export function listSessions(cwd: string): SessionEntry[] {
  return readIndex(cwd)
    .entries.slice()
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

/**
 * Resolve a session ID from a prefix (first 8 chars is enough).
 * Returns the full session ID or null if not found / ambiguous.
 */
export function resolveSessionId(cwd: string, prefix: string): string | null {
  const entries = listSessions(cwd);
  const matches = entries.filter((e) => e.sessionId.startsWith(prefix));
  if (matches.length === 1) return matches[0].sessionId;
  return null;
}

/** Delete a session's JSONL file and remove it from the index. */
export function deleteSession(cwd: string, sessionId: string): boolean {
  const index = readIndex(cwd);
  const idx = index.entries.findIndex((e) => e.sessionId === sessionId);
  if (idx < 0) return false;

  try { fs.unlinkSync(sessionPath(cwd, sessionId)); } catch { /* already gone */ }
  index.entries.splice(idx, 1);
  writeIndex(cwd, index);
  return true;
}
