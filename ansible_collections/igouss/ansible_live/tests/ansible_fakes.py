"""Stand-ins for what Ansible hands a callback, holding only what the recorder reads."""

import dataclasses
from typing import Any, Mapping


@dataclasses.dataclass(frozen=True)
class Host:
    name: str

    def get_name(self) -> str:
        return self.name


@dataclasses.dataclass(frozen=True)
class Task:
    _uuid: str
    name: str
    play: "Play"

    def get_name(self) -> str:
        return self.name

    def get_play(self) -> "Play":
        return self.play


@dataclasses.dataclass(frozen=True)
class Inventory:
    patterns: Mapping[str, tuple[str, ...]]

    def get_hosts(self, pattern: str) -> list[Host]:
        return [Host(name) for name in self.patterns[pattern]]


@dataclasses.dataclass(frozen=True)
class VariableManager:
    extra_vars: Mapping[str, Any]
    _inventory: Inventory


@dataclasses.dataclass(frozen=True)
class Play:
    _uuid: str
    name: str
    variables: VariableManager
    hosts: str

    def get_name(self) -> str:
        return self.name

    def get_variable_manager(self) -> VariableManager:
        return self.variables


@dataclasses.dataclass(frozen=True)
class Playbook:
    _file_name: str
    plays: tuple[Play, ...]

    def get_plays(self) -> list[Play]:
        return list(self.plays)


@dataclasses.dataclass(frozen=True)
class Result:
    host: Host
    task: Task
    result: Mapping[str, Any]


@dataclasses.dataclass(frozen=True)
class Stats:
    lines: Mapping[str, Mapping[str, int]]

    @property
    def processed(self) -> Mapping[str, Mapping[str, int]]:
        return self.lines

    def summarize(self, host: str) -> Mapping[str, int]:
        return self.lines[host]


def play(uuid: str, name: str, pattern: str, hosts: tuple[str, ...],
         extra_vars: Mapping[str, Any] | None = None) -> Play:
    """A play over `pattern`, which the inventory resolves to `hosts`."""
    return Play(uuid, name, VariableManager(extra_vars or {}, Inventory({pattern: hosts})), pattern)


def recap(ok: int = 0, changed: int = 0, failures: int = 0, unreachable: int = 0) -> dict[str, int]:
    """One host's line as `AggregateStats.summarize` gives it."""
    return {"ok": ok, "changed": changed, "failures": failures, "unreachable": unreachable, "skipped": 0,
            "rescued": 0, "ignored": 0}
