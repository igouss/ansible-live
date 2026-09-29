import json
import pathlib

from viewer.plugin.follower.followed import Here, lost
from viewer.plugin.follower.follower import LAST, Follower, end_from, ended
from recorder import line

HERE: Here = Here("fedora", lambda pid: True, lambda: "2026-09-28T14:40:00.000Z")
OLD: str = "20260928T100000Z-1"
MID: str = "20260928T110000Z-2"
NEW: str = "20260928T120000Z-3"


def start(run: str) -> bytes:
    return line({"v": 1, "run": run, "seq": 0, "type": "run.start", "pid": 1, "controller": "fedora"})


def end(run: str) -> bytes:
    return line({"v": 1, "run": run, "seq": 1, "type": "run.end", "outcome": "ok"})


def logged(directory: pathlib.Path, run: str, *lines: bytes) -> None:
    with (directory / f"{run}.jsonl").open("ab") as log:
        log.write(b"".join(lines))


def runs(lines: list[bytes]) -> list[str]:
    return [json.loads(each)["run"] for each in lines]


def test_no_logs_and_no_directory_follow_nothing(tmp_path: pathlib.Path) -> None:
    assert [Follower(tmp_path, HERE, []).step(), Follower(tmp_path / "none", HERE, []).step()] == [[], []]


def test_the_newest_run_is_followed_though_it_ended(tmp_path: pathlib.Path) -> None:
    logged(tmp_path, NEW, start(NEW), end(NEW))
    assert Follower(tmp_path, HERE, []).step() == [start(NEW), end(NEW)]


def test_an_ended_older_run_is_not_followed_an_unended_one_is(tmp_path: pathlib.Path) -> None:
    logged(tmp_path, OLD, start(OLD), end(OLD))
    logged(tmp_path, MID, start(MID))
    logged(tmp_path, NEW, start(NEW), end(NEW))
    assert runs(Follower(tmp_path, HERE, []).step()) == [MID, NEW, NEW]


def test_an_older_run_killed_mid_line_is_followed_its_half_line_held(tmp_path: pathlib.Path) -> None:
    logged(tmp_path, OLD, start(OLD), end(OLD)[:-1])
    logged(tmp_path, NEW, start(NEW))
    assert runs(Follower(tmp_path, HERE, []).step()) == [OLD, NEW]


def test_a_run_that_starts_while_following_is_followed_once(tmp_path: pathlib.Path) -> None:
    follower: Follower = Follower(tmp_path, HERE, [])
    before: list[bytes] = follower.step()
    logged(tmp_path, NEW, start(NEW))
    first: list[bytes] = follower.step()
    logged(tmp_path, NEW, end(NEW))
    assert [before, first, follower.step()] == [[], [start(NEW)], [end(NEW)]]


def test_runs_interleave_each_in_its_own_order(tmp_path: pathlib.Path) -> None:
    logged(tmp_path, OLD, start(OLD))
    logged(tmp_path, NEW, start(NEW))
    follower: Follower = Follower(tmp_path, HERE, [])
    first: list[bytes] = follower.step()
    logged(tmp_path, NEW, end(NEW))
    logged(tmp_path, OLD, end(OLD))
    assert [first, follower.step()] == [[start(OLD), start(NEW)], [end(OLD), end(NEW)]]


def test_a_run_is_let_go_once_it_ended(tmp_path: pathlib.Path) -> None:
    logged(tmp_path, NEW, start(NEW), end(NEW))
    follower: Follower = Follower(tmp_path, HERE, [])
    follower.step()
    logged(tmp_path, NEW, b'{"after":"the end"}\n')
    assert [follower.step(), list(follower.followed)] == [[], []]


def test_a_log_deleted_while_followed_is_let_go_and_the_others_still_read(tmp_path: pathlib.Path) -> None:
    logged(tmp_path, OLD, start(OLD))
    logged(tmp_path, NEW, start(NEW))
    follower: Follower = Follower(tmp_path, HERE, [])
    follower.step()
    (tmp_path / f"{OLD}.jsonl").unlink()
    logged(tmp_path, NEW, end(NEW))
    assert [follower.step(), list(follower.followed)] == [[end(NEW)], []]


