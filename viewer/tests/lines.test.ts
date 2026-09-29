import * as hegel from "@hegeldev/hegel"
import type { TestCase } from "@hegeldev/hegel"
import * as gs from "@hegeldev/hegel/generators"
import { expect, test } from "vitest"
import { split } from "../plugin/core/lines.ts"
import { cut, NOTHING, pieced } from "./pieces.ts"

test("nothing yet: no lines, nothing held", () => {
  expect(split("", "")).toEqual(NOTHING)
})

test("one piece of one line", () => {
  expect(split("", "a\n")).toEqual({ lines: ["a"], held: "" })
})

test("a line without its newline is held, then finished by the next piece, which may bring many", () => {
  expect([split("", "a\nb"), split("b", "c\n\nd")]).toEqual([{ lines: ["a"], held: "b" }, { lines: ["bc", ""], held: "d" }])
})

test("however the output is cut into pieces, its lines come out whole, in order", () =>
  hegel.test((tc: TestCase) => {
    const lines: readonly string[] = tc.draw(gs.arrays(gs.text({ maxSize: 6 }).filter((line: string) => !line.includes("\n")), { maxSize: 5 }))
    const output: string = lines.map((line: string) => `${line}\n`).join("")
    expect(pieced(cut(tc, output))).toEqual({ lines, held: "" })
  }))
