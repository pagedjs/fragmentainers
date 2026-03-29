/**
 * CSS Multicol §3 pseudo-algorithm.
 * Resolves used column count and width from CSS properties and container width.
 *
 * @param {number} U - Container's content box inline-size
 * @param {number|null} specifiedWidth - column-width value (null = auto)
 * @param {number|null} specifiedCount - column-count value (null = auto)
 * @param {number} gap - column-gap value in px
 * @returns {{ count: number, width: number }}
 */
export function resolveColumnDimensions(U, specifiedWidth, specifiedCount, gap) {
  // Both auto → single column
  if (specifiedWidth == null && specifiedCount == null) {
    return { count: 1, width: U };
  }

  let N, W;

  if (specifiedWidth != null && specifiedCount == null) {
    // Only column-width specified — width is a minimum
    N = Math.max(1, Math.floor((U + gap) / (specifiedWidth + gap)));
    W = (U - (N - 1) * gap) / N;
  } else if (specifiedWidth == null && specifiedCount != null) {
    // Only column-count specified
    N = specifiedCount;
    W = Math.max(0, (U - (N - 1) * gap) / N);
  } else {
    // Both specified — column-count acts as maximum
    N = Math.min(specifiedCount, Math.max(1, Math.floor((U + gap) / (specifiedWidth + gap))));
    W = (U - (N - 1) * gap) / N;
  }

  return { count: N, width: W };
}
