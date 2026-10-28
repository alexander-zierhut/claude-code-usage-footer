# Engine notes

What we learned about Claude Code's plugin (mod) runtime while building this plugin, for Claude Code 2.1.312 on Linux. None of this is documented API; it was read from the installed build (`~/.local/share/claude/versions/<version>`, a bundled binary, searched with `LC_ALL=C grep -aoE`) and confirmed in use. Check it again after a Claude Code update before relying on it.

## The footer row

```
⏵⏵ auto mode on (shift+tab to cycle) · PR #247 · esc to interrupt     [notices]
                                                                      [SessionMode site]
```

- The row is a `Box` with `flexWrap: "wrap"`: left side first, right group second.
- The right group has `flexShrink: 0`, `marginLeft: "auto"`, `flexDirection: "column"` and `alignItems: "flex-end"`. Its children are the notifications (above) and the status group with the `SessionMode` site (below).
- Consequence: the right group is already flush right, so a mod must not add a spacer. When left + right do not fit, the whole right group wraps onto a new row. Shrinking or `overflow` inside the mod's tree does not help, because wrapping is decided on the group's full width.
- The left side is one `Box` (`height: 1`, `overflow: "hidden"`) built inside the footer component: mode label and cycle hint, then optional parts joined by ` · ` (PR link, remote/bridge status, notices, tasks, artifacts, voice hint, and the hint list ending with the selection hint). Only the `PromptHint` part is a mod site; the rest cannot be read by a mod.

## Render sites (`ui.render` components)

The list in the build: `AskUserQuestion, UserMessage, AssistantMessage, ToolUse, ToolResult, ToolGroup, ToolProgress, CommandOutput, Spinner, TurnDuration, InfoNotice, SessionMode, PromptHint, AbovePrompt, Pane`.

- `SessionMode`: `props.modes` (extra mode labels, usually empty). The engine's own rendering is `" · " + modes.join(" & ")`, dimmed; `next(e)` returns it (often nothing). `e.viewport.columns` is the terminal width.
- `PromptHint`: props carry the hint text (`hint`) and more, possibly the draft (`tail`); count only `hint` when it is present.
- `AbovePrompt`: props include `hasSurvey`, `isWorking`, `maxRows`, `bodyColumns`, `scroll`. `isWorking` is how the plugin learns that `esc to interrupt` is on the left.

## Selection

- `$.ui.selection()` returns the current selection, and after the selection is taken down it keeps returning the last selected text (the engine keeps it). A mod cannot tell live from finished. There is no selection event for mods (`ui.select` is for list pickers).
- The selection hint on the left is shown only while text is selected and only if copy-on-select is off (`ctrl+c to copy`) or the terminal is VS Code / xterm.js (`shift+click to native select`). Ghostty with the default copy-on-select shows none.

## Usage and the cache

- `$.session.usage()` gives `rateLimits` (`{ kind, percentUsed, resetsAt }`) and `context`; it takes `{ breakdown, columns }` and has no refresh option. The figures only move with this session's own responses, and are empty after `--resume` until the first request.
- `GET https://api.anthropic.com/api/oauth/usage` (header `anthropic-beta: oauth-2025-04-20`) returns account-wide `five_hour` and `seven_day` with `utilization` and `resets_at`. This is what `/usage` reads.
- `$.session.authorize()` returns `{ handle, kind }` (or `null`, for example in the desktop app, which does not lend its sign-in). `$.http.fetch(url, { auth: handle, headers })` adds the credentials only when the URL's host matches the handle's host (`api.anthropic.com`). The response is `{ ok, status, text }`.
- `$.store` is per plugin and shared across sessions (used for the 5 minute shared poll). Signature: `$.store.get(key)`, `$.store.set(key, value)`.
- Prompt cache: a cache read refreshes the 1 hour TTL at no cost, so the clock restarts at every main-thread request (`turn.step`, tool calls included). On API keys or in usage overage the TTL is 5 minutes, which the plugin does not detect (see upstream #99905 for exposing the status line's `prompt_cache` figures).

## Other call signatures used

- `$.env.get(name)`, `$.settings.read({ key })`, `$.clock.every(ms, fn)`, `$.clock.now()`, `$.ui.invalidate('ui.render')`.
- Test kit: `mock.store(on)`, `mock.clock(on, { now })` (with `.advance(ms)`), `$.ui.mount({ plugin, surface, component, props, viewport })`, `find`, `findAll`, `press`, `unmount`.
