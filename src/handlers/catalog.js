import { RepeatedTableHeader } from "./repeated-header.js";
import { FixedPosition } from "./fixed-position.js";
import { StyleResolver } from "./style-resolver.js";
import { EmulatePrintPixelRatio } from "./normalize.js";
import { BodyRewriter } from "./body-rewriter.js";
import { PseudoElements } from "./pseudo-elements.js";

/**
 * The one ordered catalog of handler classes. Every Fragmenter
 * resolves this list into its own fresh handler instances at
 * construction. Exposed as `Fragmenter.handlers`.
 *
 * Packages built on fragmentainers append to it once at import time:
 *
 *   Fragmenter.handlers.push(Footnote, RunningElements);
 *
 * To override a core handler, append a subclass of it — at resolution
 * it takes the original's slot, so ordering constraints still hold.
 * Pushes after a flow exists affect flows constructed later only.
 */
export const defaultHandlers = [
	RepeatedTableHeader,
	FixedPosition,
	StyleResolver,
	EmulatePrintPixelRatio,
	BodyRewriter,
	PseudoElements,
];