def test_a_run_found_dead_is_said_lost_by_its_name_once(tmp_path: pathlib.Path) -> None:
    logged(tmp_path, NEW, start(NEW))
    follower: Follower = Follower(tmp_path, Here("fedora", lambda pid: False, HERE.now), [])
    assert [follower.step(), follower.step(), follower.step()] == [[start(NEW)], [lost(NEW, HERE.now())], []]


def test_a_run_asked_for_is_followed_though_it_ended_and_is_not_the_newest(tmp_path: pathlib.Path) -> None:
    logged(tmp_path, OLD, start(OLD), end(OLD))
    logged(tmp_path, MID, start(MID), end(MID))
    logged(tmp_path, NEW, start(NEW))
    assert runs(Follower(tmp_path, HERE, [OLD]).step()) == [OLD, OLD, NEW]


def test_a_run_asked_for_that_has_no_log_is_let_go_and_the_directory_still_followed(tmp_path: pathlib.Path) -> None:
    follower: Follower = Follower(tmp_path, HERE, [OLD])
    first: list[bytes] = follower.step()
    logged(tmp_path, NEW, start(NEW))
    assert [first, follower.step()] == [[], [start(NEW)]]


def test_many_runs_asked_for_are_each_followed_once(tmp_path: pathlib.Path) -> None:
    logged(tmp_path, OLD, start(OLD), end(OLD))
    logged(tmp_path, MID, start(MID), end(MID))
    logged(tmp_path, NEW, start(NEW), end(NEW))
    assert runs(Follower(tmp_path, HERE, [MID, OLD, MID]).step()) == [OLD, OLD, MID, MID, NEW, NEW]


def test_a_file_that_is_not_a_log_is_no_run(tmp_path: pathlib.Path) -> None:
    logged(tmp_path, NEW, start(NEW))
    (tmp_path / "notes.txt").write_text("")
    (tmp_path / "old.jsonl.bak").write_text("")
    assert Follower(tmp_path, HERE, []).runs() == [NEW]


def test_a_log_ends_only_in_a_complete_run_end(tmp_path: pathlib.Path) -> None:
    logged(tmp_path, OLD, start(OLD), end(OLD))
    logged(tmp_path, MID, start(MID), end(MID)[:-1])
    logged(tmp_path, NEW, start(NEW))
    assert [ended(tmp_path / f"{OLD}.jsonl"), ended(tmp_path / f"{MID}.jsonl"), ended(tmp_path / f"{NEW}.jsonl")] == [True, False, False]


def test_a_run_end_after_a_line_longer_than_what_is_read_of_the_end(tmp_path: pathlib.Path) -> None:
    logged(tmp_path, OLD, start(OLD), line({"message": "x" * LAST}), end(OLD))
    logged(tmp_path, NEW, line({"message": "x" * LAST}))
    assert [ended(tmp_path / f"{OLD}.jsonl"), ended(tmp_path / f"{NEW}.jsonl")] == [True, False]


def test_a_log_of_one_run_end_has_ended(tmp_path: pathlib.Path) -> None:
    logged(tmp_path, OLD, end(OLD))
    assert ended(tmp_path / f"{OLD}.jsonl") is True


def test_a_log_that_is_gone_has_ended(tmp_path: pathlib.Path) -> None:
    assert ended(tmp_path / f"{OLD}.jsonl") is True


def test_only_the_last_bytes_of_a_long_log_are_read_for_its_end() -> None:
    assert [end_from(0), end_from(LAST), end_from(LAST + 5)] == [0, 0, 5]


def test_an_empty_log_has_not_ended(tmp_path: pathlib.Path) -> None:
    logged(tmp_path, OLD)
    assert ended(tmp_path / f"{OLD}.jsonl") is False
