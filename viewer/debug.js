import {
  findChildBreakToken,
  isMonolithic,
  debugPrintTokenTree,
} from "../src/helpers.js";

/**
 * Build a text dump for a single page fragment.
 * Returns { text: string, hasIssues: boolean }.
 */
export function buildPageDump(fragments, i, pageH) {
  const lines = [];
  const log = (...args) => lines.push(args.join(" "));

  const page = fragments[i];
  const prevBT = i > 0 ? fragments[i - 1].breakToken : null;
  const issues = [];

  if (page.blockSize > pageH + 0.01) {
    issues.push(`OVERFLOW by ${(page.blockSize - pageH).toFixed(2)}px`);
  }

  const childData = [];
  let childSum = 0;

  for (const frag of page.childFragments) {
    if (!frag.node) continue;
    childSum += frag.blockSize;
    const info = dumpFragment(frag, prevBT, 0);
    childData.push(info);
    if (info.issues.length) issues.push(...info.issues);
  }

  const lastFrag = page.childFragments[page.childFragments.length - 1];
  if (lastFrag?.node) {
    const clip = checkLastLineClip(lastFrag, page.blockSize, pageH);
    if (clip) issues.push(clip);
  }

  const remaining = pageH - page.blockSize;
  const gap = page.blockSize - childSum;
  const hasIssues = issues.length > 0;

  const btInfo = page.breakToken
    ? `breakToken(consumed=${page.breakToken.consumedBlockSize.toFixed(1)} children=${page.breakToken.childBreakTokens.length})`
    : "breakToken=null";
  const csInfo = page.constraints
    ? ` constraints={content: ${page.constraints.contentArea.inlineSize}x${page.constraints.contentArea.blockSize}}`
    : "";
  const issueTag = hasIssues ? ` *** ${issues.length} ISSUE(S)` : "";

  log(
    `## Page ${i + 1}/${fragments.length}  blockSize=${page.blockSize.toFixed(2)}  remaining=${remaining.toFixed(2)}  ${btInfo}${csInfo}${issueTag}`,
  );

  const textSegments = collectPageTextSegments(page, prevBT);
  if (textSegments.length > 0) {
    log(`  first text: "${truncate(textSegments[0], 80)}"`);
    if (textSegments.length > 1) {
      log(
        `  last text:  "${truncate(textSegments[textSegments.length - 1], 80)}"`,
      );
    }
  }

  log(
    `  childFragments: ${page.childFragments.filter((f) => f.node).length}  childSum=${childSum.toFixed(2)}  gap=${gap.toFixed(2)}  remaining=${remaining.toFixed(2)}`,
  );

  for (const info of childData) {
    printFragmentInfo(info, log, "  ");
  }

  if (hasIssues) {
    log("  ISSUES:");
    for (const issue of issues) {
      log(`    - ${issue}`);
    }
  }

  if (page.breakToken) {
    log("  breakTokenTree:");
    log(debugPrintTokenTree(page.breakToken, 2));
  }
  log("");

  return { text: lines.join("\n"), hasIssues };
}

/**
 * Build a document-level summary across all fragments.
 */
export function buildDocumentSummary(fragments, pageH) {
  const lines = [];
  let totalContentHeight = 0;
  let overflowPages = 0;
  let forcedBreaks = 0;
  const elementSpans = new Map();

  for (let i = 0; i < fragments.length; i++) {
    const page = fragments[i];
    const effH = fragmentainerHeight(page, pageH);
    totalContentHeight += page.blockSize;
    if (page.blockSize > effH + 0.01) overflowPages++;
    if (page.breakToken) {
      if (page.breakToken.isForcedBreak) forcedBreaks++;
      forcedBreaks += countForcedBreaks(page.breakToken);
    }
    trackElementSpans(page, i, elementSpans);
  }

  const spanning = [];
  for (const [name, [first, last]] of elementSpans) {
    if (last > first) {
      spanning.push(`${name} (pages ${first + 1}-${last + 1})`);
    }
  }

  lines.push("## Document Summary");
  lines.push(
    `  totalContentHeight: ${totalContentHeight.toFixed(1)}px across ${fragments.length} pages`,
  );
  lines.push(
    `  overflowPages: ${overflowPages}  forcedBreaks: ${forcedBreaks}`,
  );
  if (spanning.length > 0) {
    lines.push(`  spanning elements (${spanning.length}):`);
    for (const s of spanning.slice(0, 20)) {
      lines.push(`    - ${s}`);
    }
    if (spanning.length > 20) {
      lines.push(`    ... and ${spanning.length - 20} more`);
    }
  }
  return lines.join("\n");
}

