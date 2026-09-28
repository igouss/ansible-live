from hypothesis import given, strategies as st

from ansible_collections.igouss.ansible_live.plugins.plugin_utils import said


def test_a_task_that_said_nothing() -> None:
    assert said.message({"changed": False}) is None


def test_its_msg() -> None:
    assert said.message({"msg": "web2 answered 503"}) == "web2 answered 503"


def test_a_failed_assert_s_msg_and_the_assertion_that_failed() -> None:
    assert said.message({"msg": "Assertion failed", "assertion": "port == 8080"}) == "Assertion failed\nport == 8080"


def test_its_stderr_when_it_has_no_msg() -> None:
    assert said.message({"msg": "", "stderr": "sudo: a password is required"}) == "sudo: a password is required"


def test_why_it_was_skipped_only_when_nothing_else_was_said() -> None:
    assert said.message({"msg": "a", "skip_reason": "Conditional result was False"}) == "a"


def test_why_it_was_skipped() -> None:
    assert said.message({"skip_reason": "Conditional result was False"}) == "Conditional result was False"


def test_a_list_msg_is_its_lines() -> None:
    assert said.message({"msg": ["one", "two"]}) == "one\ntwo"


def test_a_loop_is_what_its_items_said_not_the_summary() -> None:
    looped: dict[str, object] = {"msg": "All items completed", "results": [{"msg": "a"}, {"changed": True}, {"stderr": "b"}]}
    assert said.message(looped) == "a\nb"


def test_a_loop_whose_items_said_nothing() -> None:
    assert said.message({"msg": "All items completed", "results": [{"changed": False}]}) is None


def test_an_empty_loop_says_its_msg() -> None:
    assert said.message({"msg": "nothing to loop over", "results": []}) == "nothing to loop over"


def test_a_long_message_is_cut_at_the_limit() -> None:
    assert said.message({"msg": "x" * 4001}) == "x" * 4000


def test_a_blank_skip_reason_says_nothing() -> None:
    assert said.message({"skip_reason": "  "}) is None


texts: st.SearchStrategy[str] = st.text(max_size=20) | st.integers(3995, 4005).map(lambda n: "é" * n)


@given(st.dictionaries(st.sampled_from(["msg", "assertion", "stderr", "skip_reason", "changed", "results"]),
                       st.one_of(texts, st.lists(texts, max_size=3),
                                 st.lists(st.fixed_dictionaries({"msg": texts}), max_size=3), st.none())))
def test_what_a_task_said_is_never_over_the_limit(result: dict[str, object]) -> None:
    assert len(said.message(result) or "") <= 4000


@given(st.text(min_size=1).filter(str.strip), st.text())
def test_a_msg_always_leads(msg: str, stderr: str) -> None:
    assert (said.message({"msg": msg, "stderr": stderr}) or "").startswith(msg[:4000])
