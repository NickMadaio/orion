import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  TaskGraph,
  TaskRunRecord,
  TrustProvenance,
  ValidationResult,
} from "../types.js";
import {
  DECISION_FIELDS,
  DECISION_OUTCOMES,
  EXECUTION_RESULT_FIELDS,
  EXECUTION_STATUSES,
  PROPOSAL_FIELDS,
  SENSITIVITIES,
  decisionEnvelope,
  executionResultEnvelope,
  proposalEnvelope,
} from "./contracts.js";
import {
  runSystemStatusContractBridge,
  systemStatusContractEvidence,
} from "./system-status-adapter.js";

const NOW = "2026-08-19T22:00:00.000Z";

function graph(): TaskGraph {
  return {
    version: "1",
    goal: "Read system status",
    inputs: [
      {
        id: "orion_user_turn_1",
        kind: "instruction",
        trust: "trusted_user",
        content: "check system status",
      },
    ],
    assumptions: [],
    retryBudget: 0,
    steps: [
      {
        id: "status",
        action: "system_status",
        arguments: {},
        dependsOn: [],
        risk: "low",
        expectedEffect: "System status is read",
        verify: "system_status_observed",
        sourceRefs: ["orion_user_turn_1"],
        reversible: true,
      },
    ],
  };
}

const provenance: TrustProvenance = {
  binding: "run",
  turnCount: 1,
  sources: ["channel_message"],
  runId: "run-0001",
  sessionKey: "session-0001",
};

function validation(status: ValidationResult["status"] = "ready"): ValidationResult {
  return {
    valid: status === "ready",
    status,
    issues:
      status === "ready"
        ? []
        : [{ code: "fixture_denied", message: "Denied by the fixture." }],
    executionOrder: status === "ready" ? ["status"] : [],
    planHash: "plan-hash-0001",
  };
}

function record(output: Record<string, unknown> = {}): TaskRunRecord {
  return {
    taskId: "orion-task-0001",
    planHash: "plan-hash-0001",
    goal: "Read system status",
    status: "succeeded",
    createdAt: NOW,
    completedAt: "2026-08-19T22:00:00.020Z",
    authorization: provenance,
    validation: validation(),
    steps: [
      {
        stepId: "status",
        status: "verified",
        attempts: 1,
        idempotencyKey: "idempotency-0001",
        request: { action: "system_status", arguments: {}, sourceRefs: [] },
        execution: {
          mode: "observed",
          output: {
            batteryPercent: 82,
            diskFreeGb: 140,
            diskTotalGb: 460,
            uptime: "2d 3h",
            summary: "battery 82%, 140 of 460 GB free, up 2d 3h",
            ...output,
          },
        },
        verification: {
          method: "system_status_observed",
          observed: true,
        },
      },
    ],
  };
}

