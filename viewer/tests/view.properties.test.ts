import * as hegel from "@hegeldev/hegel"
import type { TestCase } from "@hegeldev/hegel"
import * as gs from "@hegeldev/hegel/generators"
import { expect, test } from "vitest"
import type { Event } from "../plugin/core/event.ts"
import { glance } from "../plugin/core/glance.ts"
import { list } from "../plugin/core/rows.ts"
import type { Play, Run } from "../plugin/core/run.ts"
import { view, type View } from "../plugin/core/view.ts"
import { foldedAs, RUN, streamOf } from "./events.ts"
import { anyEvent, aPrefix, aRun } from "./generate.ts"
import * as oracle from "./oracle.ts"

const COLUMNS: gs.Generator<number> = gs.integers({ minValue: 1, maxValue: 120 })
/** Narrower than a generated play's host column and its tasks, so rows meet the pane's edge. */
const NARROW: gs.Generator<number> = gs.integers({ minValue: 1, maxValue: 9 })

function drawn(run: Run, columns: number): View {
  return view({ stream: streamOf(run), id: run.id, runs: [run.id], picked: false, directory: "/d", columns, trouble: null })
}

function aRunSoFar(tc: TestCase): Run {
  return foldedAs(RUN, aPrefix(tc, aRun(tc, RUN)))
}

test("every grid row fits a pane narrower than the play's tasks", () =>
  hegel.test((tc: TestCase) => {
    const run: Run = aRunSoFar(tc)
    const columns: number = tc.draw(NARROW)
    const most: number = oracle.widest(columns, oracle.hostColumns(glance(run).play?.hosts ?? []))
    expect(drawn(run, columns).grid.map(oracle.width).filter((wide: number) => wide > most)).toEqual([])
  }))

test("no task of the play goes missing: each host's row shows the newest that fit, and the totals count the rest", () =>
  hegel.test((tc: TestCase) => {
    const run: Run = aRunSoFar(tc)
    const play: Play | null = glance(run).play
    const hosts: readonly string[] = play?.hosts ?? []
    const counted: { readonly shown: readonly number[]; readonly hidden: number } = oracle.gridTasks(drawn(run, tc.draw(COLUMNS)), oracle.hostColumns(hosts))
    expect(counted.shown.map((cells: number) => cells + counted.hidden)).toEqual(hosts.map(() => list(play?.tasks ?? null).length))
  }))

test("any events at all draw at any width without throwing", () =>
  hegel.test((tc: TestCase) => {
    const events: readonly Event[] = tc.draw(gs.arrays(anyEvent, { maxSize: 30 }))
    expect(drawn(foldedAs(RUN, events), tc.draw(COLUMNS)).head.length).toBeGreaterThan(0)
  }))
