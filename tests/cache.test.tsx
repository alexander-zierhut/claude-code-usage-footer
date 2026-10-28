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

test('a narrow footer drops the words, then the reset times, but keeps the price', async ($, on) => {
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
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })
  const at = (columns: number) => $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'SessionMode', props: { modes: [] }, viewport: { columns, rows: 40 } })

  let foot = await at(120)
  expect(await foot.find({ text: '82%' })).toBeDefined()
  expect(await foot.find({ text: ' · 3h 29m' })).toBeDefined()
  expect(await foot.find({ text: '$0.15' })).toBeDefined()
  await foot.unmount()

  foot = await at(100)
  expect(await foot.find({ text: '82%' })).toBeDefined()
  expect(await foot.find({ text: ' · 3h 29m' })).toBeUndefined()
  expect(await foot.find({ text: '$0.15' })).toBeDefined()
  await foot.unmount()
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

test('the footer never wraps: it steps aside while text is selected, for a long hint, or when nothing fits', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  let selection = ''
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('ui.selection', () => ({ value: selection }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const at = (columns: number) => $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'SessionMode', props: { modes: [] }, viewport: { columns, rows: 40 } })

  let foot = await at(200)
  expect(await foot.find({ text: '82% left' })).toBeDefined()
  await foot.unmount()

  // Selecting text: the row steps aside for a few seconds, then comes back even though
  // the engine keeps answering with the last selection.
  selection = 'some copied text'
  await clock.advance(600)
  foot = await at(200)
  expect(await foot.find({ text: '82% left' })).toBeUndefined()
  expect(await foot.find({ text: 'engine' })).toBeDefined()
  await foot.unmount()
  await clock.advance(5000)
  foot = await at(200)
  expect(await foot.find({ text: '82% left' })).toBeDefined()
  await foot.unmount()
  // A new selection hides it again.
  selection = 'other text'
  await clock.advance(600)
  foot = await at(200)
  expect(await foot.find({ text: '82% left' })).toBeUndefined()
  await foot.unmount()
  await clock.advance(5000)

  // Far too narrow even for the short form: only the engine's own label.
  foot = await at(70)
  expect(await foot.find({ text: '82%' })).toBeUndefined()
  expect(await foot.find({ text: 'engine' })).toBeDefined()
  await foot.unmount()

  // A long hint on the left takes its real width: the wide form gives way to a shorter one.
  const hint = await $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'PromptHint', props: { hint: 'x'.repeat(100) } })
  await hint.unmount()
  foot = await at(200)
  expect(await foot.find({ text: '82% left' })).toBeUndefined()
  expect(await foot.find({ text: '82%' })).toBeDefined()
  await foot.unmount()
})
