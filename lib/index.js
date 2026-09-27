/**
 * Host half of `dsh-stop-hotkey`.
 *
 * This plugin is deliberately browser-only: interrupting a turn is purely a
 * client-side action (`conversation.cancel()` on the session scope), so the
 * host half exists only to occupy the profile row that mounts the browser
 * bundle declared by `dsh.client` in package.json.
 *
 * @module dsh-stop-hotkey
 */

/** Stable Loader identity for this row. */
export const name = 'stop-hotkey';

/** No host services are required. */
export const inject = [];

/**
 * Mount the (empty) host half.
 * @param _ctx - Host Cordis context.
 */
export function apply(_ctx) {}
