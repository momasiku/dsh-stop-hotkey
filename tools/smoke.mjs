/**
 * Smoke test for the browser half of `dsh-stop-hotkey`.
 *
 * No jsdom is available in this checkout, so this harness stubs just enough of
 * the browser (document, event target, rAF, timers) to drive the real bundle:
 * it loads `lib/client.js` exactly the way the client module loader does
 * (`window.__ModuleLoader__.load({id, factory})`), then dispatches synthetic
 * keydown events and asserts what the plugin did.
 *
 * Run: node tools/smoke.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8');

let failures = 0;
let checks = 0;

/** Assert one condition and record the outcome. */
function ok(label, condition) {
	checks += 1;
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}`);
	}
}

/** Minimal Element stand-in: enough for `matches` walking and appendChild. */
function makeElement(matches = () => false) {
	const element = {
		parentElement: null,
		matches: (selector) => matches(selector),
		setAttribute() {},
		appendChild() {},
		remove() {},
		style: {},
		textContent: ''
	};
	return element;
}

/** A standards-plausible event: plain object + preventDefault bookkeeping. */
function makeEvent(key, target = null) {
	return {
		key,
		keyCode: key === 'Escape' ? 27 : 0,
		target,
		isComposing: false,
		defaultPrevented: false,
		stopped: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopPropagation() {
			this.stopped = true;
		}
	};
}

/** Install the globals the bundle touches, and expose the loader queue. */
function makeEnvironment() {
	const listeners = { capture: [], bubble: [] };
	const document = {
		body: { appendChild() {} },
		createElement: () => makeElement(),
		addEventListener(type, handler, capture) {
			(listeners[capture === true ? 'capture' : 'bubble']).push({ type, handler });
		},
		removeEventListener(type, handler, capture) {
			const bucket = listeners[capture === true ? 'capture' : 'bubble'];
			const index = bucket.findIndex((row) => row.type === type && row.handler === handler);
			if (index !== -1) bucket.splice(index, 1);
		}
	};

	const registrations = [];
	const window = {
		__ModuleLoader__: {
			load(registration) {
				registrations.push(registration);
			}
		}
	};

	const globals = {
		window,
		document,
		requestAnimationFrame: (fn) => setTimeout(fn, 0),
		setTimeout,
		clearTimeout,
		Element: function Element() {}
	};

	/** Dispatch to the registered capture listeners, in registration order. */
	function press(key, target = null) {
		const event = makeEvent(key, target);
		for (const row of [...listeners.capture]) {
			if (row.type !== 'keydown') continue;
			row.handler(event);
		}
		return event;
	}

	return { registrations, listeners, press, globals };
}

/** Build a mock client context with one running session. */
function makeContext({ running = true, hasConversation = true, stopLabel = 'Stop generating' } = {}) {
	const calls = { cancel: 0, effects: [] };
	const conversation = {
		cancel() {
			calls.cancel += 1;
			return Promise.resolve({ ok: true });
		}
	};
	const session = { running };
	const ctx = {
		sessions: {
			list: { getSnapshot: () => ({ current: 'session-1' }) },
			binding: (id) => (id === 'session-1' ? { session } : void 0),
			scope: (id) => {
				if (id !== 'session-1') return void 0;
				return {
					get: (service) => (service === 'conversation' && hasConversation ? conversation : void 0)
				};
			}
		},
		get: (service) => (service === 'locale' ? { bind: () => () => stopLabel } : void 0),
		effect: (factory) => {
			calls.effects.push(factory);
			return () => {};
		}
	};
	return { ctx, calls, session };
}

/** Load the real bundle against a fresh environment and return its exports. */
function load(env) {
	const previous = {};
	for (const [key, value] of Object.entries(env.globals)) {
		previous[key] = globalThis[key];
		globalThis[key] = value;
	}
	try {
		// eslint-disable-next-line no-new-func -- the bundle is an IIFE over window
		new Function('window', 'document', 'requestAnimationFrame', 'setTimeout', 'clearTimeout', 'Element', bundle)(
			env.globals.window,
			env.globals.document,
			env.globals.requestAnimationFrame,
			env.globals.setTimeout,
			env.globals.clearTimeout,
			env.globals.Element
		);
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete globalThis[key];
			else globalThis[key] = value;
		}
	}
	if (env.registrations.length !== 1) throw new Error(`expected exactly one loader registration, got ${env.registrations.length}`);
	const registration = env.registrations[0];
	return { id: registration.id, exports: registration.factory(() => { throw new Error('unexpected require'); }) };
}

console.log('dsh-stop-hotkey smoke');

// --- shape ------------------------------------------------------------------

{
	const env = makeEnvironment();
	const loaded = load(env);
	ok('registers under id "dsh-stop-hotkey"', loaded.id === 'dsh-stop-hotkey');
	ok('exports name/inject/apply', loaded.exports.name === 'stop-hotkey'
		&& Array.isArray(loaded.exports.inject)
		&& loaded.exports.inject.includes('sessions')
		&& typeof loaded.exports.apply === 'function');
}

// --- a single Escape arms, it does not cancel --------------------------------

{
	const env = makeEnvironment();
	const { exports } = load(env);
	const { ctx, calls } = makeContext();
	exports.apply(ctx);
	const first = env.press('Escape');
	ok('first Escape on a running turn does NOT cancel', calls.cancel === 0);
	ok('first Escape is not consumed (popups keep working)', first.defaultPrevented === false);
}

// --- a second Escape cancels and consumes the event ---------------------------

{
	const env = makeEnvironment();
	const { exports } = load(env);
	const { ctx, calls } = makeContext();
	exports.apply(ctx);
	env.press('Escape');
	const second = env.press('Escape');
	ok('second Escape calls conversation.cancel() exactly once', calls.cancel === 1);
	ok('second Escape is consumed', second.defaultPrevented === true && second.stopped === true);
}

// --- an unrelated key retires the arming window ------------------------------

{
	const env = makeEnvironment();
	const { exports } = load(env);
	const { ctx, calls } = makeContext();
	exports.apply(ctx);
	env.press('Escape');
	env.press('a');
	env.press('Escape');
	ok('a keypress between the two Escapes resets the arming window', calls.cancel === 0);
}

// --- idle sessions are left alone --------------------------------------------

{
	const env = makeEnvironment();
	const { exports } = load(env);
	const { ctx, calls } = makeContext({ running: false });
	exports.apply(ctx);
	env.press('Escape');
	env.press('Escape');
	ok('idle turn never calls cancel()', calls.cancel === 0);
}

// --- a popup owns Escape -----------------------------------------------------

{
	const env = makeEnvironment();
	const { exports } = load(env);
	const { ctx, calls } = makeContext();
	exports.apply(ctx);
	const popupTarget = makeElement((selector) => selector.includes('[role="menu"]'));
	env.press('Escape', popupTarget);
	env.press('Escape', popupTarget);
	ok('Escape inside an open menu/dialog never cancels', calls.cancel === 0);
}

// --- IME composition ---------------------------------------------------------

{
	const env = makeEnvironment();
	const { exports } = load(env);
	const { ctx, calls } = makeContext();
	exports.apply(ctx);
	const composing = makeEvent('Escape');
	composing.isComposing = true;
	for (const row of env.listeners.capture) row.handler(composing);
	env.press('Escape');
	ok('a composing Escape neither cancels nor arms', calls.cancel === 0);
}

// --- missing conversation service degrades quietly ---------------------------

{
	const env = makeEnvironment();
	const { exports } = load(env);
	const { ctx, calls } = makeContext({ hasConversation: false });
	exports.apply(ctx);
	env.press('Escape');
	const second = env.press('Escape');
	ok('missing conversation service cancels nothing', calls.cancel === 0);
	ok('missing conversation service does not throw or consume', second.defaultPrevented === false);
}

// --- teardown ----------------------------------------------------------------

{
	const env = makeEnvironment();
	const { exports } = load(env);
	const { ctx, calls } = makeContext();
	exports.apply(ctx);
	ok('registers one disposer through ctx.effect', calls.effects.length === 1);
	ok('two keydown listeners were installed', env.listeners.capture.length === 2);
	calls.effects[0]()(); // ctx.effect(factory) → factory() returns the disposer
	ok('disposing removes both keydown listeners', env.listeners.capture.length === 0);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
