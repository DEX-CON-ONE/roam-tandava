import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { APP_URL, stackEnv } from "./support";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const supabase = stackEnv();
const port = new URL(APP_URL).port || "4173";

// The app is built the way the ROAM deployment is built: same brand settings,
// live-data-only mode, no demo mode. Only the backend address differs.
function brandEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of readFileSync(join(root, "brands", "roam", "brand.env"), "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?\s*$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: join(root, "test-results", "owner-e2e.json") }]],
  outputDir: join(root, "test-results", "owner"),
  use: {
    baseURL: APP_URL,
    locale: "en-GB",
    timezoneId: "Europe/London",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: root,
    url: `${APP_URL}/auth/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      ...brandEnv(),
      // Keep the run on this machine: an anonymous visit to "/" goes to sign-in, not the public website.
      VITE_ROOT_REDIRECT_URL: "/auth/login",
      VITE_SUPABASE_URL: supabase.API_URL,
      VITE_SUPABASE_ANON_KEY: supabase.ANON_KEY,
      VITE_APP_URL: APP_URL,
      VITE_DEMO_MODE: "false",
      VITE_LIVE_DATA_ONLY: "true",
      // Placeholder publishable key: marks the build as Stripe test mode. Never sent to Stripe.
      VITE_STRIPE_PUBLISHABLE_KEY: "pk_test_e2e_local_placeholder",
    },
  },
});
