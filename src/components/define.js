const warned = new Set();

/**
 * Register a custom element class under `name`, once.
 *
 * A second registration of the *same* class is a no-op: a module evaluated
 * once can be imported from many places. A second registration of a
 * *different* class means two copies of fragmentainers are live on the page.
 * Only one class can own the name, so the copies diverge — `instanceof`
 * against the losing copy's class fails for every element on the page, and
 * each copy keeps its own module-level state. That is a page setup bug rather
 * than a supported configuration, so it warns instead of passing silently.
 *
 * @param {string} name — custom element name
 * @param {CustomElementConstructor} ctor — class to register
 * @returns {CustomElementConstructor} the class registered under `name`, which
 *   is `ctor` unless another copy of the module got there first
 */
export function defineElement(name, ctor) {
	const existing = customElements.get(name);
	if (!existing) {
		customElements.define(name, ctor);
		return ctor;
	}

	if (existing !== ctor && !warned.has(name)) {
		warned.add(name);
		console.warn(
			`<${name}> is already defined by a different class: two copies of ` +
				"fragmentainers are loaded. The first definition stays in use, so " +
				"instanceof checks and module state will not agree across the copies.",
		);
	}

	return existing;
}
