import type { Run } from "./run.ts"
import type { Stream } from "./stream.ts"

/** Every run the operator can pick, oldest first: those the stream has shown and those logged. Run ids sort by start (FR-2). */
export function runs(stream: Stream, logged: readonly string[]): readonly string[] {
  return [...new Set([...stream.runs.keys(), ...logged])].sort()
}

/** The run the pane shows when the operator picked none: the newest still running, else the newest. */
export function live(stream: Stream, all: readonly string[]): string | null {
  const running: readonly string[] = [...stream.runs.values()].filter((run: Run) => run.status.state === "running").map((run: Run) => run.id).sort()
  return running.at(-1) ?? all.at(-1) ?? null
}

/** The run `by` places older (-1) or newer (1) than `id` among `all`; `id` itself at either end. */
export function beside(all: readonly string[], id: string, by: -1 | 1): string {
  const at: number = all.indexOf(id)
  return all[at + by] ?? id
}
