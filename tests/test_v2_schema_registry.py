from __future__ import annotations

import json
import unittest
from pathlib import Path

from orion.core.schemas import DecisionEnvelope, ExecutionResult, ProposalEnvelope
from orion.shared.result import DecisionOutcome, ExecutionStatus, Sensitivity


SCHEMA_ROOT = Path(__file__).resolve().parents[1] / "orion/core/schemas"


class V2SchemaRegistryTests(unittest.TestCase):
    def load(self, name: str) -> dict[str, object]:
        return json.loads((SCHEMA_ROOT / name).read_text(encoding="utf-8"))

    def assert_closed_schema(self, schema: dict[str, object], fields: frozenset[str]):
        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(set(schema["required"]), fields)
        self.assertEqual(set(schema["properties"]), fields)
        self.assertEqual(schema["properties"]["schema_version"], {"const": 1})

    def test_canonical_schemas_match_reference_envelope_fields(self):
        self.assert_closed_schema(self.load("proposal.schema.json"), ProposalEnvelope.FIELDS)
        self.assert_closed_schema(self.load("decision.schema.json"), DecisionEnvelope.FIELDS)
        self.assert_closed_schema(
            self.load("execution-result.schema.json"), ExecutionResult.FIELDS
        )

    def test_closed_vocabularies_match_reference_enums(self):
        proposal = self.load("proposal.schema.json")
        decision = self.load("decision.schema.json")
        execution = self.load("execution-result.schema.json")
        self.assertEqual(
            set(proposal["properties"]["sensitivity"]["enum"]),
            {value.value for value in Sensitivity},
        )
        self.assertEqual(
            set(decision["properties"]["outcome"]["enum"]),
            {value.value for value in DecisionOutcome},
        )
        self.assertEqual(
            set(execution["properties"]["status"]["enum"]),
            {value.value for value in ExecutionStatus},
        )


if __name__ == "__main__":
    unittest.main()
