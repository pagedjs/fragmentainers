#!/usr/bin/env node
/**
 * Launch a spec test in a headed Playwright browser for debugging.
 * Supports manual refresh — re-injects the spec processor on each load.
 *
 * Usage:
 *   node debug/viewer.js specs/at-page/awesome.html
 *   node debug/viewer.js specs/at-page/awesome.html --type multicol
 *   node debug/viewer.js specs/at-page/awesome.html --browser firefox
 *   node debug/viewer.js specs/at-page/awesome.html --html output.html
 *   node debug/viewer.js specs/at-page/awesome.html --inspect
 */
import { chromium, firefox, webkit } from "playwright";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import net from "node:net";
import { extractPages, buildHtml, extractInspect } from "./extract.js";

const BROWSERS = { chromium, firefox, webkit };

// --- Logging ---

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

function printUsage() {
	console.log();
	console.log(bold("  fragmentainers view"));
	console.log();
	console.log("  Usage: node debug/viewer.js <spec-path> [options]");
	console.log();
	console.log("  Options:");
	console.log("    --type <print|multicol>             Fragmentation mode (default: print)");
	console.log("    --browser <chromium|firefox|webkit>  Browser engine (default: chromium)");
	console.log("    --html [path]                        Extract pages to HTML file (or stdout)");
	console.log("    --inspect [path]                     Print inspect report (or stdout)");
	console.log("    --pdf [path]                         Save as PDF (default: output.pdf)");
	console.log();
	console.log("  Examples:");
	console.log(dim("    node debug/viewer.js specs/at-page/awesome.html"));
	console.log(dim("    node debug/viewer.js specs/at-page/awesome.html --type multicol"));
	console.log(dim("    node debug/viewer.js specs/at-page/awesome.html --browser firefox"));
	console.log(dim("    node debug/viewer.js specs/at-page/awesome.html --html output.html"));
	console.log(dim("    node debug/viewer.js specs/at-page/awesome.html --inspect"));
	console.log(dim("    node debug/viewer.js specs/at-page/awesome.html --pdf book.pdf"));
	console.log();
}

function printConfig(port, existing, specPath, specType, browserName) {
	const serverLabel = existing ? "(existing)" : "";
	console.log(dim(`  server   http://localhost:${port} ${serverLabel}`));
	console.log(dim(`  spec     ${specPath}`));
	console.log(dim(`  type     ${specType}`));
	console.log(dim(`  browser  ${browserName}`));
	console.log();
}

function printResult(error, count, ms) {
	if (error) {
		console.log(`  ${red("fail")}   ${error.split("\n")[0]}`);
	} else {
		console.log(`  ${green("ready")}  ${count ?? "?"} pages ${dim(`(${ms}ms)`)}`);
	}
}

function printTimeout(timing) {
	console.log(`  ${red("timeout")}  spec did not finish${timing}`);
}

function printFooter() {
	console.log();
	console.log(dim("  Refresh the browser to re-run. Close to exit."));
}

// --- Server ---

async function ensureServer(defaultPort) {
	if (await isPortListening(defaultPort)) {
		return { port: defaultPort, server: null, existing: true };
	}
	const port = await findFreePort(8090);
	const serverRoot = resolve(import.meta.dirname, "..");
	const server = spawn("npx", ["serve", serverRoot, "-l", String(port)], {
		stdio: "ignore",
		detached: false,
	});
	await new Promise((r) => setTimeout(r, 1000));
	return { port, server, existing: false };
}

