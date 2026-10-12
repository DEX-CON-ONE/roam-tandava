import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the member booking journey. They need a running local
 * Supabase stack, the app built against it, and a Stripe TEST key: see
 * e2e/README.md. They are not part of `npm test` or CI.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4180",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // The journey has to work on a phone, so that is what is tested.
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
});
