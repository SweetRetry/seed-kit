import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { deleteLeftOfCursor } from './inputEditing';
import { SLASH_COMMANDS, AVAILABLE_MODELS } from '../commands/slash.js';

const HISTORY_MAX = 100;

interface InputBoxProps {
  streaming: boolean;
  waitingForConfirm?: boolean;
  waitingForModel?: boolean;
  currentModel?: string;
  availableSkills?: Array<{ name: string; scope: 'global' | 'project' }>;
  onSubmit: (value: string) => void;
  onInterrupt: () => void;
  onConfirm?: (approved: boolean) => void;
  onModelSelect?: (model: string | null) => void;
}

type Suggestion = { label: string; complete: string; desc: string };

function getSuggestions(
  val: string,
  skills: Array<{ name: string; scope: 'global' | 'project' }>
): Suggestion[] | null {
  if (!val.startsWith('/')) return null;
  const raw = val.slice(1);

  if (raw.toLowerCase().startsWith('skills:')) {
    const query = raw.slice('skills:'.length).toLowerCase();
    const matches = skills.filter((s) => s.name.toLowerCase().startsWith(query));
    if (matches.length === 0) return null;
    if (matches.length === 1 && matches[0].name.toLowerCase() === query) return null;
    return matches.map((s) => ({
      label: `/skills:${s.name}`,
      complete: `/skills:${s.name}`,
      desc: `[${s.scope[0]}]`,
    }));
  }

  if (raw.includes(' ')) return null;
  const query = raw.toLowerCase();
  const matches = SLASH_COMMANDS.filter((c) => c.name.startsWith(query));
  if (matches.length === 0 || (matches.length === 1 && matches[0].name === query)) return null;
  return matches.map((c) => ({
    label: `/${c.name}${c.args ? ' ' + c.args : ''}`,
    complete: c.args ? `/${c.name} ` : `/${c.name}`,
    desc: c.desc,
  }));
}

