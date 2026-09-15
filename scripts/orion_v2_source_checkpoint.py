#!/usr/bin/env python3
"""Create a local source-only checkpoint without touching index or worktree."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath
from typing import Sequence


ALLOWED_ROOTS = {
    "native",
    "openclaw-plugins",
    "orion",
    "docs/planning",
    "scripts",
    "tests",
}
# One handoff, so there is one place to look. OVERNIGHT-LOG.md was removed on
# 2026-09-07 along with three other parallel narratives -- four files all
# claiming to say where the program was is four chances to read the stale one.
ALLOWED_ROOT_FILES = {"HANDOFF.md"}
EXCLUDED_PREFIXES = (".builds/", "openclaw-workspace/", "docs/planning/_archive/")
SECRET_NAMES = {".env", ".env.save"}
BRANCH_PATTERN = re.compile(r"orion-v2/source-checkpoint-[A-Za-z0-9._-]+\Z")


def checkpoint_path(path: str) -> bool:
    candidate = PurePosixPath(path)
    if candidate.is_absolute() or ".." in candidate.parts:
        return False
    normalized = candidate.as_posix()
    if normalized.startswith("./"):
        normalized = normalized[2:]
    if not normalized or normalized in SECRET_NAMES:
        return False
    if any(normalized.startswith(prefix) for prefix in EXCLUDED_PREFIXES):
        return False
    parts = PurePosixPath(normalized).parts
    if len(parts) == 1:
        return normalized in ALLOWED_ROOT_FILES
    return parts[0] in ALLOWED_ROOTS


def select_untracked(paths: Sequence[str]) -> tuple[list[str], list[str]]:
    included = sorted(path for path in paths if checkpoint_path(path))
    excluded = sorted(path for path in paths if not checkpoint_path(path))
    return included, excluded


def run_git(
    repo: Path,
    arguments: Sequence[str],
    *,
    environment: dict[str, str] | None = None,
    text: bool = True,
    input_text: str | None = None,
) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *arguments],
        cwd=repo,
        env=environment,
        check=False,
        capture_output=True,
        text=text,
        input=input_text,
    )


def require_git(repo: Path, arguments: Sequence[str], **kwargs) -> subprocess.CompletedProcess:
    completed = run_git(repo, arguments, **kwargs)
    if completed.returncode != 0:
        raise RuntimeError(f"git {' '.join(arguments[:2])} failed")
    return completed


def repository_state(repo: Path) -> tuple[str, bytes]:
    tree = require_git(repo, ["write-tree"]).stdout.strip()
    status = require_git(repo, ["status", "--porcelain=v1", "-z"], text=False).stdout
    return tree, status


def untracked_paths(repo: Path) -> list[str]:
    raw = require_git(
        repo, ["ls-files", "--others", "--exclude-standard", "-z"], text=False
    ).stdout
    return [part.decode("utf-8", errors="surrogateescape") for part in raw.split(b"\0") if part]


def add_in_chunks(repo: Path, environment: dict[str, str], paths: list[str]) -> None:
    for offset in range(0, len(paths), 100):
        require_git(repo, ["add", "--", *paths[offset : offset + 100]], environment=environment)


def create_checkpoint(repo: Path, branch: str, message: str) -> tuple[str, int, int]:
    if not BRANCH_PATTERN.fullmatch(branch):
        raise ValueError("branch must match orion-v2/source-checkpoint-<name>")
    ref = f"refs/heads/{branch}"
    existing = run_git(repo, ["show-ref", "--verify", "--quiet", ref])
    if existing.returncode == 0:
        raise ValueError(f"branch already exists: {branch}")
    if existing.returncode not in (1,):
        raise RuntimeError("could not inspect checkpoint ref")

    before_tree, before_status = repository_state(repo)
    included, excluded = select_untracked(untracked_paths(repo))
    with tempfile.TemporaryDirectory(prefix="orion-v2-checkpoint-") as directory:
        environment = os.environ.copy()
        environment["GIT_INDEX_FILE"] = str(Path(directory) / "index")
        require_git(repo, ["read-tree", "HEAD"], environment=environment)
        require_git(repo, ["add", "-u", "--", "."], environment=environment)
        add_in_chunks(repo, environment, included)
        tree = require_git(repo, ["write-tree"], environment=environment).stdout.strip()
        parent = require_git(repo, ["rev-parse", "HEAD"]).stdout.strip()
        commit = require_git(
            repo,
            ["commit-tree", tree, "-p", parent],
            environment=environment,
            input_text=message + "\n",
        ).stdout.strip()
        require_git(repo, ["update-ref", ref, commit, "0" * 40])

    after_tree, after_status = repository_state(repo)
    if (before_tree, before_status) != (after_tree, after_status):
        raise RuntimeError("active index or worktree changed during checkpoint")
    return commit, len(included), len(excluded)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--branch", required=True)
    parser.add_argument("--message", default="checkpoint: preserve current ORION source state")
    parser.add_argument("--dry-run", action="store_true")
    arguments = parser.parse_args(argv)
    repo = arguments.repo.resolve()

    try:
        included, excluded = select_untracked(untracked_paths(repo))
        if arguments.dry_run:
            print(
                "source checkpoint: dry-run "
                f"included_untracked={len(included)} excluded_untracked={len(excluded)}"
            )
            return 0
        commit, included_count, excluded_count = create_checkpoint(
            repo, arguments.branch, arguments.message
        )
    except (OSError, RuntimeError, ValueError) as error:
        print(f"source checkpoint: FAIL {error}")
        return 1
    print(
        "source checkpoint: ok "
        f"branch={arguments.branch} commit={commit[:12]} "
        f"included_untracked={included_count} excluded_untracked={excluded_count}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
