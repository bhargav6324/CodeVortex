"""Per-reviewer sliding-window limits; process-local, matching the one-worker demo."""
from collections import deque
import math
from threading import Lock
import time

from app.errors import ApiError

WINDOW_SECONDS = 60


class RateLimiter:
    def __init__(self, limits, clock=time.monotonic):
        self.limits = dict(limits)
        self.clock = clock
        self.hits = {}
        self.lock = Lock()

    def check(self, actor_id, bucket):
        limit = self.limits[bucket]
        now = self.clock()
        with self.lock:
            window = self.hits.setdefault((actor_id, bucket), deque())
            while window and window[0] <= now - WINDOW_SECONDS:
                window.popleft()
            if len(window) >= limit:
                retry_after = max(1, math.ceil(window[0] + WINDOW_SECONDS - now))
                raise ApiError(429, "RATE_LIMITED", "Too many requests; retry later.", retryable=True, retry_after=retry_after)
            window.append(now)
