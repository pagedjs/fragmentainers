import { handlers } from "./registry.js";
import { PageFloat } from "./page-float.js";
import { RepeatedTableHeader } from "./repeated-header.js";
import { FixedPosition } from "./fixed-position.js";
import { Footnote } from "./footnote.js";
import { StyleResolver } from "./style-resolver.js";
import { EmulatePrintPixelRatio } from "./normalize.js";
import { BodyRewriter } from "./body-rewriter.js";
import { PseudoElements } from "./pseudo-elements.js";

handlers.register(RepeatedTableHeader);
handlers.register(FixedPosition);
handlers.register(StyleResolver);
handlers.register(EmulatePrintPixelRatio);
handlers.register(BodyRewriter);
handlers.register(PseudoElements);

export { LayoutHandler } from "./handler.js";
export { handlers } from "./registry.js";
export { PageFloat } from "./page-float.js";
export { RepeatedTableHeader } from "./repeated-header.js";
export { FixedPosition } from "./fixed-position.js";
export { Footnote } from "./footnote.js";
