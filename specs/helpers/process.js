/**
 * Spec test page processor — injected into test pages via Playwright.
 *
 * Detects whether the page uses @page rules (pagination) or CSS columns
 * (multicol), then runs the library's fragmentation engine accordingly.
 */
import { FragmentainerLayout } from "/src/core/fragmentainer-layout.js";
import { PageResolver } from "/src/atpage/page-resolver.js";
import "/src/dom/fragment-container.js";
import "/debug/fake-page.js";
import { findMulticolContainers, processMulticol } from "./multicol.js";
import { buildRefHtml } from "./build-ref.js";

const SAVE_REF = location.hash === "#ref";

async function run() {
  try {
    await document.fonts.ready;

    const resolver = PageResolver.fromDocument();
    const multicolContainers = findMulticolContainers(document.body);

    if (resolver.pageRules.length > 0) {
      await runPageMode(resolver);
    } else if (multicolContainers.length > 0) {
      for (const container of multicolContainers) {
        await processMulticol(container);
      }
    }

    document.documentElement.dataset.specReady = "true";
  } catch (err) {
    console.error("Spec process error:", err);
    document.documentElement.dataset.specError = err.message + "\n" + err.stack;
    document.documentElement.dataset.specReady = "true";
  }
}

async function runPageMode(resolver) {
  const frag = document.createDocumentFragment();
  while (document.body.firstChild) {
    frag.appendChild(document.body.firstChild);
  }

  document.body.style.margin = "0";
  document.body.style.padding = "0";
  document.body.style.background = "none";

  const styles = collectConstructedSheets();
  const layout = new FragmentainerLayout(frag, { resolver, styles });
  const flow = await layout.flow();

  const pages = [];

  for (let i = 0; i < flow.fragmentainerCount; i++) {
    const fragEl = flow.renderFragmentainer(i);
    const pageEl = document.createElement("fake-page");
    pageEl.className = "spec-page";
    pageEl.dataset.pageIndex = i;
    pageEl.appendChild(fragEl);
    document.body.appendChild(pageEl);

    if (SAVE_REF) {
      const { pageBoxSize, margins } = flow.fragments[i].constraints;
      pages.push({ pageBoxSize, margins, html: fragEl.contentRoot.innerHTML });
    }
  }

  document.documentElement.dataset.pageCount = String(flow.fragmentainerCount);

  if (SAVE_REF) {
    document.documentElement.dataset.refHtml = buildRefHtml(pages);
  }
}

function collectConstructedSheets() {
  const sheets = [];
  for (const sheet of document.styleSheets) {
    try {
      const constructed = new CSSStyleSheet();
      let css = "";
      for (const rule of sheet.cssRules) {
        css += rule.cssText + "\n";
      }
      constructed.replaceSync(css);
      sheets.push(constructed);
    } catch {
      // Cross-origin sheets can't be read — skip
    }
  }
  return sheets;
}

run();
