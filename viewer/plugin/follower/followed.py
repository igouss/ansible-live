"""One run as the follower follows it: its lines as they are written, and whether it was lost (contract/SPEC.md
FR-12, FR-14)."""

import dataclasses
import json
from typing import Any, Callable

from .tail import Tail


@dataclasses.dataclass(frozen=True)
class Here:
    """What the follower knows of the host it runs on: its name, whether a pid is alive, and the time."""

    host: str
    alive: Callable[[int], bool]
    now: Callable[[], str]


class Followed:
    """A run followed until its log says run.end or it is lost."""

    def __init__(self, run: str, tail: Tail) -> None:
        self.run: str = run
        self.tail: Tail = tail
        self.started: tuple[str, int] | None = None
        self.ended: bool = False
        self.lost: bool = False

    @property
    def done(self) -> bool:
        return self.ended or self.lost

    def step(self, here: Here) -> list[bytes]:
        """The lines to emit now. FR-14 is decided in this order only: the pid seen dead, then the log read to its
        end; the other order calls a run lost that wrote run.end in between."""
        dead: bool = self.died(here)
        lines: list[bytes] = self.tail.read()
        for line in lines:
            self.learn(line)
        if dead and not self.ended:
            self.lost = True
            return [*lines, lost(self.run, here.now())]
        return lines

    def died(self, here: Here) -> bool:
        return self.started is not None and self.started[0] == here.host and not here.alive(self.started[1])

    def learn(self, line: bytes) -> None:
        if b"run." not in line:
            return
        said: dict[str, Any] = fields(line)
        self.ended = self.ended or says_end(said)
        controller: Any = said.get("controller")
        pid: Any = said.get("pid")
        if said.get("type") == "run.start" and isinstance(controller, str) and type(pid) is int:
            self.started = (controller, pid)


def says_end(said: dict[str, Any]) -> bool:
    return said.get("type") == "run.end"


def fields(line: bytes) -> dict[str, Any]:
    """A line's fields; none for a line that is not a JSON object, which the follower passes on all the same."""
    try:
        parsed: Any = json.loads(line)
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def lost(run: str, at: str) -> bytes:
    return (json.dumps({"v": 1, "type": "run.lost", "run": run, "at": at}, separators=(",", ":")) + "\n").encode()
