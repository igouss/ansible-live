import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock, Mounted } from 'claude-code/testing'

const PANE = { title: 'ansible-live', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
/** `/ansible-live` as typed at the prompt. */
const OPEN = { command: 'ansible-live', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
const A = '20260928T142821Z-4242'
const B = '20260928T143000Z-4343'

/** One run's log as the recorder writes it: its start, a play of web1 and web2, and what `then` adds. */
function log(run: string, ...then: readonly object[]): string {
  const events: readonly object[] = [
    { type: 'run.start', pid: 4242, controller: 'fedora', ansible: '2.21.1', check: false, limit: null, extra_vars: [] },
    { type: 'playbook.start', playbook: '/srv/site.yml' },
    { type: 'play.start', play: 'p-1', name: 'Web servers', hosts: ['web1', 'web2'] },
    { type: 'task.start', task: 't-1', name: 'Write the config', play: 'p-1', handler: false },
    { type: 'host.start', task: 't-1', host: 'web1' },
    ...then,
  ]
  return events.map((event: object, seq: number) => JSON.stringify({ v: 1, run, seq, at: '2026-09-28T14:28:21.000Z', ...event }) + '\n').join('')
}

const FAILED: readonly object[] = [
  { type: 'host.result', task: 't-1', host: 'web1', outcome: 'failed', changed: false, message: 'boom' },
  { type: 'playbook.end', outcome: 'failed', hosts: { web1: { ok: 0, changed: 0, failed: 1, unreachable: 0, skipped: 0, rescued: 0, ignored: 0 } } },
  { type: 'run.end', outcome: 'failed' },
]

/** Answers beneath the plugin: a follower that writes `live` then each log it is asked for, and keeps going; and a
directory holding `logs`. */
type Host = { readonly spawned: readonly (readonly string[])[]; readonly clock: MockClock }

function host(on: On, live: string, logs: Readonly<Record<string, string>> = {}, panes: readonly string[] = []): Host {
  const spawned: (readonly string[])[] = []
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/op' })
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('fs.list', async () => ({ value: Object.keys(logs).map((run: string) => ({ name: `${run}.jsonl`, kind: 'file', size: 1, isLink: false })) }))
  on('ui.close', async () => ({ value: undefined }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.panes', async () => ({ value: panes.map((id: string) => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('process.spawn', async function* (_$, e) {
    spawned.push(e.argv)
    const text: string = live + e.argv.slice(4).map((run: string) => logs[run] ?? '').join('')
    if (text !== '') {
      yield { stream: 'stdout', text }
    }
    await clock.sleep(Number.MAX_SAFE_INTEGER)
    return { value: { code: 0, signal: null } }
  })
  return { spawned, clock }
}

/** The pane as `/ansible-live` opens it, drawn on `surface`. */
async function opened($: Engine, clock: MockClock, surface: 'terminal' | 'desktop'): Promise<Mounted<'terminal' | 'desktop', 'Pane'>> {
  await $.command.run(OPEN)
  await clock.settle()
  return $.ui.mount({ plugin: 'ansible-live', surface, component: 'Pane', props: PANE, requestId: 'ansible-live' })
}

/** What the pane's rows keyed `keys` say. */
async function texts(ui: Mounted<'terminal' | 'desktop', 'Pane'>, ...keys: readonly string[]): Promise<readonly (string | undefined)[]> {
  return Promise.all(keys.map(async (key: string) => (await ui.find({ key }))?.text))
}

const DIRECTORY: string = '/home/op/.local/state/ansible-live'

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: no run yet says where logs are read from and how to record one`, async ($, on) => {
    const { clock } = host(on, '')
    expect(await texts(await opened($, clock, surface), 'head', 'notes.0')).toEqual(['No runs yet', `Logs are read from ${DIRECTORY}.`])
  })

  test(`${surface}: one running run shows its task in progress and web1 running`, async ($, on) => {
    const { clock } = host(on, log(A))
    expect(await texts(await opened($, clock, surface), 'head', 'where', 'now', 'grid.0', 'grid.1')).toEqual([
      `● running ${A} · fedora`, 'site.yml › Web servers', '▸ Write the config', 'web1 ●', 'web2 ·',
    ])
  })

  test(`${surface}: one run ended failed shows the failure and its message`, async ($, on) => {
    const { clock } = host(on, log(A, ...FAILED))
    expect(await texts(await opened($, clock, surface), 'head', 'now', 'failure.0', 'failure.1', 'totals')).toEqual([
      `✗ failed ${A} · fedora`, undefined, '✗ web1 · Write the config', '  boom', '1 failed',
    ])
  })

  test(`${surface}: of two concurrent runs the newer shows, and older picks the other`, async ($, on) => {
    const { clock } = host(on, log(A) + log(B), { [A]: log(A), [B]: log(B) })
    const ui = await opened($, clock, surface)
    const first: readonly (string | undefined)[] = await texts(ui, 'head')
    await ui.press({ key: 'older' })
    expect([first, await texts(ui, 'head', 'place')]).toEqual([[`● running ${B} · fedora`], [`● running ${A} · fedora`, 'run 1 of 2']])
  })

  test(`${surface}: an earlier ended run starts the follower again, asked for it, and live goes back`, async ($, on) => {
    const { spawned, clock } = host(on, log(B), { [A]: log(A, ...FAILED), [B]: log(B) })
    const ui = await opened($, clock, surface)
    await ui.press({ key: 'older' })
    await clock.settle()
    const picked: readonly (string | undefined)[] = await texts(ui, 'head')
    await ui.press({ key: 'live' })
    expect([spawned.map((argv: readonly string[]) => argv.slice(3)), picked, await texts(ui, 'head')]).toEqual([
      [[DIRECTORY], [DIRECTORY, A]], [`✗ failed ${A} · fedora`], [`● running ${B} · fedora`],
    ])
  })

  test(`${surface}: no follower runs before the pane opens, and one closed is started afresh on opening again`, async ($, on) => {
    const { spawned, clock } = host(on, log(A))
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const before: number = spawned.length
    await $.command.run(OPEN)
    await clock.settle()
    const open: number = spawned.length
    const ui = await opened($, clock, surface)
    const again: number = spawned.length
    await ui.press({ key: 'close' })
    await $.command.run(OPEN)
    await clock.settle()
    expect([before, open, again, spawned.length]).toEqual([0, 1, 1, 2])
  })

  test(`${surface}: a pane left open across a reload is followed again`, async ($, on) => {
    const { spawned } = host(on, log(A), {}, ['ansible-live'])
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    expect(spawned.map((argv: readonly string[]) => argv.slice(3))).toEqual([[DIRECTORY]])
  })
}