function nonceFactory(): () => string {
  let value = 0;
  return () => `00000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
}

describe("ORION v2 schema contracts", () => {
  it("rejects unknown fields, naive timestamps, and non-finite JSON", () => {
    const base = {
      schema_version: 1,
      proposal_id: "proposal-0001",
      correlation_id: "correlation-0001",
      source: "openclaw_taskgraph",
      capability: "system_status",
      arguments: {},
      created_at: NOW,
      provenance: ["host-binding:run"],
      sensitivity: "INTERNAL",
    };
    expect(() => proposalEnvelope({ ...base, trusted: true })).toThrow(
      /unknown=.*trusted/,
    );
    expect(() => proposalEnvelope({ ...base, created_at: "2026-08-19T22:00:00" })).toThrow(
      /offset ISO-8601/,
    );
    expect(() => proposalEnvelope({ ...base, created_at: "2026-02-31T22:00:00Z" })).toThrow(
      /offset ISO-8601/,
    );
    expect(() => proposalEnvelope({ ...base, arguments: { value: Infinity } })).toThrow(
      /finite/,
    );
  });

  it("deep-copies and freezes nested JSON", () => {
    const argumentsValue = { nested: ["safe"] };
    const proposal = proposalEnvelope({
      schema_version: 1,
      proposal_id: "proposal-0001",
      correlation_id: "correlation-0001",
      source: "openclaw_taskgraph",
      capability: "system_status",
      arguments: argumentsValue,
      created_at: NOW,
      provenance: ["host-binding:run"],
      sensitivity: "INTERNAL",
    });
    argumentsValue.nested.push("changed");
    expect(proposal.arguments.nested).toEqual(["safe"]);
    expect(Object.isFrozen(proposal.arguments.nested)).toBe(true);

    const shared = { value: "safe" };
    expect(
      proposalEnvelope({
        schema_version: 1,
        proposal_id: "proposal-0002",
        correlation_id: "correlation-0002",
        source: "openclaw_taskgraph",
        capability: "system_status",
        arguments: { left: shared, right: shared },
        created_at: NOW,
        provenance: ["host-binding:run"],
        sensitivity: "INTERNAL",
      }).arguments,
    ).toEqual({ left: { value: "safe" }, right: { value: "safe" } });

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      proposalEnvelope({
        schema_version: 1,
        proposal_id: "proposal-0003",
        correlation_id: "correlation-0003",
        source: "openclaw_taskgraph",
        capability: "system_status",
        arguments: cyclic,
        created_at: NOW,
        provenance: ["host-binding:run"],
        sensitivity: "INTERNAL",
      }),
    ).toThrow(/cyclic/);
  });

  it("enforces decision expiry and execution ordering", () => {
    expect(() =>
      decisionEnvelope({
        schema_version: 1,
        decision_id: "decision-0001",
        proposal_id: "proposal-0001",
        outcome: "ALLOW",
        policy_version: "policy-v1",
        reason_codes: ["ready"],
        decided_at: NOW,
        expires_at: NOW,
      }),
    ).toThrow(/after/);
    expect(() =>
      executionResultEnvelope({
        schema_version: 1,
        execution_id: "execution-0001",
        proposal_id: "proposal-0001",
        status: "SUCCEEDED",
        observed_outcome: {},
        audit_reference: "audit-ref-0001",
        started_at: NOW,
        finished_at: "2026-08-19T21:59:59.000Z",
      }),
    ).toThrow(/precede/);
  });

  it("matches the canonical schema fields and closed vocabularies", async () => {
    const schemaRoot = fileURLToPath(
      new URL("../../../../orion/core/schemas/", import.meta.url),
    );
    const load = async (name: string) =>
      JSON.parse(await readFile(path.join(schemaRoot, name), "utf8")) as {
        required: string[];
        properties: Record<string, { enum?: string[] }>;
      };
    const proposal = await load("proposal.schema.json");
    const decision = await load("decision.schema.json");
    const execution = await load("execution-result.schema.json");
    expect(new Set(proposal.required)).toEqual(new Set(PROPOSAL_FIELDS));
    expect(new Set(decision.required)).toEqual(new Set(DECISION_FIELDS));
    expect(new Set(execution.required)).toEqual(new Set(EXECUTION_RESULT_FIELDS));
    expect(new Set(proposal.properties.sensitivity?.enum)).toEqual(
      new Set(SENSITIVITIES),
    );
    expect(new Set(decision.properties.outcome?.enum)).toEqual(
      new Set(DECISION_OUTCOMES),
    );
    expect(new Set(execution.properties.status?.enum)).toEqual(
      new Set(EXECUTION_STATUSES),
    );
  });
});

describe("default-off system_status bridge", () => {
  it("returns the exact legacy record and keeps contract evidence non-enumerable", async () => {
    const legacy = record();
    let calls = 0;
    const result = await runSystemStatusContractBridge({
      graph: graph(),
      provenance,
      validation: validation(),
      runLegacy: async () => {
        calls += 1;
        return legacy;
      },
      now: () => new Date(NOW),
      nonce: nonceFactory(),
    });
    expect(calls).toBe(1);
    expect(result).toBe(legacy);
    expect(JSON.stringify(result)).not.toContain("schema_version");
    expect(systemStatusContractEvidence(result)).toMatchObject({
      proposal: { capability: "system_status", arguments: {} },
      decision: { outcome: "ALLOW", reason_codes: ["legacy_validator_ready"] },
      execution: {
        status: "SUCCEEDED",
        audit_reference: "orion-task-0001",
        observed_outcome: { mode: "observed" },
      },
    });
  });

  it("mirrors a denied legacy decision without inventing an execution", async () => {
    const denied = record();
    denied.status = "rejected";
    denied.validation = validation("rejected");
    denied.steps = [];
    const result = await runSystemStatusContractBridge({
      graph: graph(),
      provenance,
      validation: validation("rejected"),
      runLegacy: async () => denied,
      now: () => new Date(NOW),
      nonce: nonceFactory(),
    });
    const evidence = systemStatusContractEvidence(result);
    expect(evidence?.decision?.outcome).toBe("DENY");
    expect(evidence?.execution).toBeUndefined();
  });

  // The bridge is an observer. Every case below would have thrown out of the
  // tool while the flag was on, which is the one thing a default-off contract
  // experiment must never do to a working action.
  it("stands aside on widened arguments, output drift, and missing audit durability", async () => {
    const widened = graph();
    widened.steps[0]!.arguments = { verbose: true };
    const widenedLegacy = record();
    const warnings: string[] = [];
    let calls = 0;
    const widenedResult = await runSystemStatusContractBridge({
      graph: widened,
      provenance,
      validation: validation(),
      runLegacy: async () => {
        calls += 1;
        return widenedLegacy;
      },
      onWarning: (message) => warnings.push(message),
    });
    // The legacy catalog declares `requiredArguments: []` and rejects no
    // unknown key, so this call succeeds with the flag off. It must also
    // succeed with the flag on.
    expect(calls).toBe(1);
    expect(widenedResult).toBe(widenedLegacy);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/arguments must be empty/);
    const widenedEvidence = systemStatusContractEvidence(widenedResult);
    expect(widenedEvidence?.contractError).toMatch(/arguments must be empty/);
    expect(widenedEvidence?.proposal).toBeUndefined();
    expect(widenedEvidence?.decision).toBeUndefined();
    expect(widenedEvidence?.execution).toBeUndefined();

    const drifted = record({ rawSecret: "must-not-cross" });
    const driftedResult = await runSystemStatusContractBridge({
      graph: graph(),
      provenance,
      validation: validation(),
      runLegacy: async () => drifted,
    });
    expect(driftedResult).toBe(drifted);
    const driftedEvidence = systemStatusContractEvidence(driftedResult);
    expect(driftedEvidence?.contractError).toMatch(/unknown=.*rawSecret/);
    // The drift is reported, never re-emitted: an unrecognised field must not
    // reach a v2 envelope.
    expect(driftedEvidence?.execution).toBeUndefined();
    expect(JSON.stringify(driftedEvidence)).not.toContain("must-not-cross");

    const unaudited = record();
    unaudited.audit = { appended: false, error: "fixture" };
    const unauditedResult = await runSystemStatusContractBridge({
      graph: graph(),
      provenance,
      validation: validation(),
      runLegacy: async () => unaudited,
    });
    expect(unauditedResult).toBe(unaudited);
    expect(systemStatusContractEvidence(unauditedResult)?.contractError).toMatch(
      /durable audit/,
    );
  });

  it("never throws when the legacy record refuses a hidden property", async () => {
    const frozen = Object.freeze(record());
    const result = await runSystemStatusContractBridge({
      graph: graph(),
      provenance,
      validation: validation(),
      runLegacy: async () => frozen,
      now: () => new Date(NOW),
      nonce: nonceFactory(),
    });
    expect(result).toBe(frozen);
    expect(systemStatusContractEvidence(result)).toBeUndefined();
  });
});
