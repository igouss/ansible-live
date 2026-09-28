"""A run as the contract records it (contract/SPEC.md): each thing that happens in it becomes its next event."""

import dataclasses
import types
from typing import Any, Mapping, TypeAlias

COUNTS: tuple[str, ...] = ("ok", "changed", "failed", "unreachable", "skipped", "rescued", "ignored")
Counts: TypeAlias = Mapping[str, Mapping[str, int]]
Event: TypeAlias = dict[str, Any]


@dataclasses.dataclass(frozen=True)
class RunStarted:
    pid: int
    controller: str
    ansible: str
    check: bool
    limit: str | None
    extra_vars: tuple[str, ...]


@dataclasses.dataclass(frozen=True)
class PlaybookStarted:
    playbook: str


@dataclasses.dataclass(frozen=True)
class PlayStarted:
    play: str
    name: str
    hosts: tuple[str, ...]


@dataclasses.dataclass(frozen=True)
class TaskStarted:
    task: str
    name: str
    play: str
    handler: bool


@dataclasses.dataclass(frozen=True)
class HostStarted:
    task: str
    host: str


@dataclasses.dataclass(frozen=True)
class HostEnded:
    task: str
    host: str
    outcome: str
    changed: bool
    message: str | None


@dataclasses.dataclass(frozen=True)
class PlaybookEnded:
    """`totals` are Ansible's counts per host since the process started, not since this playbook did."""
    totals: Counts


@dataclasses.dataclass(frozen=True)
class Exited:
    pass


Happening: TypeAlias = PlaybookStarted | PlayStarted | TaskStarted | HostStarted | HostEnded | PlaybookEnded | Exited
TYPES: dict[type, str] = {PlaybookStarted: "playbook.start", PlayStarted: "play.start", TaskStarted: "task.start",
                          HostStarted: "host.start", HostEnded: "host.result"}
NOTHING: Counts = types.MappingProxyType({})


@dataclasses.dataclass(frozen=True)
class Recording:
    run: str
    seq: int = 1
    playbooks_open: int = 0
    totals: Counts = NOTHING
    ended: bool = False


def begin(run: str, started: RunStarted, at: str) -> tuple[Recording, Event]:
    return Recording(run), _event(run, 0, at, "run.start", dataclasses.asdict(started))


def record(recording: Recording, happening: Happening, at: str) -> tuple[Recording, Event | None]:
    """The recording after `happening`, and the event it adds; None once the run has ended."""
    if recording.ended:
        return recording, None
    after: Recording = dataclasses.replace(recording, seq=recording.seq + 1)
    match happening:
        case PlaybookStarted():
            after = dataclasses.replace(after, playbooks_open=recording.playbooks_open + 1)
        case PlaybookEnded(totals=totals):
            hosts: Counts = _since(recording.totals, totals)
            outcome: str = playbook_outcome(hosts)
            after = dataclasses.replace(after, playbooks_open=recording.playbooks_open - 1, totals=totals)
            return after, _event(recording.run, recording.seq, at, "playbook.end", {"outcome": outcome, "hosts": hosts})
        case Exited():
            outcome = "interrupted" if recording.playbooks_open else playbook_outcome(recording.totals)
            return dataclasses.replace(after, ended=True), _event(recording.run, recording.seq, at, "run.end",
                                                                  {"outcome": outcome})
    return after, _event(recording.run, recording.seq, at, TYPES[type(happening)], dataclasses.asdict(happening))


def playbook_outcome(hosts: Counts) -> str:
    """`failed` when a host had a failure it did not ignore, or could not be reached (FR-17); contract/check.py
    states the same rule on its own, as the oracle this is tested against."""
    return "failed" if any(line["failed"] or line["unreachable"] for line in hosts.values()) else "ok"


def _since(before: Counts, now: Counts) -> dict[str, dict[str, int]]:
    """Each host's counts from `before` to `now`, leaving out hosts nothing happened to."""
    empty: dict[str, int] = dict.fromkeys(COUNTS, 0)
    moved: dict[str, dict[str, int]] = {
        host: {name: line[name] - before.get(host, empty)[name] for name in COUNTS} for host, line in now.items()}
    return {host: line for host, line in moved.items() if any(line.values())}


def _event(run: str, seq: int, at: str, kind: str, fields: Mapping[str, Any]) -> Event:
    return {"v": 1, "run": run, "seq": seq, "at": at, "type": kind, **fields}
