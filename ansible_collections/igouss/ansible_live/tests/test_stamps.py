import datetime

from ansible_collections.igouss.ansible_live.plugins.plugin_utils import stamps

EAST: datetime.timezone = datetime.timezone(datetime.timedelta(hours=3))


def test_a_run_is_named_by_its_utc_start_and_pid() -> None:
    assert stamps.run_id(datetime.datetime(2026, 9, 28, 17, 28, 21, tzinfo=EAST), 4242) == "20260928T142821Z-4242"


def test_an_event_is_timed_in_utc_to_the_millisecond() -> None:
    assert stamps.at(datetime.datetime(2026, 9, 28, 17, 28, 21, 123999, tzinfo=EAST)) == "2026-09-28T14:28:21.123Z"


def test_a_whole_second_still_has_its_milliseconds() -> None:
    assert stamps.at(datetime.datetime(2026, 9, 28, 14, 28, 21, tzinfo=datetime.timezone.utc)) == "2026-09-28T14:28:21.000Z"


def test_milliseconds_are_the_microseconds_truncated() -> None:
    assert stamps.at(datetime.datetime(2026, 9, 28, 14, 28, 21, 500000, tzinfo=datetime.timezone.utc)) == "2026-09-28T14:28:21.500Z"
