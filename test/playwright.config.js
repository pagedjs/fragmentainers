import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 15000,
  workers: 8,
  webServer: {
    command: "serve . -p 8787 --no-clipboard",
    port: 8787,
    cwd: "..",
    reuseExistingServer: true,
  },
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: "http://localhost:8787",
  },
  reporter: [["list"]],
});
