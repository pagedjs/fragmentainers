/**
 * Custom elements for CSS-isolated measurement and rendering.
 *
 * <content-measure> — off-screen measurement container with Shadow DOM.
 *   Injects content + CSS into a shadow root so the host page's styles
 *   don't affect layout measurements.
 *
 * <fragment-container> — visible page container with Shadow DOM.
 *   Wraps rendered fragment output to prevent CSS leakage from the host page.
 *
 * Both elements use `all: initial` on :host to reset inherited CSS properties
 * (font-size, line-height, etc.) to browser defaults, preventing the host
 * page's styles from affecting content inside the shadow root.
 */

// ---------------------------------------------------------------------------
// <content-measure> — off-screen measurement
// ---------------------------------------------------------------------------

/**
 * Host styles for measurement mode.
 * - all: initial resets inherited properties to browser defaults
 * - contain: layout paint (not strict — strict includes size → 0×0)
 */
const MEASURE_HOST_STYLES = `
  :host {
    all: initial;
    display: block;
    contain: layout paint;
  }
`;

class ContentMeasureElement extends HTMLElement {
  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    this._wrapper = null;
    this._contentCSSText = "";
  }

  /**
   * Inject content and CSS into the shadow root for measurement.
   *
   * @param {Object} options
   * @param {string} options.bodyHTML — HTML content to inject
   * @param {{ css: string, cssBaseURL: string }[]} options.cssEntries — CSS sources
   * @param {string} options.baseURL — base URL for rebasing relative paths
   * @returns {Element} the wrapper element (contentRoot) for buildLayoutTree
   */
  injectContent({ bodyHTML, cssEntries, baseURL }) {
    const { cssText, html } = preprocessContent({ bodyHTML, cssEntries, baseURL });
    return this.injectRawContent(html, cssText);
  }

  /**
   * Inject pre-processed HTML and CSS into the shadow root.
   * Used by ContentMeasureGroup to avoid re-processing CSS per element.
   *
   * @param {string} html — rebased HTML content
   * @param {string} cssText — rebased + rewritten CSS text
   * @returns {Element} the wrapper element (contentRoot) for buildLayoutTree
   */
  injectRawContent(html, cssText) {
    this._shadow.innerHTML = "";

    // Host styles
    const hostStyle = document.createElement("style");
    hostStyle.textContent = MEASURE_HOST_STYLES;
    this._shadow.appendChild(hostStyle);

    this._contentCSSText = cssText;
    const contentStyle = document.createElement("style");
    contentStyle.textContent = cssText;
    this._shadow.appendChild(contentStyle);

    // Create wrapper div that content CSS targets via .frag-body
    this._wrapper = document.createElement("div");
    this._wrapper.className = "frag-body";
    this._wrapper.innerHTML = html;
    this._shadow.appendChild(this._wrapper);

    return this._wrapper;
  }

  /**
   * The wrapper element inside the shadow root.
   * Pass this to buildLayoutTree().
   */
  get contentRoot() {
    return this._wrapper;
  }

  /**
   * Get the content styles for reuse in <fragment-container> rendering.
   * Call after injectContent() to capture styles for rendering.
   *
   * @returns {{ sheets: CSSStyleSheet[], cssText: string }}
   */
  getContentStyles() {
    return {
      sheets: [...this._shadow.adoptedStyleSheets],
      cssText: this._contentCSSText,
    };
  }
}

customElements.define("content-measure", ContentMeasureElement);

// ---------------------------------------------------------------------------
// <fragment-container> — visible page rendering
// ---------------------------------------------------------------------------

const CONTAINER_HOST_STYLES = `
  :host {
    all: initial;
    display: block;
    contain: strict;
  }
`;

