# ORION v2 source checkpoint

Recorded 2026-08-18 without changing the active index or worktree.

## Recoverable source state

- Branch: `orion-v2/source-checkpoint-20260818`
- Commit: `613c6acbc899482bc78020509752758033a95c23`
- Parent: `3843620043c05639b429092c83e004e6008769b7`
- Scope: 141 changed files relative to the Phase 0 branch parent
- Delta: 22,586 insertions and 1,259 deletions

The checkpoint was created through a temporary Git index. The tool compared
the active index tree and raw porcelain status before and after creating the
commit and refused success unless both were identical.

It captured all tracked edits plus 60 current untracked source/test/handoff
files. It excluded 187 untracked files under build-backup, live workspace
memory, and planning-archive roots. Gitignored `.env*` files were not eligible.

## Clean reproduction evidence

The checkpoint was checked out detached under `/private/tmp`, then removed
after verification. Nothing was installed or launched.

| Gate | Result |
|---|---|
| Fresh Python environment | created with Python 3.13.14 |
| Python/TTS/Phase 0 suite | 221/221 passed |
| ORION Control dependency install | `npm ci --ignore-scripts` passed from lockfile |
| ORION Control suite | 134/134 passed |
| ORION Control TypeScript build | passed; generated dist left the checkpoint worktree clean |
| Native SessionDomain/SessionService suite | 287/287 passed |
| Native release app bundle | built and signed with `Orion Local Signing` |
| Installed plugin comparison | checkpoint dist byte-for-byte matched installed dist |
| Installed app comparison | same bundle identifier and signing/runtime metadata |

The separately built app executable was not byte-identical to the installed
executable. That does not contradict source reproducibility because Swift and
code-signing builds are not configured as deterministic byte-for-byte builds.
This record therefore claims clean source/build/contract parity, not bitwise
artifact reproducibility.

## Reproduce again

Use a new empty path and do not reuse the live working copy:

```bash
git worktree add --detach /private/tmp/orion-v2-repro \
  613c6acbc899482bc78020509752758033a95c23
cd /private/tmp/orion-v2-repro
uv run python -m unittest discover -s tests -q
cd plugin/orion-control
npm ci --ignore-scripts
npm test
npm run build
cd ../../native/Orion
./Tests/run-domain-test.sh
./make_app_bundle.sh
```

Remove only that explicit temporary worktree when finished:

```bash
git -C /Users/nickmadaio/Desktop/ORION worktree remove --force \
  /private/tmp/orion-v2-repro
```

The checkpoint is local and has not been pushed. It is a safety/reproduction
anchor, not a merge request and not the new integration branch.
