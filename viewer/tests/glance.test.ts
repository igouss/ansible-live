import { expect, test } from "vitest"
import { glance, type Glance } from "../plugin/core/glance.ts"
import { folded, lost, play, playbook, playbookEnd, runEnd, runStart, task } from "./events.ts"

function names(now: Glance): readonly (string | null)[] {
  return [now.playbook?.path ?? null, now.play?.name ?? null, now.task?.name ?? null]
}

test("before a playbook starts there is nothing to show", () => {
  expect(names(glance(folded(runStart)))).toEqual([null, null, null])
})

test("a playbook with no play yet has neither a play nor a task in progress", () => {
  expect(names(glance(folded(runStart, playbook("/p.yml"))))).toEqual(["/p.yml", null, null])
})

test("a play with no task yet has none in progress", () => {
  expect(names(glance(folded(runStart, playbook("/p.yml"), play("p-1", ["a"]))))).toEqual(["/p.yml", "play p-1", null])
})

test("the task in progress is the latest one started", () => {
  expect(names(glance(folded(runStart, playbook("/p.yml"), play("p-1", ["a"]), task("t-1", "p-1"), task("t-2", "p-1"), task("t-3", "p-1"))))).toEqual(
    ["/p.yml", "play p-1", "task t-3"],
  )
})

test("the latest playbook and play show; no task is in progress once the playbook, or the run, is over", () => {
  const started = [runStart, playbook("/a.yml"), play("p-1", ["a"]), playbookEnd("ok"), playbook("/b.yml"), play("p-2", ["a"]), task("t-1", "p-2")] as const
  expect([
    names(glance(folded(...started, playbookEnd("ok")))),
    names(glance(folded(...started, runEnd("interrupted")))),
    names(glance(folded(...started, lost("2026-09-28T14:40:00.000Z")))),
  ]).toEqual([
    ["/b.yml", "play p-2", null],
    ["/b.yml", "play p-2", null],
    ["/b.yml", "play p-2", null],
  ])
})
