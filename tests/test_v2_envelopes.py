from __future__ import annotations

import copy
import unittest
from datetime import datetime, timezone

from orion.core.schemas import DecisionEnvelope, ExecutionResult, ProposalEnvelope


def proposal_fixture() -> dict[str, object]:
    return {
        "schema_version": 1,
        "proposal_id": "proposal-0001",
        "correlation_id": "correlation-0001",
        "source": "openclaw",
        "capability": "system_status",
        "arguments": {"include": ["gateway", "app"], "limit": 2},
        "created_at": "2026-08-19T18:00:00Z",
        "provenance": ["normal-agent-route"],
        "sensitivity": "INTERNAL",
    }


class V2EnvelopeTests(unittest.TestCase):
    def test_proposal_round_trip_and_arguments_are_immutable(self):
        source = proposal_fixture()
        proposal = ProposalEnvelope.from_dict(source)
        self.assertEqual(proposal.to_dict(), source)
        with self.assertRaises(TypeError):
            proposal.arguments["limit"] = 3

    def test_unknown_missing_and_unsupported_schema_fields_fail_closed(self):
        unknown = proposal_fixture()
        unknown["credential"] = "must-not-pass"
        with self.assertRaisesRegex(ValueError, "unknown=.*credential"):
            ProposalEnvelope.from_dict(unknown)

        missing = proposal_fixture()
        del missing["capability"]
        with self.assertRaisesRegex(ValueError, "missing=.*capability"):
            ProposalEnvelope.from_dict(missing)

        future = proposal_fixture()
        future["schema_version"] = 2
        with self.assertRaisesRegex(ValueError, "unsupported schema"):
            ProposalEnvelope.from_dict(future)

        non_integer = proposal_fixture()
        non_integer["schema_version"] = 1.0
        with self.assertRaisesRegex(ValueError, "unsupported schema"):
            ProposalEnvelope.from_dict(non_integer)

    def test_malformed_identifiers_naive_time_and_nonfinite_numbers_fail(self):
        malformed = proposal_fixture()
        malformed["proposal_id"] = "bad id"
        with self.assertRaisesRegex(ValueError, "identifier"):
            ProposalEnvelope.from_dict(malformed)

        naive = proposal_fixture()
        naive["created_at"] = "2026-08-19T18:00:00"
        with self.assertRaisesRegex(ValueError, "timezone"):
            ProposalEnvelope.from_dict(naive)

        nonfinite = proposal_fixture()
        nonfinite["arguments"] = {"score": float("nan")}
        with self.assertRaisesRegex(ValueError, "finite"):
            ProposalEnvelope.from_dict(nonfinite)

    def test_decision_requires_closed_outcome_and_expiration_order(self):
        decision = {
            "schema_version": 1,
            "decision_id": "decision-0001",
            "proposal_id": "proposal-0001",
            "outcome": "REQUIRE_APPROVAL",
            "policy_version": "policy-v1",
            "reason_codes": ["external-write"],
            "decided_at": "2026-08-19T18:00:01Z",
            "expires_at": "2026-08-19T18:05:01Z",
        }
        self.assertEqual(DecisionEnvelope.from_dict(decision).to_dict(), decision)
        invalid = copy.deepcopy(decision)
        invalid["expires_at"] = invalid["decided_at"]
        with self.assertRaisesRegex(ValueError, "after decided_at"):
            DecisionEnvelope.from_dict(invalid)

    def test_execution_result_requires_observation_and_time_order(self):
        result = {
            "schema_version": 1,
            "execution_id": "execution-0001",
            "proposal_id": "proposal-0001",
            "status": "SUCCEEDED",
            "observed_outcome": {"healthy": True},
            "audit_reference": "audit-ref-0001",
            "started_at": "2026-08-19T18:00:02Z",
            "finished_at": "2026-08-19T18:00:03Z",
        }
        self.assertEqual(ExecutionResult.from_dict(result).to_dict(), result)
        invalid = copy.deepcopy(result)
        invalid["finished_at"] = "2026-08-19T18:00:01Z"
        with self.assertRaisesRegex(ValueError, "must not precede"):
            ExecutionResult.from_dict(invalid)

    def test_direct_construction_cannot_bypass_tuple_contracts(self):
        valid = ProposalEnvelope.from_dict(proposal_fixture())
        with self.assertRaisesRegex(ValueError, "provenance"):
            ProposalEnvelope(
                schema_version=1,
                proposal_id=valid.proposal_id,
                correlation_id=valid.correlation_id,
                source=valid.source,
                capability=valid.capability,
                arguments={},
                created_at=datetime.now(timezone.utc),
                provenance="not-a-tuple",
                sensitivity=valid.sensitivity,
            )


if __name__ == "__main__":
    unittest.main()
