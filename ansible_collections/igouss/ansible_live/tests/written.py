"""What a run wrote, read back, and whether it keeps the contract."""

import json
import pathlib
from typing import Any

import check
from schemas import RECORDER

ZERO: dict[str, int] = {"ok": 0, "changed": 0, "failed": 0, "unreachable": 0, "skipped": 0, "rescued": 0, "ignored": 0}


def events(logs: pathlib.Path) -> list[dict[str, Any]]:
    """The one log in `logs`, parsed."""
    [path] = logs.glob("*.jsonl")
    return [json.loads(line) for line in path.read_text().splitlines()]


def kept(log: list[dict[str, Any]]) -> bool:
    return all(map(RECORDER.is_valid, log)) and check.violations(log) == []
