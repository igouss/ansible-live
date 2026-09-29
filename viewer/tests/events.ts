/** Events of run RUN, spelled short; `at` is the same everywhere except where a test reads it. */
import type { Event, HostOutcome, PlaybookOutcome, Recap, RunOutcome } from "../plugin/core/event.ts"
import { list } from "../plugin/core/rows.ts"
import { begin, cells, fold, type Cell, type Play, type Run, type Task } from "../plugin/core/run.ts"
import { EMPTY, type Stream } from "../plugin/core/stream.ts"

export const RUN: string = "20260928T142821Z-4242"
export const AT: string = "2026-09-28T14:28:21.000Z"

export const runStart: Event = {
  type: "run.start", run: RUN, at: AT, pid: 4242, controller: "fedora", ansible: "2.21.1", check: false, limit: null, extraVars: [],
}

export function playbook(path: string): Event {
  return { type: "playbook.start", run: RUN, at: AT, playbook: path }
}

export function play(id: string, hosts: readonly string[]): Event {
  return { type: "play.start", run: RUN, at: AT, play: id, name: `play ${id}`, hosts }
}

export function task(id: string, inPlay: string, handler: boolean = false): Event {
  return { type: "task.start", run: RUN, at: AT, task: id, name: `task ${id}`, play: inPlay, handler }
}

export function hostStart(inTask: string, host: string): Event {
  return { type: "host.start", run: RUN, at: AT, task: inTask, host }
}

export function result(inTask: string, host: string, outcome: HostOutcome, changed: boolean = false, message: string | null = null, at: string = AT): Event {
  return { type: "host.result", run: RUN, at, task: inTask, host, outcome, changed, message }
}

export function playbookEnd(outcome: PlaybookOutcome, hosts: Readonly<Record<string, Recap>> = {}): Event {
  return { type: "playbook.end", run: RUN, at: AT, outcome, hosts }
}

export function runEnd(outcome: RunOutcome, at: string = AT): Event {
  return { type: "run.end", run: RUN, at, outcome }
}

export function lost(at: string): Event {
  return { type: "run.lost", run: RUN, at }
}

/** A task as the grid reads it: its marks as the cell each host shows. */
export type Row = Omit<Task, "marks"> & { readonly cells: ReadonlyMap<string, Cell> }

/** A play's rows oldest first, none when there is no such play. */
export function rowsOf(play: Play | undefined): readonly Row[] {
  return list(play?.tasks ?? null).map((task: Task): Row => ({ id: task.id, name: task.name, handler: task.handler, cells: cells(task) }))
}

export function folded(...events: readonly Event[]): Run {
  return foldedAs(RUN, events)
}

export function foldedAs(run: string, events: readonly Event[]): Run {
  return events.reduce(fold, begin(run))
}

/** A stream that has shown these runs and nothing else. */
export function streamOf(...shown: readonly Run[]): Stream {
  return { ...EMPTY, runs: new Map(shown.map((run: Run) => [run.id, run])) }
}
