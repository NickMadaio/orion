from __future__ import annotations

import unittest
from datetime import datetime, timezone

from orion.core.context.domains import Domain, Provenance
from orion.core.context.ports import ContextBundle, ContextEntry
from orion.core.events.ports import AuditRecord
from orion.core.jobs.ports import JobReceipt
from orion.core.memory.ports import MemoryRecord
from orion.core.schemas import DecisionEnvelope, ProposalEnvelope
from orion.core.tools.ports import AuthorizedAction
from orion.shared.result import Sensitivity


def proposal() -> ProposalEnvelope:
    return ProposalEnvelope.from_dict(
        {
            "schema_version": 1,
            "proposal_id": "proposal-0001",
            "correlation_id": "correlation-0001",
            "source": "openclaw",
            "capability": "system_status",
            "arguments": {},
            "created_at": "2026-08-19T18:00:00Z",
            "provenance": ["normal-agent-route"],
            "sensitivity": "INTERNAL",
        }
    )


def decision(outcome: str, proposal_id: str = "proposal-0001") -> DecisionEnvelope:
    return DecisionEnvelope.from_dict(
        {
            "schema_version": 1,
            "decision_id": "decision-0001",
            "proposal_id": proposal_id,
            "outcome": outcome,
            "policy_version": "policy-v1",
            "reason_codes": ["fixture"],
            "decided_at": "2026-08-19T18:00:01Z",
            "expires_at": "2026-08-19T18:05:01Z",
        }
    )


class V2CorePortTests(unittest.TestCase):
    def test_context_bundle_enforces_count_and_character_budgets(self):
        # domain and provenance became required in Phase 3: a context entry that
        # does not say what it is about cannot be firewalled.
        entry = ContextEntry(
            source="system",
            text="healthy",
            sensitivity=Sensitivity.INTERNAL,
            domain=Domain.GENERAL,
            provenance=Provenance.SYSTEM_GENERATED,
        )
        bundle = ContextBundle(correlation_id="correlation-0001", entries=(entry,))
        self.assertEqual(bundle.entries, (entry,))
        with self.assertRaisesRegex(ValueError, "too many"):
            ContextBundle(
                correlation_id="correlation-0001",
                entries=(entry,) * 65,
            )
        with self.assertRaisesRegex(ValueError, "identifier"):
            ContextBundle(correlation_id="bad id", entries=())
        with self.assertRaisesRegex(ValueError, "tuple"):
            ContextBundle(correlation_id="correlation-0001", entries=[])

    def test_denied_or_mismatched_proposal_cannot_reach_broker(self):
        with self.assertRaisesRegex(ValueError, "denied"):
            AuthorizedAction(proposal(), decision("DENY"))
        with self.assertRaisesRegex(ValueError, "not bound"):
            AuthorizedAction(proposal(), decision("ALLOW", "proposal-0002"))

    def test_approval_reference_is_required_only_for_approval_outcome(self):
        with self.assertRaisesRegex(ValueError, "no approval"):
            AuthorizedAction(proposal(), decision("REQUIRE_APPROVAL"))
        action = AuthorizedAction(
            proposal(),
            decision("REQUIRE_APPROVAL"),
            approval_reference="approval-0001",
        )
        self.assertTrue(action.is_valid_at(datetime(2026, 8, 19, 18, 1, tzinfo=timezone.utc)))
        self.assertFalse(action.is_valid_at(datetime(2026, 8, 19, 18, 6, tzinfo=timezone.utc)))
        with self.assertRaisesRegex(ValueError, "aware"):
            action.is_valid_at(datetime(2026, 8, 19, 18, 1))

    def test_persistence_and_audit_payloads_are_deeply_immutable_json(self):
        original = {"nested": ["safe"]}
        record = MemoryRecord(
            record_id="memory-record-0001",
            record_type="conversation",
            revision=1,
            recorded_at=datetime(2026, 8, 19, 18, 0, tzinfo=timezone.utc),
            sensitivity=Sensitivity.SENSITIVE,
            payload=original,
        )
        original["nested"].append("mutated")
        self.assertEqual(record.payload["nested"], ("safe",))
        with self.assertRaises(TypeError):
            record.payload["extra"] = True

        audit = AuditRecord(
            correlation_id="correlation-0001",
            event="policy_decision",
            occurred_at=datetime(2026, 8, 19, 18, 0, tzinfo=timezone.utc),
            sensitivity=Sensitivity.INTERNAL,
            fields={"reasons": ["least_privilege"]},
        )
        self.assertEqual(audit.fields["reasons"], ("least_privilege",))
        with self.assertRaisesRegex(ValueError, "representable as JSON"):
            MemoryRecord(
                record_id="memory-record-0002",
                record_type="conversation",
                revision=1,
                recorded_at=datetime(2026, 8, 19, 18, 0, tzinfo=timezone.utc),
                sensitivity=Sensitivity.INTERNAL,
                payload={"unsafe": object()},
            )

    def test_version_and_timestamp_fields_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "positive integer"):
            MemoryRecord(
                record_id="memory-record-0001",
                record_type="conversation",
                revision=True,
                recorded_at=datetime(2026, 8, 19, 18, 0, tzinfo=timezone.utc),
                sensitivity=Sensitivity.INTERNAL,
                payload={},
            )
        with self.assertRaisesRegex(ValueError, "timezone-aware"):
            JobReceipt(
                job_id="job-receipt-0001",
                proposal_id="proposal-0001",
                accepted_at=datetime(2026, 8, 19, 18, 0),
            )


if __name__ == "__main__":
    unittest.main()
