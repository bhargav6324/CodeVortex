from datetime import datetime, timezone


def utc_now():
    return datetime.now(timezone.utc)


def stamp(value):
    if value.tzinfo is None:
        raise ValueError('Clock must be timezone-aware')
    return value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
