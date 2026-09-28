"""The callback against stand-ins for Ansible: what each thing Ansible tells it becomes in the log."""

import datetime
import os
import pathlib
import socket
from typing import Any, Callable
from unittest import mock

import pytest
from ansible import context
from ansible.module_utils.common.collections import ImmutableDict
from ansible.release import __version__ as ansible_version

import ansible_fakes as fake
from written import ZERO, events
from ansible_collections.igouss.ansible_live.plugins.callback.live import CallbackModule

NOW: datetime.datetime = datetime.datetime(2026, 9, 28, 14, 28, 21, 500000, tzinfo=datetime.timezone.utc)
WEB: fake.Play = fake.play("p-1", "Web tier", "web", ("web1", "web2"), {"pace": 0, "steps": 3})
DEPLOY: fake.Task = fake.Task("t-1", "Deploy", WEB)
WEB1: fake.Host = fake.Host("web1")


class Recorder:
    """The callback writing to `logs`, its options as given and its exit hook caught rather than registered; the
    options' wiring to Ansible's config is proven by test_runs."""

    def __init__(self, logs: pathlib.Path, cliargs: dict[str, Any], keep: int = 100) -> None:
        context.CLIARGS = ImmutableDict(cliargs)
        self.logs: pathlib.Path = logs
        self.plugin: CallbackModule = configured(str(logs), keep)
        self.plugin.clock = lambda: NOW
        with mock.patch("atexit.register") as register:
            self.plugin.v2_playbook_on_start(fake.Playbook("/site/playbooks/../web.yml", (WEB,)))
        self.exit_hook: Callable[[], None] = register.call_args.args[0]

    def events(self) -> list[dict[str, Any]]:
        return events(self.logs)

    def last(self) -> dict[str, Any]:
        return self.events()[-1]


def configured(logs: str | None, keep: int = 100) -> CallbackModule:
    plugin: CallbackModule = CallbackModule()
    plugin.get_option = {"dir": logs, "keep": keep}.__getitem__  # type: ignore[method-assign]
    return plugin


@pytest.fixture
def recorder(tmp_path: pathlib.Path) -> Recorder:
    return Recorder(tmp_path, {"check": False, "subset": None})


def test_a_run_starts_named_by_its_start_and_pid(recorder: Recorder) -> None:
    assert [path.name for path in recorder.logs.glob("*.jsonl")] == [f"20260928T142821Z-{os.getpid()}.jsonl"]


def test_a_run_starts_with_what_started_it(recorder: Recorder) -> None:
    assert recorder.events()[0] == {
        "v": 1, "run": f"20260928T142821Z-{os.getpid()}", "seq": 0, "at": "2026-09-28T14:28:21.500Z",
        "type": "run.start", "pid": os.getpid(), "controller": socket.gethostname(), "ansible": ansible_version,
        "check": False, "limit": None, "extra_vars": ["pace", "steps"]}


def test_its_clock_is_utc() -> None:
    assert CallbackModule().clock().utcoffset() == datetime.timedelta(0)


def test_logs_default_to_the_state_home(tmp_path: pathlib.Path) -> None:
    plugin: CallbackModule = configured(None)
    with mock.patch.dict(os.environ, {"XDG_STATE_HOME": str(tmp_path)}), mock.patch("atexit.register"):
        plugin.v2_playbook_on_start(fake.Playbook("/site/web.yml", ()))
    assert len(list((tmp_path / "ansible-live").glob("*.jsonl"))) == 1


def test_a_checked_limited_run(tmp_path: pathlib.Path) -> None:
    start: dict[str, Any] = Recorder(tmp_path, {"check": True, "subset": "web1"}).events()[0]
    assert (start["check"], start["limit"]) == (True, "web1")


def test_a_playbook_is_named_by_its_resolved_path(recorder: Recorder) -> None:
    assert recorder.last() == {**recorder.last(), "type": "playbook.start", "playbook": "/site/web.yml"}


def test_a_second_playbook_is_the_same_run(recorder: Recorder) -> None:
    recorder.plugin.v2_playbook_on_start(fake.Playbook("/site/db.yml", ()))
    assert [event["type"] for event in recorder.events()] == ["run.start", "playbook.start", "playbook.start"]


def test_a_playbook_without_plays_has_no_extra_vars(tmp_path: pathlib.Path) -> None:
    plugin: CallbackModule = configured(str(tmp_path))
    with mock.patch("atexit.register"):
        plugin.v2_playbook_on_start(fake.Playbook("/site/empty.yml", ()))
    assert events(tmp_path)[0]["extra_vars"] == []


