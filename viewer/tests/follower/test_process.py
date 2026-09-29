"""The follower as the pane runs it: a process writing the stream on standard output."""

import pathlib
import shutil
import subprocess
import sys

import pytest

PLUGIN: pathlib.Path = pathlib.Path(__file__).parents[2] / "plugin"
CLEAN: pathlib.Path = pathlib.Path(__file__).parents[3] / "contract" / "examples" / "valid" / "clean.jsonl"
RUN: str = "20260928T142821Z-4242"


def test_the_newest_run_is_written_unchanged_and_the_follower_keeps_following(tmp_path: pathlib.Path) -> None:
    shutil.copy(CLEAN, tmp_path / f"{RUN}.jsonl")
    with pytest.raises(subprocess.TimeoutExpired) as following:
        subprocess.run([sys.executable, "-m", "follower", tmp_path], cwd=PLUGIN, capture_output=True, timeout=2)
    assert following.value.stdout == CLEAN.read_bytes()


def test_a_follower_asked_wrongly_says_how_to_ask(tmp_path: pathlib.Path) -> None:
    ran: subprocess.CompletedProcess[bytes] = subprocess.run([sys.executable, "-m", "follower"], cwd=PLUGIN, capture_output=True, timeout=10)
    assert [ran.returncode, ran.stdout, ran.stderr] == [2, b"", b"usage: python3 -m follower <dir> [<run>...]\n"]
