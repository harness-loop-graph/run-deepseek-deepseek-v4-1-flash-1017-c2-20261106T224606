import { defineConfig, devices } from '@playwright/test';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:8080';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Seed!Passw0rd';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  metadata: {
    backendUrl: BACKEND_URL,
    seedPassword: SEED_PASSWORD,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
