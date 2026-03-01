import React, { memo } from 'react';
import { Box } from 'ink';
import { ToolCallLine, type ToolCallEntry } from './ToolCallView.js';

interface ActiveToolCallsViewProps {
  calls: ToolCallEntry[];
  onConfirm: (approved: boolean) => void;
}

export const ActiveToolCallsView = memo(function ActiveToolCallsView({
  calls,
  onConfirm,
}: ActiveToolCallsViewProps) {
  if (calls.length === 0) return null;
  return (
    <Box flexDirection="column">
      {calls.map((tc) => (
        <ToolCallLine
          key={tc.id}
          entry={tc}
          onConfirm={tc.status === 'pending' ? onConfirm : undefined}
        />
      ))}
    </Box>
  );
});
