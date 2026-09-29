"""The follower the pane spawns from the plugin's folder: `python3 -m follower <dir> [<run>...]` writes the stream
of contract/SPEC.md FR-12 to FR-14 on standard output, following every run the stream owes (FR-13) and each `<run>`
asked for, until it is killed."""

import datetime
import os
import pathlib
import socket
import sys
import time

from .followed import Here
from .follower import Follower

# How long the follower waits between looks at the logs, in seconds.
PACE: float = 0.25


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def main(args: list[str]) -> int:
    if not args:
        print("usage: python3 -m follower <dir> [<run>...]", file=sys.stderr)
        return 2
    follower: Follower = Follower(pathlib.Path(args[0]), Here(socket.gethostname(), alive, now), args[1:])
    try:
        while True:
            lines: list[bytes] = follower.step()
            if lines:
                sys.stdout.buffer.write(b"".join(lines))
                sys.stdout.buffer.flush()
            time.sleep(PACE)
    except (BrokenPipeError, KeyboardInterrupt):
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
