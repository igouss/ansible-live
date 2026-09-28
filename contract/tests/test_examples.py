"""Every example log is judged by the schemas and check.py exactly as SPEC.md says it should be."""

import json
import pathlib
from typing import Any

import jsonschema
import pytest
import referencing

import check

CONTRACT: pathlib.Path = pathlib.Path(__file__).resolve().parents[1]
EXAMPLES: pathlib.Path = CONTRACT / "examples"
RECORDER_SCHEMA: dict[str, Any] = json.loads((CONTRACT / "recorder.v1.schema.json").read_text())
STREAM_SCHEMA: dict[str, Any] = json.loads((CONTRACT / "stream.v1.schema.json").read_text())
REGISTRY: referencing.Registry = referencing.Registry().with_resource(
    RECORDER_SCHEMA["$id"], referencing.Resource.from_contents(RECORDER_SCHEMA))
RECORDER: jsonschema.Draft202012Validator = jsonschema.Draft202012Validator(RECORDER_SCHEMA, registry=REGISTRY)
STREAM: jsonschema.Draft202012Validator = jsonschema.Draft202012Validator(STREAM_SCHEMA, registry=REGISTRY)

LOGS: dict[str, tuple[bool, set[str]]] = {
    "valid/clean.jsonl": (True, set()),
    "valid/failing_then_ok.jsonl": (True, set()),
    "valid/interrupted.jsonl": (True, set()),
    "valid/killed.jsonl": (True, set()),
    "valid/serial.jsonl": (True, set()),
    "valid/unreachable.jsonl": (True, set()),
    "invalid/FR-4-message-over-4000.jsonl": (False, set()),
    "invalid/FR-4-outcome-changed.jsonl": (False, set()),
    "invalid/FR-5-at-without-milliseconds.jsonl": (False, set()),
    "invalid/FR-5-run-id-without-pid.jsonl": (False, set()),
    "invalid/FR-11-extra-var-values.jsonl": (False, set()),
    "invalid/FR-11-task-arguments.jsonl": (False, set()),
    "invalid/FR-6-seq-gap.jsonl": (True, {"FR-6"}),
    "invalid/FR-6-seq-repeated.jsonl": (True, {"FR-6"}),
    "invalid/FR-7-run-start-not-first.jsonl": (True, {"FR-7"}),
    "invalid/FR-7-event-after-run-end.jsonl": (True, {"FR-7"}),
    "invalid/FR-7-two-events-after-run-end.jsonl": (True, {"FR-7"}),
    "invalid/FR-8-play-before-playbook.jsonl": (True, {"FR-8"}),
    "invalid/FR-8-task-in-unstarted-play.jsonl": (True, {"FR-8"}),
    "invalid/FR-8-result-for-unstarted-task.jsonl": (True, {"FR-8"}),
    "invalid/FR-9-ok-after-a-failed-playbook.jsonl": (True, {"FR-9"}),
    "invalid/FR-9-failed-while-a-playbook-was-open.jsonl": (True, {"FR-9"}),
    "invalid/FR-17-ok-with-a-failed-host.jsonl": (True, {"FR-17"}),
}
STREAMS: dict[str, bool] = {
    "stream/killed_then_lost.jsonl": True,
    "stream/FR-14-lost-with-seq.jsonl": False,
}


def lines(name: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in (EXAMPLES / name).read_text().splitlines()]


def test_every_example_is_listed_here() -> None:
    found: set[str] = {str(path.relative_to(EXAMPLES)) for path in EXAMPLES.rglob("*.jsonl")}
    assert found == set(LOGS) | set(STREAMS)


@pytest.mark.parametrize(("name", "valid"), [(name, valid) for name, (valid, _) in LOGS.items()])
def test_a_log_is_judged_by_the_recorder_schema(name: str, valid: bool) -> None:
    assert all(map(RECORDER.is_valid, lines(name))) == valid


@pytest.mark.parametrize(("name", "rules"), [(name, rules) for name, (_, rules) in LOGS.items()])
def test_a_log_breaks_exactly_its_rules(name: str, rules: set[str]) -> None:
    assert {violation.rule for violation in check.violations(lines(name))} == rules


@pytest.mark.parametrize(("name", "valid"), STREAMS.items())
def test_a_stream_is_judged_by_the_stream_schema(name: str, valid: bool) -> None:
    assert all(map(STREAM.is_valid, lines(name))) == valid


def test_a_recorder_never_writes_run_lost() -> None:
    assert not RECORDER.is_valid(lines("stream/killed_then_lost.jsonl")[-1])


def test_every_recorder_line_is_a_stream_line() -> None:
    assert all(map(STREAM.is_valid, lines("valid/clean.jsonl")))
