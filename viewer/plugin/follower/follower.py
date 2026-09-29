"""Which runs the follower follows, and the stream it emits of them (contract/SPEC.md FR-12, FR-13)."""

import os
import pathlib

from .followed import Followed, Here, fields, says_end
from .tail import Tail

# Far longer than any run.end line, so a log that ends in one has it whole in its last bytes.
LAST: int = 4096


class Follower:
    """Follows, in `directory`, every run whose log has no run.end, the newest run, each run it is asked for, and
    every run that starts after."""

    def __init__(self, directory: pathlib.Path, here: Here, asked: list[str]) -> None:
        self.directory: pathlib.Path = directory
        self.here: Here = here
        self.followed: dict[str, Followed] = {}
        logged: list[str] = self.runs()
        self.known: set[str] = {*logged, *asked}
        for run in sorted(self.known):
            if run in asked or run in logged[-1:] or not ended(self.log(run)):
                self.follow(run)

    def step(self) -> list[bytes]:
        """The lines to emit now, each run's in its own order."""
        for run in self.runs():
            if run not in self.known:
                self.known.add(run)
                self.follow(run)
        lines: list[bytes] = []
        for run, followed in list(self.followed.items()):
            try:
                lines += followed.step(self.here)
            except FileNotFoundError:
                del self.followed[run]
                continue
            if followed.done:
                del self.followed[run]
        return lines

    def follow(self, run: str) -> None:
        self.followed[run] = Followed(run, Tail(self.log(run)))

    def runs(self) -> list[str]:
        """The runs logged in the directory, oldest first (FR-2); none while it does not exist."""
        try:
            names: list[str] = os.listdir(self.directory)
        except FileNotFoundError:
            return []
        return sorted(name.removesuffix(".jsonl") for name in names if name.endswith(".jsonl"))

    def log(self, run: str) -> pathlib.Path:
        return self.directory / f"{run}.jsonl"


def ended(log: pathlib.Path) -> bool:
    """Whether the log's last line is a run.end (FR-7: nothing follows one); a log that is gone has ended too."""
    try:
        with log.open("rb") as file:
            file.seek(end_from(os.fstat(file.fileno()).st_size))
            last: bytes = file.read()
    except FileNotFoundError:
        return True
    lines: list[bytes] = last.split(b"\n")
    return len(lines) > 1 and lines[-1] == b"" and says_end(fields(lines[-2]))


def end_from(size: int) -> int:
    """Where to start reading a log of `size` bytes to have its last line whole when that is a run.end."""
    return max(0, size - LAST)
