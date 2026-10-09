import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'
import { BACKEND_ENV, BACKEND_URL, FRONTEND_ENV, FRONTEND_PORT, FRONTEND_URL } from './e2e/stack'

// The e2e stack runs on its own ports and database so it never collides with (or touches) the dev stack (see e2e/stack.ts):
//   Postgres  localhost:5433  (docker-compose.e2e.yml, wiped on every `npm run test:e2e`)
//   backend   localhost:3101  (backend-express, migrated and seeded with ACTIVE test users on start)
//   frontend  localhost:3100  (Vite dev server locally, a production build + preview on CI)

// Cross-browser runs (Firefox, WebKit) are opt-in to keep local runs fast: E2E_ALL_BROWSERS=1 npm run test:e2e
const allBrowsers = !!process.env.E2E_ALL_BROWSERS || !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Three browsers at once on every core slow WebKit enough to time out now and then, so cross-browser runs use fewer workers
  workers: process.env.CI ? 1 : allBrowsers ? 6 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: FRONTEND_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Always headless (a headed WebKit window under WSLg ends up with a 0x0 viewport); pass --headed to watch a run
    headless: true,
  },

  projects: [
    // Logs in as each test user and saves the sessions the other projects start from
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
    ...(allBrowsers
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] }, dependencies: ['setup'], testIgnore: /auth\.setup\.ts/ },
          { name: 'webkit', use: { ...devices['Desktop Safari'] }, dependencies: ['setup'], testIgnore: /auth\.setup\.ts/ },
        ]
      : []),
  ],

  webServer: [
    {
      // Migrates and seeds the e2e database, then starts the API (the database itself is started by `pretest:e2e`)
      command: 'npm --prefix ../backend-express run e2e:start',
      url: `${BACKEND_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: BACKEND_ENV,
    },
    {
      command: process.env.CI
        ? `npm run build-only && npm run preview -- --port ${FRONTEND_PORT} --strictPort`
        : `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
      url: FRONTEND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: FRONTEND_ENV,
    },
  ],
})
