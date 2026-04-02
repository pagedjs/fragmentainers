/**
 * Get the fragmentainer size for a given index.
 * When constraints are available on the fragment (from PageResolver),
 * returns the content area. Otherwise falls back to the fragmentainerSizes array.
 *
 * @param {{ inlineSize: number, blockSize: number }[]} fragmentainerSizes
 * @param {number} fragmentainerIndex
 * @param {import('../fragment.js').PhysicalFragment[]} [fragments]
 * @returns {{ inlineSize: number, blockSize: number }}
 */
export function getFragmentainerSize(
  fragmentainerSizes,
  fragmentainerIndex,
  fragments,
) {
  if (fragments?.[fragmentainerIndex]?.constraints) {
    return fragments[fragmentainerIndex].constraints.contentArea;
  }
  return (
    fragmentainerSizes[fragmentainerIndex] ||
    fragmentainerSizes[fragmentainerSizes.length - 1]
  );
}
