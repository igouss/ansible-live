import { expect, test } from "vitest"
import { beside, live, runs } from "../plugin/core/choice.ts"
import { begin, type Run } from "../plugin/core/run.ts"
import { EMPTY } from "../plugin/core/stream.ts"
import { streamOf } from "./events.ts"

const OLD: string = "20260928T100000Z-1"
const MID: string = "20260928T110000Z-2"
const NEW: string = "20260928T120000Z-3"

function ended(id: string): Run {
  return { ...begin(id), status: { state: "ended", outcome: "ok", at: "t" } }
}

test("no runs: nothing to pick and nothing live", () => {
  expect([runs(EMPTY, []), live(EMPTY, [])]).toEqual([[], null])
})

test("the runs to pick are those streamed and those logged, once each, oldest first", () => {
  expect(runs(streamOf(begin(NEW), ended(OLD)), [MID, OLD])).toEqual([OLD, MID, NEW])
})

test("live is the newest running run, though a newer one ended", () => {
  expect(live(streamOf(begin(OLD), begin(MID), ended(NEW)), [OLD, MID, NEW])).toBe(MID)
})

test("live is the newest of many running, whatever order the stream showed them in", () => {
  expect(live(streamOf(begin(NEW), begin(OLD), begin(MID)), [OLD, MID, NEW])).toBe(NEW)
})

test("with nothing running, live is the newest run", () => {
  expect(live(streamOf(ended(OLD)), [OLD, MID])).toBe(MID)
})

test("a lost run is not running: live passes over it to the newest", () => {
  expect(live(streamOf({ ...begin(MID), status: { state: "lost", at: "t" } }), [OLD, MID, NEW])).toBe(NEW)
})

test("beside a run: the one older, the one newer, and itself at either end", () => {
  expect([beside([OLD, MID, NEW], MID, -1), beside([OLD, MID, NEW], MID, 1), beside([OLD, MID, NEW], OLD, -1), beside([OLD, MID, NEW], NEW, 1)]).toEqual([OLD, NEW, OLD, NEW])
})
