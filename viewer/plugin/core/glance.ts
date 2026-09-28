import type { Play, Playbook, Run, Task } from "./run.ts"

/** Where a run is now: its latest playbook and play, and the task in progress while there is one. */
export type Glance = {
  readonly playbook: Playbook | null
  readonly play: Play | null
  readonly task: Task | null
}

export function glance(run: Run): Glance {
  const playbook: Playbook | null = run.playbooks.at(-1) ?? null
  const play: Play | null = playbook?.plays.at(-1) ?? null
  const going: boolean = run.status.state === "running" && playbook?.end === null
  return { playbook, play, task: going ? play?.tasks?.first ?? null : null }
}
