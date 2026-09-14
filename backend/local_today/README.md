# Local read-only Today foundation

This is a local proof for REC-LIVE-FOUNDATION and the next REC-USABLE-CLIENT
route, reusing `backend.ownership.Owner` and the declared `GET /plan` path.
It is not a deployed service, account system or paired phone connection.

`TodaySnapshotRepository` persists one snapshot per server-resolved owner in
SQLite. Publication is a local operation, not an HTTP route. Transactions reject
older revisions and different content reusing the same revision; an identical
publication is idempotent. Every public repository operation takes an Owner.
The directory/database must be private (0700/0600), owned by the current OS user,
and not symlinks. No cloud provider, migration of existing records or production
database choice is implied by this development store.

`backend/adapters/local_today.py` binds only `127.0.0.1` on an ephemeral port.
There is no configurable public host, sign-in endpoint or remote write operation.
LocalReadSessions issues short-lived random bearer values to trusted local
callers from a pre-existing Session; it stores only their hashes in memory.
Expiry uses a monotonic clock. These are harness credentials, not production
identity verification. Restart drops all sessions; snapshots and read observations
survive. Never put this adapter behind a proxy or use it for production traffic.

## Wire contract

Only `GET /plan` with one `Authorization: Bearer ...` header can read a snapshot.
The owner comes from the resolved session, never a path, query or request body.
A successful response is:

```json
{
  "schemaVersion": 1,
  "ownerID": "server-resolved-owner",
  "snapshot": {
    "revision": 8,
    "capturedAt": 1789420800,
    "plan": null
  }
}
```

`capturedAt` is the snapshot's original Unix timestamp, not the HTTP read time.
Reading cannot refresh stale evidence. Revision is an integer up to 2^53−1.
`plan` is null for an explicitly published absence, or an opaque JSON object for
the shared Swift plan. It is not interpreted or scheduled by this service.
Before display, the future client must decode it as TodayPlan and call validate();
this service checks only the envelope and JSON/size bounds (one million bytes).
Snapshot publication must come from a validated local exporter. That exporter
and phone decoder/transport are not implemented by this slice.

Responses use `Cache-Control: no-store`. Missing/invalid/expired/revoked sessions
return 401; another owner's absent snapshot and a genuinely absent snapshot both
return the same 404. Unsupported methods return 405. Corrupt/unavailable storage
returns 503, never an empty success. Successful and missing authenticated reads
are durably recorded by owner with observation time and outcome, without body or
token contents. The development audit table has no retention policy yet.

## Reproduce

From the repository root, run:

```bash
python3 -m unittest tests.test_local_today_service -v
python3 -m unittest tests.test_v2_backend_foundation tests.test_v2_backend_security tests.test_v2_authentication
```

The first command creates private temporary stores, binds real loopback sockets,
and uses real HTTP requests. It checks owner isolation, expiry/revocation,
restart/durability, publication conflicts, refused writes, envelope bounds,
private storage and corrupt-store failure. Temporary servers and files close at
completion. It never reads your actual Mac plan or any existing credentials.

The only import-boundary exception is `http.server` in this exact adapter.
Regression tests still reject outbound HTTP clients and raw sockets there, and
reject this server import elsewhere. No egress guard is relaxed for a client.

Next: a validated Mac snapshot exporter and an authenticated Simulator read
client, then explicit stale/offline/reconnect behavior. Real account/device
identity, TLS, production storage and physical-device deployment remain separate
requirements before any live remote route can be enabled.
