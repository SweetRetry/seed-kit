import { InferSchema, lazySchema, zodSchema } from '@ai-sdk/provider-utils';
import { z } from 'zod';

const seedUsageSchema = z.object({
  input_tokens: z.number().nullish(),
  output_tokens: z.number().nullish(),
  total_tokens: z.number().nullish(),
  input_tokens_details: z
    .object({
      cached_tokens: z.number().nullish(),
    })
    .nullish(),
  output_tokens_details: z
    .object({
      reasoning_tokens: z.number().nullish(),
    })
    .nullish(),
});

const seedResponseOutputTextSchema = z.object({
  type: z.literal('output_text'),
  text: z.string(),
});

const seedResponseRefusalSchema = z.object({
  type: z.literal('refusal'),
  refusal: z.string(),
});

const seedResponseMessageSchema = z.object({
  id: z.string().nullish(),
  type: z.literal('message'),
  content: z
    .array(
      z.union([seedResponseOutputTextSchema, seedResponseRefusalSchema]),
    )
    .nullish(),
});

const seedResponseReasoningSchema = z.object({
  id: z.string().nullish(),
  type: z.literal('reasoning'),
  summary: z
    .array(
      z.object({
        type: z.literal('summary_text'),
        text: z.string(),
      }),
    )
    .nullish(),
});

const seedResponseFunctionCallSchema = z.object({
  id: z.string(),
  type: z.literal('function_call'),
  call_id: z.string(),
  name: z.string(),
  arguments: z.string().nullish(),
});

export const seedResponseOutputItemSchema = z.union([
  seedResponseMessageSchema,
  seedResponseReasoningSchema,
  seedResponseFunctionCallSchema,
]);

export const seedResponsesResponseSchema = lazySchema(() =>
  zodSchema(
    z.object({
      id: z.string(),
      model: z.string().nullish(),
      created_at: z.number().nullish(),
      output: z.array(seedResponseOutputItemSchema).nullish(),
      incomplete_details: z
        .object({
          reason: z.string().nullish(),
        })
        .nullish(),
      usage: seedUsageSchema.nullish(),
    }),
  ),
);

export const seedResponsesChunkSchema = lazySchema(() =>
  zodSchema(
    z.union([
      z.object({
        type: z.literal('response.output_text.delta'),
        item_id: z.string(),
        delta: z.string(),
      }),
      z.object({
        type: z.enum(['response.completed', 'response.incomplete']),
        response: z.object({
          incomplete_details: z.object({ reason: z.string() }).nullish(),
          usage: seedUsageSchema.nullish(),
        }),
      }),
      z.object({
        type: z.literal('response.created'),
        response: z.object({
          id: z.string(),
          created_at: z.number(),
          model: z.string(),
        }),
      }),
      z.object({
        type: z.literal('response.output_item.added'),
        item: z.discriminatedUnion('type', [
          z.object({ type: z.literal('message'), id: z.string() }),
          z.object({ type: z.literal('reasoning'), id: z.string() }),
          z.object({
            type: z.literal('function_call'),
            id: z.string(),
            call_id: z.string(),
            name: z.string(),
            arguments: z.string(),
          }),
          z.object({ type: z.literal('web_search'), id: z.string() }),
        ]),
      }),
      z.object({
        type: z.literal('response.output_item.done'),
        item: z.discriminatedUnion('type', [
          z.object({ type: z.literal('message'), id: z.string() }),
          z.object({ type: z.literal('reasoning'), id: z.string() }),
          z.object({
            type: z.literal('function_call'),
            id: z.string(),
            call_id: z.string(),
            name: z.string(),
            arguments: z.string(),
          }),
          z.object({ type: z.literal('web_search'), id: z.string() }),
        ]),
      }),
      z.object({
        type: z.literal('response.function_call_arguments.delta'),
        item_id: z.string(),
        delta: z.string(),
      }),
      z.object({
        type: z.literal('response.function_call_arguments.done'),
        item_id: z.string(),
        arguments: z.string(),
      }),
      z.object({
        type: z.literal('response.reasoning_summary_text.delta'),
        item_id: z.string(),
        delta: z.string(),
      }),
      z.object({
        type: z.literal('response.failed'),
        response: z.object({
          incomplete_details: z.object({ reason: z.string() }).nullish(),
          usage: seedUsageSchema.nullish(),
        }),
      }),
      z.object({
        type: z.literal('error'),
        code: z.string().nullish(),
        message: z.string(),
        param: z.string().nullish(),
      }),
      z
        .object({ type: z.string() })
        .passthrough()
        .transform(value => ({
          type: 'unknown_chunk' as const,
          message: (value as { type: string }).type,
        })),
    ]),
  ),
);

export type SeedResponsesResponse = InferSchema<
  typeof seedResponsesResponseSchema
>;
export type SeedResponsesChunk = InferSchema<
  typeof seedResponsesChunkSchema
>;
export type SeedResponsesUsage = z.infer<typeof seedUsageSchema>;
