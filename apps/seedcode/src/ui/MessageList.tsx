import React from 'react';
import { Box, Text, Static } from 'ink';
import type { TurnEntry } from './ReplApp.js';
import { ToolCallLine } from './ToolCallView.js';
import { renderMarkdown } from './renderMarkdown.js';

interface MessageListProps {
  // Completed turns — rendered via Static, never redrawn
  staticTurns: TurnEntry[];
  // The in-progress assistant turn (streaming), or null
  activeTurn: (TurnEntry & { type: 'assistant' }) | null;
}

export function MessageList({ staticTurns, activeTurn }: MessageListProps) {
  return (
    <>
      {staticTurns.length === 0 && !activeTurn && (
        <Box marginBottom={1}>
          <Text dimColor>Type /help for available commands.</Text>
        </Box>
      )}

      <Static items={staticTurns}>
        {(turn, i) => <TurnView key={i} turn={turn} />}
      </Static>

      {activeTurn && (
        <Box marginTop={1} flexDirection="column">
          <Text color="green" bold>{'seed '}</Text>
          {/* Don't render markdown while streaming — content is incomplete */}
          <Box>
            <Text>{activeTurn.content}</Text>
            <Text color="green">▋</Text>
          </Box>
        </Box>
      )}
    </>
  );
}

function TurnView({ turn }: { turn: TurnEntry }) {
  switch (turn.type) {
    case 'user':
      return (
        <Box marginTop={1}>
          <Text color="cyan" bold>{'you  '}</Text>
          <Text>{turn.content}</Text>
        </Box>
      );

    case 'assistant':
      return (
        <Box marginTop={1} flexDirection="column">
          <Text color="green" bold>{'seed '}</Text>
          <Text>{turn.done ? renderMarkdown(turn.content) : turn.content}</Text>
        </Box>
      );

    case 'error':
      return (
        <Box marginTop={1}>
          <Text color="red">{'✕    '}</Text>
          <Text color="red">{turn.content}</Text>
        </Box>
      );

    case 'info':
      return (
        <Box marginTop={1}>
          <Text dimColor>{turn.content}</Text>
        </Box>
      );

    case 'toolcall':
      return <ToolCallLine entry={turn.entry} />;
  }
}
