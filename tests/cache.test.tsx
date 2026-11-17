import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 18, resetsAt: '2099-01-01T01:29:00Z' },
  { kind: 'seven_day', percentUsed: 1 },
]
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const
const WARM_IDLE = 18 * 60 // 18 minutes: warm, cold in 42m
const COLD_IDLE = (3 * 24 + 9) * 3600 // 3d 9h: cold

test('a warm cache shows Robo, the WARM chip and the minutes left, folded', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'usage-footer', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // Drawings keep no key in the kit, so they are found by what they say.
  const alts = (await band.findAll({ type: 'Svg' })).map(s => s.props.alt)
  expect(alts).toEqual(['Robo, bobbing', 'WARM'])
  expect(await band.find({ text: ' 42m left' })).toBeDefined()
  expect(await band.find({ key: 'card' })).toBeUndefined()
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('Show')

  await band.press({ key: 'cache-fold' })
  expect(await band.find({ key: 'card' })).toBeDefined()
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('Hide')
  await band.unmount()
})

test('a cold cache opens the card with the re-cache price, and Hide folds it to one row', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'usage-footer', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const card = await band.find({ key: 'card' })
  expect(card).toBeDefined()
  expect(JSON.stringify(card)).toContain('Cache cold. Idle 3d 9h. Next message re-caches 770k tokens.')
  // The page's width: 80 columns is a 1020 px band.
  expect(JSON.stringify(card)).toContain('width=\\"1020\\"')

  await band.press({ key: 'cache-fold' })
  expect(await band.find({ key: 'card' })).toBeUndefined()
  expect(await band.find({ text: ' 3d 9h' })).toBeDefined()
  // Opus 5.5: 770k tokens at the 1-hour write price, 2 x $4 per million.
  expect(await band.find({ text: '$6.16' })).toBeDefined()
  await band.unmount()
})

test('squeezed, the folded cache stacks as a third block, then takes its own row', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const half = await $.ui.mount({ plugin: 'usage-footer', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 53 } })
  expect(await half.find({ key: 'block' })).toBeDefined()
  expect(await half.find({ text: '42m left' })).toBeDefined()
  expect(await half.find({ text: '$0.15' })).toBeDefined()
  await half.unmount()

  const narrow = await $.ui.mount({ plugin: 'usage-footer', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 33 } })
  expect(await narrow.find({ key: 'cache' })).toBeDefined()
  await narrow.press({ key: 'cache-fold' })
  // Narrow's card is the compact one: 38 columns is a 456 px band.
  expect(JSON.stringify(await narrow.find({ key: 'card' }))).toContain('width=\\"456\\"')
  await narrow.unmount()
})

test('the terminal footer keeps the engine mode label and adds usage and cache state flush right, priced always', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  for (const [idle, chip, time, price] of [
    [WARM_IDLE, 'WARM', ' 42m left', '$0.15'],
    [COLD_IDLE, 'COLD', ' 3d 9h idle', '$6.16'],
  ] as const) {
    await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: idle, context_tokens: 770000, model: 'claude-opus-5-5' })
    const foot = await $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'SessionMode', props: { modes: ['auto'] } })
    expect(await foot.find({ text: 'engine' })).toBeDefined()
    expect(await foot.find({ text: '99% left' })).toBeDefined()
    expect(await foot.find({ text: '82% left' })).toBeDefined()
    expect(await foot.find({ text: chip })).toBeDefined()
    expect(await foot.find({ text: time })).toBeDefined()
    expect(await foot.find({ text: price })).toBeDefined()
    expect(await foot.find({ text: ' next' })).toBeDefined()
    expect(await foot.findAll({ type: 'Svg' })).toEqual([])
    await foot.unmount()
  }

  // The band above the prompt stays the engine's in the terminal.
  const band = await $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: 'engine' })).toBeDefined()
  expect(await band.find({ text: 'USAGE' })).toBeUndefined()
  await band.unmount()
})

