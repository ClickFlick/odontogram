import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.browser.test.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['tests/**/*.browser.test.ts'],
          testTimeout: 30_000,
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({
              launchOptions: {
                args: [
                  '--use-angle=swiftshader',
                  '--enable-unsafe-swiftshader',
                  '--ignore-gpu-blocklist',
                  '--enable-webgl',
                ],
              },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
