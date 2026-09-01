"""What must never reach an audit record, in one place.

Two kinds of rule, because credentials hide in two ways:

- **value shapes** -- a string that looks like a key, wherever it appears;
- **field names** -- a key called `password` whose value looks like nothing in
  particular, which is the case pattern matching alone always misses.

The value shapes deliberately mirror the rules in `scripts/orion_v2_secret_scan.py`.
They are duplicated rather than imported: that script's findings are fingerprinted
and allowlisted, so refactoring its rule set risks changing fingerprints and
silently invalidating a reviewed allowlist. `orion_v2_audit_check.py` compares the
two rule sets by name every run instead, so drift is caught without touching the
scanner.
"""

from __future__ import annotations

import re
from types import MappingProxyType
from typing import Mapping


#: A value matching any of these is replaced wherever it is found.
CREDENTIAL_SHAPES: Mapping[str, re.Pattern[str]] = MappingProxyType(
    {
        # Any PEM private key header, not a fixed list of three: DSA, ENCRYPTED
        # and whatever the next format is called are all private keys.
        "private_key": re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"),
        "aws_access_key": re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
        "github_token": re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,255}\b"),
        "openai_style_key": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
        "slack_token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
        "google_api_key": re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
        "stripe_live_key": re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b"),
        "discord_webhook": re.compile(
            r"https://(?:discord(?:app)?\.com)/api/webhooks/[0-9]+/[A-Za-z0-9._-]{20,}"
        ),
        # Not in the repo scanner, and needed here: these travel through requests
        # and responses rather than sitting in source files.
        "bearer_header": re.compile(r"\bbearer\s+[A-Za-z0-9._~+/=-]{16,}", re.IGNORECASE),
        "basic_auth_header": re.compile(r"\bbasic\s+[A-Za-z0-9+/=]{16,}", re.IGNORECASE),
        "jwt": re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
        "url_credentials": re.compile(r"\b[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@", re.IGNORECASE),
    }
)

#: A field whose NAME says it holds a credential is redacted whatever its value
#: looks like. The manifest's never-log list is exactly this: access tokens,
#: refresh tokens, passwords, cookies, raw secrets, private keys.
SENSITIVE_FIELD_WORDS = frozenset(
    {
        "apikey",
        "api_key",
        "access_token",
        "accesstoken",
        "authorization",
        "auth",
        "bearer",
        "client_secret",
        "cookie",
        "cookies",
        "credential",
        "credentials",
        "id_token",
        "pass",
        "creds",
        "passphrase",
        "passwd",
        "password",
        "pwd",
        "private_key",
        "privatekey",
        "refresh_token",
        "refreshtoken",
        "secret",
        "session_token",
        "set_cookie",
        "signing_key",
        "token",
    }
)

#: Keys whose contents are model conversation. Dropped entirely unless secure
#: debug is explicitly on -- the manifest's one exemption, and it covers the
#: prompt, not whatever credential somebody pasted into it.
PROMPT_FIELD_WORDS = frozenset(
    {
        "context",
        "conversation",
        "messages",
        "prompt",
        "prompts",
        "system_prompt",
        "transcript",
    }
)

#: Field names that contain a credential word and are demonstrably not
#: credentials. `tokens` is the live one: Phase 2's inference records carry a
#: TokenCounts object under exactly that key, and blanking it would hide the
#: cost telemetry the router exists to produce.
BENIGN_FIELD_NAMES = frozenset(
    {
        "tokens",
        "token_count",
        "token_counts",
        "context_tokens",
        "input_tokens",
        "output_tokens",
        "max_tokens",
        "tokens_in",
        "tokens_out",
    }
)

#: Name parts that mean "this holds a credential". Compared as whole parts after
#: splitting, never as substrings: `tokenizer_version` is not a token.
SENSITIVE_PARTS = frozenset(
    {
        "apikey",
        "auth",
        "authorization",
        "bearer",
        "cookie",
        "cookies",
        "credential",
        "credentials",
        "creds",
        "passphrase",
        "passwd",
        "password",
        "pwd",
        "privatekey",
        "secret",
        "secrets",
        "token",
        "tokens",
    }
)

PLACEHOLDER = "[redacted:{rule}]"
DROPPED = "[omitted:prompt]"


def normalize_field(name: str) -> str:
    """Field names as they are compared: lowercase, punctuation-free.

    `X-Api-Key`, `apiKey` and `api key` are the same field wearing three
    spellings, and a redactor that only knows one of them is a redactor that
    works in tests.
    """

    # Two boundaries, not one: `sessionToken` splits at the lower-to-upper edge,
    # and `XApiKey` splits before the last capital of a run. Without the second,
    # `XApiKey` normalizes to `xapi_key` and looks like nothing.
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", str(name))
    spaced = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", "_", spaced)
    lowered = "".join(character if character.isalnum() else "_" for character in spaced.lower())
    return "_".join(part for part in lowered.split("_") if part)


def field_is_sensitive(name: str) -> bool:
    """Whether a field's NAME says it holds a credential.

    Whole-part matching after camelCase and punctuation splitting, so
    `sessionToken`, `X-Api-Key` and `refresh_token` all match while
    `tokenizer_version` does not. Known-benign names are checked first, because
    over-redaction that hides the router's cost telemetry is its own kind of
    broken audit record.
    """

    normalized = normalize_field(name)
    if normalized in BENIGN_FIELD_NAMES:
        return False
    if normalized in SENSITIVE_FIELD_WORDS:
        return True
    parts = normalized.split("_")
    if set(parts) & SENSITIVE_PARTS:
        return True
    # Two-part spellings that only mean something joined: api_key, private_key.
    joined = {f"{first}_{second}" for first, second in zip(parts, parts[1:])}
    return bool(
        joined & {"api_key", "private_key", "priv_key", "signing_key", "session_key", "secret_key"}
    )


def field_is_prompt(name: str) -> bool:
    normalized = normalize_field(name)
    return normalized in PROMPT_FIELD_WORDS
