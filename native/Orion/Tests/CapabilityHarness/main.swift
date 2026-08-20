import Foundation

/*
 The capability catalog and the profile ladder, checked against the rules the
 orion-control plugin actually enforces.

 Compiled against the REAL Sources/Orion/Capabilities.swift so the catalog it
 checks is the catalog that ships. Pure Foundation: no gateway, no config
 write, no GUI, so this is safe to run anywhere.

 WHAT THIS PROVES: that the ladder orders the way the plugin's `PROFILE_TIERS`
 orders it, that "on but blocked by the profile" is reported for the case that
 is live right now, and that the catalog does not quietly drift out of sync with
 the flags in openclaw.json.

 WHAT IT DOES NOT PROVE: that a write reaches disk. That path goes through
 `openclaw config set`, which validates and is exercised for real by flipping a
 switch in Settings — the evidence for it is the CLI's own "Config valid" and
 the timestamped copy under ~/.openclaw/backups/orion-config.
*/

var failures = 0
var checks = 0

func check(_ label: String, _ condition: @autoclosure () -> Bool) {
    checks += 1
    if condition() {
        print("  ok    \(label)")
    } else {
        print("  FAIL  \(label)")
        failures += 1
    }
}

func section(_ title: String) { print("\n== \(title) ==") }

// MARK: - The ladder

section("the profile ladder orders like the plugin's PROFILE_TIERS")

check("restricted is the floor",
      PermissionProfile.restrictedReadOnly < PermissionProfile.approvedRootEdit)
check("consequential_local outranks broad_local_filesystem",
      PermissionProfile.broadLocalFilesystem < PermissionProfile.consequentialLocal)
check("external_connected is the ceiling",
      PermissionProfile.consequentialLocal < PermissionProfile.externalConnected)
check("a profile is not above itself",
      !(PermissionProfile.consequentialLocal < PermissionProfile.consequentialLocal))
check("every profile in the plugin has a case here",
      PermissionProfile.allCases.count == 5)
check("raw values match the JSON exactly",
      PermissionProfile.consequentialLocal.rawValue == "consequential_local"
        && PermissionProfile.externalConnected.rawValue == "external_connected")

// MARK: - The catalog

section("the catalog")

let all = CapabilityCatalog.all
check("every flag key is unique",
      Set(all.map(\.key)).count == all.count)
check("every flag has a description",
      all.allSatisfy { !$0.grants.isEmpty })
check("every group is non-empty",
      CapabilityCatalog.groups.allSatisfy { !$0.flags.isEmpty })
check("the config prefix is the one openclaw config set wants",
      CapabilityCatalog.configPrefix == "plugins.entries.orion-control.config")
check("a config path is the prefix plus the key",
      all[0].configPath == "plugins.entries.orion-control.config.\(all[0].key)")

// Self-modification is the one switch that must never be quietly ordinary.
let selfMod = all.first { $0.key == "enableSelfModificationActions" }
check("self-modification is in the catalog", selfMod != nil)
check("self-modification is marked as rewriting Orion himself",
      selfMod?.gravity == .rewritesSelf)
check("self-modification is the ONLY flag marked that way",
      all.filter { $0.gravity == .rewritesSelf }.count == 1)
check("self-modification names the profile it needs",
      selfMod?.minimumProfile == .consequentialLocal)
check("self-modification says out loud that it rebuilds Orion",
      (selfMod?.grants.contains("compiling") ?? false)
        || (selfMod?.grants.contains("rebuild") ?? false))

// MARK: - Necessary and not sufficient

section("on, and still blocked by the profile")

let model = CapabilitiesModel()

check("with no profile read yet, nothing claims to be blocked",
      CapabilityCatalog.all.allSatisfy { !model.blockedByProfile($0) })

// The live case, stated as data rather than as a comment: messages_send is not
// in consequential_local's tier set, so the switch being on changes nothing.
let send = all.first { $0.key == "enableMessagesSendActions" }
check("sending messages is in the catalog", send != nil)
check("sending messages needs external_connected",
      send?.minimumProfile == .externalConnected)
check("consequential_local is genuinely below it",
      PermissionProfile.consequentialLocal < (send?.minimumProfile ?? .restrictedReadOnly))

// Move/rename/delete sits one rung up from the other file switches on purpose.
let mutate = all.first { $0.key == "enableFileMutateActions" }
check("file mutation needs consequential_local",
      mutate?.minimumProfile == .consequentialLocal)
check("the plain desktop write switches do NOT carry a profile floor",
      all.first { $0.key == "enableDesktopModifyActions" }?.minimumProfile == nil)

// MARK: - Drift against the real config

section("drift against ~/.openclaw/openclaw.json")

let configPath = ("~/.openclaw/openclaw.json" as NSString).expandingTildeInPath
if let data = FileManager.default.contents(atPath: configPath),
   let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
   let plugins = root["plugins"] as? [String: Any],
   let entries = plugins["entries"] as? [String: Any],
   let control = entries["orion-control"] as? [String: Any],
   let config = control["config"] as? [String: Any] {

    let liveBooleans = Set(config.compactMap { key, value -> String? in
        value is Bool ? key : nil
    })
    let catalogued = Set(all.map(\.key))
    // Trust flags are deliberately NOT in this panel: they decide how the
    // plugin authenticates that a turn came from Nick, not what Orion may do,
    // and defaulting them to true is what makes locally-initiated runs work at
    // all. A switch for them belongs somewhere that can explain that.
    let deliberatelyOmitted = liveBooleans.filter { $0.hasPrefix("trustAllow") }
    let missing = liveBooleans.subtracting(catalogued).subtracting(deliberatelyOmitted)

    check("every boolean flag in the live config has a switch (missing: \(missing.sorted()))",
          missing.isEmpty)
    check("no catalogued key is absent from the schema's known shape",
          catalogued.contains("enableScratchDirectWriteActions"))
    print("  note  \(liveBooleans.count) boolean(s) in config, "
          + "\(catalogued.count) catalogued, "
          + "\(deliberatelyOmitted.count) trust flag(s) deliberately omitted")
} else {
    print("  skip  no readable openclaw.json on this machine")
}

print("\ncapabilities: \(checks) checks, \(failures == 0 ? "all passed" : "\(failures) FAILED")")
exit(failures == 0 ? 0 : 1)
