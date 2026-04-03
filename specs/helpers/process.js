/**
 * Spec test page processor — injected into test pages via Playwright.
 *
 * Detects whether the page uses @page rules (pagination) or CSS columns
 * (multicol), then runs the library's fragmentation engine accordingly.
 */
import { paginate } from "/debug/paginate.js";
import { saveRef } from "./build-ref.js";

const SAVE_REF = location.hash === "#ref";

async function process() {
  try {
    const flow = await paginate();

    if (SAVE_REF) {
      saveRef(flow);
    }

    document.documentElement.dataset.specReady = "true";
  } catch (err) {
    console.error("Spec process error:", err);
    document.documentElement.dataset.specError = err.message + "\n" + err.stack;
    document.documentElement.dataset.specReady = "true";
  }
}

process();
