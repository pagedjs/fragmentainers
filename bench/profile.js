import { buildLayoutTree } from '../src/dom/index.js';
import { paginateContent } from '../src/driver.js';

/**
 * Profile a benchmark run with per-page timing.
 *
 * Instruments paginateContent to measure time per page.
 *
 * @param {Element} element
 * @param {{ inlineSize: number, blockSize: number }} pageSize
 * @returns {Object} Profiling results
 */
export function profileBenchmark(element, pageSize) {
  const tree = buildLayoutTree(element);

  const totalStart = performance.now();
  const pages = paginateContent(tree, [pageSize]);
  const totalEnd = performance.now();

  const totalMs = totalEnd - totalStart;

  return {
    name: element.dataset.name || element.id || element.tagName,
    totalMs: Math.round(totalMs * 100) / 100,
    pageCount: pages.length,
    msPerPage: Math.round((totalMs / pages.length) * 100) / 100,
    pageSizes: pages.map(p => ({
      blockSize: p.blockSize,
      childCount: p.childFragments.length,
    })),
    memory: performance.memory ? {
      usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024 * 10) / 10,
      totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024 * 10) / 10,
    } : null,
  };
}
