"""What a task said, as a result's `message` records it (contract/SPEC.md FR-11)."""

from typing import Any, Mapping

LIMIT: int = 4000


def message(result: Mapping[str, Any]) -> str | None:
    """Its msg, failed assertion and stderr, each on its own line; else why it was skipped; for a loop, what each
    item said. None when it said nothing; never over LIMIT characters."""
    return _said(result)[:LIMIT] or None


def _said(result: Mapping[str, Any]) -> str:
    items: Any = result.get("results")
    if isinstance(items, list) and items:
        return "\n".join(said for item in items if isinstance(item, Mapping) and (said := _said(item)))
    said: list[str] = [text for key in ("msg", "assertion", "stderr") if (text := _text(result.get(key))).strip()]
    skipped: str = _text(result.get("skip_reason"))
    return "\n".join(said) if said else skipped if skipped.strip() else ""


def _text(said: Any) -> str:
    return "\n".join(map(str, said)) if isinstance(said, list) else str(said or "")
