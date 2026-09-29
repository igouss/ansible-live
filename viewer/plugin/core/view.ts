import type { HostOutcome, RunOutcome } from "./event.ts"
import { glance, type Glance } from "./glance.ts"
import { list } from "./rows.ts"
import { cells, type Cell, type Counts, type Failure, type Play, type Run, type Status, type Task } from "./run.ts"
import type { Stream } from "./stream.ts"

/** How a span is drawn: an outcome's color, or plain, dim, bold, or a notice. */
export type Tone = "plain" | "dim" | "bold" | "notice" | "running" | "ok" | "changed" | "failed" | "ignored" | "unreachable" | "skipped"
export type Span = { readonly text: string; readonly tone: Tone }
export type Line = readonly Span[]

/** What the pane shows, section by section; each line is drawn on one row, cut at the pane's width. */
export type View = {
  /** The run's state and name, or why there is none. */
  readonly head: Line
  /** The playbook and play it is in. */
  readonly where: Line | null
  /** The task in progress. */
  readonly now: Line | null
  /** One row per host of the play: a cell per task, the newest last, as many as fit. */
  readonly grid: readonly Line[]
  readonly legend: Line | null
  /** The results so far, summed over the hosts, and how many tasks the grid had no room for. */
  readonly totals: Line | null
  /** The latest failure: host and task, then its message. */
  readonly failure: readonly Line[]
  /** FR-15's newer versions, unreadable lines, and how to get a first run. */
  readonly notes: readonly Line[]
  /** Which of the runs this is, and whether the pane follows the live one. */
  readonly place: Line | null
}

/** What the view is drawn from: the stream, the run shown, and where it sits among the runs. */
export type Shown = {
  readonly stream: Stream
  readonly id: string | null
  readonly runs: readonly string[]
  /** Whether the operator picked the run, rather than the pane following the live one. */
  readonly picked: boolean
  readonly directory: string
  readonly columns: number
  /** Why no follower feeds the pane, when none does. */
  readonly trouble: string | null
}

const HOST_COLUMNS: number = 16
const MESSAGE_LINES: number = 8
const TOTALS: readonly (HostOutcome | "changed")[] = ["ok", "changed", "failed", "unreachable", "skipped", "ignored"]
const ENDS: { readonly [O in RunOutcome]: Span } = {
  ok: { text: "✓ ok", tone: "ok" },
  failed: { text: "✗ failed", tone: "failed" },
  interrupted: { text: "■ interrupted", tone: "changed" },
}
/** A cell's look by what its host did with its task, and what the legend calls it, in the legend's order. */
const CELLS: { readonly [K in HostOutcome | "changed" | "running" | "none"]: Span & { readonly name: string } } = {
  ok: { text: "✓", tone: "ok", name: "ok" },
  changed: { text: "✓", tone: "changed", name: "changed" },
  failed: { text: "✗", tone: "failed", name: "failed" },
  ignored: { text: "✗", tone: "ignored", name: "ignored" },
  unreachable: { text: "!", tone: "unreachable", name: "unreachable" },
  skipped: { text: "-", tone: "skipped", name: "skipped" },
  running: { text: "●", tone: "running", name: "running" },
  none: { text: "·", tone: "dim", name: "not run" },
}
const LEGEND: Line = Object.values(CELLS).map(({ text, tone, name }, at: number, all): Span => ({
  text: `${text} ${name}${at === all.length - 1 ? "" : " "}`,
  tone,
}))
/** A view with no run to show: only its head and notes say anything. */
const NONE_YET: Omit<View, "head" | "notes"> = { where: null, now: null, grid: [], legend: null, totals: null, failure: [], place: null }

export function view(shown: Shown): View {
  const notes: readonly Line[] = [
    ...(shown.trouble === null ? [] : [[{ text: shown.trouble, tone: "failed" } as const]]),
    ...streamNotes(shown.stream),
  ]
  if (shown.id === null) {
    return {
      ...NONE_YET,
      head: [{ text: "No runs yet", tone: "bold" }],
      notes: [
        ...notes,
        [{ text: `Logs are read from ${shown.directory}.`, tone: "dim" }],
        [{ text: "Record a run: callbacks_enabled = igouss.ansible_live.live in ansible.cfg.", tone: "dim" }],
      ],
    }
  }
  const run: Run | undefined = shown.stream.runs.get(shown.id)
  if (run === undefined) {
    return { ...NONE_YET, head: [{ text: `Reading ${shown.id}…`, tone: "dim" }], notes, place: place(shown, shown.id) }
  }
  const at: Glance = glance(run)
  const drawn: Board = at.play === null ? EMPTY_BOARD : board(at.play, shown.columns)
  return {
    head: head(run),
    where: where(at),
    now: at.task === null ? null : [{ text: "▸ ", tone: "running" }, { text: named(at.task), tone: "bold" }],
    grid: drawn.grid,
    legend: drawn.tasks === 0 ? null : LEGEND,
    totals: totals(run.counts, drawn.hidden),
    failure: failure(run.failure),
    notes: run.newer === null ? notes : [[{ text: newer(run.newer, "this run"), tone: "notice" }], ...notes],
    place: place(shown, run.id),
  }
}

