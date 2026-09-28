import { expect, test } from "vitest"
import { changed, find, list, push, type Rows } from "../plugin/core/rows.ts"

const three: Rows<string> = push(push(push(null, "a1"), "b"), "a2")
const upper = (item: string): string => item.toUpperCase()
const isA = (item: string): boolean => item.startsWith("a")

test("zero, one and many rows list oldest first", () => {
  expect([list(null), list(push(null, "a")), list(three)]).toEqual([[], ["a"], ["a1", "b", "a2"]])
})

test("find answers the newest match, or null", () => {
  expect([find(three, isA), find(three, (item: string) => item === "b"), find(three, (item: string) => item === "z"), find(null, isA)]).toEqual(["a2", "b", null, null])
})

test("changed changes only the newest match and keeps the order", () => {
  expect([list(changed(three, isA, upper)), list(changed(three, (item: string) => item === "a1", upper))]).toEqual([["a1", "b", "A2"], ["A1", "b", "a2"]])
})

test("changed shares every row older than the match", () => {
  expect(changed(three, (item: string) => item === "b", upper)?.rest?.rest).toBe(three?.rest?.rest)
})

test("changed returns the very same rows when nothing matches", () => {
  expect(changed(three, (item: string) => item === "z", upper)).toBe(three)
})
