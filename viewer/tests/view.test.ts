import { expect, test } from "vitest"
import type { Event } from "../plugin/core/event.ts"
import type { Run } from "../plugin/core/run.ts"
import { EMPTY } from "../plugin/core/stream.ts"
import { view, type Line, type Shown, type Span, type View } from "../plugin/core/view.ts"
import { AT, folded, hostStart, lost, play, playbook, playbookEnd, result, RUN, runEnd, runStart, streamOf, task } from "./events.ts"

const DIRECTORY: string = "/home/op/.local/state/ansible-live"
const WEB: readonly Event[] = [runStart, playbook("/srv/site.yml"), play("p-1", ["web1", "web2"])]
const ID: Span = { text: ` ${RUN}`, tone: "dim" }
const FEDORA: Span = { text: " · fedora", tone: "dim" }
const RUNNING: Span = { text: "● running", tone: "running" }
const LIVE: Line = [{ text: "run 1 of 1", tone: "dim" }, { text: " · live", tone: "running" }]
const LEGEND: Line = [
  { text: "✓ ok ", tone: "ok" },
  { text: "✓ changed ", tone: "changed" },
  { text: "✗ failed ", tone: "failed" },
  { text: "✗ ignored ", tone: "ignored" },
  { text: "! unreachable ", tone: "unreachable" },
  { text: "- skipped ", tone: "skipped" },
  { text: "● running ", tone: "running" },
  { text: "· not run", tone: "dim" },
]
const QUIET: View = { head: [], where: null, now: null, grid: [], legend: null, totals: null, failure: [], notes: [], place: null }

function shown(run: Run, columns: number = 60): Shown {
  return { stream: streamOf(run), id: run.id, runs: [run.id], picked: false, directory: DIRECTORY, columns, trouble: null }
}

function text(line: Line | null): string | null {
  return line === null ? null : line.map((span: Span) => span.text).join("")
}

test("no run at all: say so, where logs are read from, and how to record one", () => {
  expect(view({ stream: EMPTY, id: null, runs: [], picked: false, directory: DIRECTORY, columns: 60, trouble: null })).toEqual({
    ...QUIET,
    head: [{ text: "No runs yet", tone: "bold" }],
    notes: [
      [{ text: `Logs are read from ${DIRECTORY}.`, tone: "dim" }],
      [{ text: "Record a run: callbacks_enabled = igouss.ansible_live.live in ansible.cfg.", tone: "dim" }],
    ],
  })
})

test("a run picked but not read yet says it is being read", () => {
  expect(view({ stream: EMPTY, id: RUN, runs: [RUN], picked: true, directory: DIRECTORY, columns: 60, trouble: null })).toEqual({
    ...QUIET,
    head: [{ text: `Reading ${RUN}…`, tone: "dim" }],
    place: [{ text: "run 1 of 1", tone: "dim" }],
  })
})

test("a run before its first playbook shows its state and controller, and nothing else", () => {
  expect(view(shown(folded(runStart)))).toEqual({ ...QUIET, head: [RUNNING, ID, FEDORA], place: LIVE })
})

test("a run whose run.start was never read shows its state and id alone", () => {
  expect(view(shown(folded(playbook("/p.yml")))).head).toEqual([RUNNING, ID])
})

test("check mode and a limit are named in the head", () => {
  expect(view(shown(folded({ ...runStart, check: true, limit: "web*" } as Event))).head).toEqual([
    RUNNING, ID, FEDORA, { text: " · check mode", tone: "notice" }, { text: " · limit web*", tone: "dim" },
  ])
})

test("a playbook with no play yet: its name alone, and no grid", () => {
  expect(view(shown(folded(runStart, playbook("/srv/site.yml"))))).toEqual({
    ...QUIET, head: [RUNNING, ID, FEDORA], where: [{ text: "site.yml", tone: "bold" }], place: LIVE,
  })
})

