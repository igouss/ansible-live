"""The recorder in real ansible-playbook runs over the testbed: what reaches the log, and that it keeps the contract."""

import os
import pathlib
import signal
import subprocess
import time
from typing import Any

import pytest

from written import ZERO, events, kept

ROOT: pathlib.Path = pathlib.Path(__file__).resolve().parents[4]
TESTBED: pathlib.Path = ROOT / "testbed"
PLAYBOOK: str = str(ROOT / ".venv" / "bin" / "ansible-playbook")


def started(logs: pathlib.Path, *args: str) -> subprocess.Popen[bytes]:
    env: dict[str, str] = {**os.environ, "ANSIBLE_LIVE_DIR": str(logs)}
    return subprocess.Popen([PLAYBOOK, *args], cwd=TESTBED, env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ran(logs: pathlib.Path, *args: str) -> list[dict[str, Any]]:
    started(logs, *args).wait(timeout=120)
    return events(logs)


def of(log: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [event for event in log if event["type"] == kind]


def result(log: list[dict[str, Any]], task: str, host: str) -> dict[str, Any]:
    """The outcome, changed and message of `task` on `host`."""
    [task_id] = [event["task"] for event in of(log, "task.start") if event["name"] == task]
    [ended] = [event for event in of(log, "host.result") if event["task"] == task_id and event["host"] == host]
    return {key: ended[key] for key in ("outcome", "changed", "message")}


def interrupted(logs: pathlib.Path, signum: int) -> list[dict[str, Any]]:
    """A long run sent `signum` once it has a host result."""
    playing: subprocess.Popen[bytes] = started(logs, "playbooks/long.yml", "-e", "steps=30")
    deadline: float = time.monotonic() + 60
    while not any(path.read_text().count('"host.result"') for path in logs.glob("*.jsonl")):
        assert time.monotonic() < deadline, "no host result within a minute"
        time.sleep(0.2)
    playing.send_signal(signum)
    playing.wait(timeout=60)
    return events(logs)


@pytest.fixture(scope="module")
def failing(tmp_path_factory: pytest.TempPathFactory) -> list[dict[str, Any]]:
    return ran(tmp_path_factory.mktemp("failing"), "playbooks/failing.yml", "-e", "pace=0")


def test_a_failing_run_keeps_the_contract(failing: list[dict[str, Any]]) -> None:
    assert kept(failing)


def test_a_failing_run_starts_with_what_started_it(failing: list[dict[str, Any]]) -> None:
    start: dict[str, Any] = failing[0]
    assert (start["type"], start["check"], start["limit"], start["extra_vars"]) == ("run.start", False, None, ["pace"])


def test_a_failed_task_says_why(failing: list[dict[str, Any]]) -> None:
    assert result(failing, "Health check", "web2") == {
        "outcome": "failed", "changed": False, "message": "web2 answered 503 on /healthz"}


def test_a_failing_run_ends_with_the_recap_and_fails(failing: list[dict[str, Any]]) -> None:
    assert (of(failing, "playbook.end")[0]["hosts"]["web3"], failing[-1]) == (
        {**ZERO, "ok": 4, "changed": 1, "skipped": 1, "rescued": 1, "ignored": 1},
        {**failing[-1], "type": "run.end", "outcome": "failed"})


def test_two_playbooks_each_end_with_their_own_counts(tmp_path: pathlib.Path) -> None:
    log: list[dict[str, Any]] = ran(tmp_path, "playbooks/unreachable.yml", "playbooks/long.yml",
                                    "--limit", "web1", "-e", "pace=0", "-e", "steps=1")
    assert (kept(log), [end["hosts"] for end in of(log, "playbook.end")]) == (
        True, [{"web1": {**ZERO, "ok": 2}}, {"web1": {**ZERO, "ok": 2}}])


def test_an_interrupted_run_says_so(tmp_path: pathlib.Path) -> None:
    log: list[dict[str, Any]] = interrupted(tmp_path, signal.SIGINT)
    assert (kept(log), log[-1]["type"], log[-1]["outcome"]) == (True, "run.end", "interrupted")


def test_a_killed_run_leaves_a_log_without_an_end(tmp_path: pathlib.Path) -> None:
    log: list[dict[str, Any]] = interrupted(tmp_path, signal.SIGKILL)
    assert (kept(log), of(log, "run.end")) == (True, [])
