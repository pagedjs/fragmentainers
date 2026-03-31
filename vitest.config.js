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
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
          include: ["test/**/*.browser.test.js"],
        },
      },
    ],
  },
});
