/** Hegel generators: valid v1 runs (SPEC.md FR-6 to FR-9, FR-17), any events at all, and runs as the contract spells them. */
import type { TestCase } from "@hegeldev/hegel"
import * as gs from "@hegeldev/hegel/generators"
import { HOST_OUTCOMES, PLAYBOOK_OUTCOMES, RUN_OUTCOMES, type Event, type HostOutcome, type HostResult, type HostStart, type PlaybookOutcome, type Recap, type RunOutcome } from "../plugin/core/event.ts"

const HOSTS: readonly string[] = ["web1", "web2", "db1"]
const PLAYS: readonly string[] = ["p-1", "p-2"]
const TASKS: readonly string[] = ["t-1", "t-2", "t-3"]
const START: number = Date.UTC(2026, 8, 28, 14, 28, 21)

const message: gs.Generator<string | null> = gs.optional(gs.text({ maxSize: 20 }))

/** A whole run as its recorder writes it, ending in run.end, cut off (killed), or cut off and then lost. */
export function aRun(tc: TestCase, run: string): readonly Event[] {
  const events: Event[] = []
  const at = (): string => new Date(START + events.length * 100).toISOString()
  events.push({ type: "run.start", run, at: at(), pid: 4242, controller: "fedora", ansible: "2.21.1", check: false, limit: null, extraVars: [] })
  let failed: boolean = false
  let open: boolean = false
  const playbooks: number = tc.draw(gs.integers({ minValue: 0, maxValue: 3 }))
  for (let p: number = 0; p < playbooks; p++) {
    events.push({ type: "playbook.start", run, at: at(), playbook: `/pb${p}.yml` })
    const recap: Map<string, Recap> = new Map()
    const plays: number = tc.draw(gs.integers({ minValue: 0, maxValue: 3 }))
    for (let q: number = 0; q < plays; q++) {
      const play: string = tc.draw(gs.sampledFrom(PLAYS))
      const hosts: string[] = HOSTS.filter(() => tc.draw(gs.booleans()))
      events.push({ type: "play.start", run, at: at(), play, name: `play ${q}`, hosts })
      const tasks: number = tc.draw(gs.integers({ minValue: 0, maxValue: 4 }))
      for (let t: number = 0; t < tasks; t++) {
        const task: string = tc.draw(gs.sampledFrom(TASKS))
        events.push({ type: "task.start", run, at: at(), task, name: `task ${t}`, play, handler: tc.draw(gs.booleans()) })
        for (const host of hosts) {
          const reached: number = tc.draw(gs.integers({ minValue: 0, maxValue: 2 }))
          if (reached >= 1) {
            events.push({ type: "host.start", run, at: at(), task, host })
          }
          if (reached === 2) {
            const outcome: HostOutcome = tc.draw(gs.sampledFrom(HOST_OUTCOMES))
            events.push({ type: "host.result", run, at: at(), task, host, outcome, changed: tc.draw(gs.booleans()), message: tc.draw(message) })
            const was: Recap = recap.get(host) ?? { ok: 0, changed: 0, failed: 0, unreachable: 0, skipped: 0, rescued: 0, ignored: 0 }
            recap.set(host, { ...was, failed: was.failed + (outcome === "failed" ? 1 : 0), unreachable: was.unreachable + (outcome === "unreachable" ? 1 : 0) })
          }
        }
      }
    }
    const last: boolean = p === playbooks - 1
    if (last && tc.draw(gs.booleans())) {
      open = true
    } else {
      const hosts: Record<string, Recap> = Object.fromEntries(recap)
      const outcome: PlaybookOutcome = [...recap.values()].some((line: Recap) => line.failed + line.unreachable > 0) ? "failed" : "ok"
      failed = failed || outcome === "failed"
      events.push({ type: "playbook.end", run, at: at(), outcome, hosts })
    }
  }
  const ending: "end" | "killed" | "lost" = tc.draw(gs.sampledFrom(["end", "killed", "lost"] as const))
  if (ending === "end") {
    const outcome: RunOutcome = open ? "interrupted" : failed ? "failed" : "ok"
    events.push({ type: "run.end", run, at: at(), outcome })
  }
  if (ending === "lost") {
    events.push({ type: "run.lost", run, at: at() })
  }
  return events
}

