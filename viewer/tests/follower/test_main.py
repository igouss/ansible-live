"""The follower's entry point, run in this process: its arguments, its output, its pace and how it stops."""

import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys

import pytest

from viewer.plugin.follower import __main__ as entry

CLEAN: pathlib.Path = pathlib.Path(__file__).parents[3] / "contract" / "examples" / "valid" / "clean.jsonl"
RUN: str = "20260928T142821Z-4242"


def test_this_process_is_alive() -> None:
    assert entry.alive(os.getpid()) is True


def test_a_process_of_another_user_is_alive() -> None:
    assert entry.alive(1) is True


def test_a_process_that_exited_is_not_alive() -> None:
    gone: subprocess.Popen[bytes] = subprocess.Popen(["true"])
    gone.wait()
    assert entry.alive(gone.pid) is False


def test_now_is_utc_with_milliseconds() -> None:
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", entry.now())


def test_asked_without_a_directory_it_says_how_to_ask(capsys: pytest.CaptureFixture[str]) -> None:
    assert [entry.main([]), capsys.readouterr().err] == [2, "usage: python3 -m follower <dir> [<run>...]\n"]


def interrupted(seconds: float) -> None:
    raise KeyboardInterrupt


def test_a_run_asked_for_is_written_though_it_is_neither_unended_nor_the_newest(
    tmp_path: pathlib.Path, capsysbinary: pytest.CaptureFixture[bytes], monkeypatch: pytest.MonkeyPatch,
) -> None:
    shutil.copy(CLEAN, tmp_path / f"{RUN}.jsonl")
    shutil.copy(CLEAN, tmp_path / "20260928T150000Z-1.jsonl")
    monkeypatch.setattr(entry.time, "sleep", interrupted)
    assert [entry.main([str(tmp_path), RUN]), capsysbinary.readouterr().out] == [0, CLEAN.read_bytes() * 2]


def test_following_looks_four_times_a_second_until_interrupted(
    tmp_path: pathlib.Path, capsysbinary: pytest.CaptureFixture[bytes], monkeypatch: pytest.MonkeyPatch,
) -> None:
    shutil.copy(CLEAN, tmp_path / f"{RUN}.jsonl")
    waits: list[float] = []

    def sleep(seconds: float) -> None:
        waits.append(seconds)
        raise KeyboardInterrupt

    monkeypatch.setattr(entry.time, "sleep", sleep)
    assert [entry.main([str(tmp_path)]), capsysbinary.readouterr().out, waits] == [0, CLEAN.read_bytes(), [0.25]]


def test_a_reader_that_went_away_ends_the_follower(tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch) -> None:
    shutil.copy(CLEAN, tmp_path / f"{RUN}.jsonl")

    class Gone:
        def write(self, data: bytes) -> int:
            raise BrokenPipeError

    monkeypatch.setattr(sys, "stdout", type("Out", (), {"buffer": Gone()})())
    assert entry.main([str(tmp_path)]) == 0


def test_a_run_whose_process_died_on_this_host_is_said_lost(
    tmp_path: pathlib.Path, capsysbinary: pytest.CaptureFixture[bytes], monkeypatch: pytest.MonkeyPatch,
) -> None:
    gone: subprocess.Popen[bytes] = subprocess.Popen(["true"])
    gone.wait()
    started: bytes = f'{{"v":1,"run":"{RUN}","seq":0,"type":"run.start","pid":{gone.pid},"controller":"{socket.gethostname()}"}}\n'.encode()
    (tmp_path / f"{RUN}.jsonl").write_bytes(started)
    looks: list[float] = []

    def twice(seconds: float) -> None:
        looks.append(seconds)
        if len(looks) == 2:
            raise KeyboardInterrupt

    monkeypatch.setattr(entry.time, "sleep", twice)
    code: int = entry.main([str(tmp_path)])
    said: list[bytes] = capsysbinary.readouterr().out.splitlines(keepends=True)
    assert [code, said[0], json.loads(said[1])["type"], json.loads(said[1])["run"], re.fullmatch(r".*\.\d{3}Z", json.loads(said[1])["at"]) is not None] == [
        0, started, "run.lost", RUN, True,
    ]
