/** A child's output cut into pieces anywhere, as a pipe delivers it, and those pieces put back into lines. */
import type { TestCase } from "@hegeldev/hegel"
import * as gs from "@hegeldev/hegel/generators"
import { split, type Split } from "../plugin/core/lines.ts"

/** No lines yet, nothing held. */
export const NOTHING: Split = { lines: [], held: "" }

/** `output` cut at drawn places into non-empty pieces. */
export function cut(tc: TestCase, output: string): readonly string[] {
  const at: readonly number[] = [...new Set(tc.draw(gs.arrays(gs.integers({ minValue: 1, maxValue: Math.max(1, output.length - 1) }), { maxSize: 4 })))]
    .filter((place: number) => place < output.length)
    .sort((a: number, b: number) => a - b)
  return [0, ...at].map((from: number, i: number) => output.slice(from, at[i] ?? output.length)).filter((piece: string) => piece !== "")
}

/** Every line the pieces complete, and what is held after the last. */
export function pieced(pieces: readonly string[]): Split {
  return pieces.reduce((sofar: Split, piece: string): Split => {
    const next: Split = split(sofar.held, piece)
    return { lines: [...sofar.lines, ...next.lines], held: next.held }
  }, NOTHING)
}
