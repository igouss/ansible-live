/** A v1 event (contract/SPEC.md) as the viewer reads it: the fields it shows, named the TypeScript way. */

export const HOST_OUTCOMES = ["ok", "failed", "ignored", "skipped", "unreachable"] as const
export const PLAYBOOK_OUTCOMES = ["ok", "failed"] as const
export const RUN_OUTCOMES = ["ok", "failed", "interrupted"] as const

export type HostOutcome = (typeof HOST_OUTCOMES)[number]
export type PlaybookOutcome = (typeof PLAYBOOK_OUTCOMES)[number]
export type RunOutcome = (typeof RUN_OUTCOMES)[number]

/** One host's line of a playbook's recap, as Ansible counts it. */
export type Recap = {
  readonly ok: number
  readonly changed: number
  readonly failed: number
  readonly unreachable: number
  readonly skipped: number
  readonly rescued: number
  readonly ignored: number
}

type Of<T extends string, F> = { readonly type: T; readonly run: string; readonly at: string } & F

export type RunStart = Of<"run.start", {
  readonly pid: number
  readonly controller: string
  readonly ansible: string
  readonly check: boolean
  readonly limit: string | null
  readonly extraVars: readonly string[]
}>
export type PlaybookStart = Of<"playbook.start", { readonly playbook: string }>
export type PlayStart = Of<"play.start", { readonly play: string; readonly name: string; readonly hosts: readonly string[] }>
export type TaskStart = Of<"task.start", {
  readonly task: string
  readonly name: string
  readonly play: string
  readonly handler: boolean
}>
export type HostStart = Of<"host.start", { readonly task: string; readonly host: string }>
export type HostResult = Of<"host.result", {
  readonly task: string
  readonly host: string
  readonly outcome: HostOutcome
  readonly changed: boolean
  readonly message: string | null
}>
export type PlaybookEnd = Of<"playbook.end", {
  readonly outcome: PlaybookOutcome
  readonly hosts: Readonly<Record<string, Recap>>
}>
export type RunEnd = Of<"run.end", { readonly outcome: RunOutcome }>
/** Written by the follower, never by a recorder (FR-14). */
export type RunLost = Of<"run.lost", object>

export type Event =
  | RunStart
  | PlaybookStart
  | PlayStart
  | TaskStart
  | HostStart
  | HostResult
  | PlaybookEnd
  | RunEnd
  | RunLost
