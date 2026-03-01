import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { saveApiKey } from '../config/index.js';

interface SetupWizardProps {
  onDone: (apiKey: string) => void;
  onCancel: () => void;
}

export function SetupWizard({ onDone, onCancel }: SetupWizardProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCancel();
      return;
    }

    if (key.return) {
      const trimmed = value.trim();
      if (!trimmed) {
        setError('API key cannot be empty.');
        return;
      }
      if (trimmed.includes('=')) {
        setError('Enter only the key value, not "KEY_NAME=value".');
        return;
      }
      saveApiKey(trimmed);
      onDone(trimmed);
      return;
    }

    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      setError('');
      return;
    }

    if (key.ctrl || key.meta || key.escape) return;

    setValue((v) => v + input);
    setError('');
  });

  // Mask input like a password
  const masked = '•'.repeat(value.length);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">seedcode — First Run Setup</Text>
      <Box marginTop={1}>
        <Text>Enter your VolcEngine ARK API key </Text>
        <Text dimColor>(saved to ~/.seedcode/config.json)</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="cyan" bold>› </Text>
        <Text>{masked}</Text>
        <Text inverse> </Text>
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>Press Enter to confirm · Ctrl+C to cancel</Text>
        </Box>
      )}
    </Box>
  );
}
