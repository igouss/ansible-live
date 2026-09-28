import type { Line } from "./decode.ts"
import { begin, fold, type Run } from "./run.ts"

/** What the follower's stream has shown so far: its runs, each in the order it first appeared. */
export type Stream = {
  readonly runs: ReadonlyMap<string, Run>
  /** FR-15: versions of lines too new to name their run. */
  readonly newer: readonly number[]
  readonly malformed: { readonly lines: number; readonly latest: string | null }
}

export const EMPTY: Stream = { runs: new Map(), newer: [], malformed: { lines: 0, latest: null } }

/** The stream after one more line; runs interleave, and each folds only its own events. */
export function follow(stream: Stream, line: Line): Stream {
  switch (line.kind) {
    case "event":
      return withRun(stream, line.event.run, (run: Run) => fold(run, line.event))
    case "newer":
      return line.run === null
        ? { ...stream, newer: stream.newer.includes(line.v) ? stream.newer : [...stream.newer, line.v] }
        : withRun(stream, line.run, (run: Run) => ({ ...run, newer: line.v }))
    case "unknown":
      return stream
    case "malformed":
      return { ...stream, malformed: { lines: stream.malformed.lines + 1, latest: line.why } }
  }
}

function withRun(stream: Stream, id: string, change: (run: Run) => Run): Stream {
  return { ...stream, runs: new Map(stream.runs).set(id, change(stream.runs.get(id) ?? begin(id))) }
}
