/**
 * ORION v2 Phase 1 language-neutral boundary contracts.
 *
 * These fields and vocabularies mirror the canonical JSON Schemas under
 * `orion/core/schemas`. This module is deliberately provider-, platform-, and
 * executor-free: it validates data and grants no authority.
 */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SYMBOL = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const OFFSET_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
export const PROPOSAL_FIELDS = [
    "schema_version",
    "proposal_id",
    "correlation_id",
    "source",
    "capability",
    "arguments",
    "created_at",
    "provenance",
    "sensitivity",
];
export const DECISION_FIELDS = [
    "schema_version",
    "decision_id",
    "proposal_id",
    "outcome",
    "policy_version",
    "reason_codes",
    "decided_at",
    "expires_at",
];
export const EXECUTION_RESULT_FIELDS = [
    "schema_version",
    "execution_id",
    "proposal_id",
    "status",
    "observed_outcome",
    "audit_reference",
    "started_at",
    "finished_at",
];
export const SENSITIVITIES = [
    "PUBLIC",
    "INTERNAL",
    "SENSITIVE",
    "RESTRICTED",
];
export const DECISION_OUTCOMES = [
    "ALLOW",
    "DENY",
    "REQUIRE_APPROVAL",
];
export const EXECUTION_STATUSES = [
    "SUCCEEDED",
    "FAILED",
    "DENIED",
    "CANCELLED",
];
function exactObject(value, expected, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be a JSON object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(`${label} must be a plain JSON object`);
    }
    const record = value;
    const keys = Object.keys(record);
    const allowed = new Set(expected);
    const unknown = keys.filter((key) => !allowed.has(key)).sort();
    const missing = expected.filter((key) => !Object.hasOwn(record, key)).sort();
    if (unknown.length > 0 || missing.length > 0) {
        throw new Error(`${label} fields mismatch: unknown=${JSON.stringify(unknown)} missing=${JSON.stringify(missing)}`);
    }
    return record;
}
function assertIdentifier(value, field) {
    if (typeof value !== "string" || !IDENTIFIER.test(value)) {
        throw new Error(`${field} has an invalid identifier format`);
    }
}
function assertSymbol(value, field) {
    if (typeof value !== "string" || !SYMBOL.test(value)) {
        throw new Error(`${field} has an invalid symbol format`);
    }
}
function assertDateTime(value, field) {
    if (typeof value !== "string") {
        throw new Error(`${field} must be an offset ISO-8601 timestamp`);
    }
    const match = OFFSET_DATE_TIME.exec(value);
    if (!match || !Number.isFinite(Date.parse(value))) {
        throw new Error(`${field} must be an offset ISO-8601 timestamp`);
    }
    const [year, month, day, hour, minute, second] = match
        .slice(1, 7)
        .map(Number);
    const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const offsetHour = Number(match[8] ?? 0);
    const offsetMinute = Number(match[9] ?? 0);
    if (local.getUTCFullYear() !== year ||
        local.getUTCMonth() !== month - 1 ||
        local.getUTCDate() !== day ||
        local.getUTCHours() !== hour ||
        local.getUTCMinutes() !== minute ||
        local.getUTCSeconds() !== second ||
        offsetHour > 23 ||
        offsetMinute > 59) {
        throw new Error(`${field} must be an offset ISO-8601 timestamp`);
    }
}
function assertStringList(value, field) {
    if (!Array.isArray(value) ||
        value.length === 0 ||
        value.some((item) => typeof item !== "string" || item.length === 0 || item.length > 256)) {
        throw new Error(`${field} must be a non-empty bounded string array`);
    }
}
function freezeJson(value, seen = new WeakSet()) {
    if (value === null ||
        typeof value === "string" ||
        typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error("JSON numbers must be finite");
        return value;
    }
    if (typeof value !== "object") {
        throw new Error("value is not representable as JSON");
    }
    if (seen.has(value))
        throw new Error("cyclic values are not representable as JSON");
    seen.add(value);
    if (Array.isArray(value)) {
        const frozen = Object.freeze(value.map((item) => freezeJson(item, seen)));
        seen.delete(value);
        return frozen;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new Error("value is not representable as JSON");
    }
    const record = value;
    const frozen = Object.freeze(Object.fromEntries(Object.entries(record).map(([key, item]) => [key, freezeJson(item, seen)])));
    seen.delete(value);
    return frozen;
}
function freezeJsonObject(value, field) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${field} must be a JSON object`);
    }
    return freezeJson(value);
}
export function proposalEnvelope(value) {
    const record = exactObject(value, PROPOSAL_FIELDS, "proposal envelope");
    if (record.schema_version !== 1)
        throw new Error("unsupported schema version");
    assertIdentifier(record.proposal_id, "proposal_id");
    assertIdentifier(record.correlation_id, "correlation_id");
    assertSymbol(record.source, "source");
    assertSymbol(record.capability, "capability");
    assertDateTime(record.created_at, "created_at");
    assertStringList(record.provenance, "provenance");
    if (!SENSITIVITIES.includes(record.sensitivity)) {
        throw new Error("sensitivity has an unsupported value");
    }
    return Object.freeze({
        schema_version: 1,
        proposal_id: record.proposal_id,
        correlation_id: record.correlation_id,
        source: record.source,
        capability: record.capability,
        arguments: freezeJsonObject(record.arguments, "arguments"),
        created_at: record.created_at,
        provenance: Object.freeze([...record.provenance]),
        sensitivity: record.sensitivity,
    });
}
export function decisionEnvelope(value) {
    const record = exactObject(value, DECISION_FIELDS, "decision envelope");
    if (record.schema_version !== 1)
        throw new Error("unsupported schema version");
    assertIdentifier(record.decision_id, "decision_id");
    assertIdentifier(record.proposal_id, "proposal_id");
    assertSymbol(record.policy_version, "policy_version");
    assertStringList(record.reason_codes, "reason_codes");
    assertDateTime(record.decided_at, "decided_at");
    assertDateTime(record.expires_at, "expires_at");
    if (!DECISION_OUTCOMES.includes(record.outcome)) {
        throw new Error("outcome has an unsupported value");
    }
    if (Date.parse(record.expires_at) <= Date.parse(record.decided_at)) {
        throw new Error("expires_at must be after decided_at");
    }
    return Object.freeze({
        schema_version: 1,
        decision_id: record.decision_id,
        proposal_id: record.proposal_id,
        outcome: record.outcome,
        policy_version: record.policy_version,
        reason_codes: Object.freeze([...record.reason_codes]),
        decided_at: record.decided_at,
        expires_at: record.expires_at,
    });
}
export function executionResultEnvelope(value) {
    const record = exactObject(value, EXECUTION_RESULT_FIELDS, "execution result envelope");
    if (record.schema_version !== 1)
        throw new Error("unsupported schema version");
    assertIdentifier(record.execution_id, "execution_id");
    assertIdentifier(record.proposal_id, "proposal_id");
    assertIdentifier(record.audit_reference, "audit_reference");
    assertDateTime(record.started_at, "started_at");
    assertDateTime(record.finished_at, "finished_at");
    if (!EXECUTION_STATUSES.includes(record.status)) {
        throw new Error("status has an unsupported value");
    }
    if (Date.parse(record.finished_at) < Date.parse(record.started_at)) {
        throw new Error("finished_at must not precede started_at");
    }
    return Object.freeze({
        schema_version: 1,
        execution_id: record.execution_id,
        proposal_id: record.proposal_id,
        status: record.status,
        observed_outcome: freezeJsonObject(record.observed_outcome, "observed_outcome"),
        audit_reference: record.audit_reference,
        started_at: record.started_at,
        finished_at: record.finished_at,
    });
}