test("one task in progress: where it is, what runs, and each host's cell", () => {
  expect(view(shown(folded(...WEB, task("t-1", "p-1"), hostStart("t-1", "web1"))))).toEqual({
    ...QUIET,
    head: [RUNNING, ID, FEDORA],
    where: [{ text: "site.yml", tone: "bold" }, { text: " › play p-1", tone: "plain" }],
    now: [{ text: "▸ ", tone: "running" }, { text: "task t-1", tone: "bold" }],
    grid: [
      [{ text: "web1 ", tone: "plain" }, { text: "●", tone: "running" }],
      [{ text: "web2 ", tone: "plain" }, { text: "·", tone: "dim" }],
    ],
    legend: LEGEND,
    place: LIVE,
  })
})

test("a handler is named as one", () => {
  expect(text(view(shown(folded(...WEB, task("h-1", "p-1", true)))).now)).toBe("▸ task h-1 (handler)")
})

test("many tasks: each outcome its own cell and color, newest last, and the results summed as Ansible's recap does", () => {
  const done: View = view(shown(folded(
    ...WEB,
    task("t-1", "p-1"), result("t-1", "web1", "ok"), result("t-1", "web2", "ok", true),
    task("t-2", "p-1"), result("t-2", "web1", "skipped"), result("t-2", "web2", "ignored"),
    task("t-3", "p-1"), result("t-3", "web1", "failed"), result("t-3", "web2", "unreachable"),
  )))
  const dot: Span = { text: " · ", tone: "dim" }
  expect([done.grid, done.totals]).toEqual([
    [
      [{ text: "web1 ", tone: "plain" }, { text: "✓", tone: "ok" }, { text: "-", tone: "skipped" }, { text: "✗", tone: "failed" }],
      [{ text: "web2 ", tone: "plain" }, { text: "✓", tone: "changed" }, { text: "✗", tone: "ignored" }, { text: "!", tone: "unreachable" }],
    ],
    [
      { text: "2 ok", tone: "ok" }, dot, { text: "1 changed", tone: "changed" }, dot, { text: "1 failed", tone: "failed" }, dot,
      { text: "1 unreachable", tone: "unreachable" }, dot, { text: "1 skipped", tone: "skipped" }, dot, { text: "1 ignored", tone: "ignored" },
    ],
  ])
})

test("a result that failed after changing something is shown failed", () => {
  expect(view(shown(folded(...WEB, task("t-1", "p-1"), result("t-1", "web1", "failed", true)))).grid[0]).toEqual([
    { text: "web1 ", tone: "plain" }, { text: "✗", tone: "failed" },
  ])
})

test("neighbouring cells of one outcome are drawn as one span, wherever in the row", () => {
  const same: View = view(shown(folded(
    ...WEB,
    task("t-1", "p-1"), result("t-1", "web1", "ok"),
    task("t-2", "p-1"), result("t-2", "web1", "skipped"),
    task("t-3", "p-1"), result("t-3", "web1", "skipped"),
  )))
  expect(same.grid[0]).toEqual([{ text: "web1 ", tone: "plain" }, { text: "✓", tone: "ok" }, { text: "--", tone: "skipped" }])
})

test("a narrow pane shows the newest tasks that fit and counts the rest", () => {
  const narrow: View = view(shown(folded(...WEB, task("t-1", "p-1"), task("t-2", "p-1"), task("t-3", "p-1"), result("t-3", "web1", "ok")), 7))
  expect([narrow.grid.map(text), narrow.totals]).toEqual([
    ["web1 ·✓", "web2 ··"],
    [{ text: "1 ok", tone: "ok" }, { text: " · ", tone: "dim" }, { text: "1 earlier task not shown", tone: "dim" }],
  ])
})

test("two tasks not shown are counted as tasks", () => {
  expect(text(view(shown(folded(...WEB, task("t-1", "p-1"), task("t-2", "p-1"), task("t-3", "p-1")), 6)).totals)).toBe("2 earlier tasks not shown")
})

