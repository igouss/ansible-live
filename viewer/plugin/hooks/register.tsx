import type { EngineInterface, Register } from 'claude-code'
import { directory } from '../core/logs.ts'
import { view } from '../core/view.ts'
import { pane, type Moves } from '../shell/pane.tsx'
import type { Child } from '../shell/ports.ts'
import { Watch } from '../shell/watch.ts'

/** The slash command, and the id of the pane it opens. */
const COMMAND: string = 'ansible-live'
const PANE: string = COMMAND

export const register: Register = (on, options) => {
  const configured: string = String(options.dir ?? '')
  const python: string = String(options.python ?? 'python3')
  /** Set while the pane is open: no follower runs while it is closed. */
  let watch: Watch | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'Watch the running ansible-playbook in a pane' })
    if (watch === null && (await $.ui.panes()).some((open: { readonly id: string }) => open.id === PANE)) {
      watch = await watching($, configured, python)
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: COMMAND })
    watch ??= await watching($, configured, python)
    return { text: opened.isPlaced ? 'The pane is open.' : `The pane waits: ${opened.reason}.` }
  })

  /** Stops following; the pane's own close button calls it too, since the plugin's own close raises no hook of its. */
  function unwatch(): void {
    watch?.stop()
    watch = null
  }

  on('ui.close', { id: PANE }, async (_$, e, next) => {
    unwatch()
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const drawing = $.ui.resolve(e)
    const shown: Watch | null = watch
    if (shown === null) {
      const { Text } = drawing
      return <Text dimColor>Starting…</Text>
    }
    const moves: Moves = {
      older: () => void shown.move(-1),
      newer: () => void shown.move(1),
      live: () => shown.follow(),
      close: () => {
        unwatch()
        void $.ui.close({ id: PANE })
      },
    }
    return pane(drawing, view(shown.shown(e.props.bodyColumns)), moves)
  })
}

/** A watch over the configured directory, its followers run by the host's Python from the plugin's folder. */
async function watching($: EngineInterface, configured: string, python: string): Promise<Watch> {
  const home: string = (await $.env.get('HOME')) ?? ''
  const logs: string = directory(configured, await $.env.get('XDG_STATE_HOME'), home)
  const watch: Watch = new Watch({
    spawn: (argv: readonly string[]): Child => {
      const stream = $.process.spawn({ argv, cwd: $.plugin.root })
      return { pieces: stream, ended: () => stream.result, stop: () => void stream.return({ code: null, signal: null }) }
    },
    list: async (path: string): Promise<readonly string[]> => (await $.fs.list(path)).map(entry => entry.name),
    redraw: (): void => $.ui.invalidate('ui.render'),
  }, [python, '-m', 'follower'], logs)
  watch.start()
  return watch
}
