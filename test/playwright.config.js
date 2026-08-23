import { defineConfig } from "@playwright/test";

// Override with FRAG_TEST_PORT so several checkouts can run tests at once.
const PORT = Number(process.env.FRAG_TEST_PORT ?? 8787);

export default defineConfig({
	testDir: ".",
	timeout: 15000,
	workers: 8,
	webServer: {
		command: `serve . -p ${PORT} --no-clipboard`,
		port: PORT,
		cwd: "..",
		reuseExistingServer: true,
	},
	use: {
		browserName: "chromium",
		headless: true,
		baseURL: `http://localhost:${PORT}`,
	},
	reporter: [["list"]],
});
