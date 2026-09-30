// Connectors ORION can write for himself (2026-09-30).
//
// Nick: "if he doesn't have it he can create it himself quickly to fulfill my
// request." A connector is a JSON spec, not code: one https host, named read
// operations (GET), where parameters go, and which fields to keep. ORION can
// write one after reading an API's docs; the runner (run.mjs) enforces the
// limits, so a spec can never reach another host, send a secret anywhere but
// its own host, or change anything — writes need Nick's own switch
// (orion-connect-admin), which ORION cannot run.
const NAME = /^[a-z][a-z0-9-]{1,31}$/;
const OP = /^[a-z][a-z0-9_]{1,39}$/;
const AUTH_TYPES = new Set(["none", "bearer", "header", "query"]);

export function validateSpec(spec) {
  const issues = [];
  if (!spec || typeof spec !== "object") return ["the spec must be a JSON object"];
  if (!NAME.test(spec.name ?? "")) issues.push("name: 2–32 characters, lowercase letters, digits and dashes, starting with a letter");
  if (typeof spec.title !== "string" || !spec.title.trim()) issues.push("title: say what this connects to");
  const base = String(spec.baseUrl ?? "");
  if (!/^https:\/\/[^/\s]+/.test(base)) issues.push("baseUrl must be https://host[/path] (settings may fill the host: https://{{domain}})");
  if (/[?#]/.test(base)) issues.push("baseUrl must not carry a query or fragment");
  const auth = spec.auth ?? { type: "none" };
  if (!AUTH_TYPES.has(auth.type)) issues.push("auth.type: none, bearer, header or query");
  if (auth.type !== "none" && !/^ORION [A-Za-z0-9 ._-]{1,40}$/.test(auth.keychain ?? "")) issues.push('auth.keychain: the Keychain item name, e.g. "ORION Canvas" (the secret itself never goes in the spec)');
  if (auth.type === "header" && !/^[A-Za-z0-9-]{1,40}$/.test(auth.header ?? "")) issues.push("auth.header: the header name");
  if (auth.type === "query" && !/^[A-Za-z0-9_]{1,40}$/.test(auth.param ?? "")) issues.push("auth.param: the query parameter name");
  if (/(key|token|secret|password)=|bearer\s+[a-z0-9]/i.test(JSON.stringify(spec))) issues.push("a secret seems to be written into the spec: put it in the Keychain instead");
  const ops = spec.operations;
  if (!ops || typeof ops !== "object" || !Object.keys(ops).length) issues.push("operations: at least one");
  for (const [name, op] of Object.entries(ops ?? {})) {
    if (!OP.test(name)) issues.push(`operation ${name}: lowercase letters, digits and underscores`);
    if (typeof op?.path !== "string" || !op.path.startsWith("/")) issues.push(`operation ${name}: path must start with /`);
    if (/^https?:|\/\//.test(op?.path ?? "")) issues.push(`operation ${name}: path must stay on the base host`);
    if ((op?.method ?? "GET") !== "GET" && op?.write !== true) issues.push(`operation ${name}: only GET unless marked "write": true (and then Nick must allow writes)`);
    if (typeof op?.description !== "string" || !op.description.trim()) issues.push(`operation ${name}: description`);
  }
  for (const [key, setting] of Object.entries(spec.settings ?? {})) {
    if (!/^[a-z][a-zA-Z0-9]{0,30}$/.test(key) || typeof setting?.description !== "string") issues.push(`setting ${key}: needs a description`);
  }
  return issues;
}

/** Fill {{name}} and {{name?}} (optional: dropped when absent). Values are URL-encoded. */
export function fill(template, values, { encode = true } = {}) {
  let missing = [];
  const out = String(template).replace(/\{\{\s*([a-zA-Z0-9_.]+)(\?)?\s*\}\}/g, (_, key, optional) => {
    const value = values[key];
    if (value === undefined || value === null || value === "") { if (!optional) missing = [...missing, key]; return ""; }
    return encode ? encodeURIComponent(String(value)) : String(value);
  });
  return { text: out, missing };
}

/** The request an operation makes, or the reason it cannot. Pure: no network, no secrets. */
export function buildRequest(spec, opName, params = {}, settings = {}) {
  const op = spec.operations?.[opName];
  if (!op) return { error: `${spec.name} has no operation ${opName} (it has: ${Object.keys(spec.operations ?? {}).join(", ")})` };
  const values = { ...Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, v])), ...params };
  const base = fill(spec.baseUrl, values, { encode: false });
  const path = fill(op.path, values);
  const missing = [...base.missing, ...path.missing];
  const query = new URLSearchParams();
  for (const [key, template] of Object.entries(op.query ?? {})) {
    const q = fill(template, values, { encode: false });
    missing.push(...q.missing);
    if (q.text !== "") query.append(key, q.text);
  }
  if (missing.length) return { error: `missing: ${[...new Set(missing)].join(", ")}` };
  const url = new URL(base.text.replace(/\/$/, "") + path.text);
  if (url.protocol !== "https:") return { error: "only https" };
  const expectedHost = new URL(base.text).host;
  if (url.host !== expectedHost) return { error: "the path left the base host" };
  for (const [k, v] of query) url.searchParams.append(k, v);
  return { method: op.method ?? "GET", url: url.toString(), host: url.host, write: op.write === true };
}

/** Keep only the listed dotted fields, record by record; arrays keep their first `limit` items. */
export function keepFields(value, fields, limit = 8) {
  if (!Array.isArray(fields) || !fields.length) return trimArrays(value, limit);
  const pick = (node, wanted) => {
    if (Array.isArray(node)) return node.slice(0, limit).map((item) => pick(item, wanted));
    if (node === null || typeof node !== "object") return node;
    const groups = new Map();
    for (const field of wanted) {
      const [head, ...tail] = field.split(".");
      groups.set(head, [...(groups.get(head) ?? []), tail.join(".")]);
    }
    const out = {};
    for (const [head, tails] of groups) {
      if (!(head in node)) continue;
      out[head] = tails.every(Boolean) ? pick(node[head], tails) : trimArrays(node[head], limit);
    }
    return out;
  };
  return pick(value, fields);
}

function trimArrays(value, limit) {
  if (Array.isArray(value)) return value.slice(0, limit).map((v) => trimArrays(v, limit));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimArrays(v, limit)]));
  return value;
}
