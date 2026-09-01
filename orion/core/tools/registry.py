"""The capability registry: what every tool declares about itself.

Reference validator for orion/core/schemas/capability.schema.json, in the same
relationship the Phase 1 envelopes and the Phase 2 model contract have to theirs.

The live executor keeps its flat action names. Renaming 59 of them would break
working prompts, a thousand ledger rows, and the approval hashes that gate a
`needs_approval` re-call -- for a cosmetic gain. So each entry maps one live
action onto the structured contract instead, and `catalog.ts` stays the
implementation.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Mapping, Sequence

from orion.core.context.domains import Domain


SCHEMA_VERSION = 1

RISKS = ("low", "medium", "high", "critical")
AUDITS = ("task_ledger", "permission_audit", "repair_ledger", "none")
PLATFORMS = ("macos", "ios", "cloud")

SIDE_EFFECTS = (
    "reads_device_state", "reads_files", "reads_user_data",
    "writes_files", "deletes_files", "moves_files",
    "launches_process", "quits_process", "controls_media",
    "changes_system_setting", "sends_message", "network_request",
    "changes_orion_config", "changes_orion_permissions",
)

#: Effects that change something outside ORION. An action claiming only these
#: while also claiming `reversible` is asserting something worth checking.
MUTATING_EFFECTS = frozenset({
    "writes_files", "deletes_files", "moves_files", "launches_process",
    "quits_process", "changes_system_setting", "sends_message",
    "changes_orion_config", "changes_orion_permissions",
})

_ACTION = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_CAPABILITY = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$")

_ENTRY_FIELDS = frozenset({
    "action", "capability", "domain", "risk", "approval_required", "reversible",
    "side_effects", "resource_scope", "platforms", "arguments", "returns",
    "audit", "note",
})
_ENTRY_REQUIRED = _ENTRY_FIELDS - {"note"}

#: No capability may belong to the credentials domain. Phase 3 forbids a
#: credential entering a context bundle; a capability that claimed the domain
#: would be asserting it deals in them.
FORBIDDEN_DOMAINS = frozenset({Domain.CREDENTIALS})


@dataclass(frozen=True, slots=True)
class Capability:
    action: str
    capability: str
    domain: Domain
    risk: str
    approval_required: bool
    reversible: bool
    side_effects: tuple[str, ...]
    resource_scope: str
    platforms: tuple[str, ...]
    arguments: Mapping[str, object]
    returns: Mapping[str, object]
    audit: str
    note: str | None = None

    @property
    def mutates(self) -> bool:
        return bool(set(self.side_effects) & MUTATING_EFFECTS)

    @property
    def reads_only(self) -> bool:
        return not self.mutates


@dataclass(frozen=True, slots=True)
class CapabilityRegistry:
    schema_version: int
    capabilities: Mapping[str, Capability]

    def by_capability_name(self) -> Mapping[str, Capability]:
        return {entry.capability: entry for entry in self.capabilities.values()}

    def domain_of(self, action: str) -> Domain:
        """The context domain for a live action.

        This is the lookup Phase 3's firewall was waiting on: until a capability
        said which domain it belonged to, the isolation matrix could be defined
        but never applied to a real request.
        """

        try:
            return self.capabilities[action].domain
        except KeyError:
            raise ValueError(f"unknown action: {action}") from None

    def in_domain(self, domain: Domain) -> tuple[Capability, ...]:
        return tuple(
            entry for entry in self.capabilities.values() if entry.domain is domain
        )

    def requiring_approval(self) -> tuple[Capability, ...]:
        return tuple(
            entry for entry in self.capabilities.values() if entry.approval_required
        )


def _strict(data: object, expected: frozenset[str], required: frozenset[str], what: str) -> Mapping:
    if not isinstance(data, dict):
        raise ValueError(f"{what} must be a JSON object")
    unknown = sorted(set(data) - expected)
    missing = sorted(required - set(data))
    if unknown or missing:
        raise ValueError(f"{what} fields mismatch: unknown={unknown} missing={missing}")
    return data


def _member(value: object, allowed: Sequence[str], field: str) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise ValueError(f"{field} must be one of {list(allowed)}")
    return value


def _schema_object(value: object, field: str, *, closed: bool) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be a JSON Schema object")
    if value.get("type") != "object" and closed:
        raise ValueError(f"{field}.type must be 'object'")
    if closed and value.get("additionalProperties") is not False:
        # The manifest's "reject unknown fields by default", enforced at the
        # point where a capability declares its arguments. A schema that permits
        # extra keys is exactly the hole that forced the Phase 2 bridge to fail
        # open.
        raise ValueError(f"{field}.additionalProperties must be false")
    if "type" not in value:
        raise ValueError(f"{field} must declare a type")
    return value


def _entry(data: object, index: int) -> Capability:
    fields = _strict(data, _ENTRY_FIELDS, _ENTRY_REQUIRED, f"capability[{index}]")

    action = fields["action"]
    if not isinstance(action, str) or not _ACTION.fullmatch(action):
        raise ValueError(f"capability[{index}].action has an invalid format")
    name = fields["capability"]
    if not isinstance(name, str) or not _CAPABILITY.fullmatch(name):
        raise ValueError(f"{action}.capability must be dotted, got {name!r}")

    domain = Domain(fields["domain"])
    if domain in FORBIDDEN_DOMAINS:
        raise ValueError(f"{action} may not belong to the {domain.value} domain")

    for flag in ("approval_required", "reversible"):
        if not isinstance(fields[flag], bool):
            raise ValueError(f"{action}.{flag} must be a boolean")

    raw_effects = fields["side_effects"]
    if not isinstance(raw_effects, list):
        raise ValueError(f"{action}.side_effects must be a JSON array")
    effects = tuple(_member(item, SIDE_EFFECTS, f"{action}.side_effects") for item in raw_effects)
    if len(set(effects)) != len(effects):
        raise ValueError(f"{action}.side_effects repeats itself")

    raw_platforms = fields["platforms"]
    if not isinstance(raw_platforms, list) or not raw_platforms:
        raise ValueError(f"{action}.platforms must be a non-empty array")
    platforms = tuple(_member(item, PLATFORMS, f"{action}.platforms") for item in raw_platforms)

    scope = fields["resource_scope"]
    if not isinstance(scope, str) or not scope or len(scope) > 128:
        raise ValueError(f"{action}.resource_scope must be a short non-empty string")

    note = fields.get("note")
    if note is not None and (not isinstance(note, str) or len(note) > 512):
        raise ValueError(f"{action}.note must be a string under 512 characters")

    entry = Capability(
        action=action,
        capability=name,
        domain=domain,
        risk=_member(fields["risk"], RISKS, f"{action}.risk"),
        approval_required=fields["approval_required"],
        reversible=fields["reversible"],
        side_effects=effects,
        resource_scope=scope,
        platforms=platforms,
        arguments=_schema_object(fields["arguments"], f"{action}.arguments", closed=True),
        returns=_schema_object(fields["returns"], f"{action}.returns", closed=False),
        audit=_member(fields["audit"], AUDITS, f"{action}.audit"),
        note=note,
    )

    # A destructive action that records nothing cannot be investigated after the
    # fact, which is the whole reason the ledger exists.
    if entry.mutates and entry.audit == "none":
        raise ValueError(f"{action} has side effects but records no audit")
    # "critical" and "no approval" together is either a mistake or a decision
    # somebody should have to write down deliberately.
    if entry.risk == "critical" and not entry.approval_required:
        raise ValueError(f"{action} is critical risk but requires no approval")

    return entry


def decode_registry(data: object) -> CapabilityRegistry:
    """Decode and fully validate a capability registry, or raise."""

    fields = _strict(
        data,
        frozenset({"schema_version", "capabilities"}),
        frozenset({"schema_version", "capabilities"}),
        "registry",
    )
    if type(fields["schema_version"]) is not int or fields["schema_version"] != SCHEMA_VERSION:
        raise ValueError("unsupported schema version")

    raw = fields["capabilities"]
    if not isinstance(raw, list) or not raw:
        raise ValueError("capabilities must be a non-empty array")

    entries: dict[str, Capability] = {}
    seen_names: dict[str, str] = {}
    for index, item in enumerate(raw):
        entry = _entry(item, index)
        if entry.action in entries:
            raise ValueError(f"{entry.action} appears twice in the registry")
        if entry.capability in seen_names:
            raise ValueError(
                f"capability name {entry.capability} is claimed by both "
                f"{seen_names[entry.capability]} and {entry.action}"
            )
        entries[entry.action] = entry
        seen_names[entry.capability] = entry.action

    return CapabilityRegistry(schema_version=SCHEMA_VERSION, capabilities=entries)