/** The first events of a run: what the viewer has seen while it is still going. */
export function aPrefix(tc: TestCase, events: readonly Event[]): readonly Event[] {
  return events.slice(0, tc.draw(gs.integers({ minValue: 0, maxValue: events.length })))
}

/** What the hosts said of one task, in any order and any number of times each. */
export function hostEvents(tc: TestCase, run: string, task: string): readonly (HostStart | HostResult)[] {
  const said: gs.Generator<HostStart | HostResult> = gs.composite((each: TestCase): HostStart | HostResult => {
    const host: string = each.draw(gs.sampledFrom(HOSTS))
    return each.draw(gs.sampledFrom<HostStart | HostResult>([
      { type: "host.start", run, at: "", task, host },
      { type: "host.result", run, at: "", task, host, outcome: each.draw(gs.sampledFrom(HOST_OUTCOMES)), changed: each.draw(gs.booleans()), message: null },
    ]))
  })
  return tc.draw(gs.arrays(said, { maxSize: 12 }))
}

/** Any event of any run, naming plays, tasks and hosts at random: nothing a recorder is bound to write. */
export const anyEvent: gs.Generator<Event> = gs.composite((tc: TestCase): Event => {
  const run: string = tc.draw(gs.sampledFrom(["r-1", "r-2"]))
  const at: string = tc.draw(gs.text({ maxSize: 5 }))
  const task: string = tc.draw(gs.sampledFrom(TASKS))
  const host: string = tc.draw(gs.sampledFrom(HOSTS))
  const events: readonly Event[] = [
    { type: "run.start", run, at, pid: 1, controller: "c", ansible: "a", check: tc.draw(gs.booleans()), limit: null, extraVars: [] },
    { type: "playbook.start", run, at, playbook: "/p.yml" },
    { type: "play.start", run, at, play: tc.draw(gs.sampledFrom(PLAYS)), name: "p", hosts: [host] },
    { type: "task.start", run, at, task, name: "t", play: tc.draw(gs.sampledFrom(PLAYS)), handler: false },
    { type: "host.start", run, at, task, host },
    { type: "host.result", run, at, task, host, outcome: tc.draw(gs.sampledFrom(HOST_OUTCOMES)), changed: tc.draw(gs.booleans()), message: tc.draw(message) },
    { type: "playbook.end", run, at, outcome: tc.draw(gs.sampledFrom(PLAYBOOK_OUTCOMES)), hosts: {} },
    { type: "run.end", run, at, outcome: tc.draw(gs.sampledFrom(RUN_OUTCOMES)) },
    { type: "run.lost", run, at },
  ]
  return tc.draw(gs.sampledFrom(events))
})

/** One event as the contract spells it on a line, at position `seq` of its log. */
export function spelled(event: Event, seq: number): Record<string, unknown> {
  if (event.type === "run.lost") {
    return { v: 1, ...event }
  }
  if (event.type === "run.start") {
    const { extraVars, ...rest } = event
    return { v: 1, seq, ...rest, extra_vars: extraVars }
  }
  return { v: 1, seq, ...event }
}

/** Two sequences merged in a drawn order, each keeping its own. */
export function interleaved<T>(tc: TestCase, a: readonly T[], b: readonly T[]): readonly T[] {
  const merged: T[] = []
  let i: number = 0
  let j: number = 0
  while (i < a.length || j < b.length) {
    const fromA: boolean = j === b.length || (i < a.length && tc.draw(gs.booleans()))
    merged.push(fromA ? a[i++]! : b[j++]!)
  }
  return merged
}
