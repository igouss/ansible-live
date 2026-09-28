"""Where runs are written and how a line reaches its log (contract/SPEC.md FR-1, FR-3, FR-4)."""

import json
import os
import pathlib
from typing import Any, Mapping


def directory(configured: str | None, env: Mapping[str, str]) -> pathlib.Path:
    """The configured directory, else `$XDG_STATE_HOME/ansible-live`, else `$HOME/.local/state/ansible-live`."""
    if configured:
        return pathlib.Path(configured)
    state: str = env.get("XDG_STATE_HOME") or str(pathlib.Path(env["HOME"]) / ".local" / "state")
    return pathlib.Path(state) / "ansible-live"


def prune(found: list[pathlib.Path], keep: int) -> None:
    """Deletes the oldest of the logs `found` until, with the one about to start, `keep` remain; a log another run
    pruned first is already gone."""
    for old in sorted(found)[:max(0, len(found) - keep + 1)]:
        old.unlink(missing_ok=True)


def line(event: Mapping[str, Any]) -> bytes:
    return (json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


class Log:
    """A run's log, readable by its owner alone, opened for appending; each event is appended whole, by its only
    writer."""

    def __init__(self, path: pathlib.Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.fd: int = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)

    def append(self, event: Mapping[str, Any]) -> None:
        data: bytes = line(event)
        while data:
            data = data[os.write(self.fd, data):]
