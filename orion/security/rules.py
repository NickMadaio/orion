"""The policy rules, one function each, all of them evaluated.

Nothing short-circuits. A rule that returns nothing is silent; a rule that
returns a verdict adds a reason. The engine then takes the most restrictive
outcome any rule produced -- so a decision record lists every reason it came out
the way it did, rather than the first one that happened to fire.

Rules never read the clock, the filesystem, or a device's own claim about
itself. Everything they need arrives in the `Evaluation`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from orion.core.tools.registry import Capability
from orion.security.devices import DeviceDirectory
from orion.security.profiles import Profile, ceiling, grants
from orion.security.request import PolicyRequest
from orion.security.risk import tier_of
from orion.security.signing import KeyDirectory, verify
from orion.security.vocabulary import (
    DeviceTrust,
    RequestSource,
    RiskLevel,
    SecurityState,
    at_least,
    at_most,
)
from orion.shared.result import DecisionOutcome


ALLOW = DecisionOutcome.ALLOW
DENY = DecisionOutcome.DENY
REQUIRE_APPROVAL = DecisionOutcome.REQUIRE_APPROVAL

#: Above this level an action is no longer merely local and reversible.
EXTERNAL_FLOOR = RiskLevel.R2
#: At and above this level an action reaches another person or destroys data.
COMMUNICATION_FLOOR = RiskLevel.R3
#: At and above this level a signature is required.
SIGNATURE_FLOOR = RiskLevel.R4


@dataclass(frozen=True, slots=True)
class Verdict:
    outcome: DecisionOutcome
    code: str
    detail: str


@dataclass(frozen=True, slots=True)
class Evaluation:
    """Everything the rules are allowed to look at."""

    request: PolicyRequest
    capability: Capability
    risk: RiskLevel
    effective_profile: Profile
    origin_trust: DeviceTrust
    target_trust: DeviceTrust
    now: datetime
    devices: DeviceDirectory
    keys: KeyDirectory
    remote_enabled: bool

    @property
    def tier(self) -> str:
        return tier_of(self.capability)

    @property
    def is_remote(self) -> bool:
        return self.request.origin_device != self.request.target_device

    @property
    def crossed_a_device_boundary(self) -> bool:
        """Either the target differs from the origin, or the request says so."""

        return self.is_remote or self.request.request_source is RequestSource.REMOTE_DEVICE


def declared_risk_matches(evaluation: Evaluation) -> tuple[Verdict, ...]:
    declared = evaluation.request.declared_risk
    if declared is not None and declared is not evaluation.risk:
        return (
            Verdict(
                DENY,
                "risk_mismatch",
                f"request declares {declared.value}; {evaluation.capability.action} is {evaluation.risk.value}",
            ),
        )
    return ()


def within_validity_window(evaluation: Evaluation) -> tuple[Verdict, ...]:
    """The manifest's hardest job-system rule, enforced at decision time too.

    "Never allow an expired command to execute after a device reconnects" is a
    property of the whole path, not just the queue -- a decision made now and
    replayed in an hour has to fail here as well.
    """

    request = evaluation.request
    if evaluation.now >= request.expires_at:
        return (Verdict(DENY, "request_expired", f"expired at {request.expires_at.isoformat()}"),)
    if evaluation.now < request.issued_at:
        return (
            Verdict(
                DENY,
                "request_not_yet_valid",
                f"issued at {request.issued_at.isoformat()}, which is in the future",
            ),
        )
    return ()


def devices_are_trusted(evaluation: Evaluation) -> tuple[Verdict, ...]:
    verdicts: list[Verdict] = []
    if evaluation.origin_trust is not DeviceTrust.PAIRED:
        verdicts.append(
            Verdict(
                DENY,
                "origin_device_not_paired",
                f"origin device is {evaluation.origin_trust.value}",
            )
        )
    if evaluation.target_trust is not DeviceTrust.PAIRED:
        verdicts.append(
            Verdict(
                DENY,
                "target_device_not_paired",
                f"target device is {evaluation.target_trust.value}",
            )
        )
    return tuple(verdicts)


def remote_execution_is_enabled(evaluation: Evaluation) -> tuple[Verdict, ...]:
    """No remote path exists yet, and there are two ways to be remote.

    Comparing origin to target only catches a request that ADMITS it is going
    somewhere else. A request whose source is REMOTE_DEVICE while origin equals
    target is a remote request wearing local clothes; before Phase 44 there is
    no path that should produce one.
    """

    if evaluation.crossed_a_device_boundary and not evaluation.remote_enabled:
        return (
            Verdict(
                DENY,
                "remote_execution_disabled",
                "no remote path exists yet; origin and target must be the same device",
            ),
        )
    return ()


def user_is_authenticated_and_owns_the_devices(evaluation: Evaluation) -> tuple[Verdict, ...]:
    request = evaluation.request
    if request.authenticated_user is None:
        return (Verdict(DENY, "no_authenticated_user", "the request carries no authenticated user"),)
    user = str(request.authenticated_user)
    verdicts: list[Verdict] = []
    for label, device in (("origin", request.origin_device), ("target", request.target_device)):
        if not evaluation.devices.owns(user, str(device)):
            # Ownership is resolved server-side, from the directory. A request
            # asserting whose device it is would be answering its own question.
            verdicts.append(
                Verdict(DENY, f"{label}_device_not_owned_by_user", f"{device} is not this user's device")
            )
    return tuple(verdicts)


def profile_grants_the_capability(evaluation: Evaluation) -> tuple[Verdict, ...]:
    verdicts: list[Verdict] = []
    profile = evaluation.effective_profile
    if not grants(profile, evaluation.tier):
        verdicts.append(
            Verdict(
                DENY,
                "profile_does_not_grant_tier",
                f"{profile.value} does not grant the {evaluation.tier} tier",
            )
        )
    if not at_most(evaluation.risk, ceiling(profile)):
        verdicts.append(
            Verdict(
                DENY,
                "risk_above_profile_ceiling",
                f"{evaluation.risk.value} exceeds {profile.value}'s ceiling of {ceiling(profile).value}",
            )
        )
    return tuple(verdicts)


def security_state_permits(evaluation: Evaluation) -> tuple[Verdict, ...]:
    state = evaluation.request.security_state
    if state is SecurityState.LOCKED and evaluation.risk is not RiskLevel.R0:
        return (Verdict(DENY, "security_state_locked", "ORION is locked; only observation is permitted"),)
    if state is SecurityState.HEIGHTENED and evaluation.risk is not RiskLevel.R0:
        return (
            Verdict(
                REQUIRE_APPROVAL,
                "security_state_heightened",
                "security state is heightened; anything beyond observation is confirmed",
            ),
        )
    return ()


def external_data_does_not_drive_action(evaluation: Evaluation) -> tuple[Verdict, ...]:
    """Content read from the world cannot cause an action in the world.

    Two rules rather than one, because they answer different questions:
    involvement is "this decision touched untrusted material", source is "this
    request came from untrusted material". The second is worse and is denied
    outright at anything above observation.
    """

    request = evaluation.request
    verdicts: list[Verdict] = []
    if request.external_data_involved:
        if at_least(evaluation.risk, EXTERNAL_FLOOR):
            verdicts.append(
                Verdict(
                    DENY,
                    "external_data_drives_external_action",
                    "untrusted external content cannot cause an action beyond this machine",
                )
            )
        elif evaluation.risk is not RiskLevel.R0:
            verdicts.append(
                Verdict(
                    REQUIRE_APPROVAL,
                    "external_data_involved",
                    "untrusted external content contributed to this request",
                )
            )
    if request.request_source is RequestSource.EXTERNAL_CONTENT and evaluation.risk is not RiskLevel.R0:
        verdicts.append(
            Verdict(
                DENY,
                "external_content_cannot_authorize",
                "content is data, never instruction; it cannot originate an action",
            )
        )
    return tuple(verdicts)


def model_may_propose_but_not_authorize(evaluation: Evaluation) -> tuple[Verdict, ...]:
    if (
        evaluation.request.request_source is RequestSource.MODEL_INITIATED
        and at_least(evaluation.risk, EXTERNAL_FLOOR)
    ):
        return (
            Verdict(
                REQUIRE_APPROVAL,
                "model_initiated_beyond_local",
                "the model proposed this; anything past a local reversible action is the user's call",
            ),
        )
    return ()


def sensitive_actions_are_signed(evaluation: Evaluation) -> tuple[Verdict, ...]:
    """Signed if it crossed a device boundary; verified always, if present.

    A signature answers "did this request really come from that device, and is
    it the request that device sent". A same-device request has no transport to
    forge over -- it is authenticated by the local session -- so demanding one
    locally would deny every destructive local action Orion performs today,
    while proving nothing. The requirement therefore binds on crossing a
    boundary, which is exactly when Phase 44 makes it meaningful.

    A signature that IS present is verified whatever the risk level: attaching a
    bad signature is never an accident worth tolerating.
    """

    signature = evaluation.request.signature
    if signature is None:
        if at_least(evaluation.risk, SIGNATURE_FLOOR) and evaluation.crossed_a_device_boundary:
            return (
                Verdict(
                    DENY,
                    "signature_required",
                    f"{evaluation.risk.value} actions from another device must be signed",
                ),
            )
        return ()
    origin = evaluation.devices.get(str(evaluation.request.origin_device))
    if origin is None or origin.signing_key_id is None:
        return (
            Verdict(
                DENY,
                "origin_device_has_no_signing_key",
                f"{evaluation.request.origin_device} has no registered key to sign with",
            ),
        )
    if str(signature.key_id) != str(origin.signing_key_id):
        # Verifying against ANY registered key would let any device of this user
        # sign a request claiming to come from another of them -- and the
        # decision would then carry a `signature_verified` obligation saying so.
        # A signature has to answer "did this come from THAT device".
        return (
            Verdict(
                DENY,
                "signature_key_is_not_the_origin_devices",
                f"{signature.key_id} is not the key registered to {evaluation.request.origin_device}",
            ),
        )
    secret = evaluation.keys.secret_for(str(signature.key_id))
    if secret is None:
        return (Verdict(DENY, "signing_key_unknown", f"no key registered as {signature.key_id}"),)
    if not verify(secret, evaluation.request.signed_fields(), signature):
        # Covers both "forged" and "signed, then altered": the signature is over
        # every field that can change the outcome.
        return (Verdict(DENY, "signature_invalid", "the signature does not cover this request"),)
    return ()


def resource_is_named_and_bounded(evaluation: Evaluation) -> tuple[Verdict, ...]:
    """The manifest lists `resource` as an evaluation input; this evaluates it.

    Deliberately modest, and the limits are stated rather than implied. Root
    scoping -- "is this path inside a configured root" -- lives in the live
    executor, which knows the configured roots; the engine does not have them
    and inventing an answer here would be worse than not answering.

    What it can decide without those roots: a request must say what it acts on,
    a wildcard is not a resource, and a path that climbs out of wherever it
    started is not the resource it claims to be.
    """

    resource = evaluation.request.resource
    if resource.strip() in {"", "*", "**", "all", "any"}:
        return (
            Verdict(
                DENY,
                "resource_is_not_specific",
                f"{evaluation.capability.action} must say what it acts on, not {resource!r}",
            ),
        )
    normalized = resource.replace("\\", "/")
    segments = normalized.split("/")
    if ".." in segments:
        return (
            Verdict(
                DENY,
                "resource_escapes_its_scope",
                "a resource may not climb out of the location it names",
            ),
        )
    return ()


def delegation_is_within_scope(evaluation: Evaluation) -> tuple[Verdict, ...]:
    delegation = evaluation.request.delegation
    if delegation is None:
        return ()
    request = evaluation.request
    verdicts: list[Verdict] = []
    if delegation.expired_at(evaluation.now):
        verdicts.append(Verdict(DENY, "delegation_expired", f"expired at {delegation.expires_at.isoformat()}"))
    if not delegation.covers(request.capability):
        verdicts.append(
            Verdict(
                DENY,
                "delegation_does_not_cover_capability",
                f"{delegation.delegation_id} does not name {request.capability}",
            )
        )
    if not delegation.permits_risk(evaluation.risk):
        verdicts.append(
            Verdict(
                DENY,
                "delegation_risk_exceeded",
                f"{evaluation.risk.value} exceeds the delegated maximum of {delegation.max_risk.value}",
            )
        )
    if request.authenticated_user is None or str(delegation.delegate_id) != str(request.authenticated_user):
        verdicts.append(
            Verdict(
                DENY,
                "delegation_not_for_this_user",
                "the delegation was issued to somebody else",
            )
        )
    return tuple(verdicts)


def approval_is_required(evaluation: Evaluation) -> tuple[Verdict, ...]:
    verdicts: list[Verdict] = []
    if evaluation.capability.approval_required:
        verdicts.append(
            Verdict(
                REQUIRE_APPROVAL,
                "capability_requires_approval",
                f"{evaluation.capability.action} always requires approval",
            )
        )
    if at_least(evaluation.risk, COMMUNICATION_FLOOR):
        verdicts.append(
            Verdict(
                REQUIRE_APPROVAL,
                "risk_requires_approval",
                f"{evaluation.risk.value} is never taken automatically",
            )
        )
    return tuple(verdicts)


#: Evaluation order changes neither the outcome (most restrictive wins) nor the
#: order of the reasons (the engine sorts them). It is fixed anyway, so that a
#: rule added in the middle cannot change which verdicts a partial evaluation
#: would have produced while debugging.
RULES = (
    declared_risk_matches,
    within_validity_window,
    devices_are_trusted,
    remote_execution_is_enabled,
    user_is_authenticated_and_owns_the_devices,
    profile_grants_the_capability,
    security_state_permits,
    external_data_does_not_drive_action,
    model_may_propose_but_not_authorize,
    sensitive_actions_are_signed,
    resource_is_named_and_bounded,
    delegation_is_within_scope,
    approval_is_required,
)
