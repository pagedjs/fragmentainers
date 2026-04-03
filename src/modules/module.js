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
   * @returns {Element[]} elements to include in every measurement segment
   */
  claimPersistent() {
    return [];
  }
}
