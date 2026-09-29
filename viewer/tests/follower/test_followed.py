"""One run followed while its recorder writes, exits or is killed at any step: contract/formal/Follow.tla's
properties, checked on the code."""

import json
import pathlib
import shutil
import tempfile

import hypothesis.strategies as st
from hypothesis.stateful import RuleBasedStateMachine, initialize, invariant, precondition, rule

from viewer.plugin.follower.followed import Followed, Here, fields, lost
from recorder import Recorder, line
from viewer.plugin.follower.tail import Tail

RUN: str = "20260928T142821Z-4242"
HOST: str = "fedora"
AT: str = "2026-09-28T14:40:00.000Z"


class Following(RuleBasedStateMachine):
    @initialize(middle=st.integers(min_value=0, max_value=3), controller=st.sampled_from([HOST, "elsewhere"]))
    def start(self, middle: int, controller: str) -> None:
        self.directory: pathlib.Path = pathlib.Path(tempfile.mkdtemp())
        self.recorder: Recorder = Recorder(self.directory / f"{RUN}.jsonl", RUN, controller, middle)
        self.followed: Followed = Followed(RUN, Tail(self.recorder.path))
        self.here: Here = Here(HOST, self.alive, lambda: AT)
        self.emitted: list[bytes] = []
        self.finishing: bool = False

    def alive(self, pid: int) -> bool:
        """The pid's liveness; a step drawn as racing the recorder's end has the recorder finish just as it looks."""
        if self.finishing:
            self.recorder.finish()
            self.finishing = False
        return self.recorder.alive and pid == self.recorder.pid

    @precondition(lambda self: self.recorder.can_write())
    @rule()
    def write(self) -> None:
        self.recorder.write()

    @precondition(lambda self: self.recorder.mid_line())
    @rule()
    def end_line(self) -> None:
        self.recorder.end_line()

    @precondition(lambda self: self.recorder.can_exit())
    @rule()
    def exit(self) -> None:
        self.recorder.alive = False

    @precondition(lambda self: self.recorder.can_be_killed())
    @rule()
    def kill(self) -> None:
        self.recorder.alive = False

    @rule()
    def look(self) -> None:
        """The follower's next look; a run it is done with it no longer steps (Follower drops it)."""
        if not self.followed.done:
            self.step()

    def step(self) -> None:
        self.emitted += self.followed.step(self.here)
        assert self.logged() == self.recorder.complete()

    @precondition(lambda self: not self.followed.done and self.recorder.alive)
    @rule()
    def step_as_the_recorder_finishes(self) -> None:
        self.finishing = True
        self.step()

    @invariant()
    def each_line_once_in_order(self) -> None:
        assert self.logged() == self.recorder.complete()[:len(self.logged())]

    @invariant()
    def lost_only_when_dead_without_run_end(self) -> None:
        assert not self.followed.lost or (not self.recorder.alive and not self.recorder.ended())

    @invariant()
    def lost_said_once_last(self) -> None:
        assert self.emitted[len(self.logged()):] == ([lost(RUN, AT)] if self.followed.lost else [])

    def teardown(self) -> None:
        if hasattr(self, "directory"):
            self.settle()
            shutil.rmtree(self.directory)

    def settle(self) -> None:
        """Two more looks, then: ended exactly when the log says run.end, lost exactly when this host's recorder
        died without writing it. Two, because the look that first reads run.start checks no pid: it learns the pid
        only by reading, and checking it after the read is the order FR-14 forbids."""
        self.look()
        self.look()
        dead_here: bool = not self.recorder.alive and self.recorder.started() and self.recorder.controller == HOST
        assert (self.followed.ended, self.followed.lost) == (self.recorder.ended(), dead_here and not self.recorder.ended())

    def logged(self) -> list[bytes]:
        return [line for line in self.emitted if json.loads(line)["type"] != "run.lost"]


TestFollowing = Following.TestCase


def test_a_run_of_another_controller_is_never_lost(tmp_path: pathlib.Path) -> None:
    recorder: Recorder = Recorder(tmp_path / f"{RUN}.jsonl", RUN, "elsewhere", 0)
    recorder.write()
    recorder.end_line()
    recorder.alive = False
    followed: Followed = Followed(RUN, Tail(recorder.path))
    assert [followed.step(Here(HOST, lambda pid: False, lambda: AT)), followed.done] == [recorder.complete(), False]


def test_a_live_pid_is_not_lost(tmp_path: pathlib.Path) -> None:
    recorder: Recorder = Recorder(tmp_path / f"{RUN}.jsonl", RUN, HOST, 0)
    recorder.write()
    recorder.end_line()
    followed: Followed = Followed(RUN, Tail(recorder.path))
    here: Here = Here(HOST, lambda pid: pid == recorder.pid, lambda: AT)
    assert [followed.step(here), followed.step(here), followed.done] == [recorder.complete(), [], False]


def test_the_lost_line_is_the_contracts_compact_as_the_recorders_lines() -> None:
    assert lost(RUN, AT) == line({"v": 1, "type": "run.lost", "run": RUN, "at": AT})


def learned(*lines: bytes) -> Followed:
    followed: Followed = Followed(RUN, Tail(pathlib.Path("unread")))
    for each in lines:
        followed.learn(each)
    return followed


def test_the_pid_and_controller_are_learned_from_run_start_alone() -> None:
    assert [
        learned(b'{"type":"run.start","controller":"fedora","pid":7}\n').started,
        learned(b'{"type":"task.start","controller":"fedora","pid":7}\n').started,
        learned(b'{"type":"run.start","controller":null,"pid":7}\n').started,
        learned(b'{"type":"run.start","controller":"fedora","pid":"7"}\n').started,
        learned(b'{"type":"run.start","controller":"fedora","pid":true}\n').started,
    ] == [("fedora", 7), None, None, None, None]


def test_a_line_that_is_not_a_json_object_teaches_nothing() -> None:
    assert [fields(b"[1]\n"), fields(b"nope\n"), learned(b"[1]\n", b"nope\n").started] == [{}, {}, None]


def test_a_run_that_ends_while_its_pid_is_checked_ended_and_was_not_lost(tmp_path: pathlib.Path) -> None:
    """FollowNaive.tla's counterexample: run.start read, then run.end written and the process gone between the
    follower's read and its look at the pid."""
    recorder: Recorder = Recorder(tmp_path / f"{RUN}.jsonl", RUN, HOST, 1)
    recorder.write()
    recorder.end_line()
    followed: Followed = Followed(RUN, Tail(recorder.path))
    here: Here = Here(HOST, lambda pid: recorder.alive, lambda: AT)
    followed.step(here)
    finishing: Here = Here(HOST, lambda pid: recorder.finish() or recorder.alive, lambda: AT)
    assert [followed.step(finishing), followed.ended, followed.lost] == [recorder.lines[1:], True, False]