/**
 * Get the effective fragmentainer height for a page fragment.
 */
export function fragmentainerHeight(fragment, defaultH) {
  return fragment.constraints
    ? fragment.constraints.contentArea.blockSize
    : defaultH;
}

// --- Internal helpers ---

function dumpFragment(frag, parentBT, depth) {
  const node = frag.node;
  const tag = node.element?.tagName?.toLowerCase() || "?";
  const name = node.debugName || tag;
  const isIFC = node.isInlineFormattingContext;
  const measured = node.element
    ? node.element.getBoundingClientRect().height
    : null;

  const breakProps = {};
  if (node.breakBefore && node.breakBefore !== "auto")
    breakProps.before = node.breakBefore;
  if (node.breakAfter && node.breakAfter !== "auto")
    breakProps.after = node.breakAfter;
  if (node.breakInside && node.breakInside !== "auto")
    breakProps.inside = node.breakInside;

  const issues = [];
  const info = {
    name,
    tag,
    depth,
    blockSize: frag.blockSize,
    measured,
    margin: [node.marginBlockStart || 0, node.marginBlockEnd || 0],
    padding: [node.paddingBlockStart || 0, node.paddingBlockEnd || 0],
    border: [node.borderBlockStart || 0, node.borderBlockEnd || 0],
    isIFC,
    isMonolithic: isMonolithic(node),
    breakProps,
    hasBreakToken: !!frag.breakToken,
    breakTokenType: frag.breakToken?.type || null,
    consumedBlockSize: frag.breakToken?.consumedBlockSize ?? null,
    issues,
    children: [],
  };

  if (isIFC) {
    const data = node.inlineItemsData;
    const lh = node.lineHeight;
    const lineCount = frag.childFragments.length;
    const computed = lineCount * lh;
    const inputBT = findChildBreakToken(parentBT, node);
    const outputBT = frag.breakToken;

    info.ifc = {
      lineHeight: lh,
      lineCount,
      computedHeight: computed,
      textLength: data?.textContent?.length || 0,
      itemCount: data?.items?.length || 0,
      startOffset: inputBT?.textOffset ?? 0,
      endOffset: outputBT?.textOffset ?? (data?.textContent?.length || 0),
    };

    if (computed > frag.blockSize + 0.5) {
      issues.push(
        `${name}: lines*lineHeight (${computed.toFixed(2)}) > blockSize (${frag.blockSize.toFixed(2)}) by ${(computed - frag.blockSize).toFixed(2)}px`,
      );
    }
    const remainder = frag.blockSize % lh;
    if (remainder > 0.01 && remainder < lh - 0.01) {
      issues.push(
        `${name}: blockSize ${frag.blockSize.toFixed(2)} is not a multiple of lineHeight ${lh.toFixed(2)} (remainder=${remainder.toFixed(2)})`,
      );
    }
  } else {
    for (const child of frag.childFragments) {
      if (!child.node) continue;
      const childInfo = dumpFragment(child, parentBT, depth + 1);
      info.children.push(childInfo);
      issues.push(...childInfo.issues);
    }
  }

  return info;
}

