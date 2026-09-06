"""The role-to-model contract: strict decoding and resolution.

ORION owns this contract; OpenClaw and the native surfaces execute it. That
division is the whole of the Phase 2 decision — see planning/v2/PHASE_2_PLAN.md.
This module is the reference validator for the language-neutral schema at
orion/core/schemas/model-roles.schema.json, in the same relationship the Phase 1
envelopes have to theirs. It resolves and validates; it never performs
inference, opens a socket, or reads a credential.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Mapping


SCHEMA_VERSION = 1

# The manifest names six roles. Two departures, both deliberate and recorded in
# PHASE_2_PLAN.md rather than taken quietly:
#
#   `fallback` is absent. It is a property of a role, not a role. A model is not
#   "the fallback model" in the abstract; it is what THIS role falls back to,
#   which is why fallbacks live on each role below.
#
#   `stt` and `tts` are added. Deepgram and ElevenLabs are model calls with
#   credentials, latency and cost. Leaving them out because the manifest's list
#   did not name them would leave two of ORION's five inference surfaces
#   unrouted, which is the exact problem this phase exists to close.
ROLES = (
    "reasoning",
    "fast",
    "vision",
    "local",
    "embedding",
    "stt",
    "tts",
    # Added for governed self-development (planning/v2/PHASE_GOVERNED_SELF_DEVELOPMENT.md),
    # off by default. Non-urgent coding work has a different correctness bar than
    # `local`'s text transforms -- a wrong sentence is embarrassing, a wrong diff
    # is a bug -- so it gets its own role rather than borrowing `local`'s, even
    # though today they resolve to the same model. See the seed's note for the
    # measurement that picked it.
    "coder",
)

_PROVIDER = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
_MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_MODEL_REF = re.compile(r"^([a-z][a-z0-9_-]{0,31})/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$")

_ROLE_FIELDS = frozenset({"primary", "fallbacks", "timeout_seconds", "max_retries", "rates", "note"})
_ROLE_REQUIRED = frozenset({"primary", "fallbacks", "timeout_seconds", "max_retries"})
_RATE_FIELDS = frozenset(
    {"input_per_mtok", "output_per_mtok", "cache_read_per_mtok", "cache_write_per_mtok"}
)
_RATE_REQUIRED = frozenset({"input_per_mtok", "output_per_mtok"})
_PROVIDER_FIELDS = frozenset({"endpoint", "credential"})
_CREDENTIAL_FIELDS = frozenset({"source", "ref"})
# `env_plaintext` is not an endorsement. It exists so the contract can state a
# truth that is currently ugly -- Deepgram and ElevenLabs keys sit readable in
# .env -- instead of quietly claiming a Keychain reference that does not exist.
# A gap you can query is a gap you can close; `plaintext_providers()` below is
# what makes "never give models credentials" a test rather than an aspiration.
_CREDENTIAL_SOURCES = frozenset({"keychain", "env_plaintext", "none"})
_CREDENTIAL_SOURCES_NEEDING_REF = frozenset({"keychain", "env_plaintext"})

# A contract that carries a secret has already failed at its only job. These are
# checked by name and by shape, because the way this goes wrong is someone
# pasting a working key in "just to test it" and never taking it out.
_SECRET_SHAPED = re.compile(
    r"(sk-ant-|sk-proj-|sk-[A-Za-z0-9]{16,}|Bearer\s+\S+|[A-Za-z0-9_\-]{40,})"
)
_SECRET_NAMES = ("api_key", "apikey", "secret", "token", "password", "credential_value")


@dataclass(frozen=True, slots=True)
class ModelRef:
    """A `provider/model` pair that has been checked, not merely split."""

    provider: str
    model: str

    def __str__(self) -> str:
        return f"{self.provider}/{self.model}"


@dataclass(frozen=True, slots=True)
class Rates:
    input_per_mtok: float
    output_per_mtok: float
    cache_read_per_mtok: float | None = None
    cache_write_per_mtok: float | None = None


@dataclass(frozen=True, slots=True)
class RoleBinding:
    name: str
    primary: ModelRef | None
    fallbacks: tuple[ModelRef, ...]
    timeout_seconds: int
    max_retries: int
    rates: Rates | None
    note: str | None

    @property
    def assigned(self) -> bool:
        """False for a role declared but not yet pointed at a model."""

        return self.primary is not None

    def chain(self) -> tuple[ModelRef, ...]:
        """Primary first, then fallbacks, in the order they will be tried."""

        return ((self.primary,) if self.primary else ()) + self.fallbacks


@dataclass(frozen=True, slots=True)
class ProviderBinding:
    name: str
    endpoint: str | None
    credential_source: str
    credential_ref: str | None


@dataclass(frozen=True, slots=True)
class ModelRoleContract:
    schema_version: int
    roles: Mapping[str, RoleBinding]
    providers: Mapping[str, ProviderBinding]
    # Models seen in past traffic that nothing routes to any more. Kept so the
    # contract can describe its own history: a telemetry pass over old sessions
    # would otherwise have to invent a role or silently drop the rows.
    retired: Mapping[str, str]

    def role(self, name: str) -> RoleBinding:
        try:
            return self.roles[name]
        except KeyError:
            raise ValueError(f"unknown role: {name}") from None

    def plaintext_providers(self) -> tuple[str, ...]:
        """Providers whose credential is still readable on disk.

        The manifest says never give models credentials. This turns that from a
        sentence into something a test can assert is empty.
        """

        return tuple(
            sorted(
                name
                for name, binding in self.providers.items()
                if binding.credential_source == "env_plaintext"
            )
        )

    def resolve(self, name: str) -> ModelRef:
        """The model a surface should use for this role, right now.

        Raises for an unassigned role rather than silently substituting a
        different one. A caller that asked for `vision` and quietly received a
        text model would produce confident nonsense, which is worse than an
        error a human can read.
        """

        binding = self.role(name)
        if binding.primary is None:
            raise ValueError(f"role {name} is declared but unassigned")
        return binding.primary


def _strict(data: object, expected: frozenset[str], required: frozenset[str], what: str) -> Mapping:
    if not isinstance(data, dict):
        raise ValueError(f"{what} must be a JSON object")
    unknown = sorted(set(data) - expected)
    missing = sorted(required - set(data))
    if unknown or missing:
        raise ValueError(f"{what} fields mismatch: unknown={unknown} missing={missing}")
    return data


def _bounded_int(value: object, field: str, low: int, high: int) -> int:
    if type(value) is not int or isinstance(value, bool):
        raise ValueError(f"{field} must be an integer")
    if not low <= value <= high:
        raise ValueError(f"{field} must be between {low} and {high}")
    return value


def _rate(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a number")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        raise ValueError(f"{field} must be finite")
    if number < 0:
        raise ValueError(f"{field} must not be negative")
    return number


def _model_ref(value: object, field: str) -> ModelRef:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a provider/model string")
    match = _MODEL_REF.fullmatch(value)
    if not match:
        raise ValueError(f"{field} must look like provider/model, got {value!r}")
    return ModelRef(provider=match.group(1), model=match.group(2))


def _rates(data: object) -> Rates:
    fields = _strict(data, _RATE_FIELDS, _RATE_REQUIRED, "rates")
    return Rates(
        input_per_mtok=_rate(fields["input_per_mtok"], "input_per_mtok"),
        output_per_mtok=_rate(fields["output_per_mtok"], "output_per_mtok"),
        cache_read_per_mtok=(
            _rate(fields["cache_read_per_mtok"], "cache_read_per_mtok")
            if "cache_read_per_mtok" in fields
            else None
        ),
        cache_write_per_mtok=(
            _rate(fields["cache_write_per_mtok"], "cache_write_per_mtok")
            if "cache_write_per_mtok" in fields
            else None
        ),
    )


def _role(name: str, data: object) -> RoleBinding:
    fields = _strict(data, _ROLE_FIELDS, _ROLE_REQUIRED, f"role {name}")
    primary = None if fields["primary"] is None else _model_ref(fields["primary"], f"{name}.primary")
    raw_fallbacks = fields["fallbacks"]
    if not isinstance(raw_fallbacks, list):
        raise ValueError(f"{name}.fallbacks must be a JSON array")
    if len(raw_fallbacks) > 8:
        raise ValueError(f"{name}.fallbacks is longer than 8")
    fallbacks = tuple(
        _model_ref(item, f"{name}.fallbacks[{index}]")
        for index, item in enumerate(raw_fallbacks)
    )
    if primary is None and fallbacks:
        raise ValueError(f"{name} has fallbacks but no primary to fall back FROM")
    seen = [str(ref) for ref in ((primary,) if primary else ()) + fallbacks]
    if len(set(seen)) != len(seen):
        # A chain that retries the same model twice looks like resilience and is
        # not: whatever failed the first time is still true.
        raise ValueError(f"{name} lists the same model twice in its chain")
    note = fields.get("note")
    if note is not None and (not isinstance(note, str) or len(note) > 512):
        raise ValueError(f"{name}.note must be a string under 512 characters")
    return RoleBinding(
        name=name,
        primary=primary,
        fallbacks=fallbacks,
        timeout_seconds=_bounded_int(fields["timeout_seconds"], f"{name}.timeout_seconds", 1, 3600),
        max_retries=_bounded_int(fields["max_retries"], f"{name}.max_retries", 0, 8),
        rates=_rates(fields["rates"]) if "rates" in fields else None,
        note=note,
    )


def _provider(name: str, data: object) -> ProviderBinding:
    if not _PROVIDER.fullmatch(name):
        raise ValueError(f"provider name has an invalid format: {name!r}")
    fields = _strict(data, _PROVIDER_FIELDS, frozenset({"credential"}), f"provider {name}")
    credential = _strict(
        fields["credential"], _CREDENTIAL_FIELDS, frozenset({"source"}), f"{name}.credential"
    )
    source = credential["source"]
    if source not in _CREDENTIAL_SOURCES:
        raise ValueError(f"{name}.credential.source must be one of {sorted(_CREDENTIAL_SOURCES)}")
    ref = credential.get("ref")
    if source in _CREDENTIAL_SOURCES_NEEDING_REF and not (isinstance(ref, str) and ref):
        raise ValueError(f"{name}.credential.ref is required when source is {source}")
    if source == "none" and ref is not None:
        raise ValueError(f"{name}.credential.ref must be absent when source is none")
    endpoint = fields.get("endpoint")
    if endpoint is not None and (not isinstance(endpoint, str) or len(endpoint) > 512):
        raise ValueError(f"{name}.endpoint must be a string under 512 characters")
    return ProviderBinding(
        name=name,
        endpoint=endpoint,
        credential_source=source,
        credential_ref=ref,
    )


def assert_carries_no_secret(data: object, path: str = "contract") -> None:
    """Fail loudly if anything secret-shaped reached the contract.

    The contract records where a credential LIVES. The moment it records the
    credential itself, every reader of a world-readable config file has it. This
    walks the document because the failure mode is human: someone pastes a real
    key to test something and forgets to take it out.
    """

    if isinstance(data, dict):
        for key, value in data.items():
            lowered = str(key).lower()
            if any(marker in lowered for marker in _SECRET_NAMES):
                raise ValueError(f"{path}.{key} names a secret; the contract stores references only")
            assert_carries_no_secret(value, f"{path}.{key}")
        return
    if isinstance(data, list):
        for index, item in enumerate(data):
            assert_carries_no_secret(item, f"{path}[{index}]")
        return
    if isinstance(data, str) and _SECRET_SHAPED.search(data):
        raise ValueError(f"{path} contains a secret-shaped value")


def decode_contract(data: object) -> ModelRoleContract:
    """Decode and fully validate a role contract, or raise."""

    fields = _strict(
        data,
        frozenset({"schema_version", "roles", "providers", "retired"}),
        frozenset({"schema_version", "roles", "providers"}),
        "contract",
    )
    if type(fields["schema_version"]) is not int or fields["schema_version"] != SCHEMA_VERSION:
        raise ValueError("unsupported schema version")
    assert_carries_no_secret(fields)

    raw_roles = fields["roles"]
    if not isinstance(raw_roles, dict):
        raise ValueError("roles must be a JSON object")
    unknown = sorted(set(raw_roles) - set(ROLES))
    missing = sorted(set(ROLES) - set(raw_roles))
    if unknown or missing:
        raise ValueError(f"roles mismatch: unknown={unknown} missing={missing}")
    roles = {name: _role(name, raw_roles[name]) for name in ROLES}

    raw_providers = fields["providers"]
    if not isinstance(raw_providers, dict) or not raw_providers:
        raise ValueError("providers must be a non-empty JSON object")
    providers = {name: _provider(name, value) for name, value in raw_providers.items()}

    # Every model a role can reach must name a provider that exists. Without
    # this the contract can pass every field check and still be unroutable.
    for binding in roles.values():
        for ref in binding.chain():
            if ref.provider not in providers:
                raise ValueError(
                    f"role {binding.name} references undeclared provider {ref.provider!r}"
                )

    raw_retired = fields.get("retired", {})
    if not isinstance(raw_retired, dict):
        raise ValueError("retired must be a JSON object")
    retired: dict[str, str] = {}
    for reference, role_name in raw_retired.items():
        # Validates the shape but deliberately NOT the provider: a retired model
        # may name a provider that was removed, and rejecting that would force
        # the contract to keep dead providers alive to describe dead models.
        _model_ref(reference, f"retired[{reference!r}]")
        if role_name not in ROLES:
            raise ValueError(f"retired[{reference!r}] names unknown role {role_name!r}")
        if reference in {str(ref) for b in roles.values() for ref in b.chain()}:
            raise ValueError(f"{reference} is both retired and actively routed")
        retired[reference] = role_name

    return ModelRoleContract(
        schema_version=SCHEMA_VERSION,
        roles=dict(roles),
        providers=dict(providers),
        retired=retired,
    )