test("long host names are cut so the cells keep their columns", () => {
  const long: View = view(shown(folded(runStart, playbook("/p.yml"), play("p-1", ["a-very-long-host-name.example", "b"]), task("t-1", "p-1"))))
  expect(long.grid.map(text)).toEqual(["a-very-long-host ·", "b                ·"])
})

test("the failure names its host and task, then at most eight lines of its message", () => {
  const message: string = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].join("\n")
  expect(view(shown(folded(...WEB, task("t-1", "p-1"), result("t-1", "web2", "failed", false, message)))).failure).toEqual([
    [{ text: "✗ web2", tone: "failed" }, { text: " · task t-1", tone: "bold" }],
    ...["1", "2", "3", "4", "5", "6", "7", "8"].map((line: string): Line => [{ text: `  ${line}`, tone: "plain" }]),
    [{ text: "  … 2 more lines", tone: "dim" }],
  ])
})

test("a message of exactly eight lines is shown whole", () => {
  const message: string = ["1", "2", "3", "4", "5", "6", "7", "8"].join("\n")
  expect(view(shown(folded(...WEB, task("t-1", "p-1"), result("t-1", "web2", "failed", false, message)))).failure.length).toBe(9)
})

test("an unreachable host without a message, from a task never started, is named alone", () => {
  expect(view(shown(folded(...WEB, result("t-9", "web1", "unreachable")))).failure).toEqual([[{ text: "✗ web1", tone: "unreachable" }]])
})

test("a run's end or loss heads it", () => {
  const ran: readonly Event[] = [...WEB, task("t-1", "p-1")]
  expect([
    view(shown(folded(...ran, playbookEnd("ok"), runEnd("ok")))).head[0],
    view(shown(folded(...ran, playbookEnd("failed"), runEnd("failed")))).head[0],
    view(shown(folded(...ran, runEnd("interrupted")))).head[0],
    view(shown(folded(...ran, lost(AT)))).head[0],
  ]).toEqual([
    { text: "✓ ok", tone: "ok" },
    { text: "✗ failed", tone: "failed" },
    { text: "■ interrupted", tone: "changed" },
    { text: "? lost: its process is gone and its log has no end", tone: "unreachable" },
  ])
})

test("FR-15: a run a newer recorder wrote names the version", () => {
  expect(view(shown({ ...folded(runStart), newer: 2 })).notes).toEqual([
    [{ text: "A newer recorder (v2) wrote this run; update ansible-live to read it.", tone: "notice" }],
  ])
})

test("the stream's trouble, newer lines without a run, and unreadable lines are noted, in that order", () => {
  expect(view({
    ...shown(folded(runStart)),
    stream: { ...streamOf(folded(runStart)), newer: [3], malformed: { lines: 2, latest: "not JSON" } },
    trouble: "The follower stopped (exit 1): boom",
  }).notes).toEqual([
    [{ text: "The follower stopped (exit 1): boom", tone: "failed" }],
    [{ text: "A newer recorder (v3) wrote a line that names no run; update ansible-live to read it.", tone: "notice" }],
    [{ text: "2 unreadable lines; the latest: not JSON", tone: "notice" }],
  ])
})

test("one unreadable line is one line", () => {
  expect(text(view({ ...shown(folded(runStart)), stream: { ...streamOf(folded(runStart)), malformed: { lines: 1, latest: "v is not a version" } } }).notes[0] ?? null)).toBe(
    "1 unreadable line; the latest: v is not a version",
  )
})

test("where the run sits among the runs, and whether the pane follows the live one", () => {
  const run: Run = folded(runStart)
  expect([view({ ...shown(run), runs: ["a", RUN, "z"] }).place, view({ ...shown(run), runs: ["a", RUN, "z"], picked: true }).place]).toEqual([
    [{ text: "run 2 of 3", tone: "dim" }, { text: " · live", tone: "running" }],
    [{ text: "run 2 of 3", tone: "dim" }],
  ])
})
