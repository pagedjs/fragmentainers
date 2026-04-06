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
	const specsDir = path.resolve(suiteDir, "..");
	const raw = YAML.parse(fs.readFileSync(path.join(specsDir, "tests.yml"), "utf8"))[suiteName];

	const entries = raw.map((entry) => ({
		name: entry.name,
		type: entry.type,
		skip: entry.skip || false,
	}));

	test.describe.configure({ mode: "parallel" });
	test.describe(suiteName, () => {
		for (const { name, type, skip } of entries) {
			test(name, async ({ page }, testInfo) => {
				if (skip) {
					test.skip(true, typeof skip === "string" ? skip : undefined);
				}

				const refPath = path.join(suiteDir, `${name}-ref.html`);
				const refSuffix = UPDATE_REFS ? "#ref" : "";

				await page.goto(`/specs/${suiteName}/${name}.html${refSuffix}`, {
					waitUntil: "load",
				});
				await page.evaluate((t) => {
					document.documentElement.dataset.specType = t;
				}, type);
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

				// Screenshot each page-container individually
				const testContainers = page.locator("page-container");
				const testCount = await testContainers.count();
				const testShots = [];
				for (let i = 0; i < testCount; i++) {
					const shot = await testContainers.nth(i).screenshot();
					testShots.push(shot);
					await testInfo.attach(`test-page-${i}`, { body: shot, contentType: "image/png" });
				}

				await page.goto(`/specs/${suiteName}/${name}-ref.html`, {
					waitUntil: "load",
				});

				const refContainers = page.locator("page-container");
				const refCount = await refContainers.count();

				// Attach all ref screenshots before asserting
				const refShots = [];
				for (let i = 0; i < refCount; i++) {
					const refShot = await refContainers.nth(i).screenshot();
					refShots.push(refShot);
					await testInfo.attach(`ref-page-${i}`, { body: refShot, contentType: "image/png" });
				}

				expect(testCount).toBe(refCount);

				for (let i = 0; i < refCount; i++) {
					const snapshotName = `${name}-page-${i}.png`;
					const snapshotPath = testInfo.snapshotPath(snapshotName);
					const snapshotDir = path.dirname(snapshotPath);
					if (!fs.existsSync(snapshotDir)) {
						fs.mkdirSync(snapshotDir, { recursive: true });
					}
					fs.writeFileSync(snapshotPath, refShots[i]);
					await expect(testShots[i]).toMatchSnapshot(snapshotName, {
						maxDiffPixelRatio,
						threshold,
					});
				}
			});
		}
	});
}
