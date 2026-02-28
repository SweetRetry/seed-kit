import {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3ToolCall,
  LanguageModelV3Usage,
  NoContentGeneratedError,
  SharedV3Warning,
} from '@ai-sdk/provider';
import {
  FetchFunction,
  ParseResult,
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  generateId,
  injectJsonInstructionIntoMessages,
  parseProviderOptions,
  postJsonToApi,
  removeUndefinedEntries,
} from '@ai-sdk/provider-utils';
import { convertToSeedChatMessages } from './convert-to-seed-chat-message';
import { convertSeedUsage } from './convert-seed-chat-usage';
import { getResponseMetadata } from './get-response-metadata';
import { mapSeedFinishReason } from './map-seed-finish-reason';
import {
  SeedChatChunk,
  SeedChatResponse,
  seedChatChunkSchema,
  seedChatResponseSchema,
} from './seed-chat-api';
import {
  seedChatOptions,
  SeedChatOptions,
} from './seed-chat-options';
import { seedFailedResponseHandler } from './seed-error';
import { prepareTools } from './seed-prepare-tools';

export type SeedChatConfig = {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: FetchFunction;
};

export class SeedChatLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  private readonly config: SeedChatConfig;

  constructor(modelId: string, config: SeedChatConfig) {
    this.modelId = modelId;
    this.provider = config.provider;
    this.config = config;
  }

  private async getArgs({
    responseFormat,
    prompt,
    maxOutputTokens,
    temperature,
    topP,
    topK,
    presencePenalty,
    frequencyPenalty,
    stopSequences,
    seed,
    tools,
    toolChoice,
    providerOptions,
  }: LanguageModelV3CallOptions) {
    const warnings: SharedV3Warning[] = [];

    // Parse provider options
    const options =
      (await parseProviderOptions<SeedChatOptions>({
        provider: 'seed',
        providerOptions,
        schema: seedChatOptions,
      })) ?? {};

    // Unsupported features warnings
    if (topK != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'topK',
      });
    }

    if (presencePenalty != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'presencePenalty',
      });
    }

    if (frequencyPenalty != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'frequencyPenalty',
      });
    }

    if (stopSequences != null && stopSequences.length > 0) {
      warnings.push({
        type: 'unsupported',
        feature: 'stopSequences',
      });
    }

    // Handle response format
    let messages = convertToSeedChatMessages(prompt);
    let responseFormatConfig: Record<string, unknown> | undefined;

    if (responseFormat?.type === 'json') {
      if (
        responseFormat.schema != null &&
        options.structuredOutputs !== false
      ) {
        responseFormatConfig = {
          type: 'json_schema',
          json_schema: {
            name: responseFormat.name ?? 'response',
            description: responseFormat.description,
            schema: responseFormat.schema,
            strict: options.strictJsonSchema ?? false,
          },
        };
      } else {
        responseFormatConfig = { type: 'json_object' };
        messages = convertToSeedChatMessages(
          injectJsonInstructionIntoMessages({
            messages: prompt,
            schema: responseFormat.schema,
          }),
        );
      }
    }

    // Prepare tools
    const {
      tools: seedTools,
      toolChoice: seedToolChoice,
      toolWarnings,
    } = await prepareTools({ tools, toolChoice });

    // Convert boolean thinking option to Seed API format
    const thinkingConfig =
      options.thinking === true
        ? { type: 'enabled' as const }
        : options.thinking === false
          ? { type: 'disabled' as const }
          : undefined;

    return {
      args: removeUndefinedEntries({
        model: this.modelId,
        messages,
        ...(options.maxCompletionTokens != null
          ? { max_completion_tokens: options.maxCompletionTokens }
          : { max_tokens: maxOutputTokens }),
        temperature,
        top_p: topP,
        seed,
        response_format: responseFormatConfig,
        tools: seedTools,
        tool_choice: seedToolChoice,
        parallel_tool_calls: options.parallelToolCalls,
        thinking: thinkingConfig,
      }),
      warnings: [...warnings, ...toolWarnings],
    };
  }

  async doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    const { args, warnings } = await this.getArgs(options);

    const { value: response, responseHeaders } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body: args,
      failedResponseHandler: seedFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        seedChatResponseSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const choice = response.choices[0];

    if (!choice) {
      throw new NoContentGeneratedError({
        message: 'No choices returned in response',
      });
    }

    const content = this.extractContent(choice.message);
    const usage = convertSeedUsage(response.usage);
    const finishReason = mapSeedFinishReason(choice.finish_reason);

    return {
      content,
      usage,
      finishReason,
      warnings,
      request: {
        body: {
          ...args,
          stream: false,
        },
      },
      response: {
        ...getResponseMetadata(response),
        headers: responseHeaders,
        body: response,
      },
    };
  }

  async doStream(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    const { args, warnings } = await this.getArgs(options);

    const { value: eventStream, responseHeaders } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body: { ...args, stream: true, stream_options: { include_usage: true } },
      failedResponseHandler: seedFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(
        seedChatChunkSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const toolCallState = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let finishReason: LanguageModelV3FinishReason = {
      unified: 'other',
      raw: undefined,
    };
    let usage: LanguageModelV3Usage | undefined;
    let textId: string | undefined;
    let reasoningId: string | undefined;
    let responseMetadataEmitted = false;

    const stream = eventStream.pipeThrough(
      new TransformStream<
        ParseResult<SeedChatChunk>,
        LanguageModelV3StreamPart
      >({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings });
        },

        transform(parseResult, controller) {
          if (parseResult.success === false) {
            controller.enqueue({ type: 'error', error: parseResult.error });
            return;
          }

          const chunk = parseResult.value;

          if (options.includeRawChunks) {
            controller.enqueue({ type: 'raw', rawValue: chunk });
          }

          if (!responseMetadataEmitted && chunk.id) {
            responseMetadataEmitted = true;
            controller.enqueue({
              type: 'response-metadata',
              ...getResponseMetadata(chunk),
            });
          }

          const choice = chunk.choices?.[0];
          if (!choice) {
            if (chunk.usage != null) {
              usage = convertSeedUsage(chunk.usage);
            }
            return;
          }

          const delta = choice.delta;

          if (delta.reasoning_content) {
            if (!reasoningId) {
              reasoningId = generateId();
              controller.enqueue({ type: 'reasoning-start', id: reasoningId });
            }
            controller.enqueue({
              type: 'reasoning-delta',
              id: reasoningId,
              delta: delta.reasoning_content,
            });
          }

          if (delta.content) {
            if (!textId) {
              textId = generateId();
              controller.enqueue({ type: 'text-start', id: textId });
            }
            controller.enqueue({
              type: 'text-delta',
              id: textId,
              delta: delta.content,
            });
          }

          if (delta.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index;
              let toolCall = toolCallState.get(index);

              if (!toolCall) {
                toolCall = {
                  id: toolCallDelta.id ?? generateId(),
                  name: toolCallDelta.function?.name ?? '',
                  arguments: '',
                };
                toolCallState.set(index, toolCall);
                controller.enqueue({
                  type: 'tool-input-start',
                  id: toolCall.id,
                  toolName: toolCall.name,
                });
              }

              if (toolCallDelta.function?.arguments) {
                toolCall.arguments += toolCallDelta.function.arguments;
                controller.enqueue({
                  type: 'tool-input-delta',
                  id: toolCall.id,
                  delta: toolCallDelta.function.arguments,
                });
              }
            }
          }

          if (choice.finish_reason) {
            finishReason = mapSeedFinishReason(choice.finish_reason);
          }

          if (chunk.usage != null) {
            usage = convertSeedUsage(chunk.usage);
          }
        },

        flush(controller) {
          if (reasoningId) {
            controller.enqueue({ type: 'reasoning-end', id: reasoningId });
          }

          if (textId) {
            controller.enqueue({ type: 'text-end', id: textId });
          }

          toolCallState.forEach(toolCall => {
            controller.enqueue({ type: 'tool-input-end', id: toolCall.id });
            controller.enqueue({
              type: 'tool-call',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              input: toolCall.arguments,
            });
          });

          controller.enqueue({
            type: 'finish',
            finishReason,
            usage: usage ?? convertSeedUsage(undefined),
          });
        },
      }),
    );

    return {
      stream,
      request: { body: args },
      response: { headers: responseHeaders },
    };
  }

  private extractContent(
    message: SeedChatResponse['choices'][number]['message'],
  ): LanguageModelV3Content[] {
    const content: LanguageModelV3Content[] = [];

    if (message.reasoning_content) {
      content.push({
        type: 'reasoning',
        text: message.reasoning_content,
      });
    }

    if (message.content) {
      content.push({
        type: 'text',
        text: message.content,
      });
    }

    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        content.push({
          type: 'tool-call',
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          input: toolCall.function.arguments,
        } as LanguageModelV3ToolCall);
      }
    }

    if (content.length === 0) {
      throw new NoContentGeneratedError({
        message: 'No content in response message',
      });
    }

    return content;
  }
}
