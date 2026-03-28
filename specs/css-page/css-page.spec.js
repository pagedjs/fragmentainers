import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import YAML from 'yaml';

const require = createRequire(
  path.join(process.cwd(), 'node_modules', 'playwright-core', 'package.json')
);
const { getComparator } = require('./lib/server/utils/comparators.js');
const pngComparator = getComparator('image/png');

const SUITE = 'css-page';
const tests = YAML.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'tests.yml'), 'utf8')
)[SUITE];

const diffDir = path.join(import.meta.dirname, '..', '..', 'test-results', 'spec-diffs');
fs.mkdirSync(diffDir, { recursive: true });

test.describe(SUITE, () => {
  for (const name of tests) {
    test(name, async ({ page }) => {
      await page.goto(`/specs/${SUITE}/${name}.html`, { waitUntil: 'load' });
      await page.addScriptTag({ type: 'module', url: '/specs/helpers/process.js' });
      await page.waitForSelector('[data-spec-ready]', { timeout: 15000 });

      const error = await page.getAttribute('html', 'data-spec-error');
      if (error) {
        console.warn(`  Processing error in ${name}: ${error}`);
      }

      const testShot = await page.screenshot({ fullPage: true });

      await page.goto(`/specs/${SUITE}/${name}-ref.html`, { waitUntil: 'load' });
      const refShot = await page.screenshot({ fullPage: true });

      const result = pngComparator(testShot, refShot, {
        comparator: 'ssim-cie94',
        threshold: 0,
        maxDiffPixelRatio: 0.10,
      });

      if (result !== null) {
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (result.diff) {
          fs.writeFileSync(path.join(diffDir, `${safeName}-diff.png`), result.diff);
        }
        fs.writeFileSync(path.join(diffDir, `${safeName}-test.png`), testShot);
        fs.writeFileSync(path.join(diffDir, `${safeName}-ref.png`), refShot);
      }

      expect(result, `Screenshot differs from reference`).toBeNull();
    });
  }
});
