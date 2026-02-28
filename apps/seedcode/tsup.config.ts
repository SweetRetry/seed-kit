import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  sourcemap: false,
  minify: false,
  // Bundle workspace packages into the output so no external dist is needed
  noExternal: ['@seedkit-ai/ai-sdk-provider'],
  onSuccess: 'chmod +x dist/index.js',
});
