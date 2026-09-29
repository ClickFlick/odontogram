import { defineConfig } from 'vite';

// GitHub Pages serves the demo from /<repo>/ – override with DEMO_BASE for other hosts.
export default defineConfig({
  base: process.env['DEMO_BASE'] ?? '/',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
  },
  server: { port: 5173 },
});
