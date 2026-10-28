import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheFacts, Fold, Window } from '../types'
import {
  BG, EMPTY, HUE, INK, MUTED, ORANGE, ROBO_SIZE, TEXT, TTL_MIN, TTL_MS, WORD, YELLOW,
  bandPx, cardSvg, chipSvg, costOf, familyOf, fmtIdle, kindOf, mineModel, roboSvg, usd,
} from './cache-art'
import type { CacheView } from './cache-art'

// A band above the prompt in a warm dark look: card surface, cream text,
// dot-matrix bars. Shows how much of each usage window is LEFT, 7-day first, then
// 5-hour; 7D is orange, 5H is yellow; a window under 15% adds a bold LOW.
//
// After the first reply it also shows the prompt cache: WARM (red, Robo bobbing)
// for an hour after the last request, then COLD (blue, Robo frozen) with what the
// next message costs to re-cache. Hide / Show folds the card; warm starts folded,
// cold starts open, and a choice holds until the cache flips. Zero token cost:
// it reads the engine's own figures and draws.

const CELLS = 10
const LOW_AT = 15
const TIGHT_CELLS = 6
/** How often the band redraws, so the countdown and the warm-to-cold flip stay current. */
const TICK_MS = 30_000
/** How often the account's usage is read from Anthropic, so other tabs and devices show up. */
const LIVE_MS = 5 * 60_000
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
// The footer row's left side, built by Claude Code where plugins cannot measure it. Its
// width is worked out from what can be known, sized for the longest it gets in this state:
//   ⏵⏵ auto mode on (shift+tab to cycle) · PR #247 · esc to interrupt · shift+click to native select
/** The mode label and its cycle hint. */
const MODE_COLS = 37
/** " · PR #1234": shown on a branch with a pull request; always kept free. */
const PR_COLS = 12
/** " · esc to interrupt", while a turn runs. */
const WORKING_COLS = 19
/** " · shift+click to native select", shown while text is selected in VS Code and xterm.js terminals. */
const NATIVE_SELECT_COLS = 31
/** " · ctrl+c to copy", shown while text is selected when copy-on-select is off. */
const COPY_COLS = 17
/** The gap between the two halves of the row. */
const GAP_COLS = 2

// Engine-side facts the footer adapts to. Module state: they are per process and need no store.
let hintCols = 0
let working = false
let selectCols = 0

/** Visible length of every string in the hint's props: an upper bound on what the left side shows. */
const textCols = (v: unknown): number =>
  typeof v === 'string' ? [...v].length
    : Array.isArray(v) ? v.reduce((n: number, x) => n + textCols(x), 0)
    : v && typeof v === 'object' ? Object.values(v).reduce((n: number, x) => n + textCols(x), 0)
    : 0

/** Columns left for the footer: the viewport minus the longest the left side gets right now. */
export const roomFor = (columns: number, left: { hint: number; working: boolean; select: number }): number =>
  columns - (MODE_COLS + PR_COLS + (left.working ? WORKING_COLS : 0) + left.select + (left.hint > 0 ? left.hint + 3 : 0) + GAP_COLS)

/** Room the selection hint can take in this terminal, so selecting text never pushes the row down. */
const selectionHintCols = async ($: EngineInterface): Promise<number> => {
  let cols = 0
  try {
    const term = (await $.env.get('TERM_PROGRAM')) ?? ''
    if (term === 'vscode' || (await $.env.get('VSCODE_INJECTION')) || (await $.env.get('VSCODE_PID'))) cols += NATIVE_SELECT_COLS
  } catch {
    cols += NATIVE_SELECT_COLS // unknown terminal: keep the room
  }
  try {
    if ((await $.settings.read({ key: 'copyOnSelect' })) === false) cols += COPY_COLS
  } catch {
    // the default copies on select: no copy hint
  }
  return cols
}

const windows = atom({ plugin: 'usage-footer', key: 'windows' } as const, [] as Window[])
const cache = atom({ plugin: 'usage-footer', key: 'cache' } as const, null as CacheFacts | null)
const fold = atom({ plugin: 'usage-footer', key: 'fold' } as const, null as Fold | null)

