#!/usr/bin/env python3
"""High-confidence ORION secret scan with redacted output.

The scanner intentionally reports only location, rule, and a short SHA-256
fingerprint. Suspected secret values must never be copied into CI logs, model
context, or audit notes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


SKIP_DIRECTORIES = {
    ".git",
    ".build",
    ".builds",
    ".pytest_cache",
    "__pycache__",
    "node_modules",
}

PATTERNS = {
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "aws_access_key": re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    "github_token": re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,255}\b"),
    "openai_style_key": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "slack_token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    "google_api_key": re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    "stripe_live_key": re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b"),
    "discord_webhook": re.compile(
        r"https://(?:discord(?:app)?\.com)/api/webhooks/[0-9]+/[A-Za-z0-9._-]{20,}"
    ),
}


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    rule: str
    fingerprint: str
    commit: str | None = None

    @property
    def allowlist_key(self) -> tuple[str, str, str]:
        return (self.path, self.rule, self.fingerprint)


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def findings_in_text(path: str, text: str, commit: str | None = None) -> list[Finding]:
    findings: list[Finding] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        for rule, pattern in PATTERNS.items():
            for match in pattern.finditer(line):
                findings.append(
                    Finding(
                        path=path,
                        line=line_number,
                        rule=rule,
                        fingerprint=fingerprint(match.group(0)),
                        commit=commit,
                    )
                )
    return findings


def iter_files(root: Path, include_ignored: bool = False) -> Iterable[Path]:
    candidates: Iterable[Path]
    if not include_ignored:
        listed = subprocess.run(
            ["git", "-C", str(root), "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            check=False,
            capture_output=True,
        )
        if listed.returncode == 0:
            candidates = (
                root / raw.decode("utf-8", errors="surrogateescape")
                for raw in listed.stdout.split(b"\0")
                if raw
            )
        else:
            candidates = root.rglob("*")
    else:
        candidates = root.rglob("*")

    for path in candidates:
        if not path.is_file() or path.is_symlink():
            continue
        if any(part in SKIP_DIRECTORIES for part in path.relative_to(root).parts):
            continue
        if path.stat().st_size > 5 * 1024 * 1024:
            continue
        yield path


def scan_worktree(root: Path, include_ignored: bool = False) -> list[Finding]:
    findings: list[Finding] = []
    for path in iter_files(root, include_ignored=include_ignored):
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if b"\x00" in data[:8192]:
            continue
        text = data.decode("utf-8", errors="ignore")
        findings.extend(findings_in_text(path.relative_to(root).as_posix(), text))
    return findings


def git(root: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(root), *arguments],
        check=False,
        capture_output=True,
        text=True,
    )


def scan_history(root: Path) -> list[Finding]:
    revisions = git(root, "rev-list", "--all")
    if revisions.returncode != 0:
        raise RuntimeError(revisions.stderr.strip() or "git rev-list failed")

    # One grep per commit keeps values inside captured subprocess output while
    # avoiding a prohibitively slow `git show` call for every historical blob.
    # The Python patterns below still make the final decision and redact it.
    candidate_pattern = "|".join(
        [
            "-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----",
            "(AKIA|ASIA)[0-9A-Z]{16}",
            "gh[pousr]_[A-Za-z0-9_]{20,255}",
            "sk-[A-Za-z0-9_-]{20,}",
            "xox[baprs]-[A-Za-z0-9-]{10,}",
            "AIza[0-9A-Za-z_-]{30,}",
            "(sk|rk)_live_[A-Za-z0-9]{16,}",
            "https://discord(app)?\\.com/api/webhooks/[0-9]+/[A-Za-z0-9._-]{20,}",
        ]
    )

    findings: list[Finding] = []
    seen: set[tuple[str, str, int, str, str]] = set()
    for commit in revisions.stdout.splitlines():
        matches = git(root, "grep", "-I", "-n", "-E", "-e", candidate_pattern, commit, "--")
        if matches.returncode not in (0, 1):
            raise RuntimeError(matches.stderr.strip() or f"git grep failed for {commit[:12]}")
        prefix = f"{commit}:"
        for matched_line in matches.stdout.splitlines():
            if not matched_line.startswith(prefix):
                continue
            try:
                path, line_text, content = matched_line[len(prefix):].split(":", 2)
                line_number = int(line_text)
            except (ValueError, TypeError):
                continue
            if any(part in SKIP_DIRECTORIES for part in Path(path).parts):
                continue
            for found in findings_in_text(path, content, commit[:12]):
                finding = Finding(
                    path=found.path,
                    line=line_number,
                    rule=found.rule,
                    fingerprint=found.fingerprint,
                    commit=found.commit,
                )
                key = (
                    finding.commit or "",
                    finding.path,
                    finding.line,
                    finding.rule,
                    finding.fingerprint,
                )
                if key not in seen:
                    seen.add(key)
                    findings.append(finding)
    return findings


def load_allowlist(path: Path | None) -> set[tuple[str, str, str]]:
    if path is None or not path.exists():
        return set()
    payload = json.loads(path.read_text(encoding="utf-8"))
    entries = payload.get("entries", [])
    return {
        (entry["path"], entry["rule"], entry["fingerprint"])
        for entry in entries
    }


def render(finding: Finding) -> str:
    location = f"{finding.path}:{finding.line}"
    if finding.commit:
        location = f"{finding.commit}:{location}"
    return f"{location} rule={finding.rule} fingerprint={finding.fingerprint}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--history", action="store_true", help="also scan every reachable Git commit")
    parser.add_argument(
        "--include-ignored",
        action="store_true",
        help="include gitignored local files such as .env for a credential inventory",
    )
    parser.add_argument("--allowlist", type=Path, help="reviewed path/rule/fingerprint exceptions")
    arguments = parser.parse_args(argv)

    root = arguments.root.resolve()
    allowlist = load_allowlist(arguments.allowlist)
    findings = scan_worktree(root, include_ignored=arguments.include_ignored)
    if arguments.history:
        findings.extend(scan_history(root))

    unexpected = [finding for finding in findings if finding.allowlist_key not in allowlist]
    for finding in unexpected:
        print(render(finding))
    if unexpected:
        print(f"secret scan: {len(unexpected)} unexpected high-confidence finding(s)")
        return 1
    print(f"secret scan: clean ({len(findings)} reviewed finding(s) allowlisted)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
