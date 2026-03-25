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
    fragmentationType = 'none',
    isNewFormattingContext = false,
  } = {}) {
    this.availableInlineSize = availableInlineSize;
    this.availableBlockSize = availableBlockSize;
    this.fragmentainerBlockSize = fragmentainerBlockSize;
    this.blockOffsetInFragmentainer = blockOffsetInFragmentainer;
    this.fragmentationType = fragmentationType;       // 'none' | 'page' | 'column'
    this.isNewFormattingContext = isNewFormattingContext;
  }
}
