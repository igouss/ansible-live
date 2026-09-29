import { expect, test } from "vitest"
import type { Shown } from "../plugin/core/view.ts"
import { Watch } from "../plugin/shell/watch.ts"
import { err, Host, out, RUNS, settled, type Script } from "./fakes.ts"
import { runStart } from "./events.ts"
import { lines } from "./examples.ts"
import { spelled } from "./generate.ts"

const FOLLOWER: readonly string[] = ["python3", "-m", "follower"]
const DIRECTORY: string = "/logs"
const A: string = "20260928T142821Z-4242"
const B: string = "20260928T150000Z-7"
const CLEAN: string = lines("valid/clean.jsonl").map((line: string) => `${line}\n`).join("")
const STARTED_B: string = `${JSON.stringify(spelled({ ...runStart, run: B }, 0))}\n`

async function watching(host: Host): Promise<Watch> {
  const watch: Watch = new Watch(host.ports, FOLLOWER, DIRECTORY)
  watch.start()
  await settled()
  return watch
}

function scripts(...each: readonly (readonly [string, Script])[]): ReadonlyMap<string, Script> {
  return new Map(each)
}

test("starting runs one follower of the directory and lists its logs", async () => {
  const host: Host = new Host(scripts(), [`${A}.jsonl`, "notes.txt"])
  const shown: Shown = (await watching(host)).shown(40)
  expect([host.spawned, shown.id, shown.runs, shown.picked, shown.columns, shown.trouble]).toEqual([
    [[...FOLLOWER, DIRECTORY]], A, [A], false, 40, null,
  ])
})

test("a directory that cannot be listed holds no runs", async () => {
  expect((await watching(new Host(scripts(), new Error("ENOENT")))).shown(40).runs).toEqual([])
})

test("lines cut anywhere across pieces fold into the run; only a piece that completes a line redraws; standard error folds nothing", async () => {
  const host: Host = new Host(scripts([DIRECTORY, { pieces: [out(CLEAN.slice(0, 50)), err("warn"), out(CLEAN.slice(50))], exit: "runs" }]))
  const shown: Shown = (await watching(host)).shown(40)
  expect([shown.stream.runs.get(A)?.status, shown.stream.malformed.lines, host.redraws]).toEqual([
    { state: "ended", outcome: "ok", at: "2026-09-28T14:28:22.900Z" }, 0, 1,
  ])
})

test("a watch stopped while it listed the runs picks none and starts nothing; stopping again is harmless", async () => {
  const host: Host = new Host(scripts(), [`${A}.jsonl`, `${B}.jsonl`])
  const watch: Watch = await watching(host)
  const moving: Promise<void> = watch.move(-1)
  watch.stop()
  await moving
  watch.stop()
  expect([host.spawned, watch.shown(40).picked, host.killed]).toEqual([[[...FOLLOWER, DIRECTORY]], false, [[...FOLLOWER, DIRECTORY]]])
})

test("the runs are known once listed, none before", async () => {
  const host: Host = new Host(scripts(), [`${A}.jsonl`])
  const watch: Watch = new Watch(host.ports, FOLLOWER, DIRECTORY)
  watch.start()
  const before: readonly string[] = watch.shown(40).runs
  await settled()
  expect([before, watch.shown(40).runs]).toEqual([[], [A]])
})

test("the live follower ending is trouble even when it exits 0, and the pane is redrawn to say so", async () => {
  const host: Host = new Host(scripts([DIRECTORY, { pieces: [], exit: { code: 0, signal: null } }]))
  expect([(await watching(host)).shown(40).trouble, host.redraws]).toEqual(["The follower stopped (exit 0): ", 1])
})

test("of what a follower said on standard error, trouble keeps the last 400 characters", async () => {
  const host: Host = new Host(scripts([DIRECTORY, { pieces: [err("x".repeat(500)), err("y".repeat(399))], exit: { code: 1, signal: null } }]))
  expect((await watching(host)).shown(40).trouble).toBe(`The follower stopped (exit 1): x${"y".repeat(399)}`)
})

test("a follower that fails to start after the pane closed is no trouble", async () => {
  const host: Host = new Host(scripts([DIRECTORY, { pieces: [], exit: new Error("ENOENT") }]))
  const watch: Watch = new Watch(host.ports, FOLLOWER, DIRECTORY)
  watch.start()
  watch.stop()
  await settled()
  expect([watch.shown(40).trouble, host.redraws]).toEqual([null, 0])
})

