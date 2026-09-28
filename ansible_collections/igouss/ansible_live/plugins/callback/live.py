from __future__ import annotations

DOCUMENTATION = """
    name: live
    type: aggregate
    short_description: Records each run as it happens, for ansible-live to show
    description:
        - Appends every playbook, play, task and host result of a run to a log of its own, one JSON event per line,
          as it happens, per the ansible-live event contract v1.
        - Task arguments, result dumps and extra-var values are never recorded.
    requirements:
        - enable in C(callbacks_enabled)
    options:
        dir:
            description: Where the logs go. Unset, C($XDG_STATE_HOME/ansible-live) or C(~/.local/state/ansible-live).
            type: path
            env:
                - name: ANSIBLE_LIVE_DIR
            ini:
                - section: callback_live
                  key: dir
        keep:
            description: How many logs to keep; the oldest go when a run starts.
            type: int
            default: 100
            env:
                - name: ANSIBLE_LIVE_KEEP
            ini:
                - section: callback_live
                  key: keep
"""

import atexit
import dataclasses
import datetime
import os
import pathlib
import socket
from typing import Any, Callable

from ansible import context
from ansible.plugins.callback import CallbackBase
from ansible.release import __version__ as ansible_version

from ansible_collections.igouss.ansible_live.plugins.plugin_utils import log, recording, said, stamps


@dataclasses.dataclass
class Running:
    """A run being recorded: how far its recording has got, and the log it goes to."""
    recording: recording.Recording
    log: log.Log


class CallbackModule(CallbackBase):
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = "aggregate"
    CALLBACK_NAME = "igouss.ansible_live.live"
    CALLBACK_NEEDS_ENABLED = True

    def __init__(self) -> None:
        super().__init__()
        self.clock: Callable[[], datetime.datetime] = lambda: datetime.datetime.now(datetime.timezone.utc)
        self.pid: int = os.getpid()
        self.running: Running | None = None

    def _record(self, happening: recording.Happening) -> None:
        if self.running is not None:
            self.running.recording, event = recording.record(self.running.recording, happening, stamps.at(self.clock()))
            if event is not None:
                self.running.log.append(event)

    def _begin(self, playbook: Any) -> None:
        """The run starts with its first playbook, whose plays know the extra vars."""
        logs: pathlib.Path = log.directory(self.get_option("dir"), os.environ)
        log.prune(list(logs.glob("*.jsonl")), self.get_option("keep"))
        now: datetime.datetime = self.clock()
        run: str = stamps.run_id(now, self.pid)
        plays: list[Any] = playbook.get_plays()
        extra_vars: tuple[str, ...] = tuple(sorted(plays[0].get_variable_manager().extra_vars)) if plays else ()
        started: recording.RunStarted = recording.RunStarted(
            self.pid, socket.gethostname(), ansible_version, bool(context.CLIARGS.get("check")),
            context.CLIARGS.get("subset"), extra_vars)
        begun, event = recording.begin(run, started, stamps.at(now))
        self.running = Running(begun, log.Log(logs / f"{run}.jsonl"))
        self.running.log.append(event)
        atexit.register(self._exited)

    def _exited(self) -> None:
        if os.getpid() == self.pid:
            self._record(recording.Exited())

    def v2_playbook_on_start(self, playbook: Any) -> None:
        if self.running is None:
            self._begin(playbook)
        self._record(recording.PlaybookStarted(str(pathlib.Path(playbook._file_name).resolve())))

    def v2_playbook_on_play_start(self, play: Any) -> None:
        self._record(recording.PlayStarted(play._uuid, play.get_name(), hosts(play)))

    def v2_playbook_on_task_start(self, task: Any, is_conditional: bool) -> None:
        self._record(recording.TaskStarted(task._uuid, task.get_name(), task.get_play()._uuid, False))

    def v2_playbook_on_handler_task_start(self, task: Any) -> None:
        self._record(recording.TaskStarted(task._uuid, task.get_name(), task.get_play()._uuid, True))

    def v2_runner_on_start(self, host: Any, task: Any) -> None:
        self._record(recording.HostStarted(task._uuid, host.get_name()))

    def _ended(self, result: Any, outcome: str) -> None:
        self._record(recording.HostEnded(result.task._uuid, result.host.get_name(), outcome,
                                         bool(result.result.get("changed")), said.message(result.result)))

    def v2_runner_on_ok(self, result: Any) -> None:
        self._ended(result, "ok")

    def v2_runner_on_failed(self, result: Any, ignore_errors: bool = False) -> None:
        self._ended(result, "ignored" if ignore_errors else "failed")

    def v2_runner_on_skipped(self, result: Any) -> None:
        self._ended(result, "skipped")

    def v2_runner_on_unreachable(self, result: Any) -> None:
        self._ended(result, "unreachable")

    def v2_playbook_on_stats(self, stats: Any) -> None:
        self._record(recording.PlaybookEnded({host: counts(stats.summarize(host)) for host in stats.processed}))


def hosts(play: Any) -> tuple[str, ...]:
    """The hosts `play` runs on in this batch, as its inventory resolves them under --limit; no public API offers
    the inventory, so this reaches the variable manager's."""
    return tuple(host.get_name() for host in play.get_variable_manager()._inventory.get_hosts(play.hosts))


def counts(summary: dict[str, int]) -> dict[str, int]:
    """A host's line of the recap in the contract's names: Ansible calls `failed` `failures`."""
    return {name: summary["failures" if name == "failed" else name] for name in recording.COUNTS}
