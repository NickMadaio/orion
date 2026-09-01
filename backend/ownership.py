"""Ownership, resolved on the server, applied before any read.

Two of the manifest's invariants live here: "client-provided user ownership
fields cannot override server ownership" and "one user cannot access another
user's data". The way both fail is the same -- some handler passes a `user_id`
from a request body into a query -- so the defence is structural rather than
diligent:

- an `Owner` can only be made from an authenticated session, not from a payload;
- `Repository` has **no method that does not take an owner**. There is no
  unscoped read to forget to scope.

The store here is in memory. Phase 11 replaces it with tables and must subclass
this rather than query around it; a test asserts every repository still takes an
owner first.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping

from orion.core.audit.patterns import normalize_field
from orion.shared.identifiers import Identifier
from orion.shared.json_values import freeze_json_object


#: Keys a client might send that name an owner. Stripped from every payload
#: before it reaches a handler, and recorded when they appear -- a client sending
#: one is either a bug or an attempt.
CLIENT_OWNERSHIP_KEYS = frozenset(
    {
        "user_id", "user", "owner", "owner_id", "account_id", "on_behalf_of",
        "actor_id", "uid", "sub", "principal", "principal_id", "as_user",
    }
)


class OwnershipViolation(PermissionError):
    """A read or write crossed a user boundary."""


class ClientOwnershipRefused(ValueError):
    """A payload tried to say who it belonged to."""


@dataclass(frozen=True, slots=True)
class Session:
    """What authentication produced. The only source of an Owner."""

    session_id: Identifier
    user_id: Identifier
    device_id: Identifier

    def __post_init__(self) -> None:
        for field in ("session_id", "user_id", "device_id"):
            object.__setattr__(self, field, Identifier(getattr(self, field)))


#: The token `resolve_owner` holds and nothing else can name. A docstring saying
#: "construct this through resolve_owner" is a request; this is a mechanism --
#: without it, a handler doing `Owner(payload["user_id"], session.session_id)`
#: passes every check in this module and every test in the suite.
class _Resolution:
    """Proof that a user id came from an authenticated session."""

    __slots__ = ()


_RESOLVED = _Resolution()


@dataclass(frozen=True, slots=True)
class Owner:
    """A user id the server resolved. Only `resolve_owner` can build one."""

    user_id: Identifier
    session_id: Identifier
    proof: _Resolution

    def __post_init__(self) -> None:
        if self.proof is not _RESOLVED:
            raise ClientOwnershipRefused(
                "an Owner may only be created by resolve_owner, from a Session"
            )
        object.__setattr__(self, "user_id", Identifier(self.user_id))
        object.__setattr__(self, "session_id", Identifier(self.session_id))


def resolve_owner(session: Session) -> Owner:
    if not isinstance(session, Session):
        raise ClientOwnershipRefused("an owner comes from an authenticated session")
    return Owner(user_id=session.user_id, session_id=session.session_id, proof=_RESOLVED)


def strip_client_ownership(payload: Mapping[str, object]) -> tuple[Mapping[str, object], tuple[str, ...]]:
    """Remove any ownership claim from a request body.

    Returns the cleaned payload and what was stripped, so a handler can audit the
    attempt instead of silently discarding it.
    """

    if not isinstance(payload, Mapping):
        raise ValueError("payload must be a mapping")
    # Normalized the same way the redactor normalizes field names, so `user-id`,
    # `User Id` and `userId` are the one key they obviously are.
    stripped = tuple(
        sorted(key for key in payload if normalize_field(key) in CLIENT_OWNERSHIP_KEYS)
    )
    cleaned = {
        key: value for key, value in payload.items()
        if normalize_field(key) not in CLIENT_OWNERSHIP_KEYS
    }
    return cleaned, stripped


@dataclass(frozen=True, slots=True)
class Record:
    record_id: Identifier
    owner_id: Identifier
    kind: str
    value: Mapping[str, object]

    def __post_init__(self) -> None:
        object.__setattr__(self, "record_id", Identifier(self.record_id))
        object.__setattr__(self, "owner_id", Identifier(self.owner_id))
        if not isinstance(self.kind, str) or not self.kind:
            raise ValueError("kind must be a non-empty string")
        object.__setattr__(self, "value", freeze_json_object(self.value, "value"))


class Repository:
    """Owner-scoped storage. Every method takes the owner first.

    That is the whole design. A repository with an unscoped `all()` will have it
    called by something, and the ownership check will live in whichever callers
    remembered.
    """

    def __init__(self, kind: str) -> None:
        if not isinstance(kind, str) or not kind:
            raise ValueError("a repository must say what it holds")
        self.kind = kind
        # Keyed by (owner, record id). Global ids would give two things away:
        # another user's record could be probed for existence, and an id could
        # be squatted so its rightful owner could never write it.
        self._records: dict[tuple[str, str], Record] = {}

    def put(self, owner: Owner, record_id: str, value: Mapping[str, object]) -> Record:
        _require_owner(owner)
        record = Record(record_id=record_id, owner_id=owner.user_id, kind=self.kind, value=value)
        self._records[(str(owner.user_id), str(record_id))] = record
        return record

    def get(self, owner: Owner, record_id: str) -> Record:
        _require_owner(owner)
        record = self._records.get((str(owner.user_id), str(record_id)))
        if record is None:
            # "Not found" is the ONLY answer another user gets. Distinguishing
            # "not yours" would make ids enumerable, which is the oracle half of
            # the invariant this class exists for.
            raise KeyError(f"no {self.kind} {record_id}")
        return record

    def list(self, owner: Owner) -> tuple[Record, ...]:
        _require_owner(owner)
        return tuple(
            record for (user, _), record in self._records.items()
            if user == str(owner.user_id)
        )

    def delete(self, owner: Owner, record_id: str) -> None:
        self.get(owner, record_id)
        self._records.pop((str(owner.user_id), str(record_id)), None)

    def count(self, owner: Owner) -> int:
        return len(self.list(owner))


def _require_owner(owner: object) -> None:
    if not isinstance(owner, Owner):
        raise OwnershipViolation("every repository call needs a server-resolved owner")


def owner_first_violations(repository_type: type = Repository) -> list[str]:
    """Every public method whose first argument is not `owner`.

    Structural, so a repository added in Phase 11 that quietly offers an unscoped
    read fails here rather than in an incident.
    """

    import inspect

    violations: list[str] = []
    for name, member in inspect.getmembers(repository_type, predicate=inspect.isfunction):
        if name.startswith("_"):
            continue
        parameters = list(inspect.signature(member).parameters)
        if len(parameters) < 2 or parameters[1] != "owner":
            violations.append(f"{repository_type.__name__}.{name} does not take an owner first")
    return violations
