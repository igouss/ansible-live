# Event contract, version 1

The only coupling between the recorder (the Ansible callback) and the viewer (the Claude Code
pane). The recorder writes each run as an append-only log of events; the follower turns the logs
into one stream; the viewer folds that stream into what the pane shows.

```
ansible-playbook ─▶ recorder ─▶ <dir>/<run>.jsonl ─▶ follower ─▶ stream ─▶ viewer core ─▶ pane
```

- `recorder.v1.schema.json` — every line a recorder writes.
- `stream.v1.schema.json` — every line the follower emits: a recorder line, or `run.lost`.
- `examples/valid/` — logs every check accepts; `examples/invalid/` — near-misses, each named
  after the requirement it breaks.
- `check.py` — the rules no schema can state: numbering, order, references, outcomes.

**Scope.** In: what is recorded, where, in what order, and what a follower emits. Out: how the
pane draws it; loop items, diffs and async polls (not recorded in v1).

## Where

- **FR-1** The recorder SHALL write each run to `<dir>/<run>.jsonl`, where `<dir>` is the
  callback option `dir` (env `ANSIBLE_LIVE_DIR`), defaulting to `$XDG_STATE_HOME/ansible-live`,
  and `$HOME/.local/state/ansible-live` when `XDG_STATE_HOME` is unset.
- **FR-18** A log SHALL be readable and writable by its owner alone (mode 0600): it holds what
  tasks said, `stderr` included.
- **FR-2** A run id SHALL be `<UTC start, YYYYMMDDTHHMMSSZ>-<pid>`, so that runs sort by start in
  name order and two runs started in the same second by different processes do not collide.
- **FR-3** WHEN a run starts and `<dir>` holds more than `keep` logs (callback option, default
  100), the recorder SHALL delete the oldest by name until `keep` remain, counting the new one.

## A log

A run is one `ansible-playbook` process; it may play several playbooks.

- **FR-4** Each line SHALL be one event: a JSON object validating against
  `recorder.v1.schema.json`, ending in `\n`, written with a single append so that a reader never
  sees two events interleaved.
- **FR-5** Every event SHALL carry `v` (1), `run` (its run id), `seq` and `at` (UTC, RFC 3339
  with milliseconds).
- **FR-6** `seq` SHALL be 0 on the first line and one more on each line after it.
- **FR-7** The first event SHALL be `run.start`, and no event SHALL follow `run.end`.
- **FR-8** A `play.start` SHALL follow a `playbook.start` of the same run, a `task.start` SHALL
  name a play already started, and a `host.start` or `host.result` SHALL name a task already
  started.
- **FR-9** WHEN the process exits, the recorder SHALL write `run.end`: `interrupted` if a playbook
  started without ending, else `failed` if any playbook failed, else `ok`.
- **FR-17** A `playbook.end` SHALL say `failed` when a host in its `hosts` has a non-zero
  `failed` or `unreachable` count, else `ok`.
- **FR-10** A killed process leaves a log without `run.end`; the recorder cannot prevent it, and
  the follower answers it (FR-14).

## What is never recorded

- **FR-11** The recorder SHALL NOT record task arguments, result dumps, or extra-var values:
  `extra_vars` holds names only, and a result's `message` is at most 4000 characters of what the
  task said: its `msg`, failed `assertion` and `stderr`, each non-empty one on its own line; else
  its `skip_reason`; for a loop, what each item said, one item after another.

## The events

| `type` | Fields beyond FR-5 | When |
|---|---|---|
| `run.start` | `pid`, `controller` (hostname), `ansible` (version), `check`, `limit` (or null), `extra_vars` (names) | first playbook starts |
| `playbook.start` | `playbook` (absolute path) | each playbook starts |
| `play.start` | `play` (id), `name`, `hosts` (this batch's) | each play, once per `serial` batch |
| `task.start` | `task` (id), `name`, `play`, `handler` | each task or handler starts |
| `host.start` | `task`, `host` | a task starts on one host |
| `host.result` | `task`, `host`, `outcome`, `changed`, `message` (or null) | a task ends on one host |
| `playbook.end` | `outcome` (`ok`/`failed`), `hosts`: per host `ok, changed, failed, unreachable, skipped, rescued, ignored` | each playbook's stats |
| `run.end` | `outcome` (`ok`/`failed`/`interrupted`) | the process exits (FR-9) |

`outcome` of `host.result` is one of `ok`, `failed`, `ignored` (failed, `ignore_errors`),
`skipped`, `unreachable`. Ids are Ansible's own uuids.

## The stream

- **FR-12** The follower SHALL emit each line of the logs it follows unchanged, one per line, and
  each line once, in `seq` order within its run; runs may interleave.
- **FR-13** The follower SHALL follow every run whose log has no `run.end`, the newest run, each
  run it is started with, and every run that starts while it follows; a partly written last line is
  held until its `\n`.
- **FR-14** WHEN a followed run's `controller` is this host, its `pid` is not alive, and its log
  has no `run.end`, the follower SHALL emit
  `{"v":1,"type":"run.lost","run":<id>,"at":<now>}` once for that run. It SHALL decide only after
  it saw the pid dead and then read the log to its end: checking for the end of the log before the
  pid reports a run lost that wrote `run.end` in between.

The follower's order is model-checked. `formal/Log.tla` holds one run's log under a recorder that
can be killed at any step, half-written lines included; `formal/Follow.tla` is the protocol above
and proves FR-12's order and uniqueness, FR-13's delivery and FR-14's soundness and completeness;
`formal/FollowNaive.tla`, the end-first order, must fail `LostSound`. `just formal` runs both.
Not modelled: several runs, and pruning (FR-3) deleting a log being followed.

## Versions

- **FR-15** A reader SHALL NOT fold an event whose `v` it does not know; the viewer shows the run
  as written by a newer recorder, naming the version.
- **FR-16** A change that a v1 reader would misread SHALL raise `v`; adding an event type or an
  optional field SHALL NOT.

## Assumptions (flagged)

- A-1 Liveness by `pid` on the same `controller` can be fooled by pid reuse; accepted for v1.
- A-2 A reader on another host than the controller (a shared home) cannot tell a live run from a
  killed one, and shows it as running.
- A-3 `keep` counts logs, not bytes; a very long run can make one log large. The follower
  streams, so the viewer never reads a log whole.
- A-4 FR-18's 0600 is chosen for the operator, not by them: the viewer runs as the same user, and
  nothing else is known to need the logs.

## Acceptance

| Requirement | Checked by |
|---|---|
| FR-4 schema, FR-5, FR-11 bound | `recorder.v1.schema.json` over `examples/`; recorder tests (bead .2) |
| FR-6–8, FR-9 as the log states it, FR-17 | `check.py` over `examples/` |
| FR-1–3, FR-9 on exit, FR-11 content, FR-18 | recorder tests (bead .2) |
| FR-12–14 | `formal/Follow.tla` (the protocol); follower tests (bead .4, the code) |
| FR-15 | viewer core tests (bead .3) |
| FR-16 | review of any schema change |
