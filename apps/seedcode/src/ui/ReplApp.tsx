import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text } from 'ink';
import { streamText, stepCountIs, generateText, type ModelMessage } from 'ai';
import type { Config } from '../config/schema.js';
import { handleSlashCommand, type SessionState } from '../commands/slash.js';
import { buildTools, isToolError, type ConfirmFn, type PendingConfirm } from '../tools/index.js';
import { buildContext, buildContextWithSkill, type SkillEntry } from '../context/index.js';
import { createSession, saveSession, loadSession } from '../sessions/index.js';
import { InputBox } from './InputBox.js';
import { MessageList } from './MessageList.js';
import { ToolCallLine, type ToolCallEntry } from './ToolCallView.js';

const MAX_TOOL_STEPS = 20;

interface ReplAppProps {
  config: Config;
  version: string;
  seed: ReturnType<typeof import('@seedkit-ai/ai-sdk-provider').createSeed>;
  onExit: () => void;
  skipConfirm?: boolean;
}

export type TurnEntry =
  | { type: 'user'; content: string }
  | { type: 'assistant'; content: string; done: boolean }
  | { type: 'error'; content: string }
  | { type: 'info'; content: string }
  | { type: 'toolcall'; entry: ToolCallEntry };

export function ReplApp({ config: initialConfig, version, seed, onExit, skipConfirm = false }: ReplAppProps) {
  const cwd = process.cwd();

  const [staticTurns, setStaticTurns] = useState<TurnEntry[]>([]);
  const [activeTurn, setActiveTurn] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallEntry[]>([]);
  const [liveConfig, setLiveConfig] = useState<Config>(initialConfig);
  const [totalTokens, setTotalTokens] = useState(0);
  const [waitingForModel, setWaitingForModel] = useState(false);

  const messages = useRef<ModelMessage[]>([]);
  const turnCount = useRef(0);
  const inFlight = useRef(false);
  const abortRef = useRef(false);
  const sessionIdRef = useRef<string>(createSession(process.cwd()));

  // Context state — built at startup and on /clear
  const systemPromptRef = useRef<string>('');
  const availableSkillsRef = useRef<SkillEntry[]>([]);
  const activeSkillsRef = useRef<SkillEntry[]>([]);

  const loadContext = useCallback(() => {
    const result = buildContext(cwd);
    systemPromptRef.current = result.systemPrompt;
    availableSkillsRef.current = result.skills;
    activeSkillsRef.current = [];

    for (const warning of result.warnings) {
      setStaticTurns((prev) => [...prev, { type: 'info' as const, content: `⚠  ${warning}` }]);
    }
  }, [cwd]);

  // Load context on mount
  useEffect(() => {
    loadContext();
  }, [loadContext]);

  const getEffectiveSystemPrompt = (): string => {
    let prompt = systemPromptRef.current;
    for (const skill of activeSkillsRef.current) {
      prompt = buildContextWithSkill(prompt, skill);
    }
    return prompt;
  };

  const pushStatic = useCallback((entry: TurnEntry) => {
    setStaticTurns((prev) => [...prev, entry]);
  }, []);

  const handleSubmit = useCallback(
    (input: string) => {
      if (inFlight.current) return;

      const cmdResult = handleSlashCommand(input, {
        config: liveConfig,
        turnCount: turnCount.current,
        version,
        totalTokens,
        availableSkills: availableSkillsRef.current,
        activeSkills: activeSkillsRef.current,
        sessionId: sessionIdRef.current,
        cwd,
      } satisfies SessionState);

      if (cmdResult.type === 'exit') { onExit(); return; }
      if (cmdResult.type === 'clear') {
        messages.current = [];
        turnCount.current = 0;
        sessionIdRef.current = createSession(cwd);
        setStaticTurns([]);
        setActiveTurn(null);
        setActiveToolCalls([]);
        setTotalTokens(0);
        loadContext();
        pushStatic({ type: 'info', content: '✓ Conversation cleared. Context reloaded.' });
        return;
      }
      if (cmdResult.type === 'model_picker') {
        setWaitingForModel(true);
        return;
      }
      if (cmdResult.type === 'model_change') {
        const newModel = cmdResult.model;
        setLiveConfig((c) => ({ ...c, model: newModel }));
        pushStatic({ type: 'info', content: `✓ Model: ${newModel}` });
        return;
      }
      if (cmdResult.type === 'thinking_toggle') {
        setLiveConfig((c) => {
          const next = !c.thinking;
          pushStatic({ type: 'info', content: `✓ Thinking mode: ${next ? 'on' : 'off'}` });
          return { ...c, thinking: next };
        });
        return;
      }
      if (cmdResult.type === 'skill_activate') {
        const skill = availableSkillsRef.current.find((s) => s.name === cmdResult.skillName);
        if (!skill) {
          pushStatic({ type: 'info', content: `✗ Skill not found: ${cmdResult.skillName}` });
        } else if (activeSkillsRef.current.some((s) => s.name === skill.name)) {
          pushStatic({ type: 'info', content: `  Skill already active: ${skill.name}` });
        } else {
          activeSkillsRef.current = [...activeSkillsRef.current, skill];
          pushStatic({ type: 'info', content: `✓ Skill activated: ${skill.name}` });
        }
        return;
      }
      if (cmdResult.type === 'compact') {
        void runCompact(liveConfig);
        return;
      }
      if (cmdResult.type === 'resume') {
        const loaded = loadSession(cwd, cmdResult.sessionId);
        if (loaded.length === 0) {
          pushStatic({ type: 'info', content: '✗ Session not found or empty.' });
          return;
        }
        messages.current = loaded;
        turnCount.current = loaded.filter((m) => m.role === 'user').length;
        sessionIdRef.current = cmdResult.sessionId;
        setStaticTurns([]);
        setActiveTurn(null);
        setActiveToolCalls([]);
        // Rebuild display from loaded messages
        for (const m of loaded) {
          if (m.role === 'user') {
            pushStatic({ type: 'user', content: typeof m.content === 'string' ? m.content : '' });
          } else if (m.role === 'assistant') {
            pushStatic({ type: 'assistant', content: typeof m.content === 'string' ? m.content : '', done: true });
          }
        }
        pushStatic({ type: 'info', content: `✓ Resumed session ${cmdResult.sessionId.slice(0, 8)} (${loaded.length} messages)` });
        return;
      }
      if (cmdResult.type === 'handled') {
        if (cmdResult.output) pushStatic({ type: 'info', content: cmdResult.output });
        return;
      }

      inFlight.current = true;
      abortRef.current = false;

      pushStatic({ type: 'user', content: input });
      messages.current.push({ role: 'user', content: input });
      turnCount.current++;

      setActiveTurn('');
      setStreaming(true);
      setActiveToolCalls([]);

      void runStream(liveConfig);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveConfig, version, seed, onExit, pushStatic, skipConfirm, totalTokens, loadContext],
  );

  const runStream = async (cfg: Config) => {
    let accumulated = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const confirm: ConfirmFn = (pending) => {
      setPendingConfirm(pending);
    };

    const tools = buildTools({ cwd, confirm, skipConfirm });

    const scheduleFlush = (text: string, done: boolean) => {
      accumulated = text;
      if (done) {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        setActiveTurn(accumulated);
        return;
      }
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        setActiveTurn(accumulated);
      }, 50);
    };

    try {
      const result = streamText({
        model: seed.chat(cfg.model as Parameters<typeof seed.chat>[0]),
        system: getEffectiveSystemPrompt(),
        messages: messages.current,
        tools,
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
        ...(cfg.thinking ? { providerOptions: { seed: { thinking: true } } } : {}),
        onStepFinish: (step) => {
          if (step.text) {
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            pushStatic({ type: 'assistant', content: step.text, done: false });
            accumulated = '';
            setActiveTurn('');
          }

          if (step.toolCalls && step.toolCalls.length > 0) {
            for (const tc of step.toolCalls) {
              const tr = step.toolResults?.find((r) => r.toolCallId === tc.toolCallId);

              const isError = isToolError(tr?.output);

              const entry: ToolCallEntry = {
                id: tc.toolCallId,
                toolName: tc.toolName as import('../tools/index.js').ToolName,
                description: buildToolDescription(tc.toolName, tc.input as Record<string, unknown>),
                status: isError ? 'error' : 'done',
                output: isError ? (tr?.output as import('../tools/index.js').ToolError).error : undefined,
              };
              pushStatic({ type: 'toolcall', entry });
            }
            setActiveToolCalls([]);
          }

          if (step.stepNumber + 1 >= MAX_TOOL_STEPS) {
            pushStatic({
              type: 'error',
              content: `Hard limit reached: ${MAX_TOOL_STEPS} tool steps in one turn. Stopping.`,
            });
            abortRef.current = true;
          }
        },
        onFinish: (result) => {
          if (result.usage) {
            setTotalTokens((prev) => prev + (result.usage.totalTokens ?? 0));
          }
        },
      });

      for await (const chunk of result.textStream) {
        if (abortRef.current) break;
        scheduleFlush(accumulated + chunk, false);
      }
    } catch (err) {
      if (flushTimer) clearTimeout(flushTimer);
      messages.current.pop();
      const msg = err instanceof Error ? err.message : String(err);
      const isAuthError =
        msg.includes('401') || msg.toLowerCase().includes('invalid api key');

      let content: string;
      if (isAuthError) {
        content = 'Invalid API key. Set ARK_API_KEY or reconfigure with /model.';
      } else if (msg.includes('network') || msg.includes('ECONNREFUSED')) {
        content = `Network error: ${msg}\n(Check your connection and try again.)`;
      } else {
        content = `Error: ${msg}`;
      }

      setActiveTurn(null);
      setActiveToolCalls([]);
      setPendingConfirm(null);
      pushStatic({ type: 'error', content });
      inFlight.current = false;
      setStreaming(false);
      return;
    }

    scheduleFlush(accumulated, true);
    setActiveTurn(null);
    setActiveToolCalls([]);
    setPendingConfirm(null);

    if (!abortRef.current && accumulated) {
      messages.current.push({ role: 'assistant', content: accumulated });
      pushStatic({ type: 'assistant', content: accumulated, done: true });
    } else if (abortRef.current) {
      messages.current.pop();
    }

    // Persist session after each completed turn
    saveSession(cwd, sessionIdRef.current, messages.current);

    inFlight.current = false;
    setStreaming(false);
  };

  const runCompact = async (cfg: Config) => {
    if (messages.current.length === 0) {
      pushStatic({ type: 'info', content: 'Nothing to compact.' });
      return;
    }

    inFlight.current = true;
    setStreaming(true);
    pushStatic({ type: 'info', content: '⏳ Compacting conversation...' });

    try {
      const summary = await generateText({
        model: seed.chat(cfg.model as Parameters<typeof seed.chat>[0]),
        messages: [
          ...messages.current,
          {
            role: 'user' as const,
            content:
              'Produce a compact context summary of this conversation for your own use in continuing the session. Write in first-person as the assistant. Cover: decisions made, files modified, key facts established, and any open tasks. ≤500 words. Output only the summary text, no headings.',
          },
        ],
      });

      const tokensBefore = totalTokens;
      const summaryTokens = Math.ceil((summary.text?.length ?? 0) / 4);

      messages.current = [{ role: 'assistant', content: summary.text ?? '' }];
      setTotalTokens(summaryTokens);

      pushStatic({
        type: 'info',
        content: `✓ Compacted: ~${tokensBefore} → ~${summaryTokens} tokens`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushStatic({ type: 'error', content: `Compact failed: ${msg}` });
    }

    inFlight.current = false;
    setStreaming(false);
  };

  const handleInterrupt = useCallback(() => {
    if (inFlight.current) {
      abortRef.current = true;
      if (pendingConfirm) {
        pendingConfirm.resolve(false);
        setPendingConfirm(null);
      }
    } else {
      onExit();
    }
  }, [onExit, pendingConfirm]);

  const handleModelSelect = useCallback((model: string | null) => {
    setWaitingForModel(false);
    if (model) {
      setLiveConfig((c) => ({ ...c, model }));
      pushStatic({ type: 'info', content: `✓ Model: ${model}` });
    }
  }, [pushStatic]);

  const handleConfirm = useCallback((approved: boolean) => {
    if (!pendingConfirm) return;
    pendingConfirm.resolve(approved);
    setPendingConfirm(null);

    setActiveToolCalls((prev) =>
      prev.map((tc) =>
        tc.status === 'pending'
          ? { ...tc, status: approved ? ('running' as const) : ('denied' as const) }
          : tc
      )
    );
  }, [pendingConfirm]);

  const maskedKey = liveConfig.apiKey
    ? liveConfig.apiKey.slice(0, 6) + '...' + liveConfig.apiKey.slice(-4)
    : '✗';

  const activeTurnEntry =
    activeTurn !== null
      ? ({ type: 'assistant', content: activeTurn, done: false } as const)
      : null;

  const isWaitingForConfirm = pendingConfirm !== null;

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Text bold color="cyan">seedcode </Text>
        <Text dimColor>v{version}  model:{liveConfig.model}  key:{maskedKey}</Text>
      </Box>

      <MessageList staticTurns={staticTurns} activeTurn={activeTurnEntry} />

      {activeToolCalls.map((tc) => (
        <ToolCallLine
          key={tc.id}
          entry={tc}
          onConfirm={tc.status === 'pending' ? handleConfirm : undefined}
        />
      ))}

      {pendingConfirm && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text color="yellow" bold>◆  [ {pendingConfirm.toolName} ] {pendingConfirm.description}</Text>
          {pendingConfirm.diffLines && (
            <Box flexDirection="column">
              {pendingConfirm.diffLines.removed.slice(0, 8).map((line, i) => (
                <Text key={`r${i}`} color="red">│  - {line}</Text>
              ))}
              {pendingConfirm.diffLines.removed.length > 8 && (
                <Text dimColor>│  ... ({pendingConfirm.diffLines.removed.length - 8} more removed lines)</Text>
              )}
              {pendingConfirm.diffLines.added.slice(0, 8).map((line, i) => (
                <Text key={`a${i}`} color="green">│  + {line}</Text>
              ))}
              {pendingConfirm.diffLines.added.length > 8 && (
                <Text dimColor>│  ... ({pendingConfirm.diffLines.added.length - 8} more added lines)</Text>
              )}
            </Box>
          )}
          <Box marginTop={1}>
            <Text color="yellow">Apply? </Text>
            <Text bold color="green">y</Text>
            <Text dimColor>/</Text>
            <Text bold color="red">n</Text>
            <Text dimColor> › </Text>
          </Box>
        </Box>
      )}

      <InputBox
        streaming={streaming}
        waitingForConfirm={isWaitingForConfirm}
        waitingForModel={waitingForModel}
        currentModel={liveConfig.model}
        availableSkills={availableSkillsRef.current}
        onSubmit={handleSubmit}
        onInterrupt={handleInterrupt}
        onConfirm={isWaitingForConfirm ? handleConfirm : undefined}
        onModelSelect={handleModelSelect}
      />
    </Box>
  );
}

function buildToolDescription(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'read':
      return String(input.path ?? '');
    case 'edit':
      return String(input.path ?? '');
    case 'write':
      return String(input.path ?? '');
    case 'glob':
      return String(input.pattern ?? '');
    case 'grep':
      return `${input.pattern} in ${input.fileGlob}`;
    case 'bash':
      return String(input.command ?? '');
    case 'webSearch':
      return String(input.query ?? '');
    case 'webFetch':
      return String(input.url ?? '');
    default:
      return JSON.stringify(input);
  }
}
