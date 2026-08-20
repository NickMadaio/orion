from __future__ import annotations

import copy
import unittest
from datetime import datetime, timedelta, timezone

from orion.mac.system_status_adapter import (
    execution_from_legacy_result,
    proposal_from_compact_request,
)


NOW = datetime(2026, 8, 19, 18, 30, tzinfo=timezone.utc)


def request_fixture() -> dict[str, object]:
    return {
        "action": "system_status",
        "arguments": {},
        "tool_call_id": "tool-call-0001",
        "correlation_id": "correlation-0001",
    }


def result_fixture() -> dict[str, object]:
    return {
        "mode": "observed",
        "idempotencyKey": "idempotency-0001",
        "output": {
            "batteryPercent": 82,
            "batteryState": "discharging",
            "diskFreeGb": 140,
            "diskTotalGb": 460,
            "uptime": "2d 3h",
            "summary": "battery 82%, 140 of 460 GB free, up 2d 3h",
        },
    }


class V2CompatibilityContractTests(unittest.TestCase):
    def test_compact_system_status_maps_without_mutating_legacy_request(self):
        request = request_fixture()
        before = copy.deepcopy(request)
        proposal = proposal_from_compact_request(
            request,
            proposal_id="proposal-0001",
            created_at=NOW,
        )
        self.assertEqual(request, before)
        self.assertEqual(proposal.capability, "system_status")
        self.assertEqual(proposal.to_dict()["arguments"], {})
        self.assertEqual(proposal.provenance, ("host-tool-call:tool-call-0001",))

    def test_request_mapping_rejects_other_actions_arguments_and_extra_fields(self):
        other = request_fixture()
        other["action"] = "file_write"
        with self.assertRaisesRegex(ValueError, "only system_status"):
            proposal_from_compact_request(other, proposal_id="proposal-0001", created_at=NOW)

        arguments = request_fixture()
        arguments["arguments"] = {"verbose": True}
        with self.assertRaisesRegex(ValueError, "must be empty"):
            proposal_from_compact_request(arguments, proposal_id="proposal-0001", created_at=NOW)

        extra = request_fixture()
        extra["trusted"] = True
        with self.assertRaisesRegex(ValueError, "unknown=.*trusted"):
            proposal_from_compact_request(extra, proposal_id="proposal-0001", created_at=NOW)

    def test_observed_result_maps_to_execution_envelope_without_mutation(self):
        proposal = proposal_from_compact_request(
            request_fixture(), proposal_id="proposal-0001", created_at=NOW
        )
        legacy = result_fixture()
        before = copy.deepcopy(legacy)
        result = execution_from_legacy_result(
            legacy,
            proposal=proposal,
            execution_id="execution-0001",
            audit_reference="audit-ref-0001",
            started_at=NOW,
            finished_at=NOW + timedelta(milliseconds=20),
        )
        self.assertEqual(legacy, before)
        rendered = result.to_dict()
        self.assertEqual(rendered["status"], "SUCCEEDED")
        self.assertEqual(rendered["observed_outcome"]["system_status"], legacy["output"])

    def test_result_mapping_rejects_mutation_modes_and_unexpected_output(self):
        proposal = proposal_from_compact_request(
            request_fixture(), proposal_id="proposal-0001", created_at=NOW
        )
        changed = result_fixture()
        changed["mode"] = "replaced"
        with self.assertRaisesRegex(ValueError, "observed mode"):
            execution_from_legacy_result(
                changed,
                proposal=proposal,
                execution_id="execution-0001",
                audit_reference="audit-ref-0001",
                started_at=NOW,
                finished_at=NOW,
            )

        extra = result_fixture()
        extra["output"]["rawSecret"] = "must-not-cross"
        with self.assertRaisesRegex(ValueError, "unknown=.*rawSecret"):
            execution_from_legacy_result(
                extra,
                proposal=proposal,
                execution_id="execution-0001",
                audit_reference="audit-ref-0001",
                started_at=NOW,
                finished_at=NOW,
            )


if __name__ == "__main__":
    unittest.main()
