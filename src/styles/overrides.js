/**
 * Override stylesheet for fragment split boundaries.
 *
 * When the compositor clones elements for fragmented output, the browser
 * re-applies first-fragment/last-fragment CSS incorrectly. This stylesheet
 * neutralizes properties that should only appear on the first or last
 * fragment of a split element.
 *
 * Adopted LAST in fragment-container shadow DOM for highest cascade priority.
 *
 * Pattern from pagedjs (https://github.com/pagedjs/pagedjs).
 */

const OVERRIDES = new CSSStyleSheet();
OVERRIDES.replaceSync(`
[data-split-from] {
  text-indent: unset !important;
  margin-block-start: unset !important;
  padding-block-start: unset !important;
  border-block-start: none !important;
  initial-letter: unset !important;
  counter-increment: unset !important;
  counter-set: unset !important;
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

/* === First fragments that continue (NOT the last) === */

[data-split-to] {
  margin-block-end: unset !important;
  padding-block-end: unset !important;
  border-block-end: none !important;
}

[data-split-to][data-justify-last] {
  text-align-last: justify !important;
}

[data-split-to]::after {
  content: unset !important;
}

/* Materialized pseudo element suppression */

[data-split-from] > frag-pseudo[data-pseudo="before"] {
  display: none !important;
}

[data-split-to] > frag-pseudo[data-pseudo="after"] {
  display: none !important;
}

`);

export { OVERRIDES };
