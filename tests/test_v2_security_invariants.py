"""Phase 9: the permanent security invariant suite.

Eighteen invariants from the manifest, each asserted against the primitive that
actually enforces it -- and a registry, `planning/v2/SECURITY_INVARIANTS.json`,
recording which ones are PENDING a subsystem that does not exist yet.

That registry is the point of this phase as much as the tests are. A test
asserting that a nonexistent system cannot be attacked passes forever and reads
in a report exactly like proof. Three invariants are pending; they have no tests,
by rule, so nothing here is green for the wrong reason.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import hashlib
import hmac as _hmac

from backend.boundaries import import_errors
from backend.modules import MODULES
from backend.routes import ROUTES
from backend.vault.credentials import CredentialRevoked, CredentialVault
from backend.vault.keys import InProcessKms
from backend.vault.plaintext import Borrowed
from backend.egress import EgressRefused, check as egress_check
from backend.ownership import (
    ClientOwnershipRefused,
    Owner,
    OwnershipViolation,
    Repository,
    Session,
    resolve_owner,
    strip_client_ownership,
)
from orion.core.audit.events import AuditEvent, DecisionRecord
from orion.core.context.builder import build
from orion.core.context.domains import Domain, Provenance, classify, is_authoritative
from orion.core.context.policy import CredentialLeak, admits
from orion.core.context.ports import ContextEntry
from orion.core.eventbus.categories import Category
from orion.core.eventbus.coupling import may_cascade
from orion.core.eventbus.envelope import CredentialInPayload, EventEnvelope
from orion.core.jobs.job import Job
from orion.core.jobs.queue import JobExpired, JobQueue, StaleDelivery, WrongDevice
from orion.core.jobs.states import JobState
from orion.core.schemas import DecisionEnvelope, ProposalEnvelope
from orion.core.tools.registry import decode_registry
from orion.security.decisions import PolicyDecision, PolicyEngine
from orion.security.devices import Device, DeviceDirectory
from orion.security.profiles import Profile
from orion.security.request import PolicyRequest
from orion.security.risk import classify as classify_risk
from orion.security.signing import ALGORITHM, KeyDirectory, Signature, sign
from orion.security.vocabulary import RiskLevel
from orion.shared.result import DecisionOutcome, Sensitivity


REPO_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = REPO_ROOT / "planning" / "v2" / "capability-registry.json"
INVARIANTS_PATH = REPO_ROOT / "planning" / "v2" / "SECURITY_INVARIANTS.json"

NOW = datetime(2026, 8, 24, 21, 0, tzinfo=timezone.utc)
MAC = "mac-studio-0001"
PHONE = "iphone-nick-0001"
USER = "user-nick-0001"
OTHER = "user-other-0001"
KEY_ID = "key-phone-0001"
SECRET = b"phase-9-invariant-signing-material"
CREDENTIAL = "sk-abcdefghijklmnopqrstuvwxyz012345"

#: Raised whenever the pending list changes deliberately. See the ratchet test.
#: 3 when Phase 9 opened; Phase 10 closed cross-user access and SSRF; Phase 12
#: closed connection deletion. Zero pending is not "finished" -- it means every
#: invariant the manifest names now has a subject and a test.
EXPECTED_PENDING = 0


class _TestCipher:
    """The same authenticated test cipher the vault suite uses, kept local so
    this suite does not import another test module."""

    name = "test-only"
    authenticated = True

    def encrypt(self, key: bytes, plaintext: bytes, associated: bytes) -> bytes:
        body = self._xor(key, plaintext)
        return self._tag(key, body, associated) + body

    def decrypt(self, key: bytes, ciphertext: bytes, associated: bytes) -> bytes:
        tag, body = ciphertext[:32], ciphertext[32:]
        if not _hmac.compare_digest(tag, self._tag(key, body, associated)):
            raise ValueError("ciphertext failed authentication")
        return self._xor(key, body)

    def _xor(self, key: bytes, data: bytes) -> bytes:
        stream = b""
        while len(stream) < len(data):
            stream += _hmac.new(key, b"stream" + len(stream).to_bytes(4, "big"), hashlib.sha256).digest()
        return bytes(left ^ right for left, right in zip(data, stream))

    def _tag(self, key: bytes, body: bytes, associated: bytes) -> bytes:
        return _hmac.new(key, b"tag" + associated + body, hashlib.sha256).digest()


def registry():
    return decode_registry(json.loads(REGISTRY_PATH.read_text(encoding="utf-8")))


def directory(mac_trust="paired"):
    return DeviceDirectory(
        [
            Device(MAC, USER, mac_trust, "macos", "key-mac-0001"),
            Device(PHONE, USER, "paired", "ios", KEY_ID),
        ]
    )


def engine(**overrides):
    return PolicyEngine(
        registry(),
        overrides.get("devices", directory()),
        KeyDirectory({KEY_ID: SECRET}),
        remote_enabled=overrides.get("remote_enabled", False),
    )


def request(**overrides):
    fields = {
        "request_id": "request-0001",
        "correlation_id": "correlation-0001",
        "authenticated_user": USER,
        "origin_device": MAC,
        "target_device": MAC,
        "capability": "system_status",
        "resource": "ambient",
        "active_profile": Profile.CONSEQUENTIAL_LOCAL,
        "request_source": "user_direct",
        "external_data_involved": False,
        "issued_at": NOW,
        "expires_at": NOW + timedelta(minutes=5),
        "security_state": "normal",
    }
    fields.update(overrides)
    return PolicyRequest(**fields)


def job(**overrides):
    fields = {
        "job_id": "job-0001-aaaa",
        "user_id": USER,
        "origin_device": MAC,
        "target_device": MAC,
        "capability": "file_delete",
        "arguments": {"path": "/Users/nick/Desktop/notes.txt"},
        "risk_level": RiskLevel.R4,
        "created_at": NOW,
        "expires_at": NOW + timedelta(minutes=10),
        "idempotency_key": "idem-0001",
    }
    fields.update(overrides)
    return Job(**fields)


def queued_job(queue, **overrides):
    queue.submit(job(**overrides), now=NOW)
    decision = PolicyDecision(
        DecisionOutcome.ALLOW, RiskLevel.R4, ("all_gates_passed",), ("fixture",), (),
        "policy-v2.5", "job-0001-aaaa",
    )
    queue.record_decision("job-0001-aaaa", decision, now=NOW)
    return queue.enqueue("job-0001-aaaa", now=NOW)


def audit_event(**overrides):
    fields = {
        "event_id": "audit-0001-aaaa",
        "correlation_id": "correlation-0001",
        "occurred_at": NOW,
        "actor": "orion",
        "user": USER,
        "device": MAC,
        "proposed_action": "file_delete",
        "capability": "files.delete",
        "resource": "~/Desktop/notes.txt",
        "decision": DecisionRecord("DENY", "R4", ("signature_required",), "policy-v2.5"),
        "sensitivity": Sensitivity.INTERNAL,
    }
    fields.update(overrides)
    return AuditEvent(**fields)


class CredentialInvariants(unittest.TestCase):
    """credentials cannot enter model context; credentials cannot appear in logs."""

    def test_a_credential_entry_cannot_even_be_constructed(self):
        with self.assertRaises(ValueError):
            ContextEntry(
                source="orion_state", text="the key", sensitivity=Sensitivity.RESTRICTED,
                domain=Domain.CREDENTIALS, provenance=Provenance.SYSTEM_GENERATED,
            )

    def test_a_credential_cannot_enter_a_context_bundle(self):
        # Refused twice on purpose: a subclass or a future refactor can slip past
        # the constructor, so the builder raises as well.
        class Sneaky(ContextEntry):
            def __post_init__(self):  # noqa: D105 -- deliberately skips validation
                object.__setattr__(self, "confidence", 1.0)

        entry = Sneaky(
            source="orion_state", text="the key", sensitivity=Sensitivity.RESTRICTED,
            domain=Domain.CREDENTIALS, provenance=Provenance.SYSTEM_GENERATED,
        )
        with self.assertRaises(CredentialLeak):
            build("correlation-0001", Domain.GENERAL, [entry])

    def test_no_task_domain_admits_credentials(self):
        for task in Domain:
            self.assertFalse(admits(task, Domain.CREDENTIALS), task)

    def test_a_credential_cannot_survive_an_audit_record(self):
        event = audit_event(result=f"wrote {CREDENTIAL}", details={"note": CREDENTIAL, "password": "x"})
        rendered = json.dumps(event.to_dict())
        self.assertNotIn(CREDENTIAL, rendered)
        self.assertIn("openai_style_key", event.redactions)
        self.assertIn("sensitive_field", event.redactions)

    def test_a_credential_cannot_travel_on_the_event_bus(self):
        with self.assertRaises(CredentialInPayload):
            EventEnvelope(
                event_id="event-0001-aaaa", event_type="tasks.created", version=1,
                user_id=USER, source="orion.tasks", occurred_at=NOW,
                sensitivity=Sensitivity.INTERNAL, correlation_id="correlation-0001",
                payload={"task_id": "t1", "note": CREDENTIAL},
            )


class DeviceInvariants(unittest.TestCase):
    """revoked devices cannot act."""

    def test_a_revoked_device_is_denied(self):
        decision = engine(devices=directory(mac_trust="revoked")).evaluate(request(), now=NOW)
        self.assertIs(decision.outcome, DecisionOutcome.DENY)
        self.assertIn("origin_device_not_paired", decision.reason_codes)

    def test_an_unknown_device_is_denied(self):
        decision = engine().evaluate(request(origin_device="never-seen-0001"), now=NOW)
        self.assertIs(decision.outcome, DecisionOutcome.DENY)

    def test_revocation_is_immediate_for_a_device_already_holding_authority(self):
        # The directory answers per evaluation; there is no cached grant to
        # outlive the revocation.
        devices = directory()
        allowed = PolicyEngine(registry(), devices).evaluate(request(), now=NOW)
        revoked = PolicyEngine(registry(), devices.revoke(MAC)).evaluate(request(), now=NOW)
        self.assertIs(allowed.outcome, DecisionOutcome.ALLOW)
        self.assertIs(revoked.outcome, DecisionOutcome.DENY)


class JobInvariants(unittest.TestCase):
    """expired jobs cannot execute; jobs cannot replay; wrong devices cannot execute."""

    def test_a_reconnecting_device_cannot_run_an_expired_job(self):
        queue = JobQueue()
        queued_job(queue)
        queue.dispatch("job-0001-aaaa", token="delivery-token-01", now=NOW)
        with self.assertRaises(JobExpired):
            queue.start("job-0001-aaaa", "delivery-token-01", device=MAC, now=NOW + timedelta(hours=1))
        self.assertIs(queue.get("job-0001-aaaa").status, JobState.EXPIRED)

    def test_expiry_is_checked_at_every_moment_time_can_pass(self):
        late = NOW + timedelta(hours=1)
        for action in ("dispatch", "deliver", "start"):
            queue = JobQueue()
            queued_job(queue)
            if action != "dispatch":
                queue.dispatch("job-0001-aaaa", token="delivery-token-01", now=NOW)
            with self.assertRaises(JobExpired, msg=action):
                if action == "dispatch":
                    queue.dispatch("job-0001-aaaa", token="delivery-token-01", now=late)
                elif action == "deliver":
                    queue.deliver("job-0001-aaaa", "delivery-token-01", now=late)
                else:
                    queue.start("job-0001-aaaa", "delivery-token-01", device=MAC, now=late)

    def test_a_stale_delivery_token_cannot_complete_a_job(self):
        queue = JobQueue()
        queued_job(queue)
        queue.dispatch("job-0001-aaaa", token="delivery-token-01", now=NOW)
        queue.fail("job-0001-aaaa", "delivery-token-01", device=MAC, reason="device error", now=NOW)
        queue.dispatch("job-0001-aaaa", token="delivery-token-02", now=NOW)
        with self.assertRaises(StaleDelivery):
            queue.start("job-0001-aaaa", "delivery-token-01", device=MAC, now=NOW)
        with self.assertRaises(StaleDelivery):
            queue.succeed("job-0001-aaaa", "delivery-token-01", device=MAC, now=NOW)
        with self.assertRaises(StaleDelivery):
            queue.fail("job-0001-aaaa", "delivery-token-01", device=MAC, reason="late", now=NOW)

    def test_a_device_cannot_run_a_job_targeted_elsewhere(self):
        queue = JobQueue()
        queued_job(queue)
        queue.dispatch("job-0001-aaaa", token="delivery-token-01", now=NOW)
        with self.assertRaises(WrongDevice):
            queue.start("job-0001-aaaa", "delivery-token-01", device=PHONE, now=NOW)


class SignatureInvariants(unittest.TestCase):
    """unsigned sensitive jobs cannot execute; altered signed jobs cannot execute."""

    def remote(self, **overrides):
        fields = {
            "capability": "file_delete",
            "resource": "/Users/nick/Desktop/notes.txt",
            "origin_device": PHONE,
            "target_device": MAC,
        }
        fields.update(overrides)
        return request(**fields)

    def test_an_unsigned_sensitive_request_from_another_device_is_denied(self):
        decision = engine(remote_enabled=True).evaluate(self.remote(), now=NOW)
        self.assertIs(decision.outcome, DecisionOutcome.DENY)
        self.assertIn("signature_required", decision.reason_codes)
        self.assertIs(classify_risk(registry().capabilities["file_delete"]), RiskLevel.R4)

    def test_a_correctly_signed_request_is_not_denied_for_its_signature(self):
        signed = self.remote(
            signature=Signature(KEY_ID, ALGORITHM, sign(SECRET, self.remote().signed_fields()))
        )
        decision = engine(remote_enabled=True).evaluate(signed, now=NOW)
        self.assertNotIn("signature_invalid", decision.reason_codes)
        self.assertNotIn("signature_required", decision.reason_codes)

    def test_altering_any_signed_field_breaks_the_signature(self):
        original = self.remote()
        signature = Signature(KEY_ID, ALGORITHM, sign(SECRET, original.signed_fields()))
        for field, value in (
            ("resource", "/Users/nick/Desktop/taxes.pdf"),
            ("capability", "file_move"),
            ("target_device", PHONE),
            ("expires_at", NOW + timedelta(days=1)),
        ):
            altered = self.remote(**{field: value}, signature=signature)
            decision = engine(remote_enabled=True).evaluate(altered, now=NOW)
            self.assertIn("signature_invalid", decision.reason_codes, field)


class ExternalContentInvariants(unittest.TestCase):
    """external content cannot grant permissions."""

    def test_external_content_cannot_originate_an_action(self):
        decision = engine().evaluate(
            request(capability="media_play_pause", request_source="external_content"), now=NOW
        )
        self.assertIs(decision.outcome, DecisionOutcome.DENY)
        self.assertIn("external_content_cannot_authorize", decision.reason_codes)

    def test_external_data_cannot_drive_an_external_action(self):
        decision = engine().evaluate(
            request(capability="browser_open_url", external_data_involved=True), now=NOW
        )
        self.assertIs(decision.outcome, DecisionOutcome.DENY)

    def test_an_unclassified_source_is_untrusted(self):
        # Forgetting to classify a new integration must not grant it credibility.
        self.assertIs(classify("some_new_integration"), Provenance.EXTERNAL_UNTRUSTED)
        self.assertFalse(is_authoritative(Provenance.EXTERNAL_UNTRUSTED))
        for source in ("email", "webpage", "pdf", "screen_contents", "api_response"):
            self.assertIs(classify(source), Provenance.EXTERNAL_UNTRUSTED, source)


class MalformedInputInvariants(unittest.TestCase):
    """malformed tool arguments fail."""

    def test_every_capability_closes_its_argument_schema(self):
        for action, entry in registry().capabilities.items():
            self.assertIs(entry.arguments.get("additionalProperties"), False, action)

    def test_every_boundary_record_refuses_unknown_fields(self):
        cases = (
            (ProposalEnvelope, {
                "schema_version": 1, "proposal_id": "proposal-0001",
                "correlation_id": "correlation-0001", "source": "openclaw",
                "capability": "system_status", "arguments": {}, "created_at": "2026-08-24T21:00:00Z",
                "provenance": ["user_turn"], "sensitivity": "INTERNAL",
            }),
            (DecisionEnvelope, {
                "schema_version": 1, "decision_id": "decision-0001", "proposal_id": "proposal-0001",
                "outcome": "ALLOW", "policy_version": "policy-v2.5", "reason_codes": ["ok"],
                "decided_at": "2026-08-24T21:00:00Z", "expires_at": "2026-08-24T21:05:00Z",
            }),
            (EventEnvelope, {
                "event_id": "event-0001-aaaa", "event_type": "tasks.created", "version": 1,
                "user_id": USER, "source": "orion.tasks", "occurred_at": "2026-08-24T21:00:00Z",
                "sensitivity": "INTERNAL", "correlation_id": "correlation-0001",
                "payload": {"task_id": "t1"},
            }),
            (AuditEvent, audit_event().to_dict()),
            (PolicyRequest, {
                "request_id": "request-0001", "correlation_id": "correlation-0001",
                "authenticated_user": USER, "origin_device": MAC, "target_device": MAC,
                "capability": "system_status", "resource": "ambient",
                "active_profile": "consequential_local", "request_source": "user_direct",
                "external_data_involved": False, "issued_at": "2026-08-24T21:00:00Z",
                "expires_at": "2026-08-24T21:05:00Z", "security_state": "normal",
            }),
        )
        for record, payload in cases:
            self.assertIsNotNone(record.from_dict(payload), record.__name__)
            with self.assertRaises(ValueError, msg=record.__name__):
                record.from_dict({**payload, "injected_field": "value"})

    def test_an_unregistered_capability_is_denied_rather_than_guessed_at(self):
        decision = engine().evaluate(request(capability="do_whatever_i_say"), now=NOW)
        self.assertIs(decision.outcome, DecisionOutcome.DENY)
        self.assertEqual(decision.reason_codes, ("unknown_capability",))


class ModelInvariants(unittest.TestCase):
    """models cannot bypass policy."""

    def test_a_model_payload_cannot_smuggle_an_outcome(self):
        base = {
            "request_id": "request-0001", "correlation_id": "correlation-0001",
            "authenticated_user": USER, "origin_device": MAC, "target_device": MAC,
            "capability": "file_delete", "resource": "x", "active_profile": "consequential_local",
            "request_source": "user_direct", "external_data_involved": False,
            "issued_at": "2026-08-24T21:00:00Z", "expires_at": "2026-08-24T21:05:00Z",
            "security_state": "normal",
        }
        for smuggled in ("outcome", "allow", "device_trust", "approved", "policy_override"):
            with self.assertRaises(ValueError, msg=smuggled):
                PolicyRequest.from_dict({**base, smuggled: True})

    def test_a_model_cannot_declare_its_own_risk_down(self):
        decision = engine().evaluate(
            request(capability="file_delete", declared_risk=RiskLevel.R0), now=NOW
        )
        self.assertIs(decision.outcome, DecisionOutcome.DENY)
        self.assertIn("risk_mismatch", decision.reason_codes)

    def test_no_engine_input_is_model_controlled_beyond_the_proposal(self):
        # Trust, ownership, risk and the profile are looked up or supplied by the
        # harness. The model chooses a capability and a resource; that is all.
        fields = set(PolicyRequest.__dataclass_fields__)
        for looked_up in ("device_trust", "risk", "outcome", "granted_capabilities"):
            self.assertNotIn(looked_up, fields)

    def test_a_denied_decision_cannot_become_an_authorization(self):
        decision = engine().evaluate(request(capability="do_whatever_i_say"), now=NOW)
        with self.assertRaises(ValueError):
            decision.to_envelope(decision_id="decision-0001", decided_at=NOW)


class DomainLeakInvariants(unittest.TestCase):
    """health and email data cannot leak into unrelated contexts."""

    def entry(self, domain, source="orion_state"):
        return ContextEntry(
            source=source, text="something", sensitivity=Sensitivity.SENSITIVE,
            domain=domain, provenance=Provenance.SYSTEM_GENERATED,
        )

    def test_health_context_cannot_reach_an_unrelated_task(self):
        for task in (Domain.EMAIL, Domain.CALENDAR, Domain.FILES, Domain.COMPUTER, Domain.PROJECTS):
            built = build("correlation-0001", task, [self.entry(Domain.HEALTH)])
            self.assertEqual(built.bundle.entries, (), task)
            self.assertEqual(len(built.exclusions), 1, task)

    def test_email_context_cannot_reach_an_unrelated_task(self):
        for task in (Domain.HEALTH, Domain.FILES, Domain.COMPUTER, Domain.SECURITY):
            built = build("correlation-0001", task, [self.entry(Domain.EMAIL)])
            self.assertEqual(built.bundle.entries, (), task)

    def test_health_and_security_are_sealed_to_themselves(self):
        for domain in (Domain.HEALTH, Domain.SECURITY):
            for other in Domain:
                if other in {domain, Domain.GENERAL}:
                    continue
                self.assertFalse(admits(domain, other), f"{domain}<-{other}")

    def test_health_events_cannot_cascade_beyond_notifications(self):
        for target in Category:
            expected = target in {Category.HEALTH, Category.NOTIFICATIONS}
            self.assertEqual(may_cascade(Category.HEALTH, target), expected, target)


class OwnershipInvariants(unittest.TestCase):
    """client-provided user ownership fields cannot override server ownership."""

    def test_a_request_cannot_carry_its_own_trust_or_ownership(self):
        self.assertNotIn("device_trust", PolicyRequest.__dataclass_fields__)
        self.assertNotIn("owner", PolicyRequest.__dataclass_fields__)

    def test_naming_a_user_does_not_make_their_device_yours(self):
        decision = engine().evaluate(request(authenticated_user=OTHER), now=NOW)
        self.assertIs(decision.outcome, DecisionOutcome.DENY)
        self.assertIn("origin_device_not_owned_by_user", decision.reason_codes)

    def test_ownership_is_answered_by_the_directory_not_the_request(self):
        self.assertTrue(directory().owns(USER, MAC))
        self.assertFalse(directory().owns(OTHER, MAC))

    def test_a_repository_cannot_be_read_without_a_server_resolved_owner(self):
        repository = Repository("task")
        owner = resolve_owner(Session("session-0001-aa", USER, MAC))
        repository.put(owner, "task-0001-aaaa", {"title": "mine"})
        for pretender in (USER, None, {"user_id": USER}):
            with self.assertRaises(OwnershipViolation):
                repository.get(pretender, "task-0001-aaaa")
        with self.assertRaises(ClientOwnershipRefused):
            Owner(USER, "session-0001-aa", proof=object())

    def test_one_user_cannot_read_another_users_record(self):
        repository = Repository("task")
        mine = resolve_owner(Session("session-0001-aa", USER, MAC))
        theirs = resolve_owner(Session("session-0002-aa", OTHER, PHONE))
        repository.put(mine, "task-0001-aaaa", {"title": "mine"})
        # KeyError, not OwnershipViolation: another user gets the same answer for
        # your record as for one that does not exist, or ids are enumerable.
        with self.assertRaises(KeyError):
            repository.get(theirs, "task-0001-aaaa")
        self.assertEqual(repository.list(theirs), ())

    def test_a_payload_cannot_name_its_own_owner(self):
        cleaned, stripped = strip_client_ownership({"title": "x", "user_id": OTHER})
        self.assertNotIn("user_id", cleaned)
        self.assertEqual(stripped, ("user_id",))

    def test_one_users_idempotency_key_cannot_reach_another_users_job(self):
        queue = JobQueue()
        queue.submit(job(), now=NOW)
        theirs = queue.submit(job(job_id="job-0002-aaaa", user_id=OTHER), now=NOW)
        self.assertEqual(str(theirs.job_id), "job-0002-aaaa")
        self.assertEqual(len(queue), 2)


class ConnectionInvariants(unittest.TestCase):
    """deleted connections cannot continue refreshing tokens."""

    def vault(self):
        subject = CredentialVault(
            InProcessKms({1: b"master-key-one-" + b"0" * 20}),
            _TestCipher(),
            data_key_source=lambda: b"d" * 32,
        )
        subject.store(
            credential_id="credential-0001", user_id=USER, connection_id="connection-0001",
            provider="google", scopes=("gmail.readonly",), refresh_token=b"refresh-token-value",
            now=NOW,
        )
        return subject

    def test_deleting_a_connection_revokes_its_credentials_at_once(self):
        subject = self.vault()
        subject.delete_connection(USER, "connection-0001", now=NOW)
        with self.assertRaises(CredentialRevoked):
            subject.borrow(USER, "credential-0001")

    def test_a_deleted_connection_cannot_be_given_a_new_credential(self):
        subject = self.vault()
        subject.delete_connection(USER, "connection-0001", now=NOW)
        with self.assertRaises(CredentialRevoked):
            subject.store(
                credential_id="credential-0002", user_id=USER, connection_id="connection-0001",
                provider="google", scopes=(), refresh_token=b"another", now=NOW,
            )

    def test_a_revoked_credential_cannot_be_borrowed(self):
        subject = self.vault()
        subject.revoke(USER, "credential-0001", now=NOW)
        with self.assertRaises(CredentialRevoked):
            subject.borrow(USER, "credential-0001")

    def test_no_route_and_no_module_operation_returns_a_credential(self):
        # "Never return connector credentials through public APIs": the vault's
        # borrow is not an operation any module offers, so no route can name it.
        secret_returning = {"borrow", "decrypt", "read_credential", "get_token", "reveal"}
        for name, module in MODULES.items():
            self.assertFalse(set(module.operations) & secret_returning, name)
        for route in ROUTES:
            self.assertNotIn(route.operation, secret_returning, route.path)

    def test_a_borrowed_secret_cannot_enter_a_log_a_bundle_or_an_event(self):
        # Two independent defences, and the test exercises both rather than
        # letting the first hide the second.
        secret = Borrowed(b"refresh-token-value")

        # By NAME: a field called `token` is struck before anything looks at its
        # type, so the secret never reaches the redactor's walk at all.
        by_name = audit_event(details={"token": secret})
        self.assertEqual(by_name.details["token"], "[redacted:sensitive_field]")
        self.assertIn("sensitive_field", by_name.redactions)

        # By TYPE: under an innocent name there is no pattern to match, and the
        # value is refused for not being JSON.
        with self.assertRaises(ValueError):
            audit_event(details={"value": secret})
        with self.assertRaises(ValueError):
            EventEnvelope(
                event_id="event-0001-aaaa", event_type="tasks.created", version=1,
                user_id=USER, source="orion.tasks", occurred_at=NOW,
                sensitivity=Sensitivity.INTERNAL, correlation_id="correlation-0001",
                payload={"task_id": "t1", "value": secret},
            )


class EgressInvariants(unittest.TestCase):
    """arbitrary internal URLs cannot be fetched through SSRF."""

    ALLOWLIST = frozenset({"api.anthropic.com"})

    def test_egress_denies_by_default(self):
        # The allowlist is the primary control; the range checks are the second
        # layer for an allowlisted name pointed somewhere it should not be.
        with self.assertRaises(EgressRefused):
            egress_check("https://api.anthropic.com/v1")
        self.assertEqual(egress_check("https://api.anthropic.com/v1", allowlist=self.ALLOWLIST).host,
                         "api.anthropic.com")

    def test_internal_addresses_cannot_be_fetched_even_if_allowlisted(self):
        for host in ("127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "100.64.3.4",
                     "[::1]", "[::ffff:127.0.0.1]", "localhost", "db.internal",
                     "metadata.google.internal", "svc.cluster.local", "router"):
            with self.assertRaises(EgressRefused, msg=host):
                egress_check(f"https://{host}/", allowlist=frozenset({host.strip("[]"), host}))

    def test_only_the_egress_guard_may_reach_the_network(self):
        # The guard has no production caller yet. This is what stops one
        # appearing that skips it: any backend file except egress.py importing an
        # HTTP client fails the boundary check.
        root = Path(tempfile.mkdtemp()) / "backend"
        self.addCleanup(shutil.rmtree, root.parent, ignore_errors=True)
        (root / "connectors").mkdir(parents=True)
        (root / "connectors" / "fetch.py").write_text("import requests\n", encoding="utf-8")
        errors = import_errors(root)
        self.assertTrue(any("only egress.py may reach the network" in error for error in errors), errors)

    def test_a_url_cannot_smuggle_a_host_or_a_credential(self):
        for url in ("https://api.anthropic.com@evil.example.com/",
                    "https://user:pass@api.anthropic.com/",
                    "https://api.anthropic.com.evil.example.com/",
                    "http://api.anthropic.com/"):
            with self.assertRaises(EgressRefused, msg=url):
                egress_check(url, allowlist=self.ALLOWLIST)


class ShellInvariants(unittest.TestCase):
    """remote raw shell remains disabled."""

    FORBIDDEN = ("exec", "shell", "run_command", "eval", "spawn", "bash", "sh_", "terminal")

    def test_no_capability_offers_arbitrary_execution(self):
        for action, entry in registry().capabilities.items():
            for word in self.FORBIDDEN:
                self.assertNotIn(word, action, action)
                self.assertNotIn(word, entry.capability, entry.capability)

    def test_remote_execution_is_off_by_default(self):
        decision = PolicyEngine(registry(), directory()).evaluate(
            request(origin_device=PHONE, target_device=MAC), now=NOW
        )
        self.assertIs(decision.outcome, DecisionOutcome.DENY)
        self.assertIn("remote_execution_disabled", decision.reason_codes)


class RegistryTests(unittest.TestCase):
    """The registry is the part that stops a vacuous pass reading like proof."""

    def setUp(self):
        self.document = json.loads(INVARIANTS_PATH.read_text(encoding="utf-8"))
        self.invariants = self.document["invariants"]

    def test_all_eighteen_manifest_invariants_are_registered_once(self):
        self.assertEqual(len(self.invariants), 18)
        identifiers = [item["id"] for item in self.invariants]
        self.assertEqual(len(set(identifiers)), 18)
        for item in self.invariants:
            self.assertTrue(item["manifestText"], item["id"])

    def test_every_enforced_invariant_names_a_test_that_exists(self):
        # A rename that orphans an invariant fails here rather than leaving a
        # registry entry pointing at nothing.
        module = globals()
        for item in self.invariants:
            if item["status"] != "enforced":
                continue
            self.assertTrue(item["tests"], item["id"])
            self.assertTrue(item.get("enforcedBy"), item["id"])
            for reference in item["tests"]:
                class_name, method = reference.split(".")
                self.assertIn(class_name, module, reference)
                self.assertTrue(hasattr(module[class_name], method), reference)

    def test_every_pending_invariant_names_its_missing_subject_and_has_no_test(self):
        for item in self.invariants:
            if item["status"] != "pending_subject":
                continue
            self.assertTrue(item.get("pendingSubject"), item["id"])
            self.assertTrue(item.get("expectedPhase"), item["id"])
            self.assertEqual(item["tests"], [], item["id"])

    def test_the_pending_count_cannot_rise_silently(self):
        pending = [item["id"] for item in self.invariants if item["status"] == "pending_subject"]
        self.assertEqual(
            len(pending),
            EXPECTED_PENDING,
            f"pending invariants changed: {pending}. Lower it when a phase closes one; "
            f"raising it needs a deliberate edit here and a line in the handoff.",
        )

    def test_the_suite_the_registry_names_is_this_one(self):
        self.assertEqual(self.document["suite"], "tests/test_v2_security_invariants.py")
        self.assertTrue(self.document["permanent"])


REPO_ROOT = Path(__file__).resolve().parents[1]

# Where live code lives. `archive/` and `_archive/` are excluded because they are
# kept for reference and are not run; vendored trees are excluded because they
# are not ours to hold to this rule.
LIVE_SOURCE_ROOTS = ("orion", "backend", "scripts", "native", "openclaw-plugins")
SKIP_PARTS = frozenset({
    "node_modules", ".build", "dist", "_archive", "archive", ".claude", ".git", "__pycache__",
})
SOURCE_SUFFIXES = (".py", ".js", ".ts", ".mjs", ".swift", ".sh")

WILDCARD_ADDRESSES = ("0.0.0.0", "::/0")
# A wildcard address is only a problem where something LISTENS. The first draft
# of this scan looked for the address alone and flagged orion/web.py's SSRF
# denylist -- a guard that refuses to fetch loopback URLs, which names 0.0.0.0
# precisely because it is defending against it. A test that reports a security
# control as a vulnerability is worse than no test: the cheapest way to make it
# pass is to delete the control.
BIND_TOKENS = (
    "bind(", "listen(", "HTTPServer(", "createServer(", "serve(",
    "host=", "hostname=", "--host", "sin_addr", "ListenAddress",
)


def binds_a_wildcard(line: str) -> bool:
    """Whether one line of source opens a listener on a wildcard address."""
    if not any(address in line for address in WILDCARD_ADDRESSES):
        return False
    return any(token in line for token in BIND_TOKENS)


def live_sources():
    for root in LIVE_SOURCE_ROOTS:
        base = REPO_ROOT / root
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if path.suffix not in SOURCE_SUFFIXES or not path.is_file():
                continue
            if SKIP_PARTS.intersection(path.parts):
                continue
            yield path


class TheMacNeverExposesAPublicServer(unittest.TestCase):
    """Phase 44: "Never expose a public Python server on the Mac."

    The requirement is a negative, so it is asserted against the tree rather
    than against a type. Two halves: the interface bridge actively REFUSES a
    non-loopback host, and no live source binds one in the first place.

    Verified on 2026-09-01, and the reason this is a test rather than a note in
    a gate: a negative requirement is satisfied on the day it is checked and
    broken by the next person who adds a listener. Nothing about the Swift
    domain in Phase 44 would notice.
    """

    def test_the_interface_bridge_refuses_a_non_loopback_host(self):
        import subprocess
        import sys as _sys

        result = subprocess.run(
            [_sys.executable, str(REPO_ROOT / "orion/interface/server.py"),
             "--host", "0.0.0.0", "--port", "8770"],
            capture_output=True, text=True, timeout=60, cwd=str(REPO_ROOT),
        )
        # It must refuse BEFORE binding, so this never actually opens a socket.
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("refusing to bind a non-loopback address", result.stderr)

    def test_the_loopback_hosts_it_accepts_are_exactly_the_three(self):
        source = (REPO_ROOT / "orion/interface/server.py").read_text()
        # CONTENTS, not a count. A guard listing three hosts stays a guard
        # listing three hosts after one of them is swapped for a wildcard.
        self.assertIn('args.host not in ("127.0.0.1", "localhost", "::1")', source)
        self.assertIn('ap.add_argument("--host", default="127.0.0.1")', source)

    def test_the_detector_tells_a_bind_from_a_denylist(self):
        # Without this the scan below could pass by detecting nothing at all,
        # which reads in a report exactly like proof. Both halves are pinned:
        # what it must catch, and what it must NOT.
        must_catch = [
            'server = ThreadingHTTPServer(("0.0.0.0", port), Handler)',
            'ap.add_argument("--host", default="0.0.0.0")',
            'app.listen(3000, "0.0.0.0")',
            'sock.bind(("0.0.0.0", 8080))',
        ]
        must_not_catch = [
            'if parsed.hostname in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:',
            'BLOCKED_HOSTS = {"0.0.0.0", "169.254.169.254"}',
            'server = ThreadingHTTPServer(("127.0.0.1", port), Handler)',
        ]
        for line in must_catch:
            self.assertTrue(binds_a_wildcard(line), f"should have been caught: {line}")
        for line in must_not_catch:
            self.assertFalse(binds_a_wildcard(line), f"should NOT have been caught: {line}")

    def test_no_live_source_binds_a_non_loopback_address(self):
        offenders = []
        for path in live_sources():
            for lineno, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
                if binds_a_wildcard(line):
                    offenders.append(f"{path.relative_to(REPO_ROOT)}:{lineno}: {line.strip()[:100]}")
        self.assertEqual(
            offenders,
            [],
            "a live source opens a listener on a wildcard address. Phase 44 requires the Mac "
            "to connect OUTBOUND and never listen publicly:\n" + "\n".join(offenders),
        )

    def test_the_scan_actually_reaches_the_sources_it_claims_to(self):
        # Without this, a bad glob would make the invariant above pass by
        # scanning nothing at all -- which reads in a report exactly like proof.
        scanned = {path.relative_to(REPO_ROOT).parts[0] for path in live_sources()}
        self.assertEqual(scanned, set(LIVE_SOURCE_ROOTS), f"scanned only {sorted(scanned)}")
        self.assertGreater(sum(1 for _ in live_sources()), 200)


if __name__ == "__main__":
    unittest.main()
