"""The contract's schemas as validators: what a recorder may write, and what a follower may emit."""

import json
import pathlib
from typing import Any

import jsonschema
import referencing

CONTRACT: pathlib.Path = pathlib.Path(__file__).resolve().parent
_RECORDER_SCHEMA: dict[str, Any] = json.loads((CONTRACT / "recorder.v1.schema.json").read_text())
_STREAM_SCHEMA: dict[str, Any] = json.loads((CONTRACT / "stream.v1.schema.json").read_text())
_REGISTRY: referencing.Registry = referencing.Registry().with_resource(
    _RECORDER_SCHEMA["$id"], referencing.Resource.from_contents(_RECORDER_SCHEMA))
RECORDER: jsonschema.Draft202012Validator = jsonschema.Draft202012Validator(_RECORDER_SCHEMA, registry=_REGISTRY)
STREAM: jsonschema.Draft202012Validator = jsonschema.Draft202012Validator(_STREAM_SCHEMA, registry=_REGISTRY)