def test_a_run_prunes_old_logs_when_it_starts(tmp_path: pathlib.Path) -> None:
    (tmp_path / "20200101T000000Z-1.jsonl").write_text("")
    Recorder(tmp_path, {}, keep=1)
    assert [path.name for path in tmp_path.glob("*.jsonl")] == [f"20260928T142821Z-{os.getpid()}.jsonl"]


def test_a_play_names_the_hosts_it_runs_on(recorder: Recorder) -> None:
    recorder.plugin.v2_playbook_on_play_start(WEB)
    assert recorder.last() == {**recorder.last(), "type": "play.start", "play": "p-1", "name": "Web tier",
                               "hosts": ["web1", "web2"]}


def test_a_task_names_its_play(recorder: Recorder) -> None:
    recorder.plugin.v2_playbook_on_play_start(WEB)
    recorder.plugin.v2_playbook_on_task_start(DEPLOY, False)
    assert recorder.last() == {**recorder.last(), "type": "task.start", "task": "t-1", "name": "Deploy", "play": "p-1",
                               "handler": False}


def test_a_handler_is_recorded_as_one(recorder: Recorder) -> None:
    recorder.plugin.v2_playbook_on_play_start(WEB)
    recorder.plugin.v2_playbook_on_handler_task_start(fake.Task("h-1", "Reload the site", WEB))
    assert recorder.last() == {**recorder.last(), "type": "task.start", "task": "h-1", "name": "Reload the site",
                               "play": "p-1", "handler": True}


def test_a_task_starting_on_a_host(recorder: Recorder) -> None:
    recorder.plugin.v2_runner_on_start(WEB1, DEPLOY)
    assert recorder.last() == {"v": 1, "run": f"20260928T142821Z-{os.getpid()}", "seq": 2,
                               "at": "2026-09-28T14:28:21.500Z", "type": "host.start", "task": "t-1", "host": "web1"}


def ended(recorder: Recorder, method: str, said: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    getattr(recorder.plugin, method)(fake.Result(WEB1, DEPLOY, said), **kwargs)
    return {key: recorder.last()[key] for key in ("type", "task", "host", "outcome", "changed", "message")}


def test_a_task_that_went_well(recorder: Recorder) -> None:
    assert ended(recorder, "v2_runner_on_ok", {"changed": True}) == {
        "type": "host.result", "task": "t-1", "host": "web1", "outcome": "ok", "changed": True, "message": None}


def test_a_task_that_failed(recorder: Recorder) -> None:
    assert ended(recorder, "v2_runner_on_failed", {"msg": "503"}) == {
        "type": "host.result", "task": "t-1", "host": "web1", "outcome": "failed", "changed": False, "message": "503"}


def test_a_failure_that_was_ignored(recorder: Recorder) -> None:
    assert ended(recorder, "v2_runner_on_failed", {}, ignore_errors=True)["outcome"] == "ignored"


def test_a_task_that_was_skipped(recorder: Recorder) -> None:
    assert ended(recorder, "v2_runner_on_skipped", {"skip_reason": "no"})["outcome"] == "skipped"


def test_a_host_that_could_not_be_reached(recorder: Recorder) -> None:
    assert ended(recorder, "v2_runner_on_unreachable", {"msg": "timed out"})["outcome"] == "unreachable"


def test_a_playbook_ends_with_ansible_s_recap_in_the_contract_s_names(recorder: Recorder) -> None:
    recorder.plugin.v2_playbook_on_stats(fake.Stats({"web1": fake.recap(ok=2, changed=1), "web2": fake.recap(failures=1)}))
    last: dict[str, Any] = recorder.last()
    assert (last["type"], last["outcome"], last["hosts"]) == (
        "playbook.end", "failed", {"web1": {**ZERO, "ok": 2, "changed": 1}, "web2": {**ZERO, "failed": 1}})


def test_the_run_ends_when_the_process_exits(recorder: Recorder) -> None:
    recorder.plugin.v2_playbook_on_stats(fake.Stats({"web1": fake.recap(ok=1)}))
    recorder.exit_hook()
    last: dict[str, Any] = recorder.last()
    assert (last["type"], last["outcome"]) == ("run.end", "ok")


def test_a_forked_child_exiting_does_not_end_the_run(recorder: Recorder) -> None:
    recorder.plugin.pid = 1
    recorder.exit_hook()
    assert recorder.last()["type"] == "playbook.start"


def test_nothing_is_recorded_before_a_playbook_starts(tmp_path: pathlib.Path) -> None:
    plugin: CallbackModule = configured(str(tmp_path))
    plugin.v2_runner_on_start(WEB1, DEPLOY)
    assert list(tmp_path.iterdir()) == []
