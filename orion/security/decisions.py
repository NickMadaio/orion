"""The policy engine: one place that answers ALLOW, DENY, or REQUIRE_APPROVAL.

Phase 1 left this file for Phase 5 on purpose, recording that adding "a second,
premature permission implementation" was worse than an empty package.

Deterministic by construction: no clock, no randomness, no I/O, no network, and
no input the model controls beyond the proposal itself. Given the same request,
directory, and instant, it returns the same decision -- which is what makes
"the model can never override the result" a property rather than a promise.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from orion.core.schemas import DecisionEnvelope
from orion.core.tools.registry import CapabilityRegistry
from orion.security.devices import DeviceDirectory
from orion.security.profiles import Profile
from orion.security.request import PolicyRequest
from orion.security.risk import classify, tier_of
from orion.security.rules import ALLOW, DENY, REQUIRE_APPROVAL, RULES, Evaluation, Verdict
from orion.security.signing import KeyDirectory
from orion.security.vocabulary import RiskLevel
from orion.shared.identifiers import Identifier, Symbol
from orion.shared.result import DecisionOutcome


POLICY_VERSION = "policy-v2.5"

#: How long a decision stays usable. Short on purpose: a decision is permission
#: to act now, not a token to keep.
DEFAULT_TTL = timedelta(minutes=5)

#: Most restrictive first. Used to combine verdicts and to compare outcomes.
SEVERITY = {DENY: 2, REQUIRE_APPROVAL: 1, ALLOW: 0}


@dataclass(frozen=True, slots=True)
class PolicyDecision:
    outcome: DecisionOutcome
    risk: RiskLevel
    reason_codes: tuple[str, ...]
    reasons: tuple[str, ...]
    obligations: tuple[str, ...]
    policy_version: str
    request_id: Identifier

    def to_envelope(
        self,
        *,
        decision_id: str,
        decided_at: datetime,
        ttl: timedelta = DEFAULT_TTL,
    ) -> DecisionEnvelope:
        """The Phase 1 envelope, produced by something at last.

        `AuthorizedAction` already refuses to execute without one of these; until
        now every one in the codebase was hand-built in a test.
        """

        if self.outcome is DENY:
            # A denial is not an authorization with a flag set. Handing back an
            # envelope would let a caller pass it where a decision is expected.
            raise ValueError("a denied decision has no authorization envelope")
        if not isinstance(decided_at, datetime) or decided_at.tzinfo is None:
            raise ValueError("decided_at must be timezone-aware")
        if ttl <= timedelta(0):
            raise ValueError("a decision must expire after it is made")
        moment = decided_at.astimezone(timezone.utc)
        return DecisionEnvelope(
            schema_version=1,
            decision_id=Identifier(decision_id),
            proposal_id=self.request_id,
            outcome=self.outcome,
            policy_version=Symbol(self.policy_version),
            reason_codes=self.reason_codes,
            decided_at=moment,
            expires_at=moment + ttl,
        )


class PolicyEngine:
    """Evaluate a request against every rule and return the strictest answer."""

    def __init__(
        self,
        registry: CapabilityRegistry,
        devices: DeviceDirectory,
        keys: KeyDirectory | None = None,
        *,
        remote_enabled: bool = False,
        policy_version: str = POLICY_VERSION,
    ) -> None:
        self._registry = registry
        self._devices = devices
        self._keys = keys if keys is not None else KeyDirectory()
        # Remote access arrives in Phase 44. Until then the engine denies any
        # request whose target is not its origin, and this flag is the single
        # place that changes.
        self._remote_enabled = bool(remote_enabled)
        self._policy_version = Symbol(policy_version)

    @property
    def policy_version(self) -> str:
        return str(self._policy_version)

    def risk_of(self, capability: str) -> RiskLevel:
        entry = self._registry.capabilities.get(capability)
        if entry is None:
            raise ValueError(f"unknown capability: {capability}")
        return classify(entry)

    def evaluate(self, request: PolicyRequest, *, now: datetime) -> PolicyDecision:
        if not isinstance(request, PolicyRequest):
            raise ValueError("evaluate takes a PolicyRequest")
        if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None:
            raise ValueError("evaluate requires an aware instant")
        moment = now.astimezone(timezone.utc)

        capability = self._registry.capabilities.get(request.capability)
        if capability is None:
            # Default deny, and the first rule of it: something with no
            # registered contract cannot be reasoned about, so it is refused
            # rather than given the benefit of the doubt.
            return PolicyDecision(
                outcome=DENY,
                risk=RiskLevel.R5,
                reason_codes=("unknown_capability",),
                reasons=(f"{request.capability} is not in the capability registry",),
                obligations=(),
                policy_version=str(self._policy_version),
                request_id=request.request_id,
            )

        risk = classify(capability)
        profile = (
            request.delegation.effective_profile(request.active_profile)
            if request.delegation is not None
            else request.active_profile
        )
        evaluation = Evaluation(
            request=request,
            capability=capability,
            risk=risk,
            effective_profile=profile,
            origin_trust=self._devices.trust_of(str(request.origin_device)),
            target_trust=self._devices.trust_of(str(request.target_device)),
            now=moment,
            devices=self._devices,
            keys=self._keys,
            remote_enabled=self._remote_enabled,
        )

        verdicts: list[Verdict] = []
        for rule in RULES:
            verdicts.extend(rule(evaluation))

        outcome = max((verdict.outcome for verdict in verdicts), key=lambda item: SEVERITY[item], default=ALLOW)
        codes = tuple(sorted({verdict.code for verdict in verdicts})) or ("all_gates_passed",)
        reasons = tuple(sorted({verdict.detail for verdict in verdicts})) or (
            f"{capability.action} passed every policy gate",
        )
        return PolicyDecision(
            outcome=outcome,
            risk=risk,
            reason_codes=codes,
            reasons=reasons,
            obligations=self._obligations(evaluation, outcome),
            policy_version=str(self._policy_version),
            request_id=request.request_id,
        )

    def _obligations(self, evaluation: Evaluation, outcome: DecisionOutcome) -> tuple[str, ...]:
        """What must happen if this action proceeds.

        Carried on the decision rather than left for the executor to remember.
        The context domain is here because Phase 3's firewall needs to know
        which bundle this action may see, and the decision is the one record
        that already knows both.
        """

        if outcome is DENY:
            return ()
        capability = evaluation.capability
        obligations = {
            f"audit:{capability.audit}",
            f"context_domain:{capability.domain.value}",
            f"risk:{evaluation.risk.value}",
        }
        if outcome is REQUIRE_APPROVAL:
            obligations.add("approval_bound_to_canonical_request")
        if not capability.reversible:
            obligations.add("no_undo_available")
        if evaluation.request.signature is not None:
            # Only claimed when a signature was actually checked. An obligation
            # that says "verified" on a request nobody signed is worse than no
            # obligation, because a later reader will believe it.
            obligations.add("signature_verified")
        if evaluation.is_remote:
            obligations.add("target_device_ack_required")
        return tuple(sorted(obligations))


def stricter(first: DecisionOutcome, second: DecisionOutcome) -> DecisionOutcome:
    """The more restrictive of two outcomes."""

    return first if SEVERITY[first] >= SEVERITY[second] else second


__all__ = [
    "DEFAULT_TTL",
    "POLICY_VERSION",
    "PolicyDecision",
    "PolicyEngine",
    "Profile",
    "stricter",
    "tier_of",
]
