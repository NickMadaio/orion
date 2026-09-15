# ORION v2 Phase 12 — Secret and Credential Vault

Status: **planned — 2026-08-25**. Phase 11 closed the same day.

## What the manifest asks for

Cloud credentials stored separately from ordinary data, under envelope
encryption, with master keys outside PostgreSQL and in a KMS. Nine named fields.
Decrypt only when needed, dispose of plaintext immediately, never return
connector credentials through public APIs, and never give tokens to ORION models.

## The uncomfortable part, first

**There is no AES in the Python standard library, and this repository has no
third-party dependencies.** Envelope encryption needs a real authenticated
cipher, and the options are: add `cryptography` (a dependency decision Nick has
not made, on the night he asked for five phases), or write one (never), or build
the vault around a cipher *port* and refuse to run without a real implementation.

The third. `RefusingCipher` is the default and raises on use, so nothing can
accidentally ship encrypting with a placeholder. The vault additionally refuses
any cipher that does not declare itself authenticated — a caller cannot inject a
raw stream cipher and get confidentiality without integrity. Tests inject a
deterministic fake named `TestOnlyCipher`, so it is obvious in a stack trace.

What that leaves is everything else, and it is most of the phase: the envelope
structure, the key hierarchy and rotation, the borrow-and-dispose lifecycle, the
public-API boundary, and revocation.

## Envelope encryption, and what "master keys outside PostgreSQL" means

Two layers:

- a **data key (DEK)** per credential, which encrypts the secret;
- a **key-encrypting key (KEK)** held by the KMS, which encrypts the DEK.

The database stores the ciphertext and the *wrapped* DEK. It never stores a KEK,
and `KmsPort` deliberately has no method that returns one — so "master keys
outside PostgreSQL" is a property of the interface rather than a deployment note.
Rotating the KEK re-wraps DEKs; the ciphertext is never touched, which is what
makes rotation cheap enough to actually do.

## Plaintext that disposes of itself

"Dispose of plaintext immediately after use" cannot be a comment. Decryption
returns a `Borrowed` context manager: inside the `with`, the value is available;
outside it, the buffer is overwritten and further reads raise. The wrapper
refuses `__repr__`, `__str__` and JSON encoding, because the three ways a secret
reaches a log are an f-string, a debugger, and `json.dumps` of a dict somebody
thought was safe.

## The two rules that are really about other systems

- **Never through public APIs**: a test over Phase 10's route table asserts no
  route names a vault operation that returns a secret, and the vault exposes a
  metadata-only view for anything user-facing.
- **Never to ORION models**: Phase 6 redacts credentials from audit records and
  Phase 7 refuses them on the event bus. This phase adds the third: a `Borrowed`
  value is not JSON, so it cannot enter a context bundle, an event payload, or an
  audit detail — each refuses it by type rather than by pattern-matching.

## Closing the last pending invariant

Phase 9 recorded `deleted_connections_cannot_refresh_tokens` as pending, subject
Phase 12. Deleting a connection revokes every credential under it in the same
call, and a revoked credential cannot be borrowed or refreshed. `EXPECTED_PENDING`
falls from 1 to 0.

## Exit criteria

- The nine manifest fields, stored with ciphertext and a wrapped DEK, never a
  plaintext token or a KEK.
- No cipher runs unless one is injected, and an unauthenticated cipher is refused.
- KEK rotation re-wraps DEKs without touching ciphertext, and `key_version`
  records which KEK a credential is under.
- Plaintext is borrowed, disposed at the end of the borrow, and refuses repr, str
  and JSON.
- No route can return a credential; a metadata view exists for the ones that need
  to show something.
- A deleted or revoked connection cannot refresh, and the invariant registry
  reaches zero pending.
- Suites green.
