import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
	testDir: ".",
	timeout: 30000,
	retries: 0,
	workers: 8,
	use: {
		baseURL: "http://localhost:8080",
		browserName: "chromium",
		deviceScaleFactor: 1,
		headless: true,
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
