"""Rate limiting and brute-force protection, shaped so it cannot be a weapon.

The usual brute-force defence -- lock the account after N failures -- hands an
attacker a way to lock any account they can name. So there are two mechanisms
answering two different questions:

- **per source**: a hard limit. A source making hundreds of attempts is an
  attacker whatever account it names, and refusing it costs a legitimate user
  nothing.
- **per account**: an increasing delay, never a lock. A victim under attack can
  still get in, slowly; the attacker gains nothing from making the delay longer.

Both take `now`, like everything else here, so the backoff curve can be tested
exactly rather than approximately.
"""

from __future__ import annotations

from collections import OrderedDict

from dataclasses import dataclass, field
from datetime import datetime, timedelta


#: A source gets this many failures in the window before it is refused outright.
SOURCE_LIMIT = 20
SOURCE_WINDOW = timedelta(minutes=15)

#: An account's delay doubles per failure, from one second, capped. Capped
#: because an uncapped curve becomes a lockout with extra steps.
ACCOUNT_BASE_DELAY = timedelta(seconds=1)
ACCOUNT_MAX_DELAY = timedelta(minutes=2)

#: Failures older than this stop counting for an account. An attempt last week
#: should not slow somebody down today.
ACCOUNT_MEMORY = timedelta(hours=1)


class SourceRefused(RuntimeError):
    """This source has made too many attempts. Not account-specific."""


class TooSoon(RuntimeError):
    """This account is in backoff. It says when the next attempt is allowed."""

    def __init__(self, retry_at: datetime) -> None:
        super().__init__(f"try again at {retry_at.isoformat()}")
        self.retry_at = retry_at


@dataclass
class _Attempts:
    failures: list[datetime] = field(default_factory=list)

    def prune(self, before: datetime) -> None:
        self.failures = [item for item in self.failures if item > before]


#: How many sources and accounts the throttle will remember at once. A cap is a
#: policy decision, not a tuning knob: without one the throttle is a memory
#: exhaustion primitive reachable from an unauthenticated endpoint.
MAX_TRACKED = 10_000


class Throttle:
    def __init__(
        self,
        *,
        source_limit: int = SOURCE_LIMIT,
        source_window: timedelta = SOURCE_WINDOW,
        account_memory: timedelta = ACCOUNT_MEMORY,
        max_tracked: int = MAX_TRACKED,
    ) -> None:
        # Bounded. `check()` called setdefault on both dicts for EVERY attempt
        # including successful ones, nothing evicted, and sign-in is the one
        # unauthenticated endpoint -- so a stranger could grow these without
        # limit by varying the account and source on each request. 500 guesses
        # left 500 source entries; 5000 successes left 5000 of each.
        self._sources: OrderedDict[str, _Attempts] = OrderedDict()
        self._accounts: OrderedDict[str, _Attempts] = OrderedDict()
        self._max_tracked = max_tracked
        self._source_limit = source_limit
        self._source_window = source_window
        self._account_memory = account_memory

    def check(self, *, account: str, source_hash: str, now: datetime) -> None:
        """Raise if this attempt should not happen yet."""

        source = self._track(self._sources, source_hash)
        source.prune(now - self._source_window)
        if len(source.failures) >= self._source_limit:
            raise SourceRefused(f"{source_hash} has made too many attempts")

        attempts = self._track(self._accounts, account)
        attempts.prune(now - self._account_memory)
        if not attempts.failures:
            # Nothing to remember about this one; do not hold a slot for it.
            self._sources.pop(source_hash, None) if not source.failures else None
            self._accounts.pop(account, None)
            return
        delay = self.delay_after(len(attempts.failures))
        retry_at = attempts.failures[-1] + delay
        if now < retry_at:
            raise TooSoon(retry_at)

    def record_failure(self, *, account: str, source_hash: str, now: datetime) -> None:
        self._track(self._sources, source_hash).failures.append(now)
        self._track(self._accounts, account).failures.append(now)

    def _track(self, store: "OrderedDict[str, _Attempts]", key: str) -> "_Attempts":
        """Fetch or create an entry, evicting the least recently touched.

        Least-recently-used rather than random: the entries worth keeping are the
        ones currently failing, and those are touched on every attempt.
        """

        if key in store:
            store.move_to_end(key)
        else:
            store[key] = _Attempts()
            while len(store) > self._max_tracked:
                store.popitem(last=False)
        return store[key]

    def record_success(self, *, account: str, source_hash: str) -> None:
        """A success clears the account's backoff, not the source's limit.

        Deliberately asymmetric: knowing one password does not make a source that
        has failed nineteen times trustworthy.
        """

        self._accounts.pop(account, None)

    @staticmethod
    def delay_after(failures: int) -> timedelta:
        if failures < 1:
            return timedelta(0)
        doubled = ACCOUNT_BASE_DELAY * (2 ** (failures - 1))
        return min(doubled, ACCOUNT_MAX_DELAY)

    def failures_for(self, account: str) -> int:
        return len(self._accounts.get(account, _Attempts()).failures)
