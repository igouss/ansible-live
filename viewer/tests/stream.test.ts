import { expect, test } from "vitest"
import { begin, NONE, type Run } from "../plugin/core/run.ts"
import { EMPTY, follow, type Stream } from "../plugin/core/stream.ts"
import { RUN, rowsOf } from "./events.ts"
import { read, streamed } from "./examples.ts"

function run(stream: Stream): Run | undefined {
  return stream.runs.get(RUN)
}

test("an empty stream has no runs and nothing unreadable", () => {
  expect(EMPTY).toEqual({ runs: new Map(), newer: [], malformed: { lines: 0, latest: null } })
})

test("clean.jsonl: ended ok, three rows the last a handler, and its results counted", () => {
  const clean: Run | undefined = run(streamed("valid/clean.jsonl"))
  expect([
    clean?.status.state,
    rowsOf(clean?.playbooks[0]?.plays[0]).map((row) => [row.name, row.handler]),
    clean?.counts,
    clean?.failure,
  ]).toEqual([
    "ended",
    [["Write the site config", false], ["Migrate a schema no web host has", false], ["Reload the site", true]],
    { ...NONE, ok: 4, changed: 4, skipped: 2 },
    null,
  ])
})

test("failing_then_ok.jsonl: the failure names web2 and its task; the run ended failed, its results counted", () => {
  const failing: Run | undefined = run(streamed("valid/failing_then_ok.jsonl"))
  expect([failing?.status, failing?.failure, failing?.counts]).toEqual([
    { state: "ended", outcome: "failed", at: "2026-09-28T14:28:22.200Z" },
    { host: "web2", task: "Health check", outcome: "failed", message: null, at: "2026-09-28T14:28:21.700Z" },
    { ...NONE, ok: 1, failed: 1 },
  ])
})

test("killed.jsonl: without a run.end the run is still running, web1 mid-task", () => {
  const killed: Run | undefined = run(streamed("valid/killed.jsonl"))
  expect([killed?.status, rowsOf(killed?.playbooks[0]?.plays[0])[0]?.cells]).toEqual([
    { state: "running" },
    new Map([["web1", { state: "running" }]]),
  ])
})

test("killed_then_lost.jsonl: the follower's run.lost marks it presumed dead", () => {
  expect(run(streamed("stream/killed_then_lost.jsonl"))?.status).toEqual({ state: "lost", at: "2026-09-28T14:40:00.000Z" })
})

test("serial.jsonl: two batches of one play, each with its hosts", () => {
  expect(run(streamed("valid/serial.jsonl"))?.playbooks[0]?.plays.map((each) => each.hosts)).toEqual([["web1", "web2"], ["web3"]])
})

test("interleaved runs each fold only their own events, in the order they first appeared", () => {
  const stream: Stream = read([
    `{"v":1,"run":"b","seq":0,"at":"t","type":"run.end","outcome":"ok"}`,
    `{"v":1,"run":"a","seq":0,"at":"t","type":"run.end","outcome":"failed"}`,
    `{"v":1,"type":"run.lost","run":"c","at":"t"}`,
  ])
  expect([...stream.runs.values()]).toEqual([
    { ...begin("b"), status: { state: "ended", outcome: "ok", at: "t" } },
    { ...begin("a"), status: { state: "ended", outcome: "failed", at: "t" } },
    { ...begin("c"), status: { state: "lost", at: "t" } },
  ])
})

test("FR-15: a newer line marks its run with the version and folds nothing else", () => {
  const stream: Stream = read([`{"v":1,"run":"a","seq":0,"at":"t","type":"playbook.start","playbook":"/p.yml"}`, `{"v":2,"run":"a","type":"task.begun"}`])
  expect(stream.runs.get("a")).toEqual({ ...begin("a"), playbooks: [{ path: "/p.yml", plays: [], end: null }], newer: 2 })
})

test("FR-15: a newer line naming no run is named once per version on the stream", () => {
  expect(read([`{"v":2}`, `{"v":3}`, `{"v":2}`])).toEqual({ ...EMPTY, newer: [2, 3] })
})

test("FR-16: an unknown v1 type changes nothing", () => {
  expect(follow(EMPTY, { kind: "unknown" })).toEqual(EMPTY)
})

test("malformed lines are counted, with the latest reason", () => {
  expect(read(["nope", "[]"])).toEqual({ ...EMPTY, malformed: { lines: 2, latest: "not a JSON object" } })
})
