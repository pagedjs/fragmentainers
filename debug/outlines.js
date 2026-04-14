import { findChildBreakToken } from "../src/fragmentation/index.js";
import { isMonolithic } from "../src/layout/index.js";
import { BREAK_TOKEN_BLOCK, BREAK_TOKEN_INLINE } from "../src/fragmentation/tokens.js";

/**
 * Debug utility — pretty-print a break token tree.
 */
export function debugPrintTokenTree(breakToken, indent = 0) {
	if (!breakToken) return "(null)";

	const pad = "  ".repeat(indent) + "- ";
	const flags = [];
	if (breakToken.isBreakBefore) flags.push("break-before");
	if (breakToken.isForcedBreak) flags.push("forced");
	if (breakToken.forcedBreakValue) flags.push(`value=${breakToken.forcedBreakValue}`);
	if (breakToken.isRepeated) flags.push("repeated");
	if (breakToken.isAtBlockEnd) flags.push("at-block-end");
	if (breakToken.hasSeenAllChildren) flags.push("seen-all");

	let line = `${pad}${breakToken.type}`;
	if (breakToken.node?.debugName) line += ` [${breakToken.node.debugName}]`;
	if (breakToken.type === BREAK_TOKEN_BLOCK) {
		line += ` consumed=${breakToken.consumedBlockSize} seq=${breakToken.sequenceNumber}`;
	}
	if (breakToken.type === BREAK_TOKEN_INLINE) {
		line += ` item=${breakToken.itemIndex} offset=${breakToken.textOffset}`;
	}
	if (flags.length) line += ` (${flags.join(", ")})`;

	const lines = [line];
	if (breakToken.childBreakTokens) {
		for (const child of breakToken.childBreakTokens) {
			lines.push(debugPrintTokenTree(child, indent + 1));
		}
	}
	return lines.join("\n");
}

/**
 * Build a text dump for a single page fragment.
 * Returns { text: string, hasIssues: boolean }.
 */
export function buildPageDump(fragments, i, pageH, elementSpans, fragW, fragH) {
	const lines = [];
	const log = (...args) => lines.push(args.join(" "));

	const page = fragments[i];
	if (page.isBlank) return { text: `### Page ${i + 1} (blank)`, hasIssues: false };

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
		? `constraints={content: ${page.constraints.contentArea.inlineSize}x${page.constraints.contentArea.blockSize}}`
		: "";
	const issueTag = hasIssues ? `Issues: ${issues.length}` : "";

	log(`### Page ${i + 1}`);
	log(`pageSize: ${fragW}x${fragH}`);
	log(`blockSize: ${page.blockSize.toFixed(2)}`);
	log(`remaining: ${remaining.toFixed(2)}`);
	log(`${issueTag}`);

	log("#### Layout:");
	log(`- ${btInfo}`);
	log(`- ${csInfo}`);

	const textSegments = collectPageTextSegments(page, prevBT);
	if (textSegments.length > 0) {
		log(`- first text: "${truncate(textSegments[0], 80)}"`);
		if (textSegments.length > 1) {
			log(`- last text: "${truncateStart(textSegments[textSegments.length - 1], 80)}"`);
		}
	}

	log(
		`- childFragments: ${page.childFragments.filter((f) => f.node).length}  childSum=${childSum.toFixed(2)}  gap=${gap.toFixed(2)}  remaining=${remaining.toFixed(2)}`,
	);

	for (const info of childData) {
		printFragmentInfo(info, log, 0);
	}

	if (elementSpans) {
		const pageSpanning = [];
		for (const [name, [first, last]] of elementSpans) {
			if (last > first && first <= i && last >= i) {
				pageSpanning.push(`${name} (pages ${first + 1}-${last + 1})`);
			}
		}
		if (pageSpanning.length > 0) {
			log(`\n#### Spanning elements (${pageSpanning.length}):`);
			for (const s of pageSpanning) {
				log(`- ${s}`);
			}
		}
	}

	if (hasIssues) {
		log("\n#### Issues:");
		for (const issue of issues) {
			log(`- ${issue}`);
		}
	}

	if (page.breakToken) {
		log("\n#### BreakTokens:");
		log(debugPrintTokenTree(page.breakToken, 0));
	}
	log("");

	return { text: lines.join("\n"), hasIssues };
}

