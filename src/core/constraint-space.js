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
		preserveForcedBreakMargins = false,
		cssInlineSize = null,
		cssBlockSize = null,
	} = {}) {
		this.availableInlineSize = availableInlineSize;
		this.availableBlockSize = availableBlockSize;
		this.fragmentainerBlockSize = fragmentainerBlockSize;
		this.blockOffsetInFragmentainer = blockOffsetInFragmentainer;
		this.fragmentationType = fragmentationType; // "none" | "page" | "column"
		this.isNewFormattingContext = isNewFormattingContext;
		this.reservedBlockStart = reservedBlockStart;
		this.reservedBlockEnd = reservedBlockEnd;
		this.preserveForcedBreakMargins = preserveForcedBreakMargins;
		/** Body margin-block-start for first-page collapsing (0 on non-first pages). */
		this.bodyMarginBlockStart = 0;
		/** Original CSS inline size string (e.g. "65mm") for browser-native unit conversion. */
		this.cssInlineSize = cssInlineSize;
		/** Original CSS block size string (e.g. "181mm") for browser-native unit conversion. */
		this.cssBlockSize = cssBlockSize;
	}
}
