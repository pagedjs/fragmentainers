import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const UPDATE_REFS = !!process.env.UPDATE_REFS;

/**
 * Create a visual regression spec suite from a tests.yml file.
 *
 * @param {string} suiteName - Suite key in tests.yml (e.g. "css-page")
 * @param {string} suiteDir - Absolute path to the suite directory
 * @param {object} [options]
 * @param {number} [options.maxDiffPixelRatio=0.10] - Max fraction of differing pixels
 * @param {number} [options.threshold=0.1] - Per-pixel color distance threshold for pixelmatch
 */
export function createSpecSuite(
	suiteName,
	suiteDir,
	{ maxDiffPixelRatio = 0.1, threshold = 0.1 } = {},
) {
	const raw = YAML.parse(fs.readFileSync(path.join(suiteDir, "tests.yml"), "utf8"))[suiteName];

	const entries = raw.map((entry) => {
		if (typeof entry === "string") {
			return { name: entry, skip: false };
		}
		return { name: entry.name, skip: entry.skip || false };
	});

	test.describe.configure({ mode: "parallel" });
	test.describe(suiteName, () => {
		for (const { name, skip } of entries) {
			test(name, async ({ page }, testInfo) => {
				if (skip) {
					test.skip(true, typeof skip === "string" ? skip : undefined);
				}

				const refPath = path.join(suiteDir, `${name}-ref.html`);
				const refSuffix = UPDATE_REFS ? "#ref" : "";

				await page.goto(`/specs/${suiteName}/${name}.html${refSuffix}`, {
					waitUntil: "load",
				});
				await page.addScriptTag({
					type: "module",
					url: "/specs/helpers/process.js",
				});
				await page.waitForSelector("[data-spec-ready]", { timeout: 15000 });

				const error = await page.getAttribute("html", "data-spec-error");
				if (error) {
					console.warn(`  Processing error in ${name}: ${error}`);
				}

				// When updating, save generated ref HTML (never overwrite existing)
				if (UPDATE_REFS) {
					const refHtml = await page.getAttribute("html", "data-ref-html");
					if (refHtml && !fs.existsSync(refPath)) {
						fs.writeFileSync(refPath, refHtml);
						console.log(`  Created ref: ${refPath}`);
					} else if (refHtml && fs.existsSync(refPath)) {
						console.log(`  Skipped (exists): ${refPath}`);
					}
					return;
				}

				const testShot = await page.screenshot({ fullPage: true });

				await page.goto(`/specs/${suiteName}/${name}-ref.html`, {
					waitUntil: "load",
				});

				const refFilename = `${name}.png`;
				const snapshotPath = test.info().snapshotPath(refFilename);
				await page.screenshot({
					fullPage: true,
					path: snapshotPath,
				});

				await expect(testShot).toMatchSnapshot(refFilename, {
					maxDiffPixelRatio,
					threshold,
				});
			});
		}
	});
}
