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
  return followAll(stream, [line])
}

/** The stream after `lines`, as `follow` would have it line by line, with one copy of the runs for all of them. */
export function followAll(stream: Stream, lines: readonly Line[]): Stream {
  const runs: Map<string, Run> = new Map(stream.runs)
  return lines.reduce((now: Stream, line: Line) => take(now, runs, line), { ...stream, runs })
}

/** `now` after `line`; the runs it changes are changed in `runs`, which `now` holds and nothing else sees yet. */
function take(now: Stream, runs: Map<string, Run>, line: Line): Stream {
  switch (line.kind) {
    case "event":
      runs.set(line.event.run, fold(runs.get(line.event.run) ?? begin(line.event.run), line.event))
      return now
    case "newer":
      if (line.run === null) {
        return { ...now, newer: now.newer.includes(line.v) ? now.newer : [...now.newer, line.v] }
      }
      runs.set(line.run, { ...(runs.get(line.run) ?? begin(line.run)), newer: line.v })
      return now
    case "unknown":
      return now
    case "malformed":
      return { ...now, malformed: { lines: now.malformed.lines + 1, latest: line.why } }
  }
}
