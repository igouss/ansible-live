/** What a run's events say the viewer must show, worked out from the events alone, never from the fold. */
import type { Event, HostOutcome, HostResult, RunEnd, RunLost, TaskStart } from "../plugin/core/event.ts"
import { list } from "../plugin/core/rows.ts"
import type { Counts, Failure, Run, Status } from "../plugin/core/run.ts"
import type { Line, Span, View } from "../plugin/core/view.ts"

export function rows(run: Run): readonly string[] {
  return run.playbooks.flatMap((playbook) => playbook.plays.flatMap((play) => list(play.tasks).map((task) => task.id)))
}

export function taskStarts(events: readonly Event[]): readonly string[] {
  return events.flatMap((event: Event) => (event.type === "task.start" ? [event.task] : []))
}

export function counts(events: readonly Event[]): ReadonlyMap<string, Counts> {
  const hosts: readonly string[] = [...new Set(results(events).map((event: HostResult) => event.host))]
  return new Map(hosts.map((host: string) => [host, counted(events, host)]))
}

export function failure(events: readonly Event[]): Failure | null {
  const latest: Failed | undefined = results(events).filter(isFailed).at(-1)
  if (latest === undefined) {
    return null
  }
  const before: readonly Event[] = events.slice(0, events.indexOf(latest))
  const started: TaskStart | undefined = before.findLast((event: Event): event is TaskStart => event.type === "task.start" && event.task === latest.task)
  return { host: latest.host, task: started?.name ?? null, outcome: latest.outcome, message: latest.message, at: latest.at }
}

export function status(events: readonly Event[]): Status {
  const end: RunEnd | undefined = events.find((event: Event): event is RunEnd => event.type === "run.end")
  const lost: RunLost | undefined = events.find((event: Event): event is RunLost => event.type === "run.lost")
  if (end !== undefined) {
    return { state: "ended", outcome: end.outcome, at: end.at }
  }
  return lost === undefined ? { state: "running" } : { state: "lost", at: lost.at }
}

/** The runs of a stream in the order each first appears in it. */
export function firstAppeared(stream: readonly Event[]): readonly string[] {
  return [...new Set(stream.map((event: Event) => event.run))]
}

type Failed = HostResult & { readonly outcome: "failed" | "unreachable" }

function isFailed(event: HostResult): event is Failed {
  return event.outcome === "failed" || event.outcome === "unreachable"
}

function results(events: readonly Event[]): readonly HostResult[] {
  return events.filter((event: Event): event is HostResult => event.type === "host.result")
}

function counted(events: readonly Event[], host: string): Counts {
  const mine: readonly HostResult[] = results(events).filter((event: HostResult) => event.host === host)
  const of = (outcome: HostOutcome): number => mine.filter((event: HostResult) => event.outcome === outcome).length
  return {
    ok: of("ok"), failed: of("failed"), ignored: of("ignored"), skipped: of("skipped"), unreachable: of("unreachable"),
    changed: mine.filter((event: HostResult) => event.changed).length,
  }
}

/** How many tasks of the play the grid's rows have a cell for, and how many the totals say are not shown. */
export function gridTasks(seen: View, hostColumns: number): { readonly shown: readonly number[]; readonly hidden: number } {
  return {
    shown: seen.grid.map((row: Line) => width(row) - hostColumns - 1),
    hidden: Number(/(\d+) earlier tasks? not shown/.exec(seen.totals?.map((span: Span) => span.text).join("") ?? "")?.[1] ?? 0),
  }
}

/** The widest a grid row may be: the pane's width, or its host column and one cell when even that does not fit. */
export function widest(columns: number, hostColumns: number): number {
  return Math.max(columns, hostColumns + 2)
}

export function width(line: Line): number {
  return [...line.map((span: Span) => span.text).join("")].length
}

/** How wide the grid's host column is: the longest host name, cut at 16. */
export function hostColumns(hosts: readonly string[]): number {
  return Math.min(16, Math.max(0, ...hosts.map((host: string) => host.length)))
}
