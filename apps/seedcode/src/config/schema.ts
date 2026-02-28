import { z } from 'zod';

export const ConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().default('doubao-seed-1-8-251228'),
  thinking: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_MODEL = 'doubao-seed-1-8-251228';
