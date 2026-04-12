import { modules } from "./registry.js";
import { PageFloat } from "./page-float.js";
import { RepeatedTableHeader } from "./repeated-header.js";
import { FixedPosition } from "./fixed-position.js";
import { Footnote } from "./footnote.js";
import { NthSelectors } from "./nth-selectors.js";
import { EmulatePrintPixelRatio } from "./normalize.js";
import { BodyRewriter } from "./body-rewriter.js";

modules.register(PageFloat);
modules.register(RepeatedTableHeader);
modules.register(FixedPosition);
modules.register(Footnote);
modules.register(NthSelectors);
modules.register(EmulatePrintPixelRatio);
modules.register(BodyRewriter);

export { LayoutModule } from "./module.js";
export { modules } from "./registry.js";
export { PageFloat } from "./page-float.js";
export { RepeatedTableHeader } from "./repeated-header.js";
export { FixedPosition } from "./fixed-position.js";
export { Footnote } from "./footnote.js";