const NAMES: Record<string, string> = { seven_day: '7D', five_hour: '5H', spend_limit: 'SPEND' }
const ORDER: Record<string, number> = { seven_day: 0, five_hour: 1 }
const COLORS: Record<string, string> = { seven_day: ORANGE, five_hour: YELLOW }

/** The footer's neutral: colours fade toward it while there is plenty of room. */
const GRAY = '#808080'

/** `hex` mixed with GRAY: 0 is plain gray, 1 the full colour. */
export const tone = (hex: string, strength: number): string => {
  const k = Math.max(0, Math.min(1, strength))
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2].map(i => Math.round(ch(GRAY, i) + (ch(hex, i) - ch(GRAY, i)) * k).toString(16).padStart(2, '0')).join('')
}

/** How strongly a window shows: mostly gray under half used, full colour from 95% used. */
export const strengthOf = (percentUsed: number): number => 0.2 + 0.8 * Math.max(0, Math.min(1, (percentUsed - 50) / 45))

const clean = (list: readonly Window[]): Window[] =>
  list
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

const dots = (left: number, cells: number): { on: string; off: string } => {
  const n = Math.max(0, Math.min(cells, Math.round((left / 100) * cells)))
  return { on: '●'.repeat(n), off: '·'.repeat(cells - n) }
}

const fmtReset = (iso: string | undefined, now: number): string => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms)) return ''
  if (ms <= 0) return 'resetting'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** What the cache drawings read, or null until a request and its context size are known. */
export const viewOf = (c: CacheFacts | null, now: number): CacheView | null => {
  if (!c || c.lastAt <= 0 || c.tokens <= 0) return null
  const idleMs = Math.max(0, now - c.lastAt)
  return {
    mode: idleMs >= TTL_MS ? 'cold' : 'warm',
    idle: fmtIdle(idleMs),
    idleMin: Math.floor(idleMs / 60000),
    tokens: c.tokens,
    window: c.window,
    mine: familyOf(c.model),
  }
}

/**
 * Reads the account-wide 5-hour and 7-day usage; false when there is no credential or no
 * answer. The plugin store is shared by every session, so a reading under LIVE_MS old
 * (from this tab or another) is reused: all open tabs together ask about once per LIVE_MS.
 */
const live = async ($: EngineInterface): Promise<boolean> => {
  try {
    const now = await $.clock.now()
    const last = (await $.store.get('live')) as { at: number; list: Window[] } | undefined
    if (last && now - last.at < LIVE_MS - 30_000) {
      if (last.list.length > 0) {
        await update($, windows, () => clean(last.list))
        await $.ui.invalidate('ui.render')
      }
      return last.list.length > 0
    }
    // Claim this round before asking, so a tab starting meanwhile waits for it.
    await $.store.set('live', { at: now, list: last?.list ?? [] })
    const auth = await $.session.authorize()
    if (!auth) return false
    const res = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
    if (!res.ok) return false
    const body = JSON.parse(res.text) as Record<string, { utilization?: number; resets_at?: string | null } | null>
    const list: Window[] = []
    for (const kind of ['seven_day', 'five_hour']) {
      const w = body[kind]
      if (w && typeof w.utilization === 'number') list.push({ kind, percentUsed: w.utilization, ...(w.resets_at ? { resetsAt: w.resets_at } : {}) })
    }
    if (list.length === 0) return false
    await $.store.set('live', { at: now, list })
    await update($, windows, () => clean(list))
    await $.ui.invalidate('ui.render')
    return true
  } catch {
    return false // offline, signed in with an API key, or network use turned off
  }
}

const pull = async ($: EngineInterface): Promise<void> => {
  const u = await $.session.usage()
  await update($, windows, () => clean(u.rateLimits))
}

/** Fresh context figures from the engine onto the cache facts, when it has them. */
const measure = async ($: EngineInterface, lastAt: number | null, model: string | null): Promise<void> => {
  const u = await $.session.usage()
  const m = model ?? (await $.session.model())
  await update($, cache, c => ({
    lastAt: lastAt ?? c?.lastAt ?? 0,
    tokens: u.context.tokens && u.context.tokens > 0 ? u.context.tokens : (c?.tokens ?? 0),
    window: u.context.window || c?.window || 0,
    model: m || c?.model || null,
  }))
}

/** One run of footer text and how it is drawn. */
type Part = { text: string; color?: string; dim?: boolean; bold?: boolean }

