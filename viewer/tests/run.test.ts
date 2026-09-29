import { expect, test } from "vitest"
import { begin, NONE, type Cell, type Run } from "../plugin/core/run.ts"
import { AT, folded, rowsOf, hostStart, lost, play, playbook, playbookEnd, result, RUN, runEnd, runStart, task } from "./events.ts"

test("zero events: a run with nothing to show, running", () => {
  expect(begin(RUN)).toEqual({
    id: RUN, start: null, playbooks: [], counts: NONE, failure: null, status: { state: "running" }, newer: null,
  })
})

test("run.start is kept as the run's start", () => {
  expect(folded(runStart).start).toEqual({
    at: AT, pid: 4242, controller: "fedora", ansible: "2.21.1", check: false, limit: null, extraVars: [],
  })
})

test("zero tasks: a play with its hosts and an empty grid", () => {
  expect(folded(runStart, playbook("/p.yml"), play("p-1", ["web1", "web2"])).playbooks).toEqual([
    { path: "/p.yml", plays: [{ id: "p-1", name: "play p-1", hosts: ["web1", "web2"], tasks: null }], end: null },
  ])
})

test("one task on one host: running, then its result", () => {
  const started: Run = folded(runStart, playbook("/p.yml"), play("p-1", ["web1"]), task("t-1", "p-1"), hostStart("t-1", "web1"))
  const ended: Run = folded(runStart, playbook("/p.yml"), play("p-1", ["web1"]), task("t-1", "p-1"), hostStart("t-1", "web1"), result("t-1", "web1", "ok", true))
  expect([rowsOf(started.playbooks[0]?.plays[0]), rowsOf(ended.playbooks[0]?.plays[0])]).toEqual([
    [{ id: "t-1", name: "task t-1", handler: false, cells: new Map([["web1", { state: "running" }]]) }],
    [{ id: "t-1", name: "task t-1", handler: false, cells: new Map([["web1", { state: "done", outcome: "ok", changed: true }]]) }],
  ])
})

test("a task's cells are read once: asking again gives the same map, so a redraw reads only the tasks that changed", () => {
  const run: Run = folded(runStart, playbook("/p.yml"), play("p-1", ["web1"]), task("t-1", "p-1"), hostStart("t-1", "web1"))
  const first: ReadonlyMap<string, Cell> | undefined = rowsOf(run.playbooks[0]?.plays[0])[0]?.cells
  expect([first?.get("web1"), rowsOf(run.playbooks[0]?.plays[0])[0]?.cells === first]).toEqual([{ state: "running" }, true])
})

test("many tasks on many hosts: one row per task in order, one cell per host", () => {
  const run: Run = folded(
    runStart, playbook("/p.yml"), play("p-1", ["web1", "web2"]),
    task("t-1", "p-1"), result("t-1", "web1", "ok"), result("t-1", "web2", "skipped"),
    task("t-2", "p-1"), hostStart("t-2", "web2"), result("t-2", "web1", "failed", false, "boom"),
    task("h-1", "p-1", true),
  )
  expect(rowsOf(run.playbooks[0]?.plays[0])).toEqual([
    {
      id: "t-1", name: "task t-1", handler: false,
      cells: new Map([["web1", { state: "done", outcome: "ok", changed: false }], ["web2", { state: "done", outcome: "skipped", changed: false }]]),
    },
    {
      id: "t-2", name: "task t-2", handler: false,
      cells: new Map([["web2", { state: "running" }], ["web1", { state: "done", outcome: "failed", changed: false }]]),
    },
    { id: "h-1", name: "task h-1", handler: true, cells: new Map() },
  ])
})

test("strategy free: a result for an earlier task after a later one started lands in its own row, named by it", () => {
  const run: Run = folded(
    runStart, playbook("/p.yml"), play("p-1", ["web1", "web2"]),
    task("t-1", "p-1"), task("t-2", "p-1"), result("t-2", "web2", "ok"), result("t-1", "web1", "failed", false, "slow"),
  )
  expect([rowsOf(run.playbooks[0]?.plays[0]).map((row) => [row.id, [...row.cells.keys()]]), run.failure?.task]).toEqual([
    [["t-1", ["web1"]], ["t-2", ["web2"]]],
    "task t-1",
  ])
})

test("a failure in an earlier serial batch, reported after the next batch started a task, is named by its own task", () => {
  const run: Run = folded(
    runStart, playbook("/p.yml"), play("p-1", ["web1"]), task("t-1", "p-1"),
    play("p-1", ["web2"]), task("t-2", "p-1"), result("t-1", "web1", "unreachable"),
  )
  expect(run.failure?.task).toEqual("task t-1")
})

test("counts: no result counts nothing, and each result counts once, whichever its host", () => {
  const run: Run = folded(
    runStart, playbook("/p.yml"), play("p-1", ["web1", "web2"]),
    task("t-1", "p-1"), result("t-1", "web1", "ok", true), result("t-1", "web2", "unreachable"),
    task("t-2", "p-1"), result("t-2", "web1", "ignored"), task("t-3", "p-1"), result("t-3", "web1", "skipped"),
    task("t-4", "p-1"), result("t-4", "web1", "failed"),
  )
  expect([folded(runStart).counts, run.counts]).toEqual([NONE, { ok: 1, changed: 1, failed: 1, ignored: 1, skipped: 1, unreachable: 1 }])
})