function printFragmentInfo(info, log, prefix) {
  const indent = prefix + "  ".repeat(info.depth);

  const parts = [
    `${indent}${info.name}  blockSize=${info.blockSize.toFixed(2)}`,
  ];
  if (info.measured !== null) parts.push(`measured=${info.measured.toFixed(2)}`);
  parts.push(
    `margin=${info.margin[0].toFixed(1)}/${info.margin[1].toFixed(1)}`,
  );
  parts.push(
    `pad=${info.padding[0].toFixed(1)}/${info.padding[1].toFixed(1)}`,
  );
  if (info.border[0] || info.border[1]) {
    parts.push(
      `border=${info.border[0].toFixed(1)}/${info.border[1].toFixed(1)}`,
    );
  }
  if (info.hasBreakToken) {
    const consumed =
      info.consumedBlockSize !== null
        ? ` consumed=${info.consumedBlockSize.toFixed(1)}`
        : "";
    parts.push(`BT(${info.breakTokenType}${consumed})`);
  }
  if (info.isMonolithic) parts.push("[monolithic]");

  const bpParts = [];
  if (info.breakProps.before)
    bpParts.push(`break-before:${info.breakProps.before}`);
  if (info.breakProps.after)
    bpParts.push(`break-after:${info.breakProps.after}`);
  if (info.breakProps.inside)
    bpParts.push(`break-inside:${info.breakProps.inside}`);
  if (bpParts.length) parts.push(`{${bpParts.join(", ")}}`);

  let line = parts.join("  ");

  if (info.isIFC && info.ifc) {
    const ifc = info.ifc;
    line += `\n${indent}  IFC: lineHeight=${ifc.lineHeight.toFixed(2)} lines=${ifc.lineCount} computed=${ifc.computedHeight.toFixed(2)} text=[${ifc.startOffset}..${ifc.endOffset}]/${ifc.textLength}`;
  }

  log(line);

  for (const child of info.children) {
    printFragmentInfo(child, log, prefix);
  }
}

function checkLastLineClip(frag, pageBlockSize, pageH) {
  let current = frag;
  while (current) {
    if (current.node?.isInlineFormattingContext) {
      if (pageBlockSize > pageH + 0.01) {
        return `Last IFC (${current.node.debugName}): page blockSize ${pageBlockSize.toFixed(2)} > fragmentainer ${pageH} — last line clipped`;
      }
      return null;
    }
    const blockChildren = current.childFragments.filter((f) => f.node);
    if (blockChildren.length === 0) return null;
    current = blockChildren[blockChildren.length - 1];
  }
  return null;
}

function collectPageTextSegments(pageFragment, inputBreakToken) {
  const segments = [];
  (function walk(fragment, bt) {
    for (const child of fragment.childFragments) {
      if (!child.node) continue;
      const childBT = findChildBreakToken(bt, child.node);
      if (child.node.isInlineFormattingContext) {
        extractInlineText(child, childBT, segments);
      } else {
        walk(child, childBT);
      }
    }
  })(pageFragment, inputBreakToken);
  return segments;
}

function extractInlineText(fragment, breakToken, segments) {
  const data = fragment.node.inlineItemsData;
  if (!data?.textContent) return;
  const start =
    breakToken && breakToken.type === "inline" ? breakToken.textOffset : 0;
  const end =
    fragment.breakToken && fragment.breakToken.type === "inline"
      ? fragment.breakToken.textOffset
      : data.textContent.length;
  let text = data.textContent.slice(start, end);
  const ws = fragment.node.element
    ? getComputedStyle(fragment.node.element).whiteSpace
    : "normal";
  if (!ws.startsWith("pre")) {
    text = text.replace(/\s+/g, " ").trim();
  }
  if (text) segments.push(text);
}

function countForcedBreaks(bt) {
  let count = 0;
  if (!bt.childBreakTokens) return 0;
  for (const child of bt.childBreakTokens) {
    if (child.isForcedBreak) count++;
    count += countForcedBreaks(child);
  }
  return count;
}

function trackElementSpans(pageFragment, pageIndex, map) {
  for (const child of pageFragment.childFragments) {
    if (!child.node) continue;
    const name =
      child.node.debugName ||
      child.node.element?.tagName?.toLowerCase() ||
      "?";
    if (map.has(name)) {
      map.get(name)[1] = pageIndex;
    } else {
      map.set(name, [pageIndex, pageIndex]);
    }
    trackElementSpans(child, pageIndex, map);
  }
}

function truncate(str, maxLen) {
  return str.length <= maxLen ? str : str.slice(0, maxLen - 3) + "...";
}