/**
 * Build a document-level summary across all fragments.
 */
export function buildDocumentSummary(fragments) {
	const lines = [];
	let totalContentHeight = 0;
	let overflowPages = 0;
	let forcedBreaks = 0;

	for (const page of fragments) {
		if (page.isBlank) continue;
		const effH = fragmentainerHeight(page);
		totalContentHeight += page.blockSize;
		if (page.blockSize > effH + 0.01) overflowPages++;
		if (page.breakToken) {
			if (page.breakToken.isForcedBreak) forcedBreaks++;
			forcedBreaks += countForcedBreaks(page.breakToken);
		}
	}

	lines.push("## Document Summary");
	lines.push(`- totalPages: ${fragments.length}`);
	lines.push(`- totalContentHeight: ${totalContentHeight.toFixed(1)}px`);
	lines.push(`- overflowPages: ${overflowPages}`);
	lines.push(`- forcedBreaks: ${forcedBreaks}`);
	return lines.join("\n");
}

export function buildElementSpans(fragments) {
	const map = new Map();
	for (let i = 0; i < fragments.length; i++) {
		trackElementSpans(fragments[i], i, map);
	}
	return map;
}

/**
 * Get the effective fragmentainer height for a page fragment.
 */
export function fragmentainerHeight(fragment, defaultH) {
	return fragment.constraints ? fragment.constraints.contentArea.blockSize : defaultH;
}

/**
 * Build a transparent overlay showing fragment borders for a page.
 * Each fragment is drawn as a colored outline at its engine-calculated position.
 *
 * @param {import('../src/fragmentation/fragment.js').Fragment} pageFragment
 * @param {{ inlineSize: number, blockSize: number }} contentArea
 * @param {{ top: number, right: number, bottom: number, left: number }} margins
 * @returns {HTMLElement}
 */
