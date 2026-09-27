window.__ModuleLoader__.load({
	id: "dsh-stop-hotkey",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		/**
		 * Browser half of `dsh-stop-hotkey`: a keyboard interrupt for the
		 * running turn of the current session.
		 *
		 * It goes through exactly the path the composer's stop button uses —
		 * resolve the current session id, resolve its session-scoped
		 * `conversation` service, call `cancel()` — so it needs no DOM
		 * knowledge of the input bar and stays correct if that UI moves.
		 */

		/** Composer's own "stop generating" tooltip key, localized. */
		const STOP_LABEL = "input.stop";

		/** Stable module identity. */
		const name = "stop-hotkey";

		/** `sessions` is the client session service (list, scopes, bindings). */
		const inject = ["sessions"];

		/**
		 * Elements that legitimately own Escape while they are open. Escape is
		 * only claimed as an interrupt when none of these is a focus/event
		 * ancestor, so dismissing a menu never also kills the turn.
		 */
		const ESCAPE_OWNERS = [
			'[role="menu"]',
			'[role="listbox"]',
			'[role="dialog"]',
			'[role="alertdialog"]',
			'[aria-modal="true"]',
			'[data-radix-popper-content-wrapper]',
			'[data-popup-open="true"]',
			'[data-state="open"]'
		].join(",");

		/** Reuse the composer's own localized label so the hint reads natively. */
		function stopHint(ctx) {
			try {
				const locale = ctx.get("locale");
				if (locale === void 0 || typeof locale.bind !== "function") return null;
				for (const ns of ["conversation", "ui-conversation"]) {
					const translated = locale.bind(ns)(STOP_LABEL);
					if (typeof translated === "string" && translated !== "" && translated !== STOP_LABEL) return translated;
				}
			} catch {
				/* locale is decorative here; never let it break the interrupt */
			}
			return null;
		}

		/** The session currently on stage, or undefined when none is open. */
		function currentSession(ctx) {
			try {
				return ctx.sessions.list.getSnapshot().current;
			} catch {
				return void 0;
			}
		}

		/** The business Session face for one id (carries the `running` bit). */
		function sessionOf(ctx, id) {
			try {
				return ctx.sessions.binding(id)?.session;
			} catch {
				return void 0;
			}
		}

		/**
		 * Resolve the session-scoped Conversation action face — the same service
		 * `ui-conversation` calls to service the composer's stop button.
		 */
		function conversationOf(ctx, id) {
			try {
				const scoped = ctx.sessions.scope(id);
				if (scoped === void 0 || typeof scoped.get !== "function") return void 0;
				return scoped.get("conversation");
			} catch {
				return void 0;
			}
		}

		/**
		 * True when an open popup/dialog between target and root owns this Escape.
		 *
		 * Walks by duck-typing (`matches` + `parentElement`) rather than
		 * `instanceof Element`: a cross-realm node — the plugin bundle can run
		 * against a different global than the document it is handed — fails an
		 * `instanceof` check, which would silently make every popup invisible
		 * and let Escape dismiss UI *and* kill the turn at once.
		 */
		function escapeOwnedByPopup(target) {
			let node = target;
			let hops = 0;
			while (node !== null && node !== void 0 && hops < 64) {
				if (typeof node.matches === "function" && node.matches(ESCAPE_OWNERS)) return true;
				node = node.parentElement;
				hops += 1;
			}
			return false;
		}

		/** Transient bottom-centered notice, built inline so no CSS file is needed. */
		function notify(text) {
			try {
				const host = document.createElement("div");
				host.setAttribute("role", "status");
				Object.assign(host.style, {
					position: "fixed",
					left: "50%",
					bottom: "84px",
					transform: "translateX(-50%)",
					zIndex: "2147483000",
					padding: "6px 12px",
					borderRadius: "8px",
					fontSize: "12px",
					lineHeight: "1.5",
					color: "var(--dsh-text-secondary, #d0d0d0)",
					background: "var(--dsh-surface-overlay, rgba(32,32,32,0.92))",
					border: "1px solid var(--dsh-border-subtle, rgba(255,255,255,0.12))",
					pointerEvents: "none",
					opacity: "0",
					transition: "opacity 120ms ease"
				});
				host.textContent = text;
				document.body.appendChild(host);
				requestAnimationFrame(() => {
					host.style.opacity = "1";
				});
				setTimeout(() => {
					host.style.opacity = "0";
					setTimeout(() => host.remove(), 200);
				}, 1600);
			} catch {
				/* a failed hint must never surface as an error */
			}
		}

		/**
		 * Attempt one interrupt. Returns a short outcome word for diagnostics.
		 * @param ctx - Client Cordis context.
		 */
		function interrupt(ctx) {
			const id = currentSession(ctx);
			if (id === void 0) return "no-session";
			const session = sessionOf(ctx, id);
			if (session === void 0) return "no-binding";
			if (session.running !== true) return "idle";
			const conversation = conversationOf(ctx, id);
			if (conversation === void 0 || typeof conversation.cancel !== "function") return "no-conversation";
			/* cancel() records its own failure on promptError and resolves with a
			 * result object; swallow rejection so a transport error cannot escape
			 * into an unhandled rejection from a keydown handler. */
			Promise.resolve(conversation.cancel()).catch(() => {});
			return "canceled";
		}

		/**
		 * Install the keyboard interrupt.
		 * @param ctx - Client Cordis context.
		 */
		function apply(ctx) {
			/** An Escape this layer is believed to have spent on an interrupt. */
			let spent = null;

			const onKeyDown = (event) => {
				if (event.key !== "Escape") return;
				/* IME composition, or a popup/dialog that legitimately owns Escape. */
				if (event.isComposing === true || event.keyCode === 229) return;
				if (escapeOwnedByPopup(event.target)) return;

				const id = currentSession(ctx);
				const running = id !== void 0 && sessionOf(ctx, id)?.running === true;

				if (!running) {
					spent = null;
					return;
				}

				/* First Escape: stand down (leave popup dismissal to the shell).
				 * Second Escape inside the window: force the interrupt, because
				 * either the first one was swallowed by UI this layer cannot see,
				 * or the user is insisting. A different key in between resets. */
				const forcing = spent !== null && spent.id === id && Date.now() - spent.at < 1500;
				if (!forcing) {
					spent = { id, at: Date.now() };
					const hint = stopHint(ctx);
					if (hint !== null) notify(hint);
					return;
				}

				spent = null;
				const outcome = interrupt(ctx);
				if (outcome === "canceled") {
					event.preventDefault();
					event.stopPropagation();
				}
			};

			/* A key other than Escape retires the arming window. */
			const onArmedKeyDown = (event) => {
				if (event.key !== "Escape") spent = null;
			};

			document.addEventListener("keydown", onArmedKeyDown, true);
			document.addEventListener("keydown", onKeyDown, true);
			ctx.effect(() => () => {
				document.removeEventListener("keydown", onArmedKeyDown, true);
				document.removeEventListener("keydown", onKeyDown, true);
			}, "dsh-stop-hotkey: keyboard interrupt");
		}

		exports.name = name;
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
