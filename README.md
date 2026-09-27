# dsh-stop-hotkey

**Stop the running turn without reaching for the mouse.** Press <kbd>Esc</kbd>
twice within 1.5 s and the current session's turn is cancelled — through the
exact same `conversation.cancel()` call the composer's stop button makes.

DSH ships no stop shortcut: the composer has a stop button and nothing binds it
to a key. This plugin adds one, and it is deliberately a **two-step** gesture.

## Highlights

- **Esc × 2, nothing to configure.** The first press *arms* and shows the
  composer's own localized "stop generating" hint; the second commits. Any other
  key, or waiting 1.5 s, retires the arming window.
- **Popups keep their Escape.** Menus, dialogs, listboxes and comboboxes own
  Escape while they are open, so dismissing a dropdown never kills your turn.
- **No DOM scraping.** The interrupt resolves through the session services
  (`sessions.list` → `sessions.binding(id).session.running` →
  `sessions.scope(id).get('conversation').cancel()`), so a restyled or relocated
  composer cannot break it.
- **Refuses to guess.** No session, no binding, an idle turn or a missing
  conversation service each end in a reported reason and zero side effects.
- **Clean teardown.** One disposer, two keydown listeners, both removed on unload
  — asserted by the smoke test.


## Keys

| Gesture | Effect |
| --- | --- |
| `Escape` | **Arms** the interrupt and shows the composer's own localized "stop generating" hint. Nothing is canceled yet. |
| `Escape` again within 1.5s | Cancels the running turn and consumes the event. |
| Any other key | Retires the arming window. |
| `Escape` inside an open menu / listbox / dialog / combobox | Never interacts with this plugin — the popup keeps owning its own dismissal. |

The two-step gesture is deliberate: `Escape` is exactly the key the shell uses
to dismiss menus and popovers, so a single-press interrupt would kill the turn
every time you merely closed a dropdown. The first press stands down, the second
commits — and because the first press is left unconsumed, popup dismissal keeps
working normally.

## Why it cannot miss

The interrupt resolves at call time, in the same order the composer's stop
button does:

1. `ctx.sessions.list.getSnapshot().current` — the session on stage.
2. `ctx.sessions.binding(id).session.running` — is a turn actually running?
3. `ctx.sessions.scope(id).get('conversation').cancel()` — the session-scoped
   Conversation service, the identical method the button calls.

No DOM scraping of the input bar, so the plugin survives the composer being
restyled or relocated. It also refuses to guess: when no session is open, no
turn is running, or the conversation service is unavailable, it does nothing at
all and reports the reason (`no-session` / `no-binding` / `idle` /
`no-conversation`) from `interrupt()`.

## Layout

```
package.json        dsh.bundle.patch + dsh.client (platform web, bundle id = package name)
cordis.patch.yml    inserts the single `stop-hotkey` row into the profile
lib/index.js        host half — empty; this plugin is browser-only
lib/client.js       the browser bundle (window.__ModuleLoader__.load)
tools/smoke.mjs     headless test of the browser half
```

## Install

```powershell
dsh plugin --profile <profile> add "file:E:\DeepSeek的小屋\我的插件\dsh-stop-hotkey"
```

Because the package declares `dsh.bundle.patch`, the CLI also appends it to the
profile's `dsh.profile.bundles`, and the patch layer inserts the row — no manual
`cordis.patch.yml` edit is needed (unlike a plain plugin such as `dsh-pilot`).

**Restart the DSH Desktop app afterwards**, then hard-refresh the Web GUI
(`Ctrl+F5`). The host half is composed at startup, and the browser bundle only
enters `window.__DSH_BOOT__` on the next page load.

## Test

```powershell
node tools/smoke.mjs
```

The harness stubs the browser surface (document, event target, rAF) and drives
the **real** `lib/client.js` through a fake `window.__ModuleLoader__`, then
asserts the arming/cancel contract, popup ownership, IME passthrough, idle
handling, and disposer cleanup. 15 checks.

## Limits

- Interrupts the **current** session only; it does not walk into subagents.
- No configurable key yet — `Escape` is hard-coded, which is what the two-step
  gesture is tuned around.
- `cancel()` failures are swallowed into the session's own `promptError` strip,
  where the composer already surfaces stop failures.
