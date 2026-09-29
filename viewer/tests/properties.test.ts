import * as hegel from "@hegeldev/hegel"
import type { TestCase } from "@hegeldev/hegel"
import * as gs from "@hegeldev/hegel/generators"
import { expect, test } from "vitest"
import { decode } from "../plugin/core/decode.ts"
import type { Event, HostResult, HostStart } from "../plugin/core/event.ts"
import type { Run } from "../plugin/core/run.ts"
import { EMPTY, follow, type Stream } from "../plugin/core/stream.ts"
import { foldedAs, play, playbook, rowsOf, RUN, runStart, task } from "./events.ts"
import { read } from "./examples.ts"
import { anyEvent, aPrefix, aRun, hostEvents, interleaved, spelled } from "./generate.ts"
import * as oracle from "./oracle.ts"

function folded(events: readonly Event[]): Run {
  return foldedAs(RUN, events)
}

function followed(events: readonly Event[]): Stream {
  return events.reduce((now: Stream, event: Event) => follow(now, { kind: "event", event }), EMPTY)
}

function spelledAll(events: readonly Event[]): readonly string[] {
  return events.map((event: Event, seq: number) => JSON.stringify(spelled(event, seq)))
}

test("a prefix of a run shows exactly the tasks it started, in order: never a later one", () =>
  hegel.test((tc: TestCase) => {
    const seen: readonly Event[] = aPrefix(tc, aRun(tc, RUN))
    expect(oracle.rows(folded(seen))).toEqual(oracle.taskStarts(seen))
  }))

test("the run's counts equal the results folded, over all its hosts", () =>
  hegel.test((tc: TestCase) => {
    const seen: readonly Event[] = aPrefix(tc, aRun(tc, RUN))
    expect(folded(seen).counts).toEqual(oracle.counts(seen))
  }))

test("each host's cell on a task is what the latest event about it on that task said", () =>
  hegel.test((tc: TestCase) => {
    const said: readonly (HostStart | HostResult)[] = hostEvents(tc, RUN, "t-1")
    const run: Run = folded([runStart, playbook("/p.yml"), play("p-1", ["web1", "web2", "db1"]), task("t-1", "p-1"), ...said])
    expect(rowsOf(run.playbooks[0]?.plays[0])[0]?.cells).toEqual(oracle.cells(said))
  }))

test("the failure shown is the latest failed or unreachable result, named by its task as started then", () =>
  hegel.test((tc: TestCase) => {
    const seen: readonly Event[] = aPrefix(tc, aRun(tc, RUN))
    expect(folded(seen).failure).toEqual(oracle.failure(seen))
  }))

test("a run is ended once it wrote run.end, lost once the follower said so without one, else running", () =>
  hegel.test((tc: TestCase) => {
    const seen: readonly Event[] = aPrefix(tc, aRun(tc, RUN))
    expect(folded(seen).status).toEqual(oracle.status(seen))
  }))

test("interleaved runs fold as if each were alone, listed in the order they first appeared", () =>
  hegel.test((tc: TestCase) => {
    const a: readonly Event[] = aRun(tc, "20260928T142821Z-1")
    const b: readonly Event[] = aRun(tc, "20260928T142822Z-2")
    const stream: readonly Event[] = interleaved(tc, a, b)
    const alone: ReadonlyMap<string, Run> = new Map([["20260928T142821Z-1", foldedAs("20260928T142821Z-1", a)], ["20260928T142822Z-2", foldedAs("20260928T142822Z-2", b)]])
    const runs: ReadonlyMap<string, Run> = followed(stream).runs
    expect([[...runs.keys()], runs]).toEqual([oracle.firstAppeared(stream), alone])
  }))

test("a run read from its lines folds as its events do", () =>
  hegel.test((tc: TestCase) => {
    const events: readonly Event[] = aRun(tc, RUN)
    expect(read(spelledAll(events))).toEqual(followed(events))
  }))

test("FR-16: fields and event types added after v1 change nothing the viewer shows", () =>
  hegel.test((tc: TestCase) => {
    const events: readonly Event[] = aRun(tc, RUN)
    const future: string = tc.draw(gs.text({ maxSize: 8 }))
    const lines: readonly string[] = events.flatMap((event: Event, seq: number) => [
      JSON.stringify({ ...spelled(event, seq), later_field: future }),
      JSON.stringify({ v: 1, run: RUN, seq, at: event.at, type: "later.event", task: future }),
    ])
    expect(read(lines)).toEqual(read(spelledAll(events)))
  }))

test("any events at all, in any order, fold without throwing", () =>
  hegel.test((tc: TestCase) => {
    const events: readonly Event[] = tc.draw(gs.arrays(anyEvent, { maxSize: 40 }))
    expect(followed(events).runs.size).toBeLessThanOrEqual(2)
  }))

test("any line at all decodes without throwing", () =>
  hegel.test((tc: TestCase) => {
    expect(["event", "newer", "unknown", "malformed"]).toContain(decode(tc.draw(gs.text())).kind)
  }))

test("a v1 line with any field of any JSON type decodes without throwing", () =>
  hegel.test((tc: TestCase) => {
    const value: gs.Generator<unknown> = gs.oneOf<unknown>(gs.just(null), gs.booleans(), gs.integers(), gs.text({ maxSize: 4 }), gs.arrays(gs.integers(), { maxSize: 2 }))
    const type: string = tc.draw(gs.sampledFrom(["run.start", "playbook.start", "play.start", "task.start", "host.start", "host.result", "playbook.end", "run.end", "run.lost"]))
    const fields: readonly string[] = ["run", "seq", "at", "pid", "controller", "ansible", "check", "limit", "extra_vars", "playbook", "play", "name", "hosts", "task", "handler", "host", "outcome", "changed", "message"]
    const line: Record<string, unknown> = Object.fromEntries(fields.map((field: string) => [field, tc.draw(value)]))
    expect(["event", "malformed"]).toContain(decode(JSON.stringify({ ...line, v: 1, type })).kind)
  }))
