# Computer relay: screen actions under Orion.app's Accessibility grant (2026-10-31)

The gateway's node process has no Accessibility grant. Orion.app does (`accessibility=trusted` in its log).
macOS checks a child process's TCC access against the *responsible* app, so a bridge Orion.app spawns runs
under Orion.app's grant. The relay carries screen requests from the plugin to the app over files.

## Pieces

| Side | File | Job |
|---|---|---|
| plugin | `plugin/orion-control/src/computer-relay.ts` | signs and writes `<uuid>.req.json`, waits for `<uuid>.res.json` (20 s), verifies it, deletes both |
| plugin | `plugin/orion-control/src/computer-bridge.ts` | relay when the app heartbeat is fresh and trusted, otherwise a direct spawn; names the missing grant |
| app | `native/Orion/Sources/ComputerRelay/` | validator (HMAC, freshness, nonce, allowlist, caps), file rules, bridge runner, service |
| app | `native/Orion/Sources/Orion/ComputerRelayHost.swift` | starts the service at launch, writes `heartbeat.json` every 5 s |
| tool | `native/Orion/Sources/OrionRelayProbe/` | `orion-relay-probe`: the same core from a terminal, for testing |
| contract | `native/Orion/Tests/ComputerRelayTests/Fixtures/golden-vectors.json` | canonical strings and MACs both sides must reproduce (made by an independent Python HMAC) |

Directory `~/.openclaw/orion-controlled/computer-relay/` (0700, either side creates it). Key
`~/.openclaw/orion-controlled/computer-relay.key`, 32 random bytes, 0600, created once by the plugin.

## Wire format

Request `{id, action, payload, createdAt, nonce, mac}`; response `{id, nonce, ok, result, error?, mac}`.
`mac` = HMAC-SHA256 hex over:

```
orion-computer-relay/v1/req\n  lp(id) lp(action) lp(createdAt) lp(nonce) lp(N) {lp(key) lp(value)} * N
orion-computer-relay/v1/res\n  lp(id) lp(nonce) lp("true"|"false") lp(error or "") lp(N) {lp(key) lp(value)} * N
lp(s) = <UTF-8 byte length of s> ":" s ; pairs sorted by UTF-8 bytes
```

## Security properties

1. Only `screen_observe/click/type/key/press/set_value/menu/menu_items/ocr` run; calendar, reminders,
   notifications, `screen_capture`, `status` and permission prompts are refused even when correctly signed.
   Payload keys are allowlisted, values are capped at 8 KiB, files at 64 KiB. The bridge path is fixed in the
   app, and the binary must belong to this user and be writable by nobody else. No argv or env from the request.
2. Requests carry an HMAC under a 0600 key, must be at most 15 s old (2 s future skew), and each nonce runs
   once. The request file is deleted as soon as it is read. Ids must be lowercase UUIDs matching the file name,
   so the response path can't be steered. Symlinks are not followed.
3. Responses are signed too, and bound to the request's id and nonce, so a planted answer is rejected.
4. Screen text still comes back as data. Nothing in the relay turns it into an action, and the loop's taint
   rules (computer-read.ts, computer-auth.ts) are unchanged.

What it does not defend against: a process running as Nick can read the key, so the HMAC keeps out other
users, sandboxed processes and stray files, not Nick's own account. The allowlist is the real boundary: at
worst such a process gets the nine screen actions the bridge already guards (frontmost-app match, the
sensitive-content denylist, lock check).

## Going live (orchestrator)

1. `cd native/OrionMacBridge && swift build -c release`, then install the copy the app prefers (outside
   ~/Desktop, which is TCC-protected for an app): `mkdir -p ~/.openclaw/orion-remote/bin && cp
   .build/release/orion-mac-bridge ~/.openclaw/orion-remote/bin/orion-mac-bridge` (keep it 0755).
2. `native/Orion/make_app_bundle.sh`, then replace `/Applications/Orion.app` and relaunch it (the watchdog
   relaunches it if it was quit). The bundle is signed with "Orion Local Signing", so the Accessibility grant
   should carry over. Check `~/.openclaw/logs/orion-app.log` for `computer-relay: watching`, and confirm that
   `~/.openclaw/orion-controlled/computer-relay/heartbeat.json` shows `"accessibility":true,"bridge":"ready"`.
3. Plugin: `scripts/orion-deploy`. It builds, tests, installs and rolls back if needed.
4. Config: set `enableComputerControlActions: true` under `plugins.entries["orion-control"].config` in
   `~/.openclaw/openclaw.json`. `enableComputerObserveActions` is already true. Then restart the gateway.
5. `node scripts/eval/computer-smoke.mjs` (after `npm run build` in the plugin). It needs PASS.

Not yet covered: `maybeRunComputerTask` (computer-loop.ts) still has to be wired into the turn path, and
the catalog's approval-gated `screen_*` actions in executors.ts still go through `scripts/orion-computer`
with a direct spawn.
