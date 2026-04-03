export class Module {
  matches() {
    return false;
  }

  layout() {
    return { reservedBlockStart: 0, reservedBlockEnd: 0, afterRender: null };
  }

  beforeChildren() {
    return null;
  }

  /**
   * Called before measurement begins, with the full content fragment.
   * Modules can claim elements that should persist across all measurement
   * segments (e.g., position: fixed elements that repeat on every page).
   *
   * @param {DocumentFragment|Element} content — the full content root
   * @param {CSSStyleSheet[]} styles — adopted stylesheets
   * @returns {Element[]} elements to include in every measurement segment
   */
  claimPersistent() {
    return [];
  }

  /**
   * Called after content layout completes for a fragmentainer.
   * Modules can inspect the resulting fragment and request additional
   * block-end space (e.g., for footnotes). Returning a different
   * reservedBlockEnd than what was used triggers a re-layout.
   *
   * @param {import('../core/fragment.js').PhysicalFragment} fragment
   * @param {import('../core/constraint-space.js').ConstraintSpace} constraintSpace
   * @param {import('../core/tokens.js').BreakToken|null} inputBreakToken
   * @returns {{ reservedBlockEnd: number, afterRender: Function|null }|null}
   */
  afterContentLayout() {
    return null;
  }
}
