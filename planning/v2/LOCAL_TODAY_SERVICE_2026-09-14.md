# Orion local Today service foundation

Updated 2026-09-14 22:42 BST. **Local service foundation: 100%. Phone connection: still pending.**

The backend now has an actual durable owner-scoped snapshot repository and a
read-only local HTTP adapter for the declared `/plan` route. SQLite transactions
preserve revisions across restart; older or conflicting publications cannot
replace the saved snapshot. A session determines the owner. Expired/revoked
access and cross-owner reads are refused, and corrupt storage reports unavailable.

## What passed

- 119 combined tests across the new service and existing foundation/security/authentication boundaries.
- Final ten service tests after SQLite test cleanup; independent reviewer also passed all ten and found no remaining issue.
- Real HTTP socket requests and SQLite reopen/restart are exercised with synthetic data.
- Source/history secret scan clean; no real credentials or personal plan imported.

The existing network boundary first rejected the listener as an unguarded network
import. The transport was moved into its adapter; an exact inbound `http.server`
exception was added with negative tests proving HTTP clients and raw sockets
remain blocked. Production authentication was deliberately not approximated:
local harness sessions are short-lived and disappear on restart.

## Code to work through

1. [Repository](/Users/nickmadaio/Desktop/ORION/backend/local_today/repository.py): private SQLite storage, ownership, revision checks.
2. [HTTP adapter](/Users/nickmadaio/Desktop/ORION/backend/adapters/local_today.py): session resolution and read-only responses.
3. [Socket/restart tests](/Users/nickmadaio/Desktop/ORION/tests/test_local_today_service.py): actual requests, failure cases and durability.
4. [Contract and commands](/Users/nickmadaio/Desktop/ORION/backend/local_today/README.md).

## Remaining gate

The phone still uses explicitly labeled samples. No Mac exporter, phone network
client, production sign-in, TLS, hosted database, remote listener or continuous
sync is installed. The development service serves an opaque plan envelope; the
future client must validate the shared Swift plan before rendering.

Next: validated export and the first Simulator read route, including stale/offline
and reconnect behavior. The local service work does not close REC-LIVE-FOUNDATION
or REC-USABLE-CLIENT, and does not change the roadmap's 53% marked complete.

No service is left running by the tests. Mac build232 and saved plan remain
untouched. Source is checkpointed locally; no remote push. To undo this slice,
revert its source checkpoint; there is no installed daemon or real-data migration.
Verification logs: `.builds/local-today-2026-09-14/`.
