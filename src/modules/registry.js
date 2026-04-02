import { Module } from "./module.js";

class ModuleRegistry {
  #modules = [];

  register(module) {
    if (!(module instanceof Module)) {
      throw new TypeError("Module must extend the Module base class");
    }
    if (!this.#modules.includes(module)) {
      this.#modules.push(module);
    }
  }

  remove(module) {
    const idx = this.#modules.indexOf(module);
    if (idx !== -1) {
      this.#modules.splice(idx, 1);
    }
  }

  matches(node) {
    return this.#modules.some(m => m.matches(node));
  }

  layout(rootNode, constraintSpace, breakToken, layoutChild) {
    let reservedBlockStart = 0;
    let reservedBlockEnd = 0;
    const afterRenderCallbacks = [];
    for (const mod of this.#modules) {
      const result = mod.layout(rootNode, constraintSpace, breakToken, layoutChild);
      reservedBlockStart += result.reservedBlockStart;
      reservedBlockEnd += result.reservedBlockEnd;
      if (result.afterRender) {
        afterRenderCallbacks.push(result.afterRender);
      }
    }
    return { reservedBlockStart, reservedBlockEnd, afterRenderCallbacks };
  }

  beforeChildren(node, constraintSpace, breakToken) {
    for (const mod of this.#modules) {
      const result = mod.beforeChildren(node, constraintSpace, breakToken);
      if (result) return result;
    }
    return null;
  }
}

export const modules = new ModuleRegistry();
