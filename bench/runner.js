import { buildLayoutTree } from '../src/dom/index.js';
import { paginateContent } from '../src/driver.js';

/**
 * Run a benchmark on a DOM element.
 * Builds the layout tree, runs paginateContent, measures timing.
 * Returns the pages array from the last run for visualization.
 *
 * @param {Element} element - The root content element
 * @param {{ inlineSize: number, blockSize: number }} pageSize
 * @param {number} iterations - Number of runs for median timing
 * @returns {{ name: string, pages: PhysicalFragment[], pageSize: {inlineSize: number, blockSize: number}, medianMs: number, pagesPerSec: number, runs: number[] }}
 */
export function runBenchmark(element, pageSize, iterations = 5) {
  const name = element.dataset.name || element.id || element.tagName;
  const runs = [];

  let pages;
  for (let i = 0; i < iterations; i++) {
    const tree = buildLayoutTree(element);
    const start = performance.now();
    pages = paginateContent(tree, [pageSize]);
    const end = performance.now();
    runs.push(end - start);
  }

  runs.sort((a, b) => a - b);
  const medianMs = runs[Math.floor(runs.length / 2)];

  return {
    name,
    pages,
    pageSize,
    pageCount: pages.length,
    medianMs: Math.round(medianMs * 100) / 100,
    pagesPerSec: Math.round(pages.length / (medianMs / 1000)),
    runs: runs.map(r => Math.round(r * 100) / 100),
  };
}

/**
 * Run all benchmarks found in the page.
 * Looks for elements with data-bench attribute inside a container.
 *
 * @param {Element} container - Container with benchmark fixtures
 * @param {{ inlineSize: number, blockSize: number }} pageSize
 * @param {number} iterations
 * @returns {Object[]} Array of benchmark results
 */
export function runAllBenchmarks(container, pageSize, iterations = 5) {
  const fixtures = container.querySelectorAll('[data-bench]');
  const results = [];

  for (const fixture of fixtures) {
    try {
      const result = runBenchmark(fixture, pageSize, iterations);
      results.push(result);
    } catch (err) {
      results.push({
        name: fixture.dataset.name || fixture.id || 'unknown',
        error: err.message,
      });
    }
  }

  return results;
}

/**
 * Render benchmark results table with "View Pages" toggle per row.
 */
export function renderResults(results, tableElement, previewContainer) {
  tableElement.innerHTML = `
    <thead>
      <tr>
        <th>Fixture</th>
        <th>Pages</th>
        <th>Median (ms)</th>
        <th>Pages/sec</th>
        <th>All runs (ms)</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${results.map((r, i) => r.error
        ? `<tr><td>${r.name}</td><td colspan="5" style="color:red">${r.error}</td></tr>`
        : `<tr>
            <td>${r.name}</td>
            <td>${r.pageCount}</td>
            <td>${r.medianMs}</td>
            <td>${r.pagesPerSec}</td>
            <td>${r.runs.join(', ')}</td>
            <td><button class="view-pages-btn" data-index="${i}">View Pages</button></td>
          </tr>`
      ).join('')}
    </tbody>
  `;

  // Wire up "View Pages" buttons
  tableElement.querySelectorAll('.view-pages-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const result = results[idx];
      if (result && result.pages) {
        renderPagePreview(result, previewContainer);
      }
    });
  });
}

/**
 * Render a visual preview of fragmented pages.
 * Each page is shown as a scaled box with child fragments inside.
 */
export function renderPagePreview(result, container) {
  container.innerHTML = '';

  const { pages, pageSize, name } = result;
  const maxPreviewHeight = 400;
  const scale = Math.min(1, maxPreviewHeight / pageSize.blockSize, 300 / pageSize.inlineSize);

  // Header
  const header = document.createElement('h2');
  header.textContent = `${name} — ${pages.length} pages (${pageSize.inlineSize}×${pageSize.blockSize}px)`;
  header.style.fontSize = '1.1rem';
  container.appendChild(header);

  // Page grid
  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:16px;padding:8px 0;';
  container.appendChild(grid);

  const colors = [
    '#e3f2fd', '#fce4ec', '#e8f5e9', '#fff3e0', '#f3e5f5',
    '#e0f7fa', '#fff8e1', '#fbe9e7', '#e8eaf6', '#f1f8e9',
  ];

  pages.forEach((page, pageIndex) => {
    const pageEl = document.createElement('div');
    pageEl.style.cssText = `
      position: relative;
      width: ${pageSize.inlineSize * scale}px;
      height: ${pageSize.blockSize * scale}px;
      border: 1px solid #999;
      background: #fff;
      overflow: hidden;
      flex-shrink: 0;
      box-shadow: 1px 2px 4px rgba(0,0,0,0.1);
    `;

    // Page number label
    const label = document.createElement('div');
    label.textContent = `${pageIndex + 1}`;
    label.style.cssText = `
      position: absolute; top: 2px; right: 4px;
      font-size: 9px; color: #999; z-index: 1;
    `;
    pageEl.appendChild(label);

    // Render child fragments as stacked blocks
    let offset = 0;
    page.childFragments.forEach((frag, fragIndex) => {
      const fragEl = document.createElement('div');
      const fragHeight = frag.blockSize * scale;
      const bg = colors[fragIndex % colors.length];

      fragEl.style.cssText = `
        position: absolute;
        top: ${offset}px;
        left: 0;
        width: 100%;
        height: ${fragHeight}px;
        background: ${bg};
        border-bottom: 1px solid rgba(0,0,0,0.08);
        box-sizing: border-box;
        overflow: hidden;
        font-size: ${Math.max(8, 10 * scale)}px;
        padding: 1px 3px;
        color: #555;
      `;

      // Fragment label: show element info if available
      const node = frag.node;
      let fragLabel = '';
      if (node) {
        if (node.element) {
          const tag = node.element.tagName?.toLowerCase() || '';
          const id = node.element.id ? `#${node.element.id}` : '';
          fragLabel = `${tag}${id}`;
        } else if (node.debugName) {
          fragLabel = node.debugName;
        }
      }
      if (fragHeight >= 10 * scale) {
        fragEl.textContent = fragLabel ? `${fragLabel} (${Math.round(frag.blockSize)}px)` : `${Math.round(frag.blockSize)}px`;
      }

      pageEl.appendChild(fragEl);
      offset += fragHeight;
    });

    // If page overflows the fragmentainer, show a red overflow marker
    if (page.blockSize > pageSize.blockSize) {
      const overflow = document.createElement('div');
      overflow.style.cssText = `
        position: absolute;
        bottom: 0; left: 0; right: 0;
        height: 2px; background: red;
      `;
      overflow.title = `Overflow: ${Math.round(page.blockSize - pageSize.blockSize)}px`;
      pageEl.appendChild(overflow);
    }

    // Break token indicator
    if (page.breakToken) {
      const indicator = document.createElement('div');
      indicator.style.cssText = `
        position: absolute; bottom: -14px; left: 0; right: 0;
        text-align: center; font-size: 8px; color: #888;
      `;
      indicator.textContent = page.breakToken.isForcedBreak ? '— forced break —' : '— break —';
      pageEl.style.marginBottom = '18px';
      pageEl.appendChild(indicator);
    }

    grid.appendChild(pageEl);
  });

  // Summary
  const summary = document.createElement('div');
  summary.style.cssText = 'font-size:0.85rem;color:#666;padding:8px 0;';
  const totalContent = pages.reduce((sum, p) => sum + p.blockSize, 0);
  summary.textContent = `Total content height: ${Math.round(totalContent)}px across ${pages.length} pages`;
  container.appendChild(summary);
}
