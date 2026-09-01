# ORION v2 Phase 14 — Device Identity

Status: **planned — 2026-08-25**. Phase 13 closed the same day.

## What the manifest asks for

Each trusted device gets its own cryptographic identity. On Apple devices,
hardware-backed private keys that stay non-exportable, with only public keys
registered to ORION Cloud. Three things kept separate — user identity, device
identity, app attestation — and a device record of ten named fields.

## The separation is the phase

"Do not conflate them" is the whole requirement, and it is not enforced by
intending to keep them apart. Three distinct types, each answering a different
question:

| | question | evidence | who can revoke it |
|---|---|---|---|
| user identity | who is this person | Phase 13's session | the person |
| device identity | which machine is this | a signature by the device key | the person, instantly |
| app attestation | is this a genuine build of the app | the platform's attestation | nobody; it is re-checked |

A device that can prove possession of its key is *that device*. It is not a
person, and Phase 13 already refuses to let it become one. Attestation says
something about the software, not about either — a jailbroken phone with a
genuine key is a real device running an app nobody can vouch for, and the record
has to be able to say exactly that.

## Only the public half, and what "non-exportable" means here

The backend stores public keys. It has no field for a private key and no code
path that would accept one — `register` takes a public key and a proof, and a
proof is a signature, which is what you produce when you cannot hand over the
key.

Hardware backing is a **claim the device makes**, recorded as
`attestation_state`, not something the server can verify by looking at a string.
Recording it as a claim rather than a fact is the honest option; pretending the
server knows would make every later decision rest on a field nobody checked.

## Verification, given no Ed25519 in the standard library

Same position as Phase 12's cipher, same answer: a `SignatureVerifier` port with
a refusing default. Production installs an Ed25519/ES256 verifier; tests install
an HMAC one that is named for what it is. The registry refuses to register a
device when no verifier is installed, so an unverified key cannot become a
trusted device by omission.

## Possession, not assertion

Registration requires signing a server-issued challenge. Challenges are
single-use and short-lived, so a captured registration cannot be replayed. The
account binding comes from Phase 13's `Owner`: a device is registered *by a
signed-in person*, never by presenting a device id.

## Feeding the policy engine

Phase 5's `DeviceDirectory` is what the policy engine asks about trust. It has
been built by hand in tests since Phase 5. This phase gives it a source:
`registry.as_policy_directory()` produces one, so "revoked devices cannot act"
becomes a fact about registered devices rather than about a fixture.

## Exit criteria

- The ten manifest fields, with public keys only and no private-key path.
- Three separate types for user, device and attestation, and a test that no
  function takes one where another is meant.
- Registration requires a possession proof over a single-use, short-lived
  challenge, and refuses to run with no verifier installed.
- Revocation is immediate and visible in the policy directory.
- `as_policy_directory()` produces a directory Phase 5's engine accepts.
- Suites green.
