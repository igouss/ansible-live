"""How a run is named and an event is timed (contract/SPEC.md FR-2, FR-5)."""

import datetime


def run_id(started: datetime.datetime, pid: int) -> str:
    return f"{started.astimezone(datetime.timezone.utc):%Y%m%dT%H%M%SZ}-{pid}"


def at(now: datetime.datetime) -> str:
    return now.astimezone(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
