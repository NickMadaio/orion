# Local HTTP device-session exchange — 2026-09-16

The Simulator now receives its challenge, submits its persistent-key signature
and obtains the read token over HTTP. The token stays in phone process memory.
This local transport gate is complete; formal roadmap remains45/85 phases (53%).

## Boundary and behavior

A trusted host caller issues a random, hashed,120-second setup grant already
bound to an Owner, registered device ID and public key. The client cannot choose
an owner/device through the exchange request. The setup grant cannot read plans.
`POST /session/challenge` accepts only an empty object and issues one challenge.
`POST /session/exchange` accepts only challenge/signature, consumes the setup
grant before verifying and calls existing DeviceReadSessions. Unknown, expired,
spent, wrong-proof and revoked-device attempts refuse. Restart forgets grants.
An uncertain exchange requires a fresh trusted-host grant; there is no refresh
or account-registration endpoint.

The optional exchange routes share the existing loopback-only HTTP server. Plan
writes and other HTTP verbs remain refused. Strict Authorization, Content-Type,
Content-Length, body limits and JSON duplicate-field checks apply. The parser
requires actual bytes to equal declared length, including EOF/half-close cases.
Storage failure returns503, never fallback trust. Default read-only servers have
no exchange enabled.

The Simulator client uses a fixed127.0.0.1 host, ephemeral networking, no
redirects/cookies/credential storage/cache, timeouts and bounded responses.
The same persistent key validates/signs the owner/device/key-bound message.
Response account/device/schema/token checks precede activating the reader. A
failed exchange clears prior bootstrap/history/visible data, and HTTP-session
mode never loads a legacy token file. No fallback silently restores access.

## Proof and review

-153 combined backend checks pass; source/history secret scan clean
  (3521 reviewed occurrences). Temporary bootstrap files verified absent.
- Actual Simulator flow passed: persistent-key enrollment fixture, HTTP
  challenge/signature/token exchange, read/outage/recovery, durable revoke
  clearing and persisted revocation after a separate process restart.
- Separate UI regression passes with both old and new launch flags and a
  consumed setup grant: exact failure displayed, no reading or refresh route.
- Actual socket tests cover exchange/read/revoke, expiry/restart, wrong proof,
  replay, owner/device substitution, storage outage, route/method limits,
  duplicate framing/fields, oversized lengths and a short body at EOF.
- Independent review reproduced two defects: short body accepted despite larger
  declared length; failed exchange retained previous session state. Both fixed
  and regression-tested; final review nine exchange tests pass, no actionable
  findings. All observed bootstrap directories are cleaned; lookup-failure
  regression preserves unrelated files.
- Generic physical-iOS build passes unsigned only. Network test code is
  Simulator-only; no physical pairing, Secure Enclave runtime or TLS proof.
- Evidence: `.builds/http-session-2026-09-16/` and
  `.builds/phone-pairing-check/http-session-ui.log` / `http-session-refusal.log`.

## What remains

The account and initial phone enrollment remain disposable fixtures. A private
file still delivers the short-lived setup grant and port/owner/device association.
The read token, challenge and proof no longer use file delivery. This is not
production account sign-in, hosted backend, remote TLS or physical-device setup.
The older personal-preview path remains a separate developer-token route.
No real personal plan is used by this transport test.

Next: connect a deliberate host setup flow and saved personal-plan publication
to this authenticated read route, preserving owner/device binding and revocation;
then address physical transport and account-authentication choices. Mac installed
build232 and personal accepted-plan hash remain unchanged.

## Reproduce and rollback

```sh
python3 scripts/orion_v2_phone_pairing_check.py --http-session
python3 -m unittest tests.test_local_session_exchange -v
```

The Simulator harness requires the existing optional device-crypto runtime;
verification used bundled cryptography50.0.1, no global package installation.
`--http-session` and the older file-based `--read-session` are mutually exclusive.
Run Simulator UI harnesses sequentially.

Rollback scoped checkpoint. No production service/account/store was installed.
Temporary setup grants are revoked and matching files removed; persistent phone
key and real revocation records must not be deleted. Preserve capabilities.md.