function isPortListening(port) {
	return new Promise((resolve) => {
		const socket = net.connect(port, "127.0.0.1");
		socket.on("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.on("error", () => resolve(false));
	});
}

function findFreePort(start) {
	return new Promise((resolve) => {
		const srv = net.createServer();
		srv.listen(start, () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.on("error", () => resolve(findFreePort(start + 1)));
	});
}

// --- Browser ---

async function launchBrowser(browserName, { headless = false } = {}) {
	const engine = BROWSERS[browserName];
	if (!engine) {
		console.error(`  Unknown browser: ${browserName}`);
		console.error(`  Available: ${Object.keys(BROWSERS).join(", ")}`);
		process.exit(1);
	}

	const launchOptions = { headless };
	const contextOptions = { viewport: { width: 1200, height: 1440 } };

	if (browserName === "chromium") {
		if (!headless) launchOptions.devtools = true;
		launchOptions.args = [
			"--font-render-hinting=none",
			"--disable-font-subpixel-positioning",
			"--disable-lcd-text",
		];
		if (!headless) contextOptions.deviceScaleFactor = 2;
	}

	const browser = await engine.launch(launchOptions);
	const page = await browser.newPage(contextOptions);
	return { browser, page };
}

function setupSpecInjection(page, specType) {
	page.on("console", (msg) => {
		if (msg.type() === "error") {
			console.log(`  ${red("error")}  ${msg.text()}`);
		}
	});
	page.on("pageerror", (err) => console.log(`  ${red("error")}  ${err.message}`));

	page.on("load", async () => {
		const t0 = Date.now();
		try {
			await page.evaluate((t) => {
				document.documentElement.dataset.specType = t;
			}, specType);
			await page.addScriptTag({ type: "module", url: "/specs/helpers/process.js" });
			await page.waitForSelector("[data-spec-ready]", { timeout: 30000 });
			await page.addStyleTag({
				content: `@media screen { page-container { box-shadow: 0 0 0 1px #ddd; } }`,
			});

			const ms = Date.now() - t0;
			const error = await page.getAttribute("html", "data-spec-error");
			const count = await page.getAttribute("html", "data-page-count");
			printResult(error, count, ms);
		} catch {
			printTimeout(dim(` (${Date.now() - t0}ms)`));
		}
	});
}

// --- Main ---

const specPath = process.argv[2];
if (!specPath) {
	printUsage();
	process.exit(1);
}

const typeIdx = process.argv.indexOf("--type");
const specType = typeIdx !== -1 ? process.argv[typeIdx + 1] : "print";

const browserIdx = process.argv.indexOf("--browser");
const browserName = browserIdx !== -1 ? process.argv[browserIdx + 1] : "chromium";

function parseOptionalArg(flag) {
	const idx = process.argv.indexOf(flag);
	if (idx === -1) return { enabled: false, path: null };
	const next = process.argv[idx + 1];
	const path = next && !next.startsWith("--") ? next : null;
	return { enabled: true, path };
}

const html = parseOptionalArg("--html");
const inspect = parseOptionalArg("--inspect");
const pdf = parseOptionalArg("--pdf");
const headless = html.enabled || inspect.enabled || pdf.enabled;

const { port, server, existing } = await ensureServer(3000);
printConfig(port, existing, specPath, specType, browserName);

if (headless) {
	const { browser, page } = await launchBrowser(browserName, { headless: true });
	await page.goto(`http://localhost:${port}/${specPath}`, { waitUntil: "load" });

	const t0 = Date.now();
	const script = inspect.enabled ? "/debug/inspect-report.js" : "/specs/helpers/process.js";
	await page.addScriptTag({ type: "module", url: script });
	await page.waitForSelector("[data-spec-ready]", { timeout: 30000 });

	const error = await page.getAttribute("html", "data-spec-error");
	if (error) {
		console.error(`  ${red("fail")}   ${error.split("\n")[0]}`);
		await browser.close();
		if (server) server.kill("SIGKILL");
		process.exit(1);
	}

	const ms = Date.now() - t0;
	let output;

	if (pdf.enabled) {
		const outPath = resolve(pdf.path || "output.pdf");
		const pageSize = await page.evaluate(() => {
			const fc = document.querySelector("fragment-container");
			const c = fc?.pageConstraints;
			if (!c) return null;
			return { width: c.pageBoxSize.inlineSize, height: c.pageBoxSize.blockSize };
		});
		await page.pdf({
			path: outPath,
			width: pageSize ? `${pageSize.width}px` : undefined,
			height: pageSize ? `${pageSize.height}px` : undefined,
			margin: { top: "0", right: "0", bottom: "0", left: "0" },
			printBackground: true,
		});
		console.log(`  ${green("saved")}  ${outPath} ${dim(`(${ms}ms)`)}`);
	} else if (inspect.enabled) {
		const output = (await extractInspect(page)) || "";
		const outPath = inspect.path;
		if (outPath) {
			const fullPath = resolve(outPath);
			writeFileSync(fullPath, output);
			console.log(`  ${green("saved")}  ${fullPath} ${dim(`(${ms}ms)`)}`);
		} else {
			process.stdout.write(output);
		}
	} else {
		const pages = await extractPages(page);
		const output = buildHtml(pages);
		const outPath = html.path;
		if (outPath) {
			const fullPath = resolve(outPath);
			writeFileSync(fullPath, output);
			console.log(`  ${green("saved")}  ${fullPath} ${dim(`(${ms}ms)`)}`);
		} else {
			process.stdout.write(output);
		}
	}

	await browser.close();
} else {
	// Interactive: headed browser with refresh support
	const { browser, page } = await launchBrowser(browserName);
	setupSpecInjection(page, specType);

	await page.goto(`http://localhost:${port}/${specPath}`, { waitUntil: "load" });
	printFooter();

	await new Promise((r) => browser.on("disconnected", r));
}

if (server) server.kill("SIGKILL");
process.exit(0);
