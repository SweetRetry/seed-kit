import { createJsonErrorResponseHandler } from '@ai-sdk/provider-utils';
import { z } from 'zod';

const seedErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    param: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
  }),
});

export const seedFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: seedErrorSchema,
  errorToMessage: data => data.error.message,
});
