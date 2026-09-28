import type { Event, HostOutcome, PlaybookEnd, RunOutcome, RunStart } from "./event.ts"
import { changed, find, push, type Rows } from "./rows.ts"

/** One host on one task: started, or ended with its result. */
export type Cell =
  | { readonly state: "running" }
  | { readonly state: "done"; readonly outcome: HostOutcome; readonly changed: boolean }

/** One `task.start`: a task or handler as it ran in one play batch; its cells are the host × task grid's row. */
export type Task = {
  readonly id: string
  readonly name: string
  readonly handler: boolean
  readonly cells: ReadonlyMap<string, Cell>
}

/** One `play.start`: a play, or one `serial` batch of it, with that batch's hosts and its tasks, newest first. */
export type Play = {
  readonly id: string
  readonly name: string
  readonly hosts: readonly string[]
  readonly tasks: Rows<Task>
}

export type Playbook = {
  readonly path: string
  readonly plays: readonly Play[]
  readonly end: Pick<PlaybookEnd, "outcome" | "hosts"> | null
}

/** A host's results so far, one count per `host.result`; `changed` counts results that changed something. */
export type Counts = Readonly<Record<HostOutcome | "changed", number>>

/** The latest result that failed or found its host unreachable; `task` is null when the log never started it. */
export type Failure = {
  readonly host: string
  readonly task: string | null
  readonly outcome: "failed" | "unreachable"
  readonly message: string | null
  readonly at: string
}

/** `lost`: the follower found the process dead without a `run.end` (FR-14). */
export type Status =
  | { readonly state: "running" }
  | { readonly state: "ended"; readonly outcome: RunOutcome; readonly at: string }
  | { readonly state: "lost"; readonly at: string }

export type Start = Omit<RunStart, "type" | "run">

export type Run = {
  readonly id: string
  /** Null until `run.start` is read. */
  readonly start: Start | null
  readonly playbooks: readonly Playbook[]
  readonly counts: ReadonlyMap<string, Counts>
  readonly failure: Failure | null
  readonly status: Status
  /** FR-15: the version of a line this reader could not fold, when the run has one. */
  readonly newer: number | null
}

export const NONE: Counts = { ok: 0, changed: 0, failed: 0, ignored: 0, skipped: 0, unreachable: 0 }

export function begin(id: string): Run {
  return { id, start: null, playbooks: [], counts: new Map(), failure: null, status: { state: "running" }, newer: null }
}

/**
 * The run after `event`. Total: an event that names a play or task the run never started changes nothing
 * the grid shows, and nothing ends a run a second time.
 */
export function fold(run: Run, event: Event): Run {
  switch (event.type) {
    case "run.start": {
      const { type: _type, run: _run, ...start } = event
      return { ...run, start }
    }
    case "playbook.start":
      return { ...run, playbooks: [...run.playbooks, { path: event.playbook, plays: [], end: null }] }
    case "play.start": {
      const play: Play = { id: event.play, name: event.name, hosts: event.hosts, tasks: null }
      return withLastPlaybook(run, (playbook: Playbook) => ({ ...playbook, plays: [...playbook.plays, play] }))
    }
    case "task.start": {
      const task: Task = { id: event.task, name: event.name, handler: event.handler, cells: new Map() }
      return withPlace(run, latest(run, (play: Play) => play.id === event.play), (play: Play) => ({ ...play, tasks: push(play.tasks, task) }))
    }
    case "host.start":
      return withTask(run, event.task, (task: Task) => cell(task, event.host, { state: "running" }))
    case "host.result": {
      const failure: Failure | null = event.outcome === "failed" || event.outcome === "unreachable"
        ? { host: event.host, task: latestTask(run, event.task)?.name ?? null, outcome: event.outcome, message: event.message, at: event.at }
        : run.failure
      const done: Cell = { state: "done", outcome: event.outcome, changed: event.changed }
      return withTask({ ...run, counts: tally(run.counts, event.host, event.outcome, event.changed), failure }, event.task, (task: Task) => cell(task, event.host, done))
    }
    case "playbook.end":
      return withLastPlaybook(run, (playbook: Playbook) => ({ ...playbook, end: { outcome: event.outcome, hosts: event.hosts } }))
    case "run.end":
      return run.status.state === "ended" ? run : { ...run, status: { state: "ended", outcome: event.outcome, at: event.at } }
    case "run.lost":
      return run.status.state === "running" ? { ...run, status: { state: "lost", at: event.at } } : run
  }
}

function tally(counts: ReadonlyMap<string, Counts>, host: string, outcome: HostOutcome, isChanged: boolean): ReadonlyMap<string, Counts> {
  const was: Counts = counts.get(host) ?? NONE
  return new Map(counts).set(host, { ...was, [outcome]: was[outcome] + 1, changed: was.changed + (isChanged ? 1 : 0) })
}

function cell(task: Task, host: string, value: Cell): Task {
  return { ...task, cells: new Map(task.cells).set(host, value) }
}

function withLastPlaybook(run: Run, change: (playbook: Playbook) => Playbook): Run {
  return { ...run, playbooks: replaced(run.playbooks, run.playbooks.length - 1, change) }
}

/** Where a play batch is: its playbook's index and its own. */
type Place = readonly [playbook: number, play: number]

/** The most recent `task.start` with this id is the one its hosts report on. */
function withTask(run: Run, id: string, change: (task: Task) => Task): Run {
  return withPlace(run, latest(run, holds(id)), (play: Play) => ({ ...play, tasks: changed(play.tasks, isTask(id), change) }))
}

function latestTask(run: Run, id: string): Task | null {
  const place: Place | null = latest(run, holds(id))
  return place === null ? null : find(run.playbooks[place[0]]!.plays[place[1]]!.tasks, isTask(id))
}

function holds(id: string): (play: Play) => boolean {
  return (play: Play) => find(play.tasks, isTask(id)) !== null
}

function isTask(id: string): (task: Task) => boolean {
  return (task: Task) => task.id === id
}

/** The newest play batch that passes `test`, searched from the newest back. */
function latest(run: Run, test: (play: Play) => boolean): Place | null {
  for (let playbook: number = run.playbooks.length - 1; playbook >= 0; playbook--) {
    const play: number = run.playbooks[playbook]!.plays.findLastIndex(test)
    if (play >= 0) {
      return [playbook, play]
    }
  }
  return null
}

function withPlace(run: Run, place: Place | null, change: (play: Play) => Play): Run {
  return place === null ? run : {
    ...run,
    playbooks: replaced(run.playbooks, place[0], (each: Playbook) => ({ ...each, plays: replaced(each.plays, place[1], change) })),
  }
}

function replaced<T>(items: readonly T[], index: number, change: (item: T) => T): readonly T[] {
  return items.map((item: T, at: number) => (at === index ? change(item) : item))
}