class FragmentContainerElement extends HTMLElement {
  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    this._wrapper = null;
  }

  /**
   * Set up the shadow root with content styles for rendering.
   * Dimensions must be set on the host element by the caller.
   *
   * When contentStyles is provided (from ContentMeasureElement.getContentStyles()),
   * uses those cached styles. Otherwise copies stylesheets from the current
   * document so rendered content matches the page's styling.
   *
   * @param {Object} [contentStyles] — from ContentMeasureElement.getContentStyles()
   * @returns {Element} wrapper element to append rendered content into
   */
  setupForRendering(contentStyles) {
    this._shadow.innerHTML = "";

    // Host styles
    const hostStyle = document.createElement("style");
    hostStyle.textContent = CONTAINER_HOST_STYLES;
    this._shadow.appendChild(hostStyle);

    if (contentStyles) {
      // Use cached styles from <content-measure>
      if (contentStyles.sheets.length > 0) {
        this._shadow.adoptedStyleSheets = contentStyles.sheets;
      }
      if (contentStyles.cssText) {
        const contentStyle = document.createElement("style");
        contentStyle.textContent = contentStyles.cssText;
        this._shadow.appendChild(contentStyle);
      }
    } else {
      // Copy stylesheets from the current document
      copyDocumentStyles(this._shadow);
    }

    // Create wrapper div that content CSS targets via .frag-body
    this._wrapper = document.createElement("div");
    this._wrapper.className = "frag-body";

    this._shadow.appendChild(this._wrapper);
    return this._wrapper;
  }

  /**
   * The wrapper element inside the shadow root.
   */
  get contentRoot() {
    return this._wrapper;
  }
}

customElements.define("fragment-container", FragmentContainerElement);

// ---------------------------------------------------------------------------
// ContentMeasureGroup — per-element measurement
// ---------------------------------------------------------------------------

/**
 * Coordinates multiple <content-measure> elements, one per top-level child
 * of a DocumentFragment. Processes CSS once and shares it across all measures.
 *
 * Supports two modes:
 * - **batch**: create all measure elements at once, wait for all fonts
 * - **sequential**: create one at a time, yield between each for lower peak cost
 */
class ContentMeasureGroup {
  /**
   * @param {HTMLElement} container — parent element to append measures into
   *   (typically positioned off-screen)
   */
  constructor(container) {
    this._container = container;
    /** @type {ContentMeasureElement[]} */
    this._measures = [];
    this._cssText = "";
    this._childHTMLs = [];
  }

  /**
   * Parse content and prepare per-element HTML chunks.
   * Call before measureAll() or measureSequential().
   *
   * @param {Object} options
   * @param {string} options.bodyHTML
   * @param {{ css: string, cssBaseURL: string }[]} options.cssEntries
   * @param {string} options.baseURL
   */
  prepare({ bodyHTML, cssEntries, baseURL }) {
    const { cssText, html } = preprocessContent({ bodyHTML, cssEntries, baseURL });
    this._cssText = cssText;

    // Parse HTML to extract individual top-level elements
    const temp = document.createElement("div");
    temp.innerHTML = html;
    this._childHTMLs = [];
    for (const child of temp.children) {
      this._childHTMLs.push(child.outerHTML);
    }
  }

  /** @returns {number} Number of top-level elements */
  get elementCount() {
    return this._childHTMLs.length;
  }

  /**
   * Batch mode: create all <content-measure> elements at once,
   * then wait for fonts.
   *
   * @param {string} width — CSS width for each measure container
   * @returns {Promise<Element[]>} content root elements (first child of each wrapper)
   */
  async measureAll(width) {
    for (let i = 0; i < this._childHTMLs.length; i++) {
      this._createMeasure(i, width);
    }

    // Force style recalc on all measures, then wait for fonts
    for (const m of this._measures) {
      void m.offsetHeight;
    }
    await document.fonts.ready;

    return this._getContentRoots();
  }

  /**
   * Sequential mode: create and measure one element at a time.
   * Yields after each element is ready for layout.
   *
   * @param {string} width — CSS width for each measure container
   * @yields {{ index: number, contentRoot: Element, total: number }}
   */
  async *measureSequential(width) {
    for (let i = 0; i < this._childHTMLs.length; i++) {
      const measure = this._createMeasure(i, width);

      // Force style recalc + wait for fonts for this element
      void measure.offsetHeight;
      await document.fonts.ready;
      // Double rAF to ensure layout is complete
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      yield {
        index: i,
        contentRoot: measure.contentRoot.firstElementChild,
        total: this._childHTMLs.length,
      };
    }
  }

  /**
   * Get content root elements (first child of each measure's wrapper).
   * Only valid after measureAll() or after all measureSequential() yields.
   *
   * @returns {Element[]}
   */
  _getContentRoots() {
    return this._measures.map(m => m.contentRoot.firstElementChild);
  }