test('a cleared session drops the cache until the next reply', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })
  await $.classic.SessionStart({ source: 'clear' })

  const band = await $.ui.mount({ plugin: 'usage-footer', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.findAll({ type: 'Svg' })).toEqual([])
  expect(await band.find({ text: ' 99% left' })).toBeDefined()
  await band.unmount()
})

test('an idle conversation is compacted once, 5 minutes before the cache goes cold', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  let compactions = 0
  let refuse = false
  let configs: unknown = {}
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  on('settings.read', () => ({ value: { pluginConfigs: configs } }))
  on('session.compact', () => {
    if (refuse) throw new Error('a turn is running')
    compactions += 1
    return { skip: 'counted by the test' }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 50 * 60, context_tokens: 770000, model: 'claude-opus-5-5' })

  // 54m 30s idle: 5m 30s of warm cache left, not yet.
  await clock.advance(4.5 * 60_000)
  expect(compactions).toBe(0)
  // 55m idle: 5 minutes left, but a turn is still running (one long tool call): refused, asked again each tick.
  refuse = true
  await clock.advance(60_000)
  expect(compactions).toBe(0)
  refuse = false
  await clock.advance(30_000)
  expect(compactions).toBe(1)
  // The same idle stretch is not compacted twice, warm or cold.
  await clock.advance(10 * 60_000)
  expect(compactions).toBe(1)

  // Under 20 seconds before the expiry it is too late to start safely: never compact a cache that may be cold.
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 59 * 60 + 45, context_tokens: 770000, model: 'claude-opus-5-5' })
  await clock.advance(60_000)
  expect(compactions).toBe(1)

  // A turn that blocks until the cache is cold: the retries stop there.
  refuse = true
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 54 * 60, context_tokens: 770000, model: 'claude-opus-5-5' })
  await clock.advance(6 * 60_000)
  refuse = false
  await clock.advance(5 * 60_000)
  expect(compactions).toBe(1)

  // The switch in the plugin's settings turns it off.
  configs = { 'usage-footer@claude-code-usage-footer': { options: { auto_compact: false } } }
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 56 * 60, context_tokens: 770000, model: 'claude-opus-5-5' })
  await clock.advance(2 * 60_000)
  expect(compactions).toBe(1)
  configs = {}
  await clock.advance(30_000)
  expect(compactions).toBe(2)
})

test('Claude can ask for a compaction: it runs when the turn ends, then the follow-up prompt is sent', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  const log: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('tool.register', (_: any, e: any) => ({ value: { tool: `mcp__usage-footer__${e.name}` } }))
  on('session.compact', (_: any, e: any) => {
    log.push(`compact:${e.instructions ?? ''}`)
    return { skip: 'counted by the test' }
  })
  on('prompt.submit', (_: any, e: any) => {
    log.push(`submit:${e.text}`)
    return { drop: 'counted by the test' }
  })
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('tool.run', (_: any, e: any) => ({ result: 'BASE ' + JSON.stringify(e) }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(1000)

  // Another tool's call is passed on untouched.
  expect(JSON.stringify(await $.tool.run({ tool: 'mcp__other__compact', input: {} }))).toContain('BASE')
  const ran = await $.tool.run({ tool: 'mcp__usage-footer__compact', input: { instructions: 'keep the chapter list', then: 'Continue with chapter 4.' } })
  expect(JSON.stringify(ran)).toContain('Compaction scheduled')
  // Nothing happens while the turn runs.
  expect(log).toEqual([])
  await $.turn.complete({ answer: 'done', durationMs: 1000 })
  expect(log).toEqual(['compact:keep the chapter list', 'submit:Continue with chapter 4.'])
  // Once only.
  await $.turn.complete({ answer: 'done', durationMs: 1000 })
  expect(log.length).toBe(2)
})


test('the account usage is read live at start and every 5 minutes, so other devices show up', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  let used = 40
  const asked: unknown[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: [] } }))
  on('session.authorize', () => ({ value: { handle: 'h-1', kind: 'bearer' } }))
  on('http.fetch', (_, e) => {
    asked.push(e)
    return { value: { ok: true, status: 200, text: JSON.stringify({
      five_hour: { utilization: 12, resets_at: '2099-01-01T01:29:00Z' },
      seven_day: { utilization: used, resets_at: '2099-01-03T00:00:00Z' },
      seven_day_opus: null,
    }) } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  // A resumed session: no reply yet, the band still fills from the live read.
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(1000)
  const mount = () => $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  let foot = await mount()
  expect(await foot.find({ text: '60% left' })).toBeDefined()
  expect(await foot.find({ text: '88% left' })).toBeDefined()
  await foot.unmount()
  expect(JSON.stringify(asked[0])).toContain('h-1')

  // Another device spends; the next read, 5 minutes on, shows it.
  used = 55
  await clock.advance(5 * 60_000)
  foot = await mount()
  expect(await foot.find({ text: '45% left' })).toBeDefined()
  await foot.unmount()
  expect(asked.length).toBe(2)

  // A second tab starting a minute later reuses that reading instead of asking again.
  await clock.advance(60_000)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(1000)
  expect(asked.length).toBe(2)
})

test('the footer has no background and its colours grow from gray as a window fills', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: [
    { kind: 'five_hour', percentUsed: 10 },
    { kind: 'seven_day', percentUsed: 95 },
  ] } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const foot = await $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  // 5H at 10% used: mostly gray. 7D at 95% used: the full orange, bold, LOW.
  const colorOf = async (text: string) => (await foot.findAll({ type: 'Text' })).find(t => t.text === text)?.props.color
  expect(await colorOf('90% left')).toBe('#97886d')
  expect(await colorOf('5% left')).toBe('#ff6b1a')
  expect(await foot.find({ text: ' LOW' })).toBeDefined()
  expect(JSON.stringify(await foot.findAll({ type: 'Box' }))).not.toContain('backgroundColor')
  await foot.unmount()
})

