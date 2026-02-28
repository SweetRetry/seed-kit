import { describe, expect, it } from 'vitest';
import { convertToSeedResponsesInput } from './convert-to-seed-responses-input';

describe('convertToSeedResponsesInput', () => {
  it('extracts instructions from system messages', async () => {
    const result = await convertToSeedResponsesInput({
      prompt: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'system', content: 'Always reply in Chinese.' },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    });

    expect(result.instructions).toBe(
      'You are a helpful assistant.\nAlways reply in Chinese.',
    );
    expect(result.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Hello' }],
      },
    ]);
  });

  it('converts video file to input_video part', async () => {
    const result = await convertToSeedResponsesInput({
      prompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this video.' },
            {
              type: 'file',
              mediaType: 'video/mp4',
              data: new URL('https://example.com/clip.mp4'),
            },
          ],
        },
      ],
    });

    expect(result.warnings).toEqual([]);
    expect(result.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'Describe this video.' },
          { type: 'input_video', video_url: 'https://example.com/clip.mp4' },
        ],
      },
    ]);
  });

  it('converts video file with fps provider option', async () => {
    const result = await convertToSeedResponsesInput({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              mediaType: 'video/webm',
              data: new URL('https://example.com/clip.webm'),
              providerOptions: { seed: { fps: 1 } },
            },
          ],
        },
      ],
    });

    expect(result.warnings).toEqual([]);
    expect((result.input[0] as { content: unknown[] }).content[0]).toEqual({
      type: 'input_video',
      video_url: 'https://example.com/clip.webm',
      fps: 1,
    });
  });

  it('converts assistant tool calls and tool results', async () => {
    const result = await convertToSeedResponsesInput({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_1',
              toolName: 'get_weather',
              input: { city: 'Beijing' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_1',
              toolName: 'get_weather',
              output: {
                type: 'json',
                value: { weather: 'sunny' },
              },
            },
          ],
        },
      ],
    });

    expect(result.input).toEqual([
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'get_weather',
        arguments: '{"city":"Beijing"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: '{"weather":"sunny"}',
      },
    ]);
  });
});
