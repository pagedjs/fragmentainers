import { defineConfig } from "@playwright/test";

// Override with FRAG_TEST_PORT so several checkouts can run tests at once.
const PORT = Number(process.env.FRAG_TEST_PORT ?? 8080);

export default defineConfig({
	testDir: ".",
	timeout: 30000,
	retries: 0,
	workers: 8,
	webServer: {
		command: `serve . -p ${PORT} --no-clipboard`,
		port: PORT,
		cwd: "..",
		reuseExistingServer: true,
	},
	use: {
		baseURL: `http://localhost:${PORT}`,
		browserName: "chromium",
		deviceScaleFactor: 1,
		headless: true,
		launchOptions: {
			args: ["--font-render-hinting=none"],
		},
	},
	projects: [
		{
			name: "css-page",
			testMatch: "css-page/css-page.spec.js",
		},
		{
			name: "at-page",
			testMatch: "at-page/at-page.spec.js",
		},
		{
			name: "fragmentation",
			testMatch: "fragmentation/fragmentation.spec.js",
		},
	],
	reporter: [
		["list"],
		["json", { outputFile: "results.json" }],
		["html", { open: "on-failure", outputFolder: "../spec-report" }],
	],
});
