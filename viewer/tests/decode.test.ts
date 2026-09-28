import { expect, test } from "vitest"
import { decode, type Line } from "../plugin/core/decode.ts"
import { lines } from "./examples.ts"

const ENVELOPE: string = `"v":1,"run":"20260928T142821Z-4242","seq":3,"at":"2026-09-28T14:28:21.300Z"`
const HEAD = { run: "20260928T142821Z-4242", at: "2026-09-28T14:28:21.300Z" } as const

test.each([
  "valid/clean.jsonl",
  "valid/failing_then_ok.jsonl",
  "valid/interrupted.jsonl",
  "valid/killed.jsonl",
  "valid/serial.jsonl",
  "valid/unreachable.jsonl",
  "stream/killed_then_lost.jsonl",
])("every line of %s is an event", (name: string) => {
  expect(lines(name).map(decode).filter((line: Line) => line.kind !== "event")).toEqual([])
})

test("a task.start reads as the viewer names it", () => {
  expect(decode(`{${ENVELOPE},"type":"task.start","task":"t-1","name":"Deploy","play":"p-1","handler":true}`)).toEqual({
    kind: "event",
    event: { type: "task.start", ...HEAD, task: "t-1", name: "Deploy", play: "p-1", handler: true },
  })
})

test("run.start's extra_vars read as extraVars, and a null limit stays null", () => {
  expect(decode(`{${ENVELOPE},"type":"run.start","pid":7,"controller":"c","ansible":"2.21.1","check":true,"limit":null,"extra_vars":["a","b"]}`)).toEqual({
    kind: "event",
    event: {
      type: "run.start", ...HEAD,
      pid: 7, controller: "c", ansible: "2.21.1", check: true, limit: null, extraVars: ["a", "b"],
    },
  })
})

test("a host.result keeps its message, and a null message stays null", () => {
  expect([
    decode(`{${ENVELOPE},"type":"host.result","task":"t","host":"h","outcome":"failed","changed":false,"message":"boom"}`),
    decode(`{${ENVELOPE},"type":"host.result","task":"t","host":"h","outcome":"ok","changed":true,"message":null}`),
  ]).toEqual([
    { kind: "event", event: { type: "host.result", ...HEAD, task: "t", host: "h", outcome: "failed", changed: false, message: "boom" } },
    { kind: "event", event: { type: "host.result", ...HEAD, task: "t", host: "h", outcome: "ok", changed: true, message: null } },
  ])
})

test("a playbook.end keeps each host's recap", () => {
  const recap: string = `{"ok":2,"changed":1,"failed":0,"unreachable":0,"skipped":3,"rescued":0,"ignored":1}`
  expect(decode(`{${ENVELOPE},"type":"playbook.end","outcome":"ok","hosts":{"web1":${recap}}}`)).toEqual({
    kind: "event",
    event: {
      type: "playbook.end", ...HEAD, outcome: "ok",
      hosts: { web1: { ok: 2, changed: 1, failed: 0, unreachable: 0, skipped: 3, rescued: 0, ignored: 1 } },
    },
  })
})

test("run.lost carries no seq, and one that has one still reads", () => {
  expect([
    decode(`{"v":1,"type":"run.lost","run":"r","at":"2026-09-28T14:40:00.000Z"}`),
    decode(`{"v":1,"type":"run.lost","run":"r","at":"2026-09-28T14:40:00.000Z","seq":6}`),
  ]).toEqual([
    { kind: "event", event: { type: "run.lost", run: "r", at: "2026-09-28T14:40:00.000Z" } },
    { kind: "event", event: { type: "run.lost", run: "r", at: "2026-09-28T14:40:00.000Z" } },
  ])
})

test("FR-16: a field added after v1 is ignored", () => {
  expect(decode(`{${ENVELOPE},"type":"run.end","outcome":"ok","duration":12}`)).toEqual({
    kind: "event", event: { type: "run.end", ...HEAD, outcome: "ok" },
  })
})

