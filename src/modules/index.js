import { modules } from "./registry.js";
import { PageFloat } from "./page-float.js";
import { PageFit } from "./page-fit.js";
import { RepeatedTableHeader } from "./repeated-header.js";
import { FixedPosition } from "./fixed-position.js";

modules.register(PageFloat);
modules.register(PageFit);
modules.register(RepeatedTableHeader);
modules.register(FixedPosition);

export { Module } from "./module.js";
export { modules } from "./registry.js";
export { PageFloat } from "./page-float.js";
export { PageFit } from "./page-fit.js";
export { RepeatedTableHeader } from "./repeated-header.js";
export { FixedPosition } from "./fixed-position.js";
