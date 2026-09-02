/**
 * Override rules for fragment split boundaries.
 *
 * When the compositor clones elements for fragmented output, the browser
 * re-applies first-fragment/last-fragment CSS incorrectly. These rules
 * neutralize properties that should only appear on the first or last
 * fragment of a split element.
 *
 * `OVERRIDES_TEXT` is the CSS string consumed by the composite scoped
 * sheet. `OVERRIDES` is the pre-built CSSStyleSheet for standalone
 * consumers that adopt it directly.
 *
 * Pattern from pagedjs (https://github.com/pagedjs/pagedjs).
 */

/** The `text-align-last` keywords `Fragment` can resolve for a split box. */
const TEXT_ALIGN_LAST_KEYWORDS = [
	"justify",
	"center",
	"left",
	"right",
	"start",
	"end",
	"match-parent",
];

const ALIGN_LAST_RULES = TEXT_ALIGN_LAST_KEYWORDS.map(
	(keyword) => `[data-align-last="${keyword}"] {\n  text-align-last: ${keyword} !important;\n}`,
).join("\n\n");

const OVERRIDES_TEXT = `
[data-split-from] {
  text-indent: unset !important;
  margin-block-start: unset !important;
  initial-letter: unset !important;
  counter-increment: unset !important;
  counter-set: unset !important;
}

[data-split-from]:not([data-box-decoration-clone]) {
  padding-block-start: unset !important;
  border-block-start: none !important;
}

/* Suppress counter-reset on continuation fragments — but not on <ol>,
   where the start attribute controls the list-item counter scope and
   the compositor sets the correct continuation value. */
[data-split-from]:not(ol) {
  counter-reset: unset !important;
}

[data-split-from]::first-letter {
  color: unset !important;
  font-size: unset !important;
  font-weight: unset !important;
  font-family: unset !important;
  line-height: unset !important;
  float: unset !important;
  padding: unset !important;
  margin: unset !important;
}

[data-split-from]::before {
  content: none !important;
}

li[data-split-from] {
  list-style: none !important;
}

/* Margins adjoining a fragmentation break are truncated (CSS Fragmentation L3 §5.2). */
[data-truncate-margin] {
  margin-block-start: unset !important;
}

[data-truncate-margin-end] {
  margin-block-end: unset !important;
}

/* First fragments that continue (NOT the last) */

[data-split-to] {
  margin-block-end: unset !important;
}

[data-split-to]:not([data-box-decoration-clone]) {
  padding-block-end: unset !important;
  border-block-end: none !important;
}

[data-split-to]::after {
  content: unset !important;
}

/* The split box's last line here is not its last line: the compositor tags the
   deepest split element with the keyword resolved from text-align-last and
   text-align. Not gated on [data-split-to] — a box at its block-end carries
   the keyword while only its overflow continues. */
${ALIGN_LAST_RULES}

/* Past its block-end a box has no extent and no decorations; what is built
   into it is overflow (CSS Fragmentation §2.1). The shadow is cast by a box
   that has no extent here. The outline is not: Chromium draws it around the
   zero-extent fragment, so it stays. */
[data-past-block-end] {
  height: 0 !important;
  min-height: 0 !important;
  margin-block-start: 0 !important;
  margin-block-end: 0 !important;
  padding-block-start: 0 !important;
  padding-block-end: 0 !important;
  border-block-start: none !important;
  border-block-end: none !important;
  box-shadow: none !important;
}

/* Materialized pseudo element suppression */

[data-split-from] > frag-pseudo[data-pseudo="before"] {
  display: none !important;
}

[data-split-to] > frag-pseudo[data-pseudo="after"] {
  display: none !important;
}

`;

const OVERRIDES = new CSSStyleSheet();
OVERRIDES.replaceSync(OVERRIDES_TEXT);

export { OVERRIDES, OVERRIDES_TEXT };
