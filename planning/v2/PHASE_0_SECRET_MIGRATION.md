# ORION v2 Phase 0 — credential migration runbook

Status: **prepared and dry-run validated; live apply deferred**.

## Current evidence

OpenClaw 2026.7.1-2's built-in read-only audit reported three plaintext
findings and no unresolved, shadowed, or legacy-reference findings:

1. `gateway.auth.token` in `~/.openclaw/openclaw.json`
2. `models.providers.anthropic.apiKey` in that config
3. `profiles.ollama:local.token` in the main agent credential database

The repository inventory separately proves that `.env`, `.env.save`, and the
OpenClaw config are mode `0600`. The active Anthropic value differs from the
July 27 `.env.save` value and matches the current OpenClaw provider value.
That is consistent with rotation after July 27, but it does not prove which
credential was historically exposed.

## Chosen storage design

Use macOS Keychain-backed OpenClaw `exec` SecretRefs for the gateway and
Anthropic values. OpenClaw resolves them into its in-memory snapshot, uses
sentinels until provider egress, and preserves the last-known-good snapshot if
reload cannot resolve every active reference.

The proposed providers use `/usr/bin/security` directly, `jsonOnly: false`,
and one Keychain service per credential:

- service `ORION OpenClaw Gateway`, account `openclaw`
- service `ORION OpenClaw Anthropic`, account `openclaw`

Both provider objects passed `openclaw config set ... --dry-run` against the
current live schema. No Keychain item, config value, or runtime was changed.

The Ollama auth-profile token should be migrated through `openclaw secrets
configure --agent main`, because that supported planner understands the agent
database target and scrubs profile residue atomically. Do not edit the SQLite
credential database directly.

## Coordinated apply gate

Do not apply while Nick or another agent is exercising the live Orion UI. The
apply requires a short coordinated gateway window because it changes runtime
credential resolution and calls `secrets.reload`.

During that window:

1. Re-run `openclaw secrets audit --json` and the no-cloud Orion doctor.
2. Insert the two current values into Keychain without printing them or placing
   them in command-line arguments.
3. Generate an OpenClaw secrets plan targeting the gateway, Anthropic provider,
   and main-agent Ollama profile.
4. Run `openclaw secrets apply --from <plan> --dry-run --allow-exec`.
5. Apply only if every reference resolves and target validation passes.
6. Call `openclaw secrets reload --json`; rely on its atomic last-known-good
   behavior if resolution fails.
7. Require `openclaw secrets audit --check` to return clean.
8. Run the no-cloud doctor, authenticated `orion_v2_live_smoke.py`, authority
   snapshot check, and full regression suites.

OpenClaw intentionally does not create plaintext rollback copies during secret
apply. Do not add another config backup containing the migrated values.

## Repository `.env` follow-up

The Anthropic value cannot be removed from repository `.env` until the legacy
Python provider is either migrated to Keychain/SecretRef access or proven
unused. Removing it now could silently remove legacy fallback behavior.

Nick must also decide whether the different July 27 `.env.save` value is an
obsolete prior credential. Secure deletion is intentionally not inferred from
age alone.
