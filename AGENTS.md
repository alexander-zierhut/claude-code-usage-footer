# Working agreement for this repo

For anyone changing `usage-footer`, human or model. Users read [`README.md`](README.md); this file is what you need to change the plugin without breaking what it promises. How Claude Code's footer behaves under the hood (and how we found out) is in [`docs/ENGINE-NOTES.md`](docs/ENGINE-NOTES.md), shipping a version is in [`docs/RELEASING.md`](docs/RELEASING.md).

The plugin is a fork of [ribbon](https://github.com/robonuggets/ribbon) by Jay E (RoboNuggets), MIT. Keep the credit in the README and Jay's line in `LICENSE`.

## The rules

These came from the owner while building it. Each one was a correction, so do not soften them.

- The footer row never wraps. A second line under "auto mode on" is the worst failure this plugin can have. If the text does not fit, use a shorter form; if the shortest does not fit, draw nothing. Never guess optimistically.
- No timers for layout decisions. Hiding for "a few seconds" was tried and rejected: it comes back too early (wrap) or too late. Decide from facts the engine gives (props, events, measured text), or reserve room for the worst case.
- Do not spam the usage API. One `/api/oauth/usage` read per 5 minutes across all open sessions (shared through `$.store`), never per render, never retried in a loop.
- Dollars only for the next-message price. A "percent of the weekly limit" estimate was built and removed: the dollar-per-percent ratio is unknown and other devices skew it.
- Calm colours. No background on the footer row, labels in the terminal's dim colour, usage colours fade in from gray as a window fills (full colour from 95% used). Warm cache is muted, cold stands out with its price.
- Never touch the user's token. Live usage goes through `$.session.authorize()` and `$.http.fetch` with the auth handle; the plugin does not read `~/.claude/.credentials.json`.

## How it is built

Everything lives in `hooks/register.tsx` (state, events, footer, desktop band) and `hooks/cache-art.ts` (ribbon's drawings and the `MODELS` price table). Types of the stored state are in `types/index.d.ts`.

- State: `windows` (5h / 7d), `cache` (last request time, context tokens, model) and `fold` are plugin atoms. Engine facts that only matter per process (`hintCols`, `working`, `selectCols`) are module variables.
- Usage figures come from three places, newest wins: `session.start` (`$.session.usage()`), `session.measure` and `turn.complete` (the session's own responses), and `live()` (account-wide, every 5 minutes, shared via `$.store` key `live`).
- Cache clock: `turn.step` of the main thread stamps the request time; subagents (`e.agentId`) are ignored. `/clear` and `/compact` reset it, `--resume` seeds it from `seconds_since_last_response`. The TTL is a fixed 60 minutes (`TTL_MIN` in `cache-art.ts`).
- Terminal footer: `ui.render` for `SessionMode`. `rowParts(list, view, now, level)` builds the text for level 0 (long), 1 (medium) and 2 (short); the renderer takes the first level whose exact width (`partsWidth`) fits `roomFor(...)`, otherwise it returns only the engine's own node.
- `roomFor` is the worst-case width of the footer's left side for the current state: mode label, room for a PR link, `esc to interrupt` while working (from `AbovePrompt`'s `isWorking`), the selection hint where it can appear (VS Code / xterm.js via env, `ctrl+c to copy` when `copyOnSelect` is off), and the measured `PromptHint`. The constants at the top of `register.tsx` hold the widths. When Claude Code adds a new hint on the left, add it here.
- Desktop, VS Code and mobile still draw ribbon's band through `AbovePrompt`; the terminal returns `next(e)` there.
- Idle compaction: the 30 second tick calls `compactIdle`, which asks `$.session.compact()` when `compactDue` holds (the last `COMPACT_LEFT_MS`, 5 minutes, of a warm cache). `compactedFor` remembers the request time it ran for, so one idle stretch is compacted once; a refused try (a turn is running) is repeated on the next tick. It must only ever start while the cache is warm: `compactDue` is false in the last `COMPACT_MARGIN_MS` before the expiry and after it, so a late tick or a machine waking from sleep never compacts a cold conversation. Afterwards `classic.SessionStart` with source `compact` clears the cache facts. This timer decides an action, not layout, so the no-timers rule above does not apply to it.
- The compact tool: `session.start` registers `COMPACT_TOOL` (`$.tool.register`, not awaited), the `tool.run` hook answers it. A turn is running when the tool is called, so the hook only notes the request in `asked`; `compactAsked` runs it from `turn.complete` of the main thread (and from the tick as a retry), then sends the follow-up with `$.prompt.submit`. If the compaction cannot run, the follow-up is still sent so unattended work goes on.
- `compacting` is true while either compaction is under way. A compaction can take longer than a tick; without the flag the tick starts a second one beside it (seen live).
- Switches: `userConfig` in `plugin.json` (`auto_compact`, `compact_tool`, both default true) shows up in `/config`. `optionOn` reads them through `$.settings.read({ key: 'pluginConfigs' })` each time they matter, so a change applies without a restart (the tool itself is only registered at session start).

## Testing

`claude plugin test .` runs `tests/*.test.ts(x)` against the engine's test kit (`claude-code/testing`). Rules the kit enforces that are easy to trip over:

- No dynamic `import()` in tests; test through mounted UI (`$.ui.mount`) and the engine events.
- Anything the plugin calls must be answered in the test (`on('http.fetch', ...)`, `on('env.get', ...)`); unanswered calls throw, and the plugin's own `try/catch` paths then run.
- An engine stand-in for `ui.render` must return an element (`<Text>engine</Text>`), not `{ value: null }`. Tests that use JSX must be `.tsx`.
- Module variables survive between tests in one file; order tests so a test that changes `hintCols` or `working` runs last or resets them.

Every layout change needs a test with exact column numbers (see "the footer takes the longest form whose exact text fits").

## Upstream

What the plugin really needs from Claude Code (the free width of the footer, or engine-side fitting) is requested in [anthropics/claude-code#105631](https://github.com/anthropics/claude-code/issues/105631). If it lands, replace `roomFor` and its constants with the engine's figure and drop the worst-case reserve. Related upstream issues are listed in that request.
