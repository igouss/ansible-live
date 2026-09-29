import { beside, live, runs } from '../core/choice.ts'
import { decode } from '../core/decode.ts'
import { split, type Split } from '../core/lines.ts'
import { logged } from '../core/logs.ts'
import { EMPTY, followAll, type Stream } from '../core/stream.ts'
import type { Shown } from '../core/view.ts'
import type { Child, Exit, Ports } from './ports.ts'

/** How much of what the follower said on standard error its trouble keeps. */
const SAID: number = 400

/**
 * The pane's shell while it is open: the one follower it runs, the stream that follower gives, and the run the
 * operator picked. Picking a run the follower does not follow starts it again, asked for that run too, on a fresh
 * stream (FR-13). Closing the pane stops it.
 */
export class Watch {
  private stream: Stream = EMPTY
  private picked: string | null = null
  private logs: readonly string[] = []
  private trouble: string | null = null
  private asked: readonly string[] = []
  /** The follower whose output the stream is: none once stopped. */
  private child: Child | null = null
  private readonly ports: Ports
  /** The follower's command, `[python, -m, follower]`, to which the directory and the runs asked for are added. */
  private readonly follower: readonly string[]
  private readonly directory: string

  constructor(ports: Ports, follower: readonly string[], directory: string) {
    this.ports = ports
    this.follower = follower
    this.directory = directory
  }

  start(): void {
    this.spawn()
    void this.list()
  }

  stop(): void {
    this.child?.stop()
    this.child = null
  }

  shown(columns: number): Shown {
    const [all, id]: readonly [readonly string[], string | null] = this.current()
    return { stream: this.stream, id, runs: all, picked: this.picked !== null, directory: this.directory, columns, trouble: this.trouble }
  }

  /** Shows the run older (-1) or newer (1) than the one shown. */
  async move(by: -1 | 1): Promise<void> {
    await this.list()
    const [all, id]: readonly [readonly string[], string | null] = this.current()
    if (id !== null) {
      this.pick(beside(all, id, by))
    }
  }

  /** Back to the run in progress, else the newest. */
  follow(): void {
    this.picked = null
    this.ports.redraw()
  }

  /** Every run to pick from, and the one shown. */
  private current(): readonly [readonly string[], string | null] {
    const all: readonly string[] = runs(this.stream, this.logs)
    return [all, this.picked ?? live(this.stream, all)]
  }

  /** Shows run `id`; a watch already stopped (the pane closed while the runs were listed) starts nothing. */
  private pick(id: string): void {
    if (this.child === null) {
      return
    }
    this.picked = id
    if (!this.stream.runs.has(id) && !this.asked.includes(id)) {
      this.asked = [...this.asked, id]
      this.child.stop()
      this.stream = EMPTY
      this.spawn()
    }
    this.ports.redraw()
  }

  private async list(): Promise<void> {
    this.logs = await this.ports.list(this.directory).then(logged, (): readonly string[] => [])
  }

  private spawn(): void {
    const argv: readonly string[] = [...this.follower, this.directory, ...this.asked]
    const child: Child = this.ports.spawn(argv)
    this.child = child
    void this.pour(child).catch((error: unknown) => this.fail(child, `The follower did not start (${argv.join(' ')}): ${String(error)}`))
  }

  private async pour(child: Child): Promise<void> {
    let held: string = ''
    let complaint: string = ''
    for await (const piece of child.pieces) {
      if (piece.stream === 'stderr') {
        complaint = (complaint + piece.text).slice(-SAID)
        continue
      }
      const said: Split = split(held, piece.text)
      held = said.held
      if (said.lines.length > 0 && child === this.child) {
        this.stream = followAll(this.stream, said.lines.map(decode))
        this.ports.redraw()
      }
    }
    const ended: Exit = await child.ended()
    this.fail(child, `The follower stopped (exit ${ended.code ?? ended.signal}): ${complaint.trim()}`)
  }

  /** A follower ending is trouble unless the watch let it go: stopped, or started again. */
  private fail(child: Child, trouble: string): void {
    if (child === this.child) {
      this.trouble = trouble
      this.ports.redraw()
    }
  }
}