test("the latest failure or unreachable host is the failure shown; an ignored one is not", () => {
  const first: Run = folded(runStart, playbook("/p.yml"), play("p-1", ["a", "b"]), task("t-1", "p-1"), result("t-1", "a", "failed", false, "first", "2026-09-28T14:28:22.000Z"))
  const second: Run = folded(
    runStart, playbook("/p.yml"), play("p-1", ["a", "b"]), task("t-1", "p-1"),
    result("t-1", "a", "failed", false, "first"), result("t-1", "b", "unreachable", false, "gone", "2026-09-28T14:28:23.000Z"),
    result("t-1", "a", "ignored", false, "never mind"),
  )
  expect([folded(runStart).failure, first.failure, second.failure]).toEqual([
    null,
    { host: "a", task: "task t-1", outcome: "failed", message: "first", at: "2026-09-28T14:28:22.000Z" },
    { host: "b", task: "task t-1", outcome: "unreachable", message: "gone", at: "2026-09-28T14:28:23.000Z" },
  ])
})

test("serial: each batch is its own play with its own hosts, and a task restarted in a later batch gets a new row", () => {
  const run: Run = folded(
    runStart, playbook("/p.yml"),
    play("p-1", ["web1"]), task("t-1", "p-1"), result("t-1", "web1", "ok"),
    play("p-1", ["web2"]), task("t-1", "p-1"), result("t-1", "web2", "failed"),
  )
  expect(run.playbooks[0]?.plays.map((each) => [each.id, each.name, each.hosts, rowsOf(each)])).toEqual([
    ["p-1", "play p-1", ["web1"], [{ id: "t-1", name: "task t-1", handler: false, cells: new Map([["web1", { state: "done", outcome: "ok", changed: false }]]) }]],
    ["p-1", "play p-1", ["web2"], [{ id: "t-1", name: "task t-1", handler: false, cells: new Map([["web2", { state: "done", outcome: "failed", changed: false }]]) }]],
  ])
})

test("a late result for a task of an earlier batch lands in that batch's row", () => {
  const run: Run = folded(
    runStart, playbook("/p.yml"),
    play("p-1", ["web1"]), task("t-1", "p-1"),
    play("p-1", ["web2"]), task("t-2", "p-1"), result("t-1", "web1", "ok"),
  )
  expect(run.playbooks[0]?.plays.map((each) => rowsOf(each).map((row) => [row.id, [...row.cells.keys()]]))).toEqual([
    [["t-1", ["web1"]]],
    [["t-2", []]],
  ])
})

test("many playbooks: each keeps its own plays and its recap", () => {
  const recap = { ok: 1, changed: 0, failed: 1, unreachable: 0, skipped: 0, rescued: 0, ignored: 0 }
  const run: Run = folded(
    runStart, playbook("/a.yml"), play("p-1", ["web1"]), playbookEnd("failed", { web1: recap }),
    playbook("/b.yml"), play("p-2", ["web1"]),
  )
  expect(run.playbooks).toEqual([
    { path: "/a.yml", plays: [{ id: "p-1", name: "play p-1", hosts: ["web1"], tasks: null }], end: { outcome: "failed", hosts: { web1: recap } } },
    { path: "/b.yml", plays: [{ id: "p-2", name: "play p-2", hosts: ["web1"], tasks: null }], end: null },
  ])
})

test("run.end ends the run with its outcome and time", () => {
  expect(folded(runStart, runEnd("interrupted", "2026-09-28T14:30:00.000Z")).status).toEqual({
    state: "ended", outcome: "interrupted", at: "2026-09-28T14:30:00.000Z",
  })
})

test("run.lost marks a running run presumed dead, and never an ended one", () => {
  expect([
    folded(runStart, lost("2026-09-28T14:40:00.000Z")).status,
    folded(runStart, runEnd("ok"), lost("2026-09-28T14:40:00.000Z")).status,
  ]).toEqual([
    { state: "lost", at: "2026-09-28T14:40:00.000Z" },
    { state: "ended", outcome: "ok", at: AT },
  ])
})

test("a run ends once: a second run.end changes nothing", () => {
  expect(folded(runStart, runEnd("failed"), runEnd("ok", "2026-09-28T14:50:00.000Z")).status).toEqual({ state: "ended", outcome: "failed", at: AT })
})

test("a lost run that then writes run.end shows its end", () => {
  expect(folded(runStart, lost("2026-09-28T14:40:00.000Z"), runEnd("ok")).status).toEqual({ state: "ended", outcome: "ok", at: AT })
})

test("events naming what the run never started change nothing the grid shows", () => {
  const before: Run = folded(runStart, playbook("/p.yml"), play("p-1", ["web1"]), task("t-1", "p-1"))
  expect(folded(
    runStart, play("p-0", ["web1"]), playbookEnd("ok"), playbook("/p.yml"), play("p-1", ["web1"]), task("t-1", "p-1"),
    task("t-9", "p-9"), hostStart("t-9", "web1"),
  )).toEqual(before)
})

test("a result for a task never started still counts, and its failure has no task name", () => {
  const run: Run = folded(runStart, result("t-9", "web1", "failed", false, "boom"))
  expect([run.counts, run.failure, run.playbooks]).toEqual([
    { ...NONE, failed: 1 },
    { host: "web1", task: null, outcome: "failed", message: "boom", at: AT },
    [],
  ])
})
