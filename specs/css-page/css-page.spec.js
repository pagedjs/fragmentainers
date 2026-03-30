import { createSpecSuite } from "../helpers/create-spec-suite.js";

createSpecSuite("css-page", import.meta.dirname, { maxDiffPixelRatio: 0.05 });
