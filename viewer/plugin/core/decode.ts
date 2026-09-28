import { HOST_OUTCOMES, PLAYBOOK_OUTCOMES, RUN_OUTCOMES, type Event, type Recap } from "./event.ts"

/** What one line of the follower's stream says to a v1 reader. */
export type Line =
  | { readonly kind: "event"; readonly event: Event }
  /** FR-15: written by a recorder newer than this reader; `run` when the line still names one. */
  | { readonly kind: "newer"; readonly v: number; readonly run: string | null }
  /** FR-16: a v1 event type added after this reader; it changes nothing this reader shows. */
  | { readonly kind: "unknown" }
  | { readonly kind: "malformed"; readonly why: string }

type Json = Readonly<Record<string, unknown>>

/** A test of one field's value, and what the value must be, for saying why it failed. */
type Guard<T> = { readonly holds: (value: unknown) => value is T; readonly must: string }

type Shape = Readonly<Record<string, Guard<unknown>>>

type Shaped<S extends Shape> = { readonly [K in keyof S]: S[K] extends Guard<infer T> ? T : never }

const TEXT: Guard<string> = { holds: (value: unknown): value is string => typeof value === "string", must: "a string" }
const TEXT_OR_NULL: Guard<string | null> = {
  holds: (value: unknown): value is string | null => value === null || TEXT.holds(value),
  must: "a string or null",
}
const TEXTS: Guard<readonly string[]> = {
  holds: (value: unknown): value is readonly string[] => Array.isArray(value) && value.every(TEXT.holds),
  must: "a list of strings",
}
const FLAG: Guard<boolean> = { holds: (value: unknown): value is boolean => typeof value === "boolean", must: "a boolean" }
const COUNT: Guard<number> = {
  holds: (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0,
  must: "a count",
}
const RECAP: Shape = { ok: COUNT, changed: COUNT, failed: COUNT, unreachable: COUNT, skipped: COUNT, rescued: COUNT, ignored: COUNT }
const RECAPS: Guard<Readonly<Record<string, Recap>>> = {
  holds: (value: unknown): value is Readonly<Record<string, Recap>> =>
    isObject(value) && Object.values(value).every((line: unknown) => isObject(line) && unmet(line, RECAP) === null),
  must: "a recap per host",
}

function oneOf<T extends string>(allowed: readonly T[]): Guard<T> {
  return {
    holds: (value: unknown): value is T => allowed.some((option: T) => option === value),
    must: `one of ${allowed.join(", ")}`,
  }
}

const ENVELOPE = { type: TEXT, run: TEXT, at: TEXT } as const
const SEQ = { seq: COUNT } as const
const RUN_START = { ...SEQ, pid: COUNT, controller: TEXT, ansible: TEXT, check: FLAG, limit: TEXT_OR_NULL, extra_vars: TEXTS } as const
const PLAYBOOK_START = { ...SEQ, playbook: TEXT } as const
const PLAY_START = { ...SEQ, play: TEXT, name: TEXT, hosts: TEXTS } as const
const TASK_START = { ...SEQ, task: TEXT, name: TEXT, play: TEXT, handler: FLAG } as const
const HOST_START = { ...SEQ, task: TEXT, host: TEXT } as const
const HOST_RESULT = { ...SEQ, task: TEXT, host: TEXT, outcome: oneOf(HOST_OUTCOMES), changed: FLAG, message: TEXT_OR_NULL } as const
const PLAYBOOK_END = { ...SEQ, outcome: oneOf(PLAYBOOK_OUTCOMES), hosts: RECAPS } as const
const RUN_END = { ...SEQ, outcome: oneOf(RUN_OUTCOMES) } as const

/** Never throws: a line that is not a v1 event this reader knows says why. Fields it does not use are ignored (FR-16). */
export function decode(line: string): Line {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return { kind: "malformed", why: "not JSON" }
  }
  if (!isObject(parsed)) {
    return { kind: "malformed", why: "not a JSON object" }
  }
  const v: unknown = parsed.v
  if (COUNT.holds(v) && v > 1) {
    return { kind: "newer", v, run: TEXT.holds(parsed.run) ? parsed.run : null }
  }
  if (v !== 1) {
    return { kind: "malformed", why: "v is not a version" }
  }
  const envelope: Shaped<typeof ENVELOPE> | string = shaped(parsed, ENVELOPE)
  return typeof envelope === "string" ? { kind: "malformed", why: envelope } : read(parsed, envelope)
}

function read(o: Json, { type, run, at }: Shaped<typeof ENVELOPE>): Line {
  switch (type) {
    case "run.lost":
      return { kind: "event", event: { type, run, at } }
    case "run.start":
      return then(shaped(o, RUN_START), (f) => ({
        type, run, at, pid: f.pid, controller: f.controller, ansible: f.ansible, check: f.check, limit: f.limit, extraVars: f.extra_vars,
      }))
    case "playbook.start":
      return then(shaped(o, PLAYBOOK_START), (f) => ({ type, run, at, playbook: f.playbook }))
    case "play.start":
      return then(shaped(o, PLAY_START), (f) => ({ type, run, at, play: f.play, name: f.name, hosts: f.hosts }))
    case "task.start":
      return then(shaped(o, TASK_START), (f) => ({
        type, run, at, task: f.task, name: f.name, play: f.play, handler: f.handler,
      }))
    case "host.start":
      return then(shaped(o, HOST_START), (f) => ({ type, run, at, task: f.task, host: f.host }))
    case "host.result":
      return then(shaped(o, HOST_RESULT), (f) => ({
        type, run, at, task: f.task, host: f.host, outcome: f.outcome, changed: f.changed, message: f.message,
      }))
    case "playbook.end":
      return then(shaped(o, PLAYBOOK_END), (f) => ({ type, run, at, outcome: f.outcome, hosts: f.hosts }))
    case "run.end":
      return then(shaped(o, RUN_END), (f) => ({ type, run, at, outcome: f.outcome }))
    default:
      return { kind: "unknown" }
  }
}

function then<S extends Shape>(fields: Shaped<S> | string, build: (fields: Shaped<S>) => Event): Line {
  return typeof fields === "string" ? { kind: "malformed", why: fields } : { kind: "event", event: build(fields) }
}

/** `o`'s fields as `shape` types them, or why the first that does not fit fails. */
function shaped<S extends Shape>(o: Json, shape: S): Shaped<S> | string {
  return unmet(o, shape) ?? (o as Shaped<S>)
}

function unmet(o: Json, shape: Shape): string | null {
  for (const [key, guard] of Object.entries(shape)) {
    if (!guard.holds(o[key])) {
      return `${key} is not ${guard.must}`
    }
  }
  return null
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
