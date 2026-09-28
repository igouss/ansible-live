import json
from typing import Any

from hypothesis import given, strategies as st

from written import ZERO, kept
from ansible_collections.igouss.ansible_live.plugins.plugin_utils import log, recording as r

RUN: str = "20260928T142821Z-4242"
AT: str = "2026-09-28T14:28:21.000Z"
STARTED: r.RunStarted = r.RunStarted(4242, "fedora", "2.21.4", False, None, ("pace",))


def played(*happenings: r.Happening) -> list[dict[str, Any]]:
    """The log a run with `happenings` writes, each event through the line it becomes."""
    recording, first = r.begin(RUN, STARTED, AT)
    events: list[dict[str, Any]] = [first]
    for happening in happenings:
        recording, event = r.record(recording, happening, AT)
        events += [event] if event is not None else []
    return [json.loads(log.line(event)) for event in events]


def test_a_run_starts_with_what_started_it() -> None:
    assert played() == [{"v": 1, "run": RUN, "seq": 0, "at": AT, "type": "run.start", "pid": 4242,
                         "controller": "fedora", "ansible": "2.21.4", "check": False, "limit": None,
                         "extra_vars": ["pace"]}]


def test_a_host_result_says_what_the_task_did() -> None:
    assert played(r.HostEnded("t-1", "web1", "failed", False, "503"))[1] == {
        "v": 1, "run": RUN, "seq": 1, "at": AT, "type": "host.result", "task": "t-1", "host": "web1",
        "outcome": "failed", "changed": False, "message": "503"}


def test_a_playbook_ends_with_what_happened_during_it() -> None:
    first: dict[str, dict[str, int]] = {"web1": {**ZERO, "ok": 2, "changed": 1}}
    second: dict[str, dict[str, int]] = {"web1": {**ZERO, "ok": 3, "changed": 1}, "db1": {**ZERO, "failed": 1}}
    ends: list[dict[str, Any]] = played(r.PlaybookStarted("/a.yml"), r.PlaybookEnded(first),
                                        r.PlaybookStarted("/b.yml"), r.PlaybookEnded(second))
    assert (ends[2]["outcome"], ends[2]["hosts"]) == ("ok", {"web1": {**ZERO, "ok": 2, "changed": 1}})
    assert (ends[4]["outcome"], ends[4]["hosts"]) == ("failed", {"web1": {**ZERO, "ok": 1}, "db1": {**ZERO, "failed": 1}})


def test_a_playbook_with_an_unreachable_host_failed() -> None:
    assert played(r.PlaybookStarted("/a.yml"), r.PlaybookEnded({"g": {**ZERO, "unreachable": 1}}))[2]["outcome"] == "failed"


def test_a_run_whose_playbooks_ended_well_ends_ok() -> None:
    assert played(r.PlaybookStarted("/a.yml"), r.PlaybookEnded({"w": {**ZERO, "ok": 1}}), r.Exited())[-1]["outcome"] == "ok"


def test_a_run_with_a_failed_playbook_fails() -> None:
    assert played(r.PlaybookStarted("/a.yml"), r.PlaybookEnded({"w": {**ZERO, "failed": 1}}),
                  r.PlaybookStarted("/b.yml"), r.PlaybookEnded({"w": {**ZERO, "failed": 1, "ok": 1}}),
                  r.Exited())[-1]["outcome"] == "failed"


def test_a_run_that_exits_inside_a_playbook_was_interrupted() -> None:
    assert played(r.PlaybookStarted("/a.yml"), r.Exited())[-1]["outcome"] == "interrupted"


def test_nothing_is_recorded_after_the_run_ended() -> None:
    assert [event["type"] for event in played(r.Exited(), r.Exited(), r.PlaybookStarted("/a.yml"))] == [
        "run.start", "run.end"]


names: st.SearchStrategy[str] = st.text(min_size=1, max_size=8)
outcomes: st.SearchStrategy[str] = st.sampled_from(["ok", "failed", "ignored", "skipped", "unreachable"])


@st.composite
def runs(draw: st.DrawFn) -> list[r.Happening]:
    """Happenings in an order Ansible makes: playbooks of plays of tasks, each started on a host before it ends
    there, Ansible's running totals growing at each playbook's end; the process may exit at any point."""
    happenings: list[r.Happening] = []
    totals: dict[str, dict[str, int]] = {}
    for playbook in range(draw(st.integers(0, 2))):
        happenings.append(r.PlaybookStarted(f"/p{playbook}.yml"))
        for play in range(draw(st.integers(0, 2))):
            hosts: list[str] = draw(st.lists(st.sampled_from(["web1", "web2", "db1"]), unique=True))
            happenings.append(r.PlayStarted(f"p{playbook}-{play}", draw(names), tuple(hosts)))
            for task in range(draw(st.integers(0, 3))):
                task_id: str = f"t{playbook}-{play}-{task}"
                happenings.append(r.TaskStarted(task_id, draw(names), f"p{playbook}-{play}", draw(st.booleans())))
                happenings += [r.HostStarted(task_id, host) for host in hosts]
                happenings += [r.HostEnded(task_id, host, draw(outcomes), draw(st.booleans()),
                                           draw(st.none() | st.text(max_size=20) | st.just("é" * 4000))) for host in hosts]
        for host in draw(st.lists(st.sampled_from(["web1", "web2", "db1"]), unique=True)):
            line: dict[str, int] = totals.get(host, ZERO)
            totals[host] = {name: count + draw(st.integers(0, 2)) for name, count in line.items()}
        happenings.append(r.PlaybookEnded({host: dict(line) for host, line in totals.items()}))
    cut: int = draw(st.integers(0, len(happenings)))
    return [*happenings[:cut], r.Exited()]


@given(runs())
def test_every_run_it_records_keeps_the_contract(happenings: list[r.Happening]) -> None:
    assert kept(played(*happenings))
