"""The complete lines a growing file gains between reads (contract/SPEC.md FR-12, FR-13)."""

import pathlib


class Tail:
    """Reads a log from where it last stopped; a last line still without its newline is held until it has one."""

    def __init__(self, path: pathlib.Path) -> None:
        self.path: pathlib.Path = path
        self.offset: int = 0
        self.held: bytes = b""

    def read(self) -> list[bytes]:
        """Each line completed since the last read, its newline included, in the order written; raises
        FileNotFoundError once the log is gone."""
        with self.path.open("rb") as log:
            log.seek(self.offset)
            gained: bytes = log.read()
        self.offset += len(gained)
        *complete, self.held = (self.held + gained).split(b"\n")
        return [line + b"\n" for line in complete]