  /**
   * Get all content root elements.
   * @returns {Element[]}
   */
  getContentRoots() {
    return this._getContentRoots();
  }

  /**
   * Get content styles from the first measure (shared CSS).
   * @returns {{ sheets: CSSStyleSheet[], cssText: string }|null}
   */
  getContentStyles() {
    return this._measures[0]?.getContentStyles() || null;
  }

  /**
   * Remove all measure elements from the DOM.
   */
  dispose() {
    for (const m of this._measures) {
      m.remove();
    }
    this._measures = [];
  }

  /**
   * Remove a specific measure element by index.
   * @param {number} index
   */
  disposeMeasure(index) {
    const measure = this._measures[index];
    if (measure) {
      measure.remove();
      this._measures[index] = null;
    }
  }

  /** @private */
  _createMeasure(index, width) {
    const measure = document.createElement("content-measure");
    measure.style.width = width;
    this._container.appendChild(measure);
    measure.injectRawContent(this._childHTMLs[index], this._cssText);
    this._measures[index] = measure;
    return measure;
  }
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Copy document-level stylesheets into a shadow root via adoptedStyleSheets,
 * rewriting body/html selectors to target .frag-body/:host.
 */
function copyDocumentStyles(shadowRoot) {
  const sheets = [];
  for (const sheet of document.styleSheets) {
    try {
      const copy = new CSSStyleSheet();
      let rules = "";
      for (const rule of sheet.cssRules) {
        rules += rewriteBodySelectors(rule.cssText) + "\n";
      }
      copy.replaceSync(rules);
      sheets.push(copy);
    } catch (_) {
      // Cross-origin stylesheet — cssRules access throws SecurityError
    }
  }
  shadowRoot.adoptedStyleSheets = sheets;
}

/**
 * Rewrite `body` and `html` selectors in CSS text to target
 * the `.frag-body` wrapper inside the shadow root.
 *
 * Handles common patterns:
 * - `body { }` → `.frag-body { }`
 * - `body.class { }` → `.frag-body.class { }`
 * - `body > div { }` → `.frag-body > div { }`
 * - `html body { }` → `.frag-body { }`
 * - `html { }` → `:host { }`
 *
 * @param {string} cssText
 * @returns {string}
 */
function rewriteBodySelectors(cssText) {
  // Replace `html` followed by whitespace+body with just body
  let result = cssText.replace(/\bhtml\s+body\b/g, "body");

  // Replace standalone `html` selectors with :host
  result = result.replace(
    /(?:^|(?<=,\s*|}\s*))\bhtml\b(?=[{\s,.#:[>+~])/gm,
    ":host",
  );

  // Replace `body` selectors with `.frag-body`
  result = result.replace(/\bbody\b(?=[{\s,.#:[>+~])/g, ".frag-body");

  return result;
}

/**
 * Pre-process content: rebase URLs and rewrite CSS selectors.
 * Shared by injectContent() and ContentMeasureGroup.
 *
 * @param {Object} options
 * @param {string} options.bodyHTML
 * @param {{ css: string, cssBaseURL: string }[]} options.cssEntries
 * @param {string} options.baseURL
 * @returns {{ cssText: string, html: string }}
 */
function preprocessContent({ bodyHTML, cssEntries, baseURL }) {
  const rebasedCSS = cssEntries
    .map(({ css, cssBaseURL }) =>
      css.replace(
        /url\(\s*['"]?(?!data:|https?:|\/\/)(.*?)['"]?\s*\)/g,
        (_match, path) => `url('${cssBaseURL}${path}')`,
      ),
    )
    .join("\n");

  const rebasedHTML = bodyHTML
    .replace(
      /src\s*=\s*["'](?!data:|https?:|\/\/)(.*?)["']/g,
      (_match, path) => `src="${baseURL}${path}"`,
    )
    .replace(
      /href\s*=\s*["'](?!data:|https?:|\/\/|#)(.*?)["']/g,
      (_match, path) => `href="${baseURL}${path}"`,
    );

  const cssText = rewriteBodySelectors(rebasedCSS);
  return { cssText, html: rebasedHTML };
}

export { ContentMeasureElement, FragmentContainerElement, ContentMeasureGroup };
