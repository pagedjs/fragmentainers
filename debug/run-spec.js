#!/usr/bin/env node
/**
 * Launch a spec test in a headed Playwright browser for debugging.
 *
 * Usage:
 *   node debug/run-spec.js specs/at-page/awesome.html
 *   node debug/run-spec.js specs/at-page/awesome.html --type multicol
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import net from "node:net";

const specPath = process.argv[2];
if (!specPath) {
	console.error("Usage: node debug/run-spec.js <spec-path> [--type print|multicol]");
	process.exit(1);
}

const typeIdx = process.argv.indexOf("--type");
const specType = typeIdx !== -1 ? process.argv[typeIdx + 1] : "print";

const PORT = await findFreePort(8090);
const serverRoot = resolve(import.meta.dirname, "..");
const server = spawn("npx", ["serve", serverRoot, "-l", String(PORT)], {
	stdio: "ignore",
});

// Wait for server to be ready
await new Promise((r) => setTimeout(r, 1000));

const url = `http://localhost:${PORT}/${specPath}`;
console.log(`Opening ${url}`);

const browser = await chromium.launch({ headless: false, devtools: true });
const page = await browser.newPage();

page.on("console", (msg) => console.log(`[browser] ${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => console.error(`[browser] ERROR: ${err.message}`));

await page.goto(url, { waitUntil: "load" });
await page.evaluate((t) => {
	document.documentElement.dataset.specType = t;
}, specType);
await page.addScriptTag({ type: "module", url: "/specs/helpers/process.js" });

try {
	await page.waitForSelector("[data-spec-ready]", { timeout: 30000 });
	const error = await page.getAttribute("html", "data-spec-error");
	if (error) {
		console.error("Spec error:", error);
	} else {
		const count = await page.getAttribute("html", "data-page-count");
		console.log(`Done — ${count ?? "?"} pages`);
	}
} catch {
	console.error("Timed out waiting for spec to finish");
}

console.log("Browser open — close it to exit.");
await new Promise((r) => browser.on("disconnected", r));
server.kill();

function findFreePort(start) {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(start, () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.on("error", () => resolve(findFreePort(start + 1)));
	});
}
