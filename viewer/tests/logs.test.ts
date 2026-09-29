import { expect, test } from "vitest"
import { directory, logged } from "../plugin/core/logs.ts"

test("FR-1: the configured directory wins", () => {
  expect(directory("/srv/live", "/s", "/h")).toBe("/srv/live")
})

test("FR-1: under the XDG state home", () => {
  expect(directory("", "/s", "/h")).toBe("/s/ansible-live")
})

test("FR-1: under the home without an XDG state home, or with an empty one", () => {
  expect([directory("", undefined, "/h"), directory("", "", "/h")]).toEqual(["/h/.local/state/ansible-live", "/h/.local/state/ansible-live"])
})

test("no names, no runs", () => {
  expect(logged([])).toEqual([])
})

test("one log is one run", () => {
  expect(logged(["20260928T142821Z-4242.jsonl"])).toEqual(["20260928T142821Z-4242"])
})

test("many logs are their runs oldest first, and what is not a log is no run", () => {
  expect(logged(["20260928T150000Z-2.jsonl", "notes.txt", "20260928T142821Z-4242.jsonl", "x.jsonl.swp"])).toEqual([
    "20260928T142821Z-4242",
    "20260928T150000Z-2",
  ])
})