test("the live follower ending is trouble, naming its exit and what it said", async () => {
  const host: Host = new Host(scripts([DIRECTORY, { pieces: [err("Traceback\nboom\n")], exit: { code: 1, signal: null } }]))
  expect((await watching(host)).shown(40).trouble).toBe("The follower stopped (exit 1): Traceback\nboom")
})

test("a follower that cannot start is trouble", async () => {
  const host: Host = new Host(scripts([DIRECTORY, { pieces: [], exit: new Error("ENOENT: python3") }]))
  expect((await watching(host)).shown(40).trouble).toBe("The follower did not start (python3 -m follower /logs): Error: ENOENT: python3")
})

test("stopping kills the follower, and its ending then is no trouble", async () => {
  const host: Host = new Host(scripts())
  const watch: Watch = await watching(host)
  watch.stop()
  await settled()
  expect([host.killed, watch.shown(40).trouble]).toEqual([[[...FOLLOWER, DIRECTORY]], null])
})

test("moving to a run the stream lacks starts the follower again, asked for it, on a fresh stream; the first one's ending is no trouble", async () => {
  const host: Host = new Host(
    scripts([DIRECTORY, { pieces: [out(STARTED_B)], exit: "runs" }], [A, { pieces: [out(CLEAN), out(STARTED_B)], exit: "runs" }]),
    [`${A}.jsonl`, `${B}.jsonl`],
  )
  const watch: Watch = await watching(host)
  await watch.move(-1)
  await settled()
  const shown: Shown = watch.shown(40)
  expect([host.spawned, host.killed, shown.id, shown.picked, [...shown.stream.runs.keys()], shown.trouble]).toEqual([
    [[...FOLLOWER, DIRECTORY], [...FOLLOWER, DIRECTORY, A]], [[...FOLLOWER, DIRECTORY]], A, true, [A, B], null,
  ])
})

test("what a follower let go gives is not folded", async () => {
  const host: Host = new Host(scripts([DIRECTORY, { pieces: [out(STARTED_B), out(CLEAN)], exit: "runs" }], [A, RUNS]), [`${A}.jsonl`, `${B}.jsonl`])
  const watch: Watch = new Watch(host.ports, FOLLOWER, DIRECTORY)
  watch.start()
  await watch.move(-1)
  await settled()
  expect([...watch.shown(40).stream.runs.keys()]).toEqual([])
})

test("a run already asked for is not asked again; each pick redraws", async () => {
  const host: Host = new Host(scripts([DIRECTORY, { pieces: [out(STARTED_B)], exit: "runs" }], [A, RUNS]), [`${A}.jsonl`, `${B}.jsonl`])
  const watch: Watch = await watching(host)
  const before: number = host.redraws
  await watch.move(-1)
  await watch.move(1)
  await watch.move(-1)
  expect([host.spawned, host.redraws - before]).toEqual([
    [[...FOLLOWER, DIRECTORY], [...FOLLOWER, DIRECTORY, A], [...FOLLOWER, DIRECTORY, A, B]], 3,
  ])
})

test("the follower started again failing is trouble", async () => {
  const host: Host = new Host(scripts([A, { pieces: [], exit: { code: 2, signal: null } }]), [`${A}.jsonl`, `${B}.jsonl`])
  const watch: Watch = await watching(host)
  await watch.move(-1)
  await settled()
  expect(watch.shown(40).trouble).toBe("The follower stopped (exit 2): ")
})

test("moving past either end stays there; following goes back to the live run", async () => {
  const host: Host = new Host(scripts(), [`${A}.jsonl`, `${B}.jsonl`])
  const watch: Watch = await watching(host)
  await watch.move(1)
  const newest: Shown = watch.shown(40)
  const before: number = host.redraws
  watch.follow()
  expect([newest.id, newest.picked, watch.shown(40).picked, host.spawned.length, host.redraws - before]).toEqual([B, true, false, 2, 1])
})

test("with no runs there is nowhere to move", async () => {
  const host: Host = new Host(scripts())
  const watch: Watch = await watching(host)
  await watch.move(-1)
  expect([watch.shown(40).id, host.spawned.length, host.redraws]).toEqual([null, 1, 0])
})
