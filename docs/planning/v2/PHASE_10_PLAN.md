# ORION v2 Phase 10 — Backend Foundation

Status: **planned — 2026-08-24**. Phase 9 closed the same day.

## What the manifest asks for

A modular monolith over Python/FastAPI/PostgreSQL with managed secrets and a
background worker; seventeen named backend modules; no microservices without a
concrete need; DEV/STAGING/PRODUCTION with separate databases, credentials,
OAuth apps, APNs environments and secrets; and production secrets never used
locally.

## The honest problem

There is no server. ORION is a Mac app: Swift, OpenClaw, TypeScript, and a Python
package with **zero third-party dependencies** — `pyproject.toml` says
`dependencies = []` and means it. `pip install fastapi` is not a foundation; it
is a dependency added to a repo that has deliberately never had one, on a night
when nobody is awake to review it, for a service with no host, no database and no
client.

So this phase builds the part of a backend foundation that is **decidable now and
wrong to defer**: the module graph and its boundaries, the environment
separation, the ownership rule, and the egress rule. It does not stand up a
server. What it deliberately does not do is listed at the bottom, in the same
detail as what it does.

That is not a smaller version of the manifest's phase. It is the half that later
phases cannot safely improvise, chosen deliberately over the half that needs a
host and a review window.

## Seventeen modules, declared rather than stubbed

Phase 1 recorded the rule this phase would otherwise break: *"Empty packages are
not a milestone."* Seventeen empty directories would satisfy "create backend
modules" and mean nothing.

Instead `backend/modules.py` declares each module with the things a boundary can
actually be checked against: what it owns, which modules it may depend on, its
data sensitivity, and its public operations. `backend/boundaries.py` then proves
the graph is acyclic and that nothing depends on anything it did not declare —
and the same check walks any implementation file that appears later, so the graph
stays true rather than decorative.

**No microservices** is a property of that graph: one deployable, in-process
calls, and a test asserting it.

## Three environments that cannot share anything

`DEV`, `STAGING`, `PRODUCTION`, each declaring its database, secret scope,
credential namespace, OAuth app and APNs environment. The rules are enforced,
not documented:

- no two environments may share a database, a secret scope or a credential
  namespace;
- production must use the production APNs environment and the others must not;
- **a runtime that is not PRODUCTION cannot resolve a production secret** — the
  manifest's "never use production secrets locally", as a function that raises
  rather than a sentence in a document.

## The two invariants this phase owes Phase 9

Phase 9 recorded three pending invariants and named this phase for two:

- **one user cannot access another user's data** — a `Repository` base that
  cannot be queried without an owner, and refuses a client-supplied owner id.
  Every future repository inherits it; a test asserts none bypasses it. The data
  store does not exist yet, so what is enforced is the resolution layer Phase 11
  must route its queries through.
- **arbitrary internal URLs cannot be fetched through SSRF** — a default-deny
  egress guard: allowlisted hosts only, https only, no credentials in the URL,
  and refusal of loopback, private, link-local, CGNAT and cloud-metadata
  addresses in both literal and hostname form.

`EXPECTED_PENDING` falls from 3 to 1.

## Exit criteria

- All seventeen manifest modules declared with owner, dependencies, sensitivity
  and public operations; the graph acyclic and dependency-complete.
- One deployable, asserted.
- Three environments with database, secret scope, credential namespace, OAuth app
  and APNs environment, none shared, proven by a test.
- Resolving a production secret outside production raises.
- A repository cannot be queried without a server-resolved owner, and a
  client-supplied owner id is refused.
- The egress guard denies by default and refuses every private-range and
  metadata address form.
- The backend does not import Mac-local ORION modules, enforced by AST.
- Two Phase 9 invariants closed and the ratchet lowered.
- Suites green.

## What this phase does NOT do

No FastAPI, no PostgreSQL, no migrations, no running process, no deployment. The
route table is declared and an adapter binds it to FastAPI **if FastAPI is
installed**, imported lazily so the suite never needs it. Adding those
dependencies is a reviewed decision with a host attached, and Phase 11 is the
database phase — deliberately not entered here.