test("FR-16: an event type added after v1 is unknown, not malformed", () => {
  expect(decode(`{${ENVELOPE},"type":"host.retry","task":"t","host":"h"}`)).toEqual({ kind: "unknown" })
})

test("FR-15: a newer version is named, with its run when it names one", () => {
  expect([
    decode(`{"v":2,"run":"r","type":"run.start"}`),
    decode(`{"v":3,"id":"r"}`),
  ]).toEqual([
    { kind: "newer", v: 2, run: "r" },
    { kind: "newer", v: 3, run: null },
  ])
})

test.each([
  ["", "not JSON"],
  ["{\"v\":1,", "not JSON"],
  ["[1]", "not a JSON object"],
  ["null", "not a JSON object"],
  ["3", "not a JSON object"],
  ["\"v\"", "not a JSON object"],
  [`{"type":"run.end"}`, "v is not a version"],
  [`{"v":0,"type":"run.end"}`, "v is not a version"],
  [`{"v":1.5,"type":"run.end"}`, "v is not a version"],
  [`{"v":"2","type":"run.end"}`, "v is not a version"],
  [`{"v":1,"run":"r","seq":0,"at":"a"}`, "type is not a string"],
  [`{"v":1,"type":"run.end","seq":0,"at":"a","outcome":"ok"}`, "run is not a string"],
  [`{"v":1,"type":"run.lost","run":"r"}`, "at is not a string"],
  [`{"v":1,"run":"r","at":"a","type":"run.end","outcome":"ok"}`, "seq is not a count"],
  [`{"v":1,"run":"r","at":"a","seq":-1,"type":"run.end","outcome":"ok"}`, "seq is not a count"],
  [`{"v":1,"run":"r","at":"a","seq":0.5,"type":"run.end","outcome":"ok"}`, "seq is not a count"],
  [`{${ENVELOPE},"type":"run.end","outcome":"done"}`, "outcome is not one of ok, failed, interrupted"],
  [`{${ENVELOPE},"type":"playbook.end","outcome":"interrupted","hosts":{}}`, "outcome is not one of ok, failed"],
  [`{${ENVELOPE},"type":"host.result","task":"t","host":"h","outcome":"changed","changed":true,"message":null}`, "outcome is not one of ok, failed, ignored, skipped, unreachable"],
  [`{${ENVELOPE},"type":"host.result","task":"t","host":"h","outcome":"ok","changed":"yes","message":null}`, "changed is not a boolean"],
  [`{${ENVELOPE},"type":"host.result","task":"t","host":"h","outcome":"ok","changed":true}`, "message is not a string or null"],
  [`{${ENVELOPE},"type":"play.start","play":"p","name":"n","hosts":"web1"}`, "hosts is not a list of strings"],
  [`{${ENVELOPE},"type":"play.start","play":"p","name":"n","hosts":["web1",2]}`, "hosts is not a list of strings"],
  [`{${ENVELOPE},"type":"playbook.end","outcome":"ok","hosts":[]}`, "hosts is not a recap per host"],
  [`{${ENVELOPE},"type":"playbook.end","outcome":"ok","hosts":{"web1":3}}`, "hosts is not a recap per host"],
  [`{${ENVELOPE},"type":"playbook.end","outcome":"ok","hosts":{"web1":{"ok":1}}}`, "hosts is not a recap per host"],
  [`{${ENVELOPE},"type":"run.start","pid":7,"controller":"c","ansible":"2","check":false,"limit":3,"extra_vars":[]}`, "limit is not a string or null"],
])("%j is malformed: %s", (line: string, why: string) => {
  expect(decode(line)).toEqual({ kind: "malformed", why })
})

test("a contract near-miss the viewer would misread is malformed", () => {
  expect(lines("invalid/FR-4-outcome-changed.jsonl").map(decode).filter((line: Line) => line.kind === "malformed")).toEqual([
    { kind: "malformed", why: "outcome is not one of ok, failed, ignored, skipped, unreachable" },
  ])
})
