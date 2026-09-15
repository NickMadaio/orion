#!/usr/bin/env python3
"""Prove the role contract is the single source of truth, or say where it isn't.

A contract nothing checks is decoration. This reads the live configuration and
the source files that still hardcode a model, and reports every place they
disagree with the contract.

Read-only by design. It never writes config, never restarts anything, never
touches the network. Applying the contract to live config is a separate,
reviewed step -- this one only tells the truth about today.

Exit 0 when everything agrees. Exit 1 on drift, so it can gate a slice.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from orion.core.models.contract import ModelRoleContract, decode_contract  # noqa: E402

DEFAULT_CONTRACT = REPO_ROOT / "docs" / "planning" / "v2" / "model-roles.seed.json"
OPENCLAW_CONFIG = Path.home() / ".openclaw" / "openclaw.json"
LOCAL_MODEL_SWIFT = REPO_ROOT / "native/Orion/Sources/Orion/LocalModel.swift"
DEEPGRAM_SWIFT = REPO_ROOT / "native/Orion/Sources/Orion/DeepgramSpeech.swift"
TTS_DAEMON = REPO_ROOT / "scripts/orion_tts_daemon.py"


@dataclass(frozen=True)
class Finding:
    role: str
    where: str
    contract: str
    live: str

    @property
    def agrees(self) -> bool:
        return self.contract == self.live

    def render(self) -> str:
        mark = "ok  " if self.agrees else "DRIFT"
        line = f"  {mark} {self.role:<10} {self.where}"
        if self.agrees:
            return f"{line}\n         {self.contract}"
        return f"{line}\n         contract: {self.contract}\n         live:     {self.live}"


def _first_group(path: Path, pattern: str, label: str) -> str:
    """Pull one constant out of a source file, or say plainly that it moved."""

    if not path.exists():
        return f"<{label}: file not found>"
    match = re.search(pattern, path.read_text(encoding="utf-8"))
    return match.group(1) if match else f"<{label}: pattern no longer matches>"


def probe_openclaw(contract: ModelRoleContract) -> list[Finding]:
    if not OPENCLAW_CONFIG.exists():
        return [Finding("reasoning", str(OPENCLAW_CONFIG), "-", "<config not found>")]
    config = json.loads(OPENCLAW_CONFIG.read_text(encoding="utf-8"))
    defaults = config.get("agents", {}).get("defaults", {})
    model = defaults.get("model", {})
    where = "~/.openclaw/openclaw.json"

    reasoning = contract.role("reasoning")
    findings = [
        Finding("reasoning", f"{where} agents.defaults.model.primary",
                str(reasoning.primary), str(model.get("primary"))),
        Finding("reasoning", f"{where} agents.defaults.model.fallbacks",
                ", ".join(str(r) for r in reasoning.fallbacks),
                ", ".join(model.get("fallbacks", []))),
        Finding("fast", f"{where} agents.defaults.utilityModel",
                str(contract.role("fast").primary), str(defaults.get("utilityModel"))),
    ]

    search = defaults.get("memorySearch", {})
    live_embedding = f"{search.get('provider')}/{search.get('model')}"
    findings.append(
        Finding("embedding", f"{where} agents.defaults.memorySearch",
                str(contract.role("embedding").primary), live_embedding)
    )
    findings.append(
        Finding("reasoning", f"{where} agents.defaults.timeoutSeconds",
                str(reasoning.timeout_seconds), str(defaults.get("timeoutSeconds")))
    )
    return findings


def probe_native(contract: ModelRoleContract) -> list[Finding]:
    """Check the Swift FALLBACK constants, not the live model.

    Since 2026-08-23 the app resolves both of these from the contract at
    runtime, so its live answer is the contract's by construction and checking
    it would be circular. What is still worth checking is the compiled-in
    fallback: it is what the app uses when the contract is missing or
    unparseable, and it should degrade to the same model rather than silently
    to a different one.
    """

    local = _first_group(
        LOCAL_MODEL_SWIFT, r'static let fallbackModel = "([^"]+)"', "fallbackModel"
    )
    stt = _first_group(
        DEEPGRAM_SWIFT, r'static let fallbackModel = "([^"]+)"', "fallbackModel"
    )
    contract_local = contract.role("local").primary
    contract_stt = contract.role("stt").primary
    return [
        Finding("local", "LocalModel.swift fallbackModel (used if contract absent)",
                contract_local.model if contract_local else "-", local),
        Finding("stt", "DeepgramSpeech.swift fallbackModel (used if contract absent)",
                contract_stt.model if contract_stt else "-", stt),
    ]


def probe_tts(contract: ModelRoleContract) -> list[Finding]:
    default_model = _first_group(
        TTS_DAEMON, r'"(Marvis-AI_[^"]+)"', "DEFAULT_MODEL"
    )
    eleven = _first_group(
        TTS_DAEMON, r'_env\("ORION_ELEVEN_MODEL", "([^"]+)"\)', "ORION_ELEVEN_MODEL"
    )
    tts = contract.role("tts")
    primary = tts.primary.model if tts.primary else "-"
    fallback = tts.fallbacks[0].model if tts.fallbacks else "-"
    return [
        Finding("tts", "orion_tts_daemon.py DEFAULT_MODEL", primary, default_model),
        Finding("tts", "orion_tts_daemon.py ORION_ELEVEN_MODEL", fallback, eleven),
    ]


ENV_FILE = REPO_ROOT / ".env"

# Which env variable would hold each provider's key, if a stale plaintext copy
# were still lying around.
PROVIDER_VARIABLES = {
    "anthropic": "ANTHROPIC_API_KEY",
    "deepgram": "DEEPGRAM_API_KEY",
    "elevenlabs": "ELEVENLABS_API_KEY",
}


def stale_plaintext(contract: ModelRoleContract) -> list[str]:
    """Providers the contract says are on the Keychain that still have a
    plaintext copy on disk.

    `plaintext_providers()` reports what the contract DECLARES. That is a
    routing fact and it can be true while a leftover copy still sits in `.env`
    from before a migration. Only this notices the difference, and the leftover
    is the one that actually leaks.
    """

    if not ENV_FILE.exists():
        return []
    present = set()
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        if value.strip().strip('"').strip("'"):
            present.add(name.strip())
    return sorted(
        name
        for name, binding in contract.providers.items()
        if binding.credential_source == "keychain"
        and PROVIDER_VARIABLES.get(name) in present
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument(
        "--check", action="store_true",
        help="exit non-zero on drift (default behaviour; kept for symmetry with the other v2 scripts)",
    )
    args = parser.parse_args()

    contract = decode_contract(json.loads(args.contract.read_text(encoding="utf-8")))

    findings: list[Finding] = []
    findings += probe_openclaw(contract)
    findings += probe_native(contract)
    findings += probe_tts(contract)

    print(f"model contract: {args.contract.relative_to(REPO_ROOT)}\n")
    for finding in findings:
        print(finding.render())

    drift = [f for f in findings if not f.agrees]
    plaintext = contract.plaintext_providers()

    print()
    if plaintext:
        # Not drift -- the contract states this correctly. It is the gap the
        # contract exists to make impossible to forget.
        print(
            f"  NOTE  {len(plaintext)} provider(s) still read a key from plaintext .env: "
            f"{', '.join(plaintext)}"
        )
        print("        Phase 2 slice 5 closes this. The contract is honest about it, not silent.")

    stale = stale_plaintext(contract)
    if stale:
        print(
            f"  NOTE  {len(stale)} provider(s) declared keychain but still have a plaintext "
            f"copy in .env: {', '.join(stale)}"
        )
        print("        The contract is right about routing; the leftover is what leaks.")

    unassigned = tuple(name for name, b in contract.roles.items() if not b.assigned)
    if unassigned:
        print(f"  NOTE  role(s) declared and unassigned: {', '.join(unassigned)}")

    if drift:
        print(f"\nmodel contract check: DRIFT in {len(drift)} of {len(findings)} bindings")
        return 1
    print(f"\nmodel contract check: all {len(findings)} bindings agree")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
