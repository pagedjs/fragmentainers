import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30000,
  retries: 0,
  workers: 4,
  projects: [
    {
      name: 'setup',
      testMatch: 'helpers/setup.js',
    },
    {
      name: 'css-page',
      testMatch: 'css-page/css-page.spec.js',
      dependencies: ['setup'],
      use: {
        baseURL: 'http://localhost:8080',
        viewport: { width: 1200, height: 1200 },
        browserName: 'chromium',
      },
    },
    {
      name: 'css-break',
      testMatch: 'css-break/css-break.spec.js',
      dependencies: ['setup'],
      use: {
        baseURL: 'http://localhost:8080',
        viewport: { width: 1200, height: 1200 },
        browserName: 'chromium',
      },
    },
    {
      name: 'pagedjs',
      testMatch: 'pagedjs/pagedjs.spec.js',
      dependencies: ['setup'],
      use: {
        baseURL: 'http://localhost:8080',
        viewport: { width: 1200, height: 1200 },
        browserName: 'chromium',
      },
    },
  ],
  reporter: [
    ['list'],
    ['json', { outputFile: 'results.json' }],
  ],
});
