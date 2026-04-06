import { createSpecSuite } from "../helpers/create-spec-suite.js";

createSpecSuite("at-page", import.meta.dirname, { maxDiffPixelRatio: 0.05 });
