import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// GitHub Pages serves the demo from /<repo>/ – override with DEMO_BASE for other hosts.
export default defineConfig(({ command }) => ({
  base: process.env['DEMO_BASE'] ?? '/',
  resolve: {
    // during development consume the core *source* for instant reload; production builds use
    // the built package exactly like a real consumer
    alias:
      command === 'serve'
        ? [
            {
              find: '@oozkul/dental-3d',
              replacement: fileURLToPath(
                new URL('../../packages/core/src/index.ts', import.meta.url),
              ),
            },
          ]
        : [],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
  },
  server: { port: 5173 },
}));
