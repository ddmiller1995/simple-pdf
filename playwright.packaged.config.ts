import { defineConfig } from '@playwright/test';

// Opt-in: verifies the BUILT app in release/ (run `pnpm dist:mac` first). Not part of `pnpm e2e`.
export default defineConfig({
  testDir: 'tests/packaged',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
});
