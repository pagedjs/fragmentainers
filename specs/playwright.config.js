import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: ".",
  timeout: 30000,
  retries: 0,
  workers: 8,
  projects: [
    {
      name: "css-page",
      testMatch: "css-page/css-page.spec.js",
      use: {
        baseURL: "http://localhost:8080",
        viewport: { width: 1200, height: 1200 },
        browserName: "chromium",
      },
    },
    {
      name: "pagedjs",
      testMatch: "pagedjs/pagedjs.spec.js",
      use: {
        baseURL: "http://localhost:8080",
        viewport: { width: 1200, height: 1200 },
        browserName: "chromium",
      },
    },
    {
      name: "fragmentation",
      testMatch: "fragmentation/fragmentation.spec.js",
      use: {
        baseURL: "http://localhost:8080",
        viewport: { width: 1200, height: 1200 },
        browserName: "chromium",
      },
    },
  ],
  reporter: [
    ["list"],
    ["json", { outputFile: "results.json" }],
    ["html", { open: "on-failure", outputFolder: "../spec-report" }],
  ],
});
