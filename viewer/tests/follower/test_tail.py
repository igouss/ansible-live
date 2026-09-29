import pathlib

import pytest

from viewer.plugin.follower.tail import Tail


def grown(path: pathlib.Path, text: bytes) -> None:
    with path.open("ab") as log:
        log.write(text)


def test_an_empty_log_has_no_lines(tmp_path: pathlib.Path) -> None:
    (tmp_path / "r.jsonl").write_bytes(b"")
    assert Tail(tmp_path / "r.jsonl").read() == []


def test_one_line_is_read_once(tmp_path: pathlib.Path) -> None:
    (tmp_path / "r.jsonl").write_bytes(b'{"seq":0}\n')
    tail: Tail = Tail(tmp_path / "r.jsonl")
    assert [tail.read(), tail.read()] == [[b'{"seq":0}\n'], []]


def test_many_lines_in_the_order_written_and_as_written(tmp_path: pathlib.Path) -> None:
    (tmp_path / "r.jsonl").write_bytes('{"seq":0}\n{"m":"déjà"}\n'.encode())
    assert Tail(tmp_path / "r.jsonl").read() == [b'{"seq":0}\n', '{"m":"déjà"}\n'.encode()]


def test_a_line_without_its_newline_is_held_until_it_has_one(tmp_path: pathlib.Path) -> None:
    (tmp_path / "r.jsonl").write_bytes(b'{"seq":0}\n{"se')
    tail: Tail = Tail(tmp_path / "r.jsonl")
    first: list[bytes] = tail.read()
    grown(tmp_path / "r.jsonl", b'q":1}')
    second: list[bytes] = tail.read()
    grown(tmp_path / "r.jsonl", b'\n{"seq":2}\n')
    assert [first, second, tail.read()] == [[b'{"seq":0}\n'], [], [b'{"seq":1}\n', b'{"seq":2}\n']]


def test_a_log_that_is_gone_says_so(tmp_path: pathlib.Path) -> None:
    with pytest.raises(FileNotFoundError):
        Tail(tmp_path / "r.jsonl").read()
