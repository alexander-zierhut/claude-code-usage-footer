# Claude Code usage footer

A Claude Code plugin that shows your plan usage and prompt cache state in the terminal footer, right next to the mode indicator:

```
⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt     7D 44% left · 3d 10h   5H 88% left · 2h 20m   WARM  58m left · $0.05 next
```

- How much of your 7-day and 5-hour usage is left, and when each window resets
- Read for your whole account, so usage from other tabs, the desktop app, your phone or another laptop shows up too
- Whether the prompt cache is warm or cold, and what your next message costs at API list prices

This version is built for the Claude Code CLI in the terminal. It is based on [ribbon](https://github.com/robonuggets/ribbon) by Jay E ([RoboNuggets](https://robonuggets.com)), a lovely band above the prompt whose drawn version is made for the desktop app. All the credit for the idea, the cache tracking and the pricing goes there.

## Install

In a shell:

```
claude plugin install usage-footer --marketplace alexander-zierhut/claude-code-usage-footer
```

Or inside a Claude Code session:

```
/plugin install usage-footer --marketplace alexander-zierhut/claude-code-usage-footer
```

Answer `y` to add the marketplace, pick the user scope, then start a new session.

Update with `claude plugin update usage-footer@claude-code-usage-footer`, remove with `claude plugin uninstall usage-footer`.

## What you see

| Part | Meaning |
|---|---|
| `7D 44% left · 3d 10h` | Share of the 7-day window left, and time until it resets |
| `5H 88% left · 2h 20m` | Same for the 5-hour window. `LOW` appears under 15% |
| `WARM 58m left` | The prompt cache is live; minutes until it expires |
| `COLD 2h 5m idle` | The cache expired; the next message re-sends the whole conversation |
| `$0.05 next` | Estimated cost of the next message at API list prices (cheap when warm, full re-cache when cold) |

The footer has no background and stays quiet while there is plenty of room: each window starts out mostly gray and turns orange (7D) or yellow (5H) as it fills, reaching full colour at 95% used. A warm cache is muted; a cold one stands out, together with its price.

The footer gets shorter in narrow terminals instead of wrapping onto a second line:

```
7D 44% left · 3d 10h   5H 88% left · 2h 20m   WARM  58m left · $0.05 next
7D 44% · 3d 10h  5H 88% · 2h 20m  WARM  58m · $0.05
7D 44%  5H 88%  WARM  $0.05
```

In the desktop app, the VS Code extension and on mobile it keeps ribbon's drawn band above the prompt.

## Changes compared to ribbon

- Terminal: the usage and cache state are drawn in the footer row next to the mode indicator, instead of a band above the prompt. Claude Code's own mode label and hints stay as they are.
- Account-wide usage: the 5-hour and 7-day figures are read from Anthropic's usage endpoint at session start and every 5 minutes, so usage from other sessions and devices is included. Ribbon only sees what the current session's responses report.
- Gentle polling: all open sessions share one reading through the plugin store, so several tabs together still ask about once every 5 minutes.
- Works right after `--resume` or a plugin reload, without waiting for the first reply.
- The next-message price is shown while the cache is warm too, not only when it is cold.
- Width-aware footer with three layouts. It never breaks the footer onto a second line: Claude Code does not let plugins measure the left side of the row, so the plugin works out its longest possible width from what it can know (mode label, PR link, "esc to interrupt" while working, the selection hint in VS Code terminals, the prompt hint) and picks the longest form whose exact text fits, or hides until there is room.
- Calm colours in the footer: no background, and the usage colours grow from gray as a window fills up.

## Good to know

- Prices are estimates at API list prices from the table in `hooks/cache-art.ts` (`MODELS`). A subscription is billed differently, so read them as a relative measure.
- The live usage read uses Claude Code's own sign-in through `$.session.authorize()`. The plugin never reads or stores your token. With an API key, or in the desktop app (which does not lend its sign-in to plugins), it falls back to the figures the session itself reports.
- The usage endpoint and the footer slot are not part of a documented public API, so a Claude Code update may change them. If the live read fails, the footer keeps working with the session's own figures.
- Plugins cannot see how wide the left side of the footer is, so the footer keeps room for the longest hint that can appear there (in VS Code terminals that means it stays shorter than strictly needed). A request for Claude Code to tell plugins the free width, or to fit their text itself, is open as [anthropics/claude-code#105631](https://github.com/anthropics/claude-code/issues/105631). If it lands, the reserve goes away.
- Subagents do not reset the cache clock; only the main conversation does.

## Develop

```
claude --plugin-dir ./claude-code-usage-footer   # load without installing
claude plugin test ./claude-code-usage-footer    # run the tests
```

```
.claude-plugin/   plugin.json and marketplace.json
hooks/            register.tsx (footer, band, usage and cache tracking), cache-art.ts (drawings, price table), font.ts
types/            the shape of what the plugin remembers
tests/            layouts, warm and cold, footer widths, live usage and shared polling
```

## License

[MIT](LICENSE), as the original ribbon. The embedded font is [Outfit](https://github.com/Outfitio/Outfit-Fonts) under the SIL Open Font License 1.1.