// The left side, worked out: mode label 37 + PR 12 + gap 2 = 51 columns outside VS Code.
// The cache-warm row at its three levels is 64, 42 and 27 columns wide.
const footerWorld = async ($: any, on: any, env: Record<string, string> = {}) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  on('env.get', (_: any, e: any) => ({ value: env[e.name] }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })
  return (columns: number) => $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'SessionMode', props: { modes: [] }, viewport: { columns, rows: 40 } })
}
const levelAt = async (at: (n: number) => Promise<any>, columns: number): Promise<string> => {
  const foot = await at(columns)
  const level = (await foot.find({ text: '82% left' })) ? 'full'
    : (await foot.find({ text: ' · 3h 29m' })) ? 'mid'
    : (await foot.find({ text: '82%' })) ? 'short' : 'hidden'
  expect(await foot.find({ text: 'engine' })).toBeDefined()
  await foot.unmount()
  return level
}

test('the footer takes the longest form whose exact text fits, and hides rather than wrap', async ($, on) => {
  const at = await footerWorld($, on)
  expect(await levelAt(at, 115)).toBe('full')
  expect(await levelAt(at, 114)).toBe('mid')
  expect(await levelAt(at, 93)).toBe('mid')
  expect(await levelAt(at, 92)).toBe('short')
  expect(await levelAt(at, 78)).toBe('short')
  expect(await levelAt(at, 77)).toBe('hidden')
})

test('the room follows the left side: native-select hint in VS Code, esc to interrupt while working, a long hint', async ($, on) => {
  const at = await footerWorld($, on, { TERM_PROGRAM: 'vscode' })
  // The screenshot: 104 columns, "... · PR #247 · shift+click to native select" on the left.
  expect(await levelAt(at, 104)).toBe('hidden')
  expect(await levelAt(at, 120)).toBe('short')

  // A turn runs: "esc to interrupt" joins the left side, and the row makes room at once.
  const band = await $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, isWorking: true } })
  await band.unmount()
  expect(await levelAt(at, 120)).toBe('hidden')
  const idle = await $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, isWorking: false } })
  await idle.unmount()
  expect(await levelAt(at, 120)).toBe('short')

  // A long hint on the left takes its measured width.
  const hint = await $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'PromptHint', props: { hint: 'x'.repeat(40) } })
  await hint.unmount()
  expect(await levelAt(at, 160)).toBe('short')
})
