import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { ToolName } from '../tools/index.js';

export type ToolCallStatus =
  | 'pending'      // waiting for confirmation
  | 'running'      // executing
  | 'done'         // finished successfully
  | 'error'        // failed
  | 'denied';      // user denied

export interface ToolCallEntry {
  id: string;
  toolName: ToolName;
  description: string;
  status: ToolCallStatus;
  output?: string;
}

interface ToolCallLineProps {
  entry: ToolCallEntry;
  /** Only relevant when status === 'pending' */
  onConfirm?: (approved: boolean) => void;
}

export function ToolCallLine({ entry, onConfirm }: ToolCallLineProps) {
  useInput(
    (input, key) => {
      if (entry.status !== 'pending' || !onConfirm) return;
      if (input === 'y' || input === 'Y') {
        onConfirm(true);
      } else if (input === 'n' || input === 'N' || key.escape) {
        onConfirm(false);
      }
    },
    { isActive: entry.status === 'pending' }
  );

  const icon = {
    pending: '◆',
    running: '◆',
    done: '◆',
    error: '✕',
    denied: '◆',
  }[entry.status];

  const iconColor = {
    pending: 'yellow',
    running: 'cyan',
    done: 'green',
    error: 'red',
    denied: 'gray',
  }[entry.status] as string;

  const statusSuffix = {
    pending: '',
    running: ' ...',
    done: ' ✔',
    error: ' ✕',
    denied: ' (denied)',
  }[entry.status];

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={iconColor}>{icon}  </Text>
        <Text color="cyan" bold>{`[ ${entry.toolName} ] `}</Text>
        <Text>{entry.description}</Text>
        <Text dimColor>{statusSuffix}</Text>
      </Box>

      {entry.status === 'pending' && (
        <Box marginLeft={3}>
          <Text color="yellow">│  Apply? </Text>
          <Text bold color="green">y</Text>
          <Text dimColor>/</Text>
          <Text bold color="red">n</Text>
          <Text dimColor> › </Text>
        </Box>
      )}

      {entry.status === 'error' && entry.output && (
        <Box marginLeft={3}>
          <Text color="red">{entry.output}</Text>
        </Box>
      )}
    </Box>
  );
}
