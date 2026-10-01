# Task focus-lists-ui — the phone's app lists (phone)

## Why
Today `FocusLock` (App/FocusLock.swift) blocks ONE list of apps. Nick wants lists so ORION can block distracting apps and leave texting open: messaging, feeds, video, games (the same names as `scripts/lib/focus/phone-lists.mjs`). iOS only gives opaque tokens, so Nick fills each list once in Apple's `FamilyActivityPicker`.

## File you own
`native/OrionMobile/App/FocusLists.swift` — EXISTS as a placeholder, already in the Xcode project. Replace its contents via `### EDIT`. Do NOT edit FocusLock.swift or ScreenMonitor (Claude migrates them later).

## Interface
```swift
import FamilyControls
import ManagedSettings
enum AppList: String, CaseIterable, Identifiable { case messaging, feeds, video, games; var id: String { rawValue } }
@MainActor final class FocusLists: ObservableObject {
    static let shared = FocusLists()
    @Published private(set) var selections: [AppList: FamilyActivitySelection]
    @Published private(set) var blocked: Set<AppList>
    func selection(for list: AppList) -> FamilyActivitySelection
    func set(_ selection: FamilyActivitySelection, for list: AppList)
    func block(_ lists: Set<AppList>)          // shields exactly these lists (replaces the previous set)
    func unblockAll()
    func isEmpty(_ list: AppList) -> Bool
}
struct FocusListsView: View { @ObservedObject var lists: FocusLists = .shared }
```
## Decisions
- Persist each selection as PropertyList-encoded data in the app group `UserDefaults(suiteName: "group.com.nickmadaio.orion")` under `orion.focuslists.<name>`, and `blocked` under `orion.focuslists.blocked` (array of names), so the Screen Time extension can read them later.
- Shield with its OWN store, `ManagedSettingsStore(named: .init("orion.focus.lists"))`, so it never fights FocusLock's store: `shield.applications` = union of the blocked lists' application tokens (nil when empty); `shield.applicationCategories = .specific(union of category tokens)` (nil when empty); `shield.webDomains` likewise.
- `FocusListsView`: one row per list — a symbol (messaging `bubble.left.and.bubble.right.fill`, feeds `rectangle.stack.fill`, video `play.rectangle.fill`, games `gamecontroller.fill`), the name, "n apps" or "Not set", and a lock badge when blocked; tapping a row opens `.familyActivityPicker(isPresented:selection:)` for that list. A footer explains in one sentence that ORION only sees the list names, never which apps. Style with the `Phone` tokens; the screen uses `.phoneScreen()` like the other screens.
- No authorization request here (FocusLock already asks).

## Check
`phone-build` must pass.
