#!/bin/bash
#
# The cross-language contract for Phase 42's automation-permissions panel.
#
#   ./scripts/orion_v2_authority_contract_check.sh
#
# WHAT THIS PROVES: that the phone's `PermissionProfile` knows exactly the
# profiles the LIVE plugin defines, and that `AuthoritySnapshot` decodes the
# real `docs/planning/v2/CURRENT_AUTHORITY.json` rather than a fixture shaped like it.
#
# Why it earns its keep. The Security Center's most consequential panel is the
# one saying what ORION is allowed to do on its own. Two things can silently
# make it lie: a sixth permission profile added in `permissions.ts`, and a
# change to the snapshot's shape. Both would leave a screen that renders
# perfectly and reports less authority than actually exists -- the most
# dangerous possible wrong answer on a security screen. So the profile list is
# read out of the compiled plugin at runtime, not copied, and the JSON fed to
# the decoder is the real file on disk.
#
# The Swift half links against the ALREADY-BUILT MobileCore rather than
# rebuilding it, so this is fast and cannot drift from what the check harness
# tested.
#
# Read-only. It writes nothing outside its own scratch directory.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MOBILE="$REPO/native/OrionMobile"
SNAPSHOT="$REPO/docs/planning/v2/CURRENT_AUTHORITY.json"
PLUGIN="$REPO/openclaw-plugins/orion-control/dist/permissions.js"

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

NODE="$HOME/.openclaw/tools/node-v24.15.0/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node)"
[ -n "$NODE" ] || { echo "authority contract: no node found"; exit 2; }
[ -f "$PLUGIN" ] || { echo "authority contract: the plugin is not built at $PLUGIN"; exit 2; }
[ -s "$SNAPSHOT" ] || { echo "authority contract: no authority snapshot at $SNAPSHOT"; exit 2; }

echo "== reading the profile list out of the live plugin =="
"$NODE" -e "
import('file://$PLUGIN').then(m => {
  if (!Array.isArray(m.PERMISSION_PROFILES)) { console.error('no PERMISSION_PROFILES export'); process.exit(1); }
  process.stdout.write(JSON.stringify([...m.PERMISSION_PROFILES].sort()));
}).catch(e => { console.error(e.message); process.exit(1); });
" > "$SCRATCH/profiles.json" || { echo "authority contract: could not read the plugin"; exit 1; }
echo "   $(cat "$SCRATCH/profiles.json")"

echo "== building MobileCore =="
( cd "$MOBILE" && swift build 2>&1 | tail -1 ) || { echo "authority contract: MobileCore does not build"; exit 1; }

MODULES="$MOBILE/.build/debug/Modules"
[ -f "$MODULES/MobileCore.swiftmodule" ] || { echo "authority contract: no MobileCore.swiftmodule under $MODULES"; exit 1; }
# Scope the object glob to the debug tree; a bare glob pulls in every
# architecture's copy and the link fails with duplicate symbols.
OBJECTS=$(find "$MOBILE/.build" -path '*/debug/MobileCore.build/*.o' -print0 | xargs -0 echo)
[ -n "$OBJECTS" ] || { echo "authority contract: no MobileCore objects built"; exit 1; }

cat > "$SCRATCH/contract.swift" <<'SWIFT'
import Foundation
import MobileCore

var failures: [String] = []
func expect(_ ok: Bool, _ what: String) {
    print("\(ok ? "ok  " : "FAIL") \(what)")
    if !ok { failures.append(what) }
}

let arguments = CommandLine.arguments
let livePath = arguments[1]
let snapshotPath = arguments[2]

// 1. The five profiles the app knows must be exactly the ones the plugin defines.
let live = try! JSONDecoder().decode([String].self, from: Data(contentsOf: URL(fileURLWithPath: livePath)))
let known = PermissionProfile.allCases.map(\.rawValue).sorted()
expect(known == live,
       "PermissionProfile matches the live plugin's PERMISSION_PROFILES (app: \(known), plugin: \(live))")

// 2. The real snapshot decodes. If it does not, the error NAMES what it choked
//    on, which is the whole point of refusing rather than defaulting.
let bytes = try! Data(contentsOf: URL(fileURLWithPath: snapshotPath))
do {
    let snapshot = try AuthoritySnapshot.decode(bytes)
    expect(true, "the real CURRENT_AUTHORITY.json decodes (profile: \(snapshot.profile.rawValue))")
    expect(snapshot.counts.isConsistent,
           "its gate counts add up: \(snapshot.counts.auto)+\(snapshot.counts.notify)+\(snapshot.counts.approval)+\(snapshot.counts.never) == \(snapshot.counts.total)")
    let disagreeing = snapshot.availability.filter { !$0.agreesWithItsInputs }
    expect(disagreeing.isEmpty,
           "every tier's `available` equals configOn AND profileOn\(disagreeing.isEmpty ? "" : " -- disagreeing: \(disagreeing.map(\.tier))")")
    expect(!snapshot.availability.isEmpty, "and it lists at least one tier")
} catch {
    expect(false, "the real CURRENT_AUTHORITY.json decodes -- it did not: \(error)")
}

print("")
if failures.isEmpty {
    print("authority contract: OK")
    exit(0)
}
print("authority contract: FAIL")
exit(1)
SWIFT

echo "== compiling the contract against the built MobileCore =="
# bash, not zsh: the unquoted $OBJECTS below must word-split.
swiftc -I "$MODULES" -o "$SCRATCH/contract" "$SCRATCH/contract.swift" $OBJECTS 2>&1 | tail -5
[ -x "$SCRATCH/contract" ] || { echo "authority contract: the contract did not compile"; exit 1; }

echo "== running =="
"$SCRATCH/contract" "$SCRATCH/profiles.json" "$SNAPSHOT"