export function InputBox({
  streaming,
  waitingForConfirm = false,
  waitingForModel = false,
  currentModel,
  availableSkills = [],
  onSubmit,
  onInterrupt,
  onConfirm,
  onModelSelect,
}: InputBoxProps) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [suggestionIdx, setSuggestionIdx] = useState(-1);
  const [modelIdx, setModelIdx] = useState(() => {
    const idx = AVAILABLE_MODELS.indexOf(currentModel as typeof AVAILABLE_MODELS[number]);
    return idx >= 0 ? idx : 0;
  });

  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  const suggestionIdxRef = useRef(suggestionIdx);
  const modelIdxRef = useRef(modelIdx);
  valueRef.current = value;
  cursorRef.current = cursor;
  suggestionIdxRef.current = suggestionIdx;
  modelIdxRef.current = modelIdx;

  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const draftRef = useRef('');
  const pendingLinesRef = useRef<string[]>([]);

  const update = (newValue: string, newCursor: number) => {
    valueRef.current = newValue;
    cursorRef.current = newCursor;
    setValue(newValue);
    setCursor(newCursor);
  };

  const reset = () => {
    update('', 0);
    historyIdxRef.current = -1;
    draftRef.current = '';
    setSuggestionIdx(-1);
  };

  useInput(
    (input, key) => {
      const val = valueRef.current;
      const cur = cursorRef.current;
      const sugIdx = suggestionIdxRef.current;

      if (key.ctrl && input === 'c') {
        if (waitingForModel) { onModelSelect?.(null); return; }
        if (streaming || waitingForConfirm) { onInterrupt(); return; }
        if (val.length > 0 || pendingLinesRef.current.length > 0) {
          pendingLinesRef.current = [];
          reset();
        } else {
          onInterrupt();
        }
        return;
      }

      // ── Model picker mode ──────────────────────────────────────────────
      if (waitingForModel) {
        const idx = modelIdxRef.current;
        if (key.upArrow) {
          const next = idx <= 0 ? AVAILABLE_MODELS.length - 1 : idx - 1;
          setModelIdx(next);
          modelIdxRef.current = next;
          return;
        }
        if (key.downArrow) {
          const next = idx >= AVAILABLE_MODELS.length - 1 ? 0 : idx + 1;
          setModelIdx(next);
          modelIdxRef.current = next;
          return;
        }
        if (key.return) { onModelSelect?.(AVAILABLE_MODELS[idx]); return; }
        if (key.escape) { onModelSelect?.(null); return; }
        return;
      }

      // ── Confirm mode ───────────────────────────────────────────────────
      if (waitingForConfirm && onConfirm) {
        if (input === 'y' || input === 'Y') { onConfirm(true); return; }
        if (input === 'n' || input === 'N' || key.escape) { onConfirm(false); return; }
        return;
      }

      if (streaming) return;

      if (key.escape) { setSuggestionIdx(-1); return; }

      const suggestions = getSuggestions(val, availableSkills);

      if (suggestions && (key.upArrow || key.downArrow)) {
        const len = suggestions.length;
        setSuggestionIdx(key.upArrow
          ? (sugIdx <= 0 ? len - 1 : sugIdx - 1)
          : (sugIdx >= len - 1 ? 0 : sugIdx + 1));
        return;
      }

      if (suggestions && sugIdx >= 0 && (input === '\t' || key.return)) {
        const sug = suggestions[sugIdx];
        update(sug.complete, sug.complete.length);
        setSuggestionIdx(-1);
        if (key.return && !sug.complete.endsWith(' ')) {
          const trimmed = sug.complete.trim();
          reset();
          if (historyRef.current[0] !== trimmed)
            historyRef.current = [trimmed, ...historyRef.current].slice(0, HISTORY_MAX);
          onSubmit(trimmed);
        }
        return;
      }

      if (key.return) {
        if (val.endsWith('\\')) {
          pendingLinesRef.current = [...pendingLinesRef.current, val.slice(0, -1)];
          update('', 0);
          return;
        }
        const trimmed = [...pendingLinesRef.current, val].join('\n').trim();
        pendingLinesRef.current = [];
        reset();
        if (trimmed) {
          if (historyRef.current[0] !== trimmed)
            historyRef.current = [trimmed, ...historyRef.current].slice(0, HISTORY_MAX);
          onSubmit(trimmed);
        }
        return;
      }

      if (!suggestions && pendingLinesRef.current.length === 0) {
        if (key.upArrow) {
          const history = historyRef.current;
          if (history.length === 0) return;
          if (historyIdxRef.current === -1) draftRef.current = val;
          const nextIdx = Math.min(historyIdxRef.current + 1, history.length - 1);
          historyIdxRef.current = nextIdx;
          const entry = history[nextIdx];
          update(entry, entry.length);
          return;
        }
        if (key.downArrow) {
          if (historyIdxRef.current === -1) return;
          const nextIdx = historyIdxRef.current - 1;
          historyIdxRef.current = nextIdx;
          if (nextIdx === -1) { const d = draftRef.current; update(d, d.length); }
          else { const e = historyRef.current[nextIdx]; update(e, e.length); }
          return;
        }
      }

      if (key.leftArrow) { update(val, Math.max(0, cur - 1)); return; }
      if (key.rightArrow) { update(val, Math.min(val.length, cur + 1)); return; }
      if ((key.meta && key.leftArrow) || (key.ctrl && input === 'b')) { update(val, prevWordBoundary(val, cur)); return; }
      if ((key.meta && key.rightArrow) || (key.ctrl && input === 'f')) { update(val, nextWordBoundary(val, cur)); return; }
      if (key.ctrl && input === 'a') { update(val, 0); return; }
      if (key.ctrl && input === 'e') { update(val, val.length); return; }
      if (key.ctrl && input === 'k') { update(val.slice(0, cur), cur); return; }
      if (key.ctrl && input === 'u') { update(val.slice(cur), 0); return; }

      if (key.backspace || (key.delete && input === '\x7f')) {
        const next = deleteLeftOfCursor(val, cur); update(next.value, next.cursor); return;
      }
      if (key.delete && input === '') {
        const next = deleteLeftOfCursor(val, cur); update(next.value, next.cursor); return;
      }

      if (key.ctrl || key.meta) return;

      if (input) {
        if (historyIdxRef.current !== -1) { historyIdxRef.current = -1; draftRef.current = ''; }
        setSuggestionIdx(-1);
        update(val.slice(0, cur) + input + val.slice(cur), cur + input.length);
      }
    },
    { isActive: true }
  );

  // ── Model picker UI ──────────────────────────────────────────────────────
  if (waitingForModel) {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text dimColor>  Select model  </Text>
          <Text dimColor>↑↓ move · Enter confirm · Esc cancel</Text>
        </Box>
        {AVAILABLE_MODELS.map((m, i) => {
          const selected = i === modelIdx;
          const isCurrent = m === currentModel;
          return (
            <Box key={m} marginLeft={2}>
              {selected
                ? <Text bold color="cyan" inverse>{` ${m} `}</Text>
                : <Text color={isCurrent ? 'cyan' : undefined}>{m}</Text>
              }
              {isCurrent && !selected && <Text dimColor>  current</Text>}
            </Box>
          );
        })}
      </Box>
    );
  }

  if (waitingForConfirm) {
    return (
      <Box>
        <Text dimColor>  [y/n to confirm · Ctrl+C to cancel]</Text>
      </Box>
    );
  }

  if (streaming) {
    return (
      <Box>
        <Text dimColor>  [Ctrl+C to interrupt]</Text>
      </Box>
    );
  }

  const before = value.slice(0, cursor);
  const atCursor = value[cursor] ?? ' ';
  const after = value.slice(cursor + 1);
  const isMultiline = pendingLinesRef.current.length > 0;
  const suggestions = getSuggestions(value, availableSkills);

  return (
    <Box flexDirection="column">
      {isMultiline && (
        <Box flexDirection="column">
          {pendingLinesRef.current.map((line, i) => (
            <Box key={`pending-${i}`}>
              <Text dimColor>{'  '}</Text>
              <Text dimColor>{line}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box>
        <Text color="cyan" bold>{isMultiline ? '… ' : '› '}</Text>
        <Text>{before}</Text>
        <Text inverse>{atCursor}</Text>
        <Text>{after}</Text>
      </Box>
      {suggestions && (
        <Box flexDirection="column" marginLeft={2}>
          {suggestions.map((s, i) => {
            const selected = i === suggestionIdx;
            return (
              <Box key={s.complete}>
                {selected
                  ? <Text bold color="cyan" inverse>{` ${s.label} `}</Text>
                  : <Text color="cyan">{s.label}</Text>
                }
                {!selected && <Text dimColor>{`  ${s.desc}`}</Text>}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function prevWordBoundary(value: string, pos: number): number {
  let i = pos - 1;
  while (i > 0 && value[i] === ' ') i--;
  while (i > 0 && value[i - 1] !== ' ') i--;
  return Math.max(0, i);
}

function nextWordBoundary(value: string, pos: number): number {
  let i = pos;
  while (i < value.length && value[i] !== ' ') i++;
  while (i < value.length && value[i] === ' ') i++;
  return Math.min(value.length, i);
}
