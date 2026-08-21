/**
 * Stand-in for `Measurer` when a flow lays out a pre-built layout tree
 * rather than DOM content — `createFragments()` and the unit tests that
 * drive layout directly. There is no measurement container to size, no
 * segments to advance through, and no content styles to compose with,
 * so every hook is inert.
 *
 * Having one lets the flow talk to a measurer unconditionally instead of
 * branching on whether it has one.
 */
export class NullMeasurer {
	#content;

	/**
	 * @param {*} [content] - whatever the flow was constructed with; handed
	 *   back by release()/reattach() so the flow's content reference survives.
	 */
	constructor(content = null) {
		this.#content = content;
	}

	applyConstraintSpace() {}

	advance() {
		return false;
	}

	getContentStyles() {
		return null;
	}

	get initialChildren() {
		return null;
	}

	get contentRoot() {
		return this.#content;
	}

	get isSegmented() {
		return false;
	}

	get isActive() {
		return true;
	}

	release() {
		return { content: this.#content };
	}

	reattach() {
		return this.#content;
	}
}