export function buildFragmentOverlay(pageFragment, contentArea, margins) {
	const container = document.createElement("div");
	container.className = "fragment-overlay";

	const COLORS = [
		"hsl(200, 80%, 50%)",
		"hsl(120, 80%, 40%)",
		"hsl(30, 90%, 50%)",
		"hsl(280, 70%, 50%)",
		"hsl(0, 80%, 50%)",
		"hsl(180, 70%, 40%)",
	];

	function walk(fragment, parentTop, parentLeft, parentWidth, depth) {
		for (const child of fragment.childFragments) {
			if (!child.node) continue;

			const top = parentTop + child.blockOffset;
			const left = parentLeft;
			const width = child.inlineSize || parentWidth;
			const height = child.blockSize;

			if (height <= 0) continue;

			// Detect through-collapsed margins: margins from the first/last
			// child that collapse through the parent (no padding/border).
			let throughTop = 0;
			let throughBottom = 0;
			const boxStart = (child.node.paddingBlockStart || 0) + (child.node.borderBlockStart || 0);
			if (boxStart === 0 && child.childFragments.length > 0) {
				const first = child.childFragments[0];
				if (first && first.blockOffset > 0) {
					throughTop = first.blockOffset;
				}
			}
			// Bottom through-collapse: measure the gap between the last child's
			// end and the parent's blockSize when the parent has no bottom
			// padding/border. Mirrors the throughTop computation.
			const boxEnd = (child.node.paddingBlockEnd || 0) + (child.node.borderBlockEnd || 0);
			if (boxEnd === 0 && child.childFragments.length > 0) {
				const last = child.childFragments[child.childFragments.length - 1];
				if (last && last.node) {
					const trailing = child.blockSize - (last.blockOffset + last.blockSize);
					if (trailing > 0) throughBottom = trailing;
				}
			}

			const visibleHeight = height - throughTop - throughBottom;
			const color = COLORS[depth % COLORS.length];
			const isIFC = child.node.isInlineFormattingContext;

			const box = document.createElement("div");
			box.style.cssText = `
				position: absolute;
				top: ${top}px;
				left: ${left}px;
				width: ${width}px;
				height: ${visibleHeight}px;
				outline: ${isIFC ? "1px dashed" : "2px solid"} ${color};
				outline-offset: ${isIFC ? "0px" : "-1px"};
			`;

			const tag = child.node.element?.tagName?.toLowerCase() || "?";
			const label = document.createElement("span");
			label.setAttribute("data-frag-label", "");
			label.textContent = `${tag} ${visibleHeight.toFixed(1)}`;
			label.style.cssText = `top: 0; left: 0; color: ${color};`;
			box.appendChild(label);

			container.appendChild(box);

			// Recurse into block children — subtract throughTop so the
			// first child (whose blockOffset equals the through-margin)
			// aligns with the visual box top.
			if (!isIFC && child.childFragments.length > 0) {
				const childPadTop = (child.node.paddingBlockStart || 0) + (child.node.borderBlockStart || 0);
				const childPadLeft = (child.node.paddingInlineStart || 0) + (child.node.borderInlineStart || 0);
				walk(child, top + childPadTop - throughTop, left + childPadLeft, width, depth + 1);
			}
		}
	}

	walk(pageFragment, margins.top, margins.left, contentArea.inlineSize, 0);

	// Content box overlay: shows the full available block size and
	// how much the engine consumed vs what remains.
	const used = pageFragment.blockSize;
	const available = contentArea.blockSize;
	const remaining = available - used;

	// Full content area outline
	const contentBox = document.createElement("div");
	contentBox.style.cssText = `
		position: absolute;
		top: ${margins.top}px;
		left: ${margins.left}px;
		width: ${contentArea.inlineSize}px;
		height: ${available}px;
		outline: 1px dashed hsl(0, 0%, 60%);
		outline-offset: -0.5px;
		pointer-events: none;
	`;
	container.appendChild(contentBox);

	// Used block region
	if (used > 0) {
		const usedBox = document.createElement("div");
		usedBox.style.cssText = `
			position: absolute;
			top: ${margins.top}px;
			left: ${margins.left}px;
			width: ${contentArea.inlineSize}px;
			height: ${used}px;
			background: hsla(200, 80%, 50%, 0.04);
			border-bottom: 1px solid hsl(200, 80%, 50%);
			pointer-events: none;
		`;
		const usedLabel = document.createElement("span");
		usedLabel.setAttribute("data-frag-label", "");
		usedLabel.textContent = `used ${used.toFixed(1)}`;
		usedLabel.style.cssText = `bottom: 2px; right: 2px; top: auto; left: auto; color: hsl(200, 80%, 50%);`;
		usedBox.appendChild(usedLabel);
		container.appendChild(usedBox);
	}

	// Remaining block region
	if (remaining > 1) {
		const remBox = document.createElement("div");
		remBox.style.cssText = `
			position: absolute;
			top: ${margins.top + used}px;
			left: ${margins.left}px;
			width: ${contentArea.inlineSize}px;
			height: ${remaining}px;
			background: hsla(0, 80%, 50%, 0.04);
			pointer-events: none;
		`;
		const remLabel = document.createElement("span");
		remLabel.setAttribute("data-frag-label", "");
		remLabel.textContent = `remaining ${remaining.toFixed(1)}`;
		remLabel.style.cssText = `top: 2px; right: 2px; color: hsl(0, 60%, 45%);`;
		remBox.appendChild(remLabel);
		container.appendChild(remBox);
	}

	return container;
}

// Internal helpers

