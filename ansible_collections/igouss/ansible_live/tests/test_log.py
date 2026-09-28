import json
import os
import pathlib

from ansible_collections.igouss.ansible_live.plugins.plugin_utils import log


def test_the_configured_directory_wins() -> None:
    assert log.directory("/srv/live", {"XDG_STATE_HOME": "/s", "HOME": "/h"}) == pathlib.Path("/srv/live")


def test_under_the_xdg_state_home() -> None:
    assert log.directory(None, {"XDG_STATE_HOME": "/s", "HOME": "/h"}) == pathlib.Path("/s/ansible-live")


def test_under_home_without_an_xdg_state_home() -> None:
    assert log.directory(None, {"HOME": "/h"}) == pathlib.Path("/h/.local/state/ansible-live")


def logs(tmp_path: pathlib.Path, *names: str) -> list[pathlib.Path]:
    paths: list[pathlib.Path] = [tmp_path / f"{name}.jsonl" for name in names]
    for path in paths:
        path.write_text("")
    return paths


def left(directory: pathlib.Path) -> list[str]:
    return sorted(path.name for path in directory.iterdir())


def test_pruning_nothing() -> None:
    log.prune([], 3)


def test_pruning_keeps_room_for_the_new_run(tmp_path: pathlib.Path) -> None:
    log.prune(logs(tmp_path, "20260101T000000Z-1", "20260102T000000Z-1", "20260103T000000Z-1"), 3)
    assert left(tmp_path) == ["20260102T000000Z-1.jsonl", "20260103T000000Z-1.jsonl"]


def test_pruning_the_oldest_two(tmp_path: pathlib.Path) -> None:
    log.prune(logs(tmp_path, "20260103T000000Z-1", "20260101T000000Z-9", "20260102T000000Z-1"), 2)
    assert left(tmp_path) == ["20260103T000000Z-1.jsonl"]


def test_pruning_under_the_bound_deletes_nothing(tmp_path: pathlib.Path) -> None:
    log.prune(logs(tmp_path, "20260101T000000Z-1"), 3)
    assert left(tmp_path) == ["20260101T000000Z-1.jsonl"]


def test_pruning_a_log_another_run_pruned_first(tmp_path: pathlib.Path) -> None:
    log.prune([tmp_path / "20260101T000000Z-1.jsonl", *logs(tmp_path, "20260102T000000Z-1")], 1)
    assert left(tmp_path) == []


def test_a_line_is_compact_json_ending_in_a_newline() -> None:
    assert log.line({"type": "run.end", "outcome": "ok"}) == b'{"type":"run.end","outcome":"ok"}\n'


def test_a_line_keeps_what_is_not_ascii() -> None:
    assert log.line({"message": "déjà"}) == '{"message":"déjà"}\n'.encode()


def test_events_are_appended_one_per_line_creating_the_directories(tmp_path: pathlib.Path) -> None:
    path: pathlib.Path = tmp_path / "state" / "live" / "run.jsonl"
    written: log.Log = log.Log(path)
    written.append({"seq": 0})
    written.append({"seq": 1})
    assert [json.loads(line) for line in path.read_text().splitlines()] == [{"seq": 0}, {"seq": 1}]


def test_a_log_is_appended_to_not_replaced(tmp_path: pathlib.Path) -> None:
    path: pathlib.Path = tmp_path / "run.jsonl"
    path.write_text('{"seq":0}\n')
    log.Log(path).append({"seq": 1})
    assert path.read_text() == '{"seq":0}\n{"seq":1}\n'


def test_a_log_is_readable_by_its_owner_alone(tmp_path: pathlib.Path) -> None:
    before: int = os.umask(0o022)
    log.Log(tmp_path / "run.jsonl")
    os.umask(before)
    assert (tmp_path / "run.jsonl").stat().st_mode & 0o777 == 0o600
