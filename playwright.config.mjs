import { defineConfig } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    acceptDownloads: true,
    headless: true
  },
  webServer: {
    // Serves the BUILT production artefacts from the repository root.
    command: `node scripts/serve.mjs ${PORT} .`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 15_000
  }
});