function dumpFragment(frag, parentBT, depth) {
	const node = frag.node;
	const tag = node.element?.tagName?.toLowerCase() || "?";
	const name = node.debugName || tag;
	const isIFC = node.isInlineFormattingContext;
	const measured = node.blockSize || null;

	const breakProps = {};
	if (node.breakBefore && node.breakBefore !== "auto") breakProps.before = node.breakBefore;
	if (node.breakAfter && node.breakAfter !== "auto") breakProps.after = node.breakAfter;
	if (node.breakInside && node.breakInside !== "auto") breakProps.inside = node.breakInside;

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

		// Skip lineHeight checks for table cells (border-collapse makes
		// effective insets unpredictable) and anonymous blocks (lineHeight
		// is inherited from the parent element, not the actual content).
		const skipLineHeightChecks = tag === "td" || tag === "th" || !node.element;
		if (!skipLineHeightChecks && computed > frag.blockSize + 0.5) {
			issues.push(
				`${name}: lines*lineHeight (${computed.toFixed(2)}) > blockSize (${frag.blockSize.toFixed(2)}) by ${(computed - frag.blockSize).toFixed(2)}px`,
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

function printFragmentInfo(info, log, depth) {
	const indent = "  ".repeat(depth) + "- ";

	const parts = [`${indent}${info.name}  blockSize=${info.blockSize.toFixed(2)}`];
	if (info.measured !== null) parts.push(`measured=${info.measured.toFixed(2)}`);
	parts.push(`margin=${info.margin[0].toFixed(1)}/${info.margin[1].toFixed(1)}`);
	parts.push(`pad=${info.padding[0].toFixed(1)}/${info.padding[1].toFixed(1)}`);
	if (info.border[0] || info.border[1]) {
		parts.push(`border=${info.border[0].toFixed(1)}/${info.border[1].toFixed(1)}`);
	}
	if (info.hasBreakToken) {
		const consumed =
			info.consumedBlockSize !== null ? ` consumed=${info.consumedBlockSize.toFixed(1)}` : "";
		parts.push(`BT(${info.breakTokenType}${consumed})`);
	}
	if (info.isMonolithic) parts.push("[monolithic]");

	const bpParts = [];
	if (info.breakProps.before) bpParts.push(`break-before:${info.breakProps.before}`);
	if (info.breakProps.after) bpParts.push(`break-after:${info.breakProps.after}`);
	if (info.breakProps.inside) bpParts.push(`break-inside:${info.breakProps.inside}`);
	if (bpParts.length) parts.push(`{${bpParts.join(", ")}}`);

	let line = parts.join("  ");

	if (info.isIFC && info.ifc) {
		const ifc = info.ifc;
		const subIndent = "  ".repeat(depth + 1) + "- ";
		line += `\n${subIndent}IFC: lineHeight=${ifc.lineHeight.toFixed(2)} lines=${ifc.lineCount} computed=${ifc.computedHeight.toFixed(2)} text=[${ifc.startOffset}..${ifc.endOffset}]/${ifc.textLength}`;
	}

	log(line);

	for (const child of info.children) {
		printFragmentInfo(child, log, depth + 1);
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
	const start = breakToken && breakToken.type === "inline" ? breakToken.textOffset : 0;
	const end =
		fragment.breakToken && fragment.breakToken.type === "inline"
			? fragment.breakToken.textOffset
			: data.textContent.length;
	let text = data.textContent.slice(start, end);
	const ws = fragment.node.whiteSpace || "normal";
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
		const name = child.node.debugName || child.node.element?.tagName?.toLowerCase() || "?";
		if (map.has(name)) {
			map.get(name)[1] = pageIndex;
		} else {
			map.set(name, [pageIndex, pageIndex]);
		}
		trackElementSpans(child, pageIndex, map);
	}
}

function truncate(str, maxLen) {
	return str.length <= maxLen ? str : str.slice(0, maxLen - 3) + "…";
}

function truncateStart(str, maxLen) {
	return str.length <= maxLen ? str : "…" + str.slice(str.length - maxLen + 3);
}