/** Exact columns the parts take. */
export const partsWidth = (parts: readonly Part[]): number => parts.reduce((n, p) => n + [...p.text].length, 0)

/**
 * The footer's text at a level of detail: 0 "7D 44% left · 3d 10h", 1 "7D 44% · 3d 10h",
 * 2 "7D 44%". The cache keeps its price at every level. Built once for measuring and drawing.
 */
export const rowParts = (list: readonly Window[], view: CacheView | null, now: number, level: 0 | 1 | 2): Part[] => {
  const full = level === 0
  const mid = level === 1
  const gap = full ? '   ' : '  '
  const parts: Part[] = [{ text: ' ' }]
  list.forEach((w, i) => {
    const left = Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
    const color = tone(COLORS[w.kind] ?? TEXT, strengthOf(w.percentUsed))
    const reset = full || mid ? fmtReset(w.resetsAt, now) : ''
    if (i > 0) parts.push({ text: gap })
    parts.push({ text: `${NAMES[w.kind] ?? w.kind.toUpperCase()} `, dim: true })
    parts.push({ text: full ? `${left}% left` : `${Math.round(left)}%`, color, bold: left < LOW_AT })
    if (left < LOW_AT) parts.push({ text: ' LOW', color, bold: true })
    if (reset) parts.push({ text: ` · ${reset}`, dim: true })
  })
  if (view) {
    const cold = view.mode === 'cold'
    const mine = mineModel(view)
    const price = mine ? costOf(mine, view.mode, view.tokens) : 0
    const mins = `${Math.max(0, TTL_MIN - view.idleMin)}m`
    // Warm is the calm case and stays muted; cold is worth noticing before you send.
    const hue = tone(HUE[view.mode], cold ? 0.85 : 0.35)
    if (list.length > 0) parts.push({ text: gap })
    parts.push({ text: WORD[view.mode], color: hue, bold: cold })
    if (full || mid) parts.push({ text: cold ? ` ${view.idle}${full ? ' idle' : ''}` : ` ${mins}${full ? ' left' : ''}`, color: hue })
    if (mine) {
      parts.push({ text: full || mid ? ' · ' : ' ', dim: true })
      parts.push(cold ? { text: usd(price), color: TEXT, bold: true } : { text: usd(price), dim: true })
      if (full) parts.push({ text: ' next', dim: true })
    }
  }
  return parts
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await pull($)
    $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    void live($)
    $.clock.every(LIVE_MS, () => live($))
    selectCols = await selectionHintCols($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, windows, () => clean(e.rateLimits))
    }
    if (e.changed.includes('context') && e.context.tokens && e.context.tokens > 0) {
      const tokens = e.context.tokens
      await update($, cache, c => (c ? { ...c, tokens, window: e.context.window || c.window } : c))
    }
    return next(e)
  })

  // A resumed or forked session knows how long it was away and how big it is.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'clear' || e.source === 'compact') {
      await update($, cache, () => null)
      await update($, fold, () => null)
    } else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      const now = await $.clock.now()
      const lastAt = now - e.seconds_since_last_response * 1000
      const window = (await $.session.usage()).context.window
      const model = typeof e.model === 'string' ? e.model : await $.session.model()
      const tokens = typeof e.context_tokens === 'number' ? e.context_tokens : 0
      await update($, cache, () => ({ lastAt, tokens, window, model }))
    }
    return r
  }).catch(($, e, next) => next(e)) // a band that fails to seed never holds up the session

  // Each main-thread request reads or writes the cache, so its start resets the hour.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, cache, c => ({ lastAt: now, tokens: c?.tokens ?? 0, window: c?.window ?? 0, model: c?.model ?? null }))
    }
    yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const now = await $.clock.now()
    const c = await read($, cache)
    // turn.step stamps the exact request time; when no step of this turn did, the turn's end is the floor.
    const lastAt = !c || now - c.lastAt > e.durationMs ? now : c.lastAt
    await measure($, lastAt, e.usage?.model ?? null)
    await pull($)
    return r
  })

  // Terminal footer: the engine's own mode label stays on the left, ribbon's text
  // form sits flush right on the same row: 7D, 5H, then the cache state.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const list = await read($, windows)
    const now = await $.clock.now()
    const view = viewOf(await read($, cache), now)
    if (list.length === 0 && !view) return next(e)
    const engine = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    // Never wrap the footer: take the longest of the three forms whose exact text fits, and
    // step aside when even the short one does not.
    const room = roomFor(e.viewport?.columns ?? 200, { hint: hintCols, working, select: selectCols })
    const level = ([0, 1, 2] as const).find(l => partsWidth(rowParts(list, view, now, l)) <= room)
    if (level === undefined) return engine
    return (
      <Box flexDirection="row" flexShrink={0}>
        {engine}
        <Box key="ribbon" flexDirection="row" flexShrink={0}>
          {rowParts(list, view, now, level).map((p, i) => (
            <Text key={`p-${i}`} color={p.color} dimColor={p.dim} bold={p.bold}>{p.text}</Text>
          ))}
        </Box>
      </Box>
    )
  })

  // The hint on the footer's left grows (a copy hint, "esc to interrupt", ...): note its length, draw nothing.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface === 'terminal') {
      // Only the hint itself when it is named: other props can carry the draft you are typing.
      const props = e.props as Record<string, unknown>
      const cols = 'hint' in props ? textCols(props.hint) : textCols(props)
      if (cols !== hintCols) {
        hintCols = cols
        await $.ui.invalidate('ui.render')
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // "esc to interrupt" joins the footer's left side while a turn runs: follow it at once.
    if (e.surface === 'terminal' && !!e.props.isWorking !== working) {
      working = !!e.props.isWorking
      await $.ui.invalidate('ui.render')
    }
    if (e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // Svg draws on desktop, mobile and VS Code; the terminal gets the text form.
    // Ask the surface, not the table: the terminal's table still lists Svg.
    if (e.surface === 'terminal') return next(e)
    const Svg = 'Svg' in ui ? ui.Svg : null
    const list = await read($, windows)
    const now = await $.clock.now()
    const view = viewOf(await read($, cache), now)

    if (list.length === 0 && !view) {
      return (
        <Box backgroundColor={BG} paddingX={1}>
          <Text color={MUTED}>USAGE · waiting for the first reply</Text>
        </Box>
      )
    }

    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 100
    const kind = kindOf(columns)
    const isWide = kind === 'wide'
    const cells = kind === 'tight' ? TIGHT_CELLS : CELLS

    const parts = (w: Window) => {
      const left = Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
      return {
        left,
        col: COLORS[w.kind] ?? TEXT,
        name: NAMES[w.kind] ?? w.kind.toUpperCase(),
        d: dots(left, cells),
        reset: fmtReset(w.resetsAt, now),
      }
    }

    // Wide: every window on one row. Narrow: each window is a block of three
    // lines (name and dots, percent left, reset time) so nothing wraps or clips.
    const wide = (w: Window, i: number) => {
      const p = parts(w)
      return (
        <Box key={`w-${i}`} flexDirection="row" flexShrink={0} marginRight={3}>
          <Text color={MUTED} bold>{p.name} </Text>
          <Text color={p.col}>{p.d.on}</Text>
          <Text color={EMPTY}>{p.d.off}</Text>
          <Text color={p.col} bold> {p.left}% left</Text>
          {p.left < LOW_AT ? <Text color={TEXT} bold> LOW</Text> : null}
          {p.reset ? <Text color={MUTED}> · {p.reset}</Text> : null}
        </Box>
      )
    }

    const stacked = (w: Window, i: number) => {
      const p = parts(w)
      return (
        <Box key={`w-${i}`} flexDirection="column" flexShrink={0} marginRight={3}>
          <Box flexDirection="row">
            <Text color={MUTED} bold>{p.name} </Text>
            <Text color={p.col}>{p.d.on}</Text>
            <Text color={EMPTY}>{p.d.off}</Text>
          </Box>
          <Box flexDirection="row">
            <Text color={p.col} bold>{p.left}% left</Text>
            {p.left < LOW_AT ? <Text color={TEXT} bold> LOW</Text> : null}
          </Box>
          {p.reset ? <Text color={MUTED}>resets {p.reset}</Text> : null}
        </Box>
      )
    }

    const label = (
      <Box key="label" flexShrink={0} marginRight={isWide ? 2 : 3}>
        <Text color={TEXT} bold>USAGE</Text>
      </Box>
    )
    const usage = list.length > 0
      ? list.map(isWide ? wide : stacked)
      : [<Box key="wait" flexShrink={0} marginRight={3}><Text color={MUTED}>waiting for the first reply</Text></Box>]

    // Before the first reply there is no cache to show: today's band, as it was.
    if (!view) {
      return (
        <Box flexDirection="row" backgroundColor={BG} paddingX={1}>
          {label}
          {usage}
        </Box>
      )
    }

    const mode = view.mode
    const cold = mode === 'cold'
    const hue = HUE[mode]
    const mine = mineModel(view)
    const stored = await read($, fold)
    // Folding needs the card, and the card is a drawing: the terminal stays folded.
    const open = Svg !== null && (stored && stored.mode === mode ? stored.open : cold)
    const toggle = () =>
      update($, fold, f => ({ mode, open: !(f && f.mode === mode ? f.open : mode === 'cold') }))

    const badge = Svg
      ? [
          <Svg key="robo" source={roboSvg(mode)} alt={cold ? 'Robo, frozen' : 'Robo, bobbing'} width={ROBO_SIZE} height={ROBO_SIZE} isInteractive />,
          <Text key="gap"> </Text>,
          (() => {
            const c = chipSvg(mode)
            return <Svg key="chip" source={c.source} alt={WORD[mode]} width={c.w} height={c.h} />
          })(),
        ]
      : [<Text key="chip" backgroundColor={hue} color={INK} bold>{` ${WORD[mode]} `}</Text>]

    const summary = cold
      ? [
          <Text key="idle" color={hue} bold>{` ${view.idle}`}</Text>,
          mine ? <Text key="dot" color={MUTED}> · </Text> : null,
          mine ? <Text key="cost" color={TEXT} bold>{usd(costOf(mine, mode, view.tokens))}</Text> : null,
        ]
      : [<Text key="left" color={hue} bold>{` ${Math.max(0, TTL_MIN - view.idleMin)}m left`}</Text>]

    const button = Svg ? (
      <Box key="fold" flexShrink={0} alignItems="flex-start">
        <Button key="cache-fold" label={open ? 'Hide' : 'Show'} onPress={toggle} />
      </Box>
    ) : null
    const grow = <Box key="grow" flexGrow={1} />

    let rows
    if (kind === 'wide') {
      rows = (
        <Box key="row" flexDirection="row" paddingX={1} alignItems="center">
          {label}
          {usage}
          {open ? null : (
            <Box key="inline" flexDirection="row" flexShrink={0} marginRight={2} alignItems="center">
              {badge}
              {summary}
            </Box>
          )}
          {grow}
          {button}
        </Box>
      )
    } else if (kind === 'stacked') {
      // The cache becomes a third stacked block, the same shape as 7D and 5H.
      rows = (
        <Box key="row" flexDirection="row" paddingX={1}>
          {label}
          {usage}
          {open ? null : (
            <Box key="block" flexDirection="column" flexShrink={0} marginRight={2}>
              <Box flexDirection="row" alignItems="center">{badge}</Box>
              <Text color={hue} bold>{cold ? `${view.idle} idle` : `${Math.max(0, TTL_MIN - view.idleMin)}m left`}</Text>
              {mine ? (
                <Box flexDirection="row">
                  <Text color={TEXT} bold>{usd(costOf(mine, mode, view.tokens))}</Text>
                  <Text color={MUTED}> next</Text>
                </Box>
              ) : null}
            </Box>
          )}
          {grow}
          {button}
        </Box>
      )
    } else {
      // Narrow: the cache gets its own row under the usage blocks.
      rows = [
        <Box key="row" flexDirection="row" paddingX={1}>
          {label}
          {usage}
        </Box>,
        <Box key="cache" flexDirection="row" paddingX={1} alignItems="center">
          {badge}
          {summary}
          {grow}
          {button}
        </Box>,
      ]
    }

    let card = null
    if (open && Svg) {
      const c = cardSvg(view, kind, bandPx(columns))
      card = (
        <Box key="card" flexDirection="row">
          <Svg source={c.source} alt={c.alt} width={c.w} height={c.h} isInteractive={kind !== 'tight'} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" backgroundColor={BG}>
        {rows}
        {card}
      </Box>
    )
  })
}
