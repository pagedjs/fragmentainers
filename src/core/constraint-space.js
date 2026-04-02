import { FRAGMENTATION_NONE } from "./constants.js";

/**
 * Constraint space for a fragmentainer.
 * Carries the fragmentainer's dimensions and fragmentation type.
 * A fresh constraint space is created for each fragmentainer.
 */
export class ConstraintSpace {
  constructor({
    availableInlineSize = 0,
    availableBlockSize = 0,
    fragmentainerBlockSize = 0,
    blockOffsetInFragmentainer = 0,
    fragmentationType = FRAGMENTATION_NONE,
    isNewFormattingContext = false,
    reservedBlockStart = 0,
    reservedBlockEnd = 0,
    modules = null,
  } = {}) {
    this.availableInlineSize = availableInlineSize;
    this.availableBlockSize = availableBlockSize;
    this.fragmentainerBlockSize = fragmentainerBlockSize;
    this.blockOffsetInFragmentainer = blockOffsetInFragmentainer;
    this.fragmentationType = fragmentationType;       // "none" | "page" | "column"
    this.isNewFormattingContext = isNewFormattingContext;
    this.reservedBlockStart = reservedBlockStart;
    this.reservedBlockEnd = reservedBlockEnd;
    this.modules = modules;
  }
}