function head(run: Run): Line {
  const state: Span = status(run.status)
  const start: Line = run.start === null ? [] : [
    { text: ` · ${run.start.controller}`, tone: "dim" },
    ...(run.start.check ? [{ text: " · check mode", tone: "notice" } as const] : []),
    ...(run.start.limit === null ? [] : [{ text: ` · limit ${run.start.limit}`, tone: "dim" } as const]),
  ]
  return [state, { text: ` ${run.id}`, tone: "dim" }, ...start]
}

function status(now: Status): Span {
  switch (now.state) {
    case "running":
      return { text: `${CELLS.running.text} running`, tone: "running" }
    case "ended":
      return ENDS[now.outcome]
    case "lost":
      return { text: "? lost: its process is gone and its log has no end", tone: "unreachable" }
  }
}

function where(at: Glance): Line | null {
  if (at.playbook === null) {
    return null
  }
  return [
    { text: at.playbook.path.split("/").at(-1) ?? at.playbook.path, tone: "bold" },
    ...(at.play === null ? [] : [{ text: ` › ${at.play.name}`, tone: "plain" } as const]),
  ]
}

function named(task: Task): string {
  return task.handler ? `${task.name} (handler)` : task.name
}

/** A play's host × task grid: a row per host with a cell for each of the newest tasks that fit, and how many older ones do not. */
type Board = { readonly grid: readonly Line[]; readonly tasks: number; readonly hidden: number }

const EMPTY_BOARD: Board = { grid: [], tasks: 0, hidden: 0 }

function board(play: Play, columns: number): Board {
  const tasks: readonly Task[] = list(play.tasks)
  const width: number = Math.min(HOST_COLUMNS, Math.max(0, ...play.hosts.map((host: string) => host.length)))
  const room: number = Math.max(1, columns - width - 1)
  const drawn: readonly ReadonlyMap<string, Cell>[] = tasks.slice(-room).map(cells)
  return {
    grid: play.hosts.map((host: string): Line => joined([
      { text: `${host.slice(0, width).padEnd(width)} `, tone: "plain" },
      ...drawn.map((row: ReadonlyMap<string, Cell>): Span => cell(row.get(host))),
    ])),
    tasks: tasks.length,
    hidden: Math.max(0, tasks.length - room),
  }
}

function cell(state: Cell | undefined): Span {
  const { text, tone }: Span = CELLS[look(state)]
  return { text, tone }
}

function look(state: Cell | undefined): keyof typeof CELLS {
  if (state === undefined) {
    return "none"
  }
  if (state.state === "running") {
    return "running"
  }
  return state.outcome === "ok" && state.changed ? "changed" : state.outcome
}

/** Neighbouring spans of one tone as one span: fewer elements for the surface to draw. */
function joined(spans: Line): Line {
  const line: Span[] = []
  for (const span of spans) {
    const last: Span | undefined = line.at(-1)
    if (last?.tone === span.tone) {
      line[line.length - 1] = { text: last.text + span.text, tone: span.tone }
    } else {
      line.push(span)
    }
  }
  return line
}

function totals(counts: Counts, hidden: number): Line | null {
  const summed: readonly Span[] = TOTALS.flatMap((outcome: HostOutcome | "changed"): Span[] =>
    counts[outcome] === 0 ? [] : [{ text: `${counts[outcome]} ${outcome}`, tone: outcome }])
  const spans: readonly Span[] = [
    ...summed,
    ...(hidden === 0 ? [] : [{ text: `${hidden} earlier ${hidden === 1 ? "task" : "tasks"} not shown`, tone: "dim" } as const]),
  ]
  return spans.length === 0 ? null : spans.flatMap((span: Span, at: number): Span[] => at === 0 ? [span] : [{ text: " · ", tone: "dim" }, span])
}

function failure(failed: Failure | null): readonly Line[] {
  if (failed === null) {
    return []
  }
  const said: readonly string[] = failed.message?.split("\n") ?? []
  return [
    [{ text: `✗ ${failed.host}`, tone: failed.outcome }, ...(failed.task === null ? [] : [{ text: ` · ${failed.task}`, tone: "bold" } as const])],
    ...said.slice(0, MESSAGE_LINES).map((line: string): Line => [{ text: `  ${line}`, tone: "plain" }]),
    ...(said.length > MESSAGE_LINES ? [[{ text: `  … ${said.length - MESSAGE_LINES} more lines`, tone: "dim" } as const]] : []),
  ]
}

function streamNotes(stream: Stream): readonly Line[] {
  return [
    ...stream.newer.map((v: number): Line => [{ text: newer(v, "a line that names no run"), tone: "notice" }]),
    ...(stream.malformed.latest === null ? [] : [[{
      text: `${stream.malformed.lines} unreadable ${stream.malformed.lines === 1 ? "line" : "lines"}; the latest: ${stream.malformed.latest}`,
      tone: "notice",
    } as const]]),
  ]
}

/** FR-15: what this reader cannot fold is named, with its version. */
function newer(v: number, what: string): string {
  return `A newer recorder (v${v}) wrote ${what}; update ansible-live to read it.`
}

function place(shown: Shown, id: string): Line {
  return [
    { text: `run ${shown.runs.indexOf(id) + 1} of ${shown.runs.length}`, tone: "dim" },
    ...(shown.picked ? [] : [{ text: " · live", tone: "running" } as const]),
  ]
}
