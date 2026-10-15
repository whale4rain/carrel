import { defineConfig } from '@playwright/test'

// The end-to-end test drives the built Electron app; run `pnpm build` first.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  outputDir: 'test-results',
  // Actions wait no longer than checks, so a stuck step names itself instead of running out the test.
  use: { actionTimeout: 15_000 },
})
