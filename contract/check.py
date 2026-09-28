"""The rules of a v1 log that no schema states (SPEC.md FR-6 to FR-9, FR-17): numbering, order, references, outcomes."""

import dataclasses
from typing import Any, Mapping, Sequence


@dataclasses.dataclass(frozen=True)
class Violation:
    rule: str
    seq: int
    why: str


def violations(log: Sequence[Mapping[str, Any]]) -> list[Violation]:
    """What in `log`, a run's events in the order written, breaks FR-6 to FR-9 or FR-17; empty when nothing does."""
    found: list[Violation] = []
    playbooks_open: int = 0
    playbook_failed: bool = False
    ended: bool = False
    plays: set[str] = set()
    tasks: set[str] = set()
    for position, event in enumerate(log):
        seq: int = event["seq"]
        kind: str = event["type"]
        if seq != position:
            found.append(Violation("FR-6", seq, f"line {position} has seq {seq}"))
        if (position == 0) != (kind == "run.start"):
            found.append(Violation("FR-7", seq, f"{kind} at line {position}"))
        if ended:
            found.append(Violation("FR-7", seq, f"{kind} after run.end"))
        if kind == "playbook.start":
            playbooks_open += 1
        elif kind == "playbook.end":
            playbooks_open -= 1
            playbook_failed = playbook_failed or event["outcome"] == "failed"
            if event["outcome"] != playbook_outcome(event["hosts"]):
                found.append(Violation("FR-17", seq, f"playbook.end says {event['outcome']}, its hosts say otherwise"))
        elif kind == "run.end":
            ended = True
            owed: str = "interrupted" if playbooks_open else "failed" if playbook_failed else "ok"
            if event["outcome"] != owed:
                found.append(Violation("FR-9", seq, f"run.end says {event['outcome']}, the playbooks say {owed}"))
        elif kind == "play.start":
            plays.add(event["play"])
            if not playbooks_open:
                found.append(Violation("FR-8", seq, "play.start outside a playbook"))
        elif kind == "task.start":
            tasks.add(event["task"])
            if event["play"] not in plays:
                found.append(Violation("FR-8", seq, f"task.start in play {event['play']} not started"))
        elif kind in ("host.start", "host.result") and event["task"] not in tasks:
            found.append(Violation("FR-8", seq, f"{kind} for task {event['task']} not started"))
    return found


def playbook_outcome(hosts: Mapping[str, Mapping[str, int]]) -> str:
    """`failed` when a host had a failure it did not ignore, or could not be reached; else `ok`."""
    return "failed" if any(line["failed"] or line["unreachable"] for line in hosts.values()) else "ok"
