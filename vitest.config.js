import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["test/**/*.test.js"],
          exclude: ["test/**/*.browser.test.js"],
          setupFiles: ["./test/setup-dom-globals.js"],
        },
      },
      {
        test: {
          name: "browser",
          browser: {
            enabled: true,
            provider: playwright({ launch: { headless: true } }),
            instances: [{ browser: "chromium" }],
          },
          include: ["test/**/*.browser.test.js"],
        },
      },
    ],
  },
});
