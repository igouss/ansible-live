"""Shared by every Python test: the Hypothesis profile `just mutate` runs them under, and a state home of their own."""

import pathlib

import pytest
from hypothesis import HealthCheck, settings

settings.register_profile("mutation", suppress_health_check=[HealthCheck.too_slow], deadline=None)


@pytest.fixture(autouse=True)
def own_state_home(tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch) -> pathlib.Path:
    """No test, and no mutant that loses the configured directory, writes to the operator's own logs (FR-1): both
    places a log goes by default are a test's own."""
    home: pathlib.Path = tmp_path_factory.mktemp("home")
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("XDG_STATE_HOME", str(home / ".local" / "state"))
    return home
