"""A recorder as contract/formal/Log.tla has it: each line written in two steps, its body then its newline, and the
process exiting after run.end or killed at any step before."""

import pathlib

from ansible_collections.igouss.ansible_live.plugins.plugin_utils.log import line

PID: int = 4242


class Recorder:
    def __init__(self, path: pathlib.Path, run: str, controller: str, middle: int) -> None:
        self.path: pathlib.Path = path
        self.controller: str = controller
        self.pid: int = PID
        self.lines: list[bytes] = [
            line({"v": 1, "run": run, "seq": 0, "type": "run.start", "pid": PID, "controller": controller}),
            *[line({"v": 1, "run": run, "seq": seq, "type": "task.start"}) for seq in range(1, middle + 1)],
            line({"v": 1, "run": run, "seq": middle + 1, "type": "run.end", "outcome": "ok"}),
        ]
        self.written: int = 0
        self.half: bool = False
        self.alive: bool = True
        path.write_bytes(b"")

    def can_write(self) -> bool:
        return self.alive and not self.half and self.written < len(self.lines)

    def mid_line(self) -> bool:
        return self.alive and self.half

    def can_exit(self) -> bool:
        return self.alive and self.ended()

    def can_be_killed(self) -> bool:
        return self.alive and not self.ended()

    def write(self) -> None:
        self.append(self.lines[self.written][:-1])
        self.half = True

    def end_line(self) -> None:
        self.append(b"\n")
        self.half = False
        self.written += 1

    def finish(self) -> None:
        """Writes the rest of the run, run.end last, and exits."""
        if self.half:
            self.end_line()
        while self.written < len(self.lines):
            self.write()
            self.end_line()
        self.alive = False

    def append(self, data: bytes) -> None:
        with self.path.open("ab") as log:
            log.write(data)

    def complete(self) -> list[bytes]:
        return self.lines[:self.written]

    def started(self) -> bool:
        return self.written > 0

    def ended(self) -> bool:
        return self.written == len(self.lines)
