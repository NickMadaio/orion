<!-- prompt: Read-only research in /Users/nickmadaio/Desktop/ORION (a personal assistant: Swift Mac app native/Orion, iPhone app native/OrionMobile, CloudKit link native/OrionLink, OpenClaw TS plugin plugin/orion-control/src). Very thorough. Do NOT edit anything or run builds/network.

Trace: Nick sends a chat message from the iPhone app while the Mac is reachable: phone composer/view (OrionMobile, e.g. Remote -->

The phone's chat goes through two things you might not expect. On the Mac, the work is done by the **ORION Link helper app** (`native/OrionLink`), not by `PhoneLink.swift`, `PhonePlanRequests.swift` or `MessageBridge.swift`. And the model call goes through the **`scripts/orion-remote` Node script, which runs the `openclaw agent` command**, not through `GatewayClient.swift`. The full path is phone → a private CloudKit `LinkCommand` record → the helper polls every 4 s → `orion-remote handle --mode chat` → `openclaw agent` → the reply is written back onto the same record → the phone picks it up by silent push or its own 4 s poll.

## Hops

**1. Composer (phone)** — `native/OrionMobile/App/ConversationView.swift:270-275`
```swift
private func send() {
    guard canSend else { return }
    let text = draft
    draft = ""
    remote.say(text, conversation: conversationID, model: selectedModel)
}
```
- Voice mode calls the same function at `:179`, and tapped suggestions at `:149`.
- `conversationID` is nil (all history) until "New chat" (`:71`) sets `UUID().uuidString`.
- `selectedModel` comes from `snapshot.chatModels`, which the Mac reads from `model-roles.json` (`:78-79`).

**2. `RemoteStore.say` and the on-device switch** — `native/OrionMobile/App/RemoteViews.swift:156-160, 222-240`
```swift
static let answerOnDevice = false
var macReachable: Bool { presence == .online }
...
if Self.answerOnDevice && !macReachable && answerOnPhone(text, id: "local-" + id) {
    sent?("local-" + id); return
}
sent?(id)
Task {
    if let state = try? FocusLock.screenState().validated().encoded() { _ = await link.send(state, kind: .log) }
    await link.send(text, kind: .chat, id: id, conversation: conversation, model: model)
}
```
- The comment at `:227-229` quotes you (2026-10-12): "make the phone use only the api rather than this stupid local model".
- Every message now goes to the Mac and waits there if the Mac is away.
- Each chat message is preceded by a separate `kind: .log` record holding the phone's lock state, "so ORION knows it before reading 'unlock my apps'."

**3. Validation and writing the CloudKit record** — `native/OrionMobile/App/CloudLink.swift:200-224`
```swift
let record = CKRecord(recordType: LinkSchema.commandType, recordID: CKRecord.ID(recordName: id, zoneID: zoneID))
record[LinkSchema.commandConversation] = conversation as CKRecordValue?
record[LinkSchema.commandModel] = model as CKRecordValue?
record[LinkSchema.commandText] = command as CKRecordValue
record[LinkSchema.commandSentAt] = now as CKRecordValue
record[LinkSchema.commandStatus] = LinkCommandStatus.pending.rawValue as CKRecordValue
record[LinkSchema.commandDevice] = "iphone" as CKRecordValue
record[LinkSchema.commandKind] = kind.rawValue as CKRecordValue
```
- Data out: a `LinkCommand` record whose `recordName` is a UUID, written to the private database, zone `OrionLink`.
- Fields: `text`, `sentAt`, `status="pending"`, `device="iphone"`, `kind="chat"`, plus optional `conversationID` and `model`.
- `LinkCommand.validate` (`LinkSnapshot.swift:325-332`) trims the text, turns control characters into spaces, and allows 1–2000 characters ("orion-remote takes up to 4000 bytes").
- The message shows as pending at once (`byID[id]`).
- On a CloudKit error it is marked `.failed` with `"Not sent: …"`. There is no retry or outbox for chat; only `.log` entries use the outbox (`RemoteViews.swift:204-218`).

**4. The shared contract** — `native/OrionMobile/Sources/MobileCore/LinkSnapshot.swift:17-50`, 56-64
```swift
public static let containerID = "iCloud.com.nickmadaio.orion"
public static let zoneName = "OrionLink"
public static let stateType = "MacState"
...
public static let commandType = "LinkCommand"
...
public static let alertType = "LinkAlert"
```
The header comment explains that commands are plain text in orion-remote's grammar. The Mac runs every one through `orion-remote handle`, "the same gate the Discord channel uses", so "the phone gains no authority Discord does not already have."

**5. The Mac helper is kept running** — `native/Orion/Sources/Orion/PhoneLink.swift:9-27`
```swift
 The link itself is the ORION Link helper embedded at
 Contents/Library/LoginItems/ORION Link.app (native/OrionLink). It carries
 Nick's developer-team signature for CloudKit, so Orion.app keeps its own ...
static let helperID = "com.nickmadaio.orion.link"
```
- Orion.app only registers and starts the helper (`SMAppService.loginItem`), restarts it if its binary is newer, and shows `~/Library/Application Support/ORION Link/status.json`.
- The status counts as alive if it was written within 30 s (`:81`).

**6. The helper's loop** — `native/OrionLink/App/LinkEngine.swift:74-94`
```swift
while true { await tick(); try? await Task.sleep(for: .seconds(4)) }
...
await pollCommands()
await publishChats()
handleWidgetRequests()
if ticks % 8 == 0 { await deliverCheckins() }
await deliverOutreach()
await publishState(force: ticks % 8 == 1)
```
- The Mac **polls every 4 s**. It has no CloudKit subscription of its own.
- If iCloud isn't ready at boot it retries after 30 s (`:59`, `:71`).
- A `busy` guard makes ticks run one at a time.

**7. Fetching pending commands** — `LinkEngine.swift:331-368`
```swift
if record.recordType == LinkSchema.commandType,
   (record[LinkSchema.commandStatus] as? String) == LinkCommandStatus.pending.rawValue {
    pending.append(record)
}
...
for record in ordered { await handle(record) }
// Advanced only after every fetched command was handled ...
changeToken = token
```
- It reads `recordZoneChanges` since the token stored in UserDefaults `link.changeToken`, keeps only `status == "pending"`, and sorts by `sentAt`.
- If the token has expired it resets to nil.
- Because the token is saved only after every command is handled, a crash leads to a re-fetch, which orion-remote's replay guard then refuses.

**8. Running the command** — `LinkEngine.swift:370-389`
```swift
let limit = kind == .log ? 36 * 3600 : staleAfter      // staleAfter = 10 * 60 (:44)
if Date().timeIntervalSince(sentAt) > limit {
    result = .init(ok: false, reply: "Not run: this was sent more than ten minutes ago. ...")
} else {
    record[LinkSchema.commandStatus] = LinkCommandStatus.running.rawValue as CKRecordValue
    _ = try? await save([record], policy: .changedKeys)
    ...
    case .chat, .control:
        result = await Task.detached(priority: .userInitiated) { runner.run(text: text, id: id, sentAt: sentAt, chat: chat, conversation: ..., model: ...) }.value
```
- A chat message older than 10 minutes fails without running.
- Otherwise the helper first writes `status="running"` back to CloudKit, which the phone shows as "ORION is thinking…".
- `kind == .plan` goes instead to `PlanRequestFile`, which `PhonePlanRequests.swift` in Orion.app handles. That is the "plan my day" path, not chat.

**9. `CommandRunner` and the session key** — `native/OrionLink/Sources/LinkCore/CommandRunner.swift:21, 33-37, 41, 55-57, 67-71`
```swift
[remote.path, "handle", "--from", LinkSchema.sender, "--id", id,
 "--at", String(Int64(sentAt.timeIntervalSince1970 * 1000)),
 "--mode", chat ? "chat" : "command", "--", text]
...
env["ORION_REMOTE_ALLOW"] = LinkSchema.sender
let session = conversation.map { "orion-chat-" + $0 } ?? "orion-app-v2"
if chat { env["ORION_BRAIN_SESSION"] = session }
if let model { env["ORION_BRAIN_MODEL"] = model; env["ORION_BRAIN_THINKING"] = model.hasPrefix("ollama/") ? "off" : "low" }
```
- It runs `~/.openclaw/tools/node-v24.15.0/bin/node ~/.openclaw/orion-remote/scripts/orion-remote …`. That is the **installed copy**, not the repo's `scripts/`.
- **Timeout 180 s**, then `terminate()` and the reply "ORION did not answer within 180 seconds."
- Exit 0 means ok (stdout cut to 4000 characters). Exit 1 with output means a refusal whose text is forwarded.
- Picking a non-ollama model forces thinking to `low`, which overrides the per-message policy.

**10. orion-remote's checks** — `scripts/orion-remote:1512-1520, 1557, 1588-1592, 1612, 1630-1639`
```js
if (!allowedSenders().has(sender)) { ... return { ok: false, reply: null }; }
...
const parsed = mode === "chat" ? { error: "conversation", verb: null, args: [] } : parse(text);
...
if (age > MAX_ENVELOPE_AGE_MS) { ... "that command was too old to run" }
const admission = await admitInbound({ sender, envelopeId, now, record });
...
if (Buffer.byteLength(text, "utf8") > MAX_BRAIN_BYTES) { ... }
const answer = await askBrain(text, sender);
```
The checks run in this order:
1. Sender allowlist (env `ORION_REMOTE_ALLOW`).
2. Device routing (`ORION_DEVICE_ID`, or the hostname).
3. The lock.
4. Age: `MAX_ENVELOPE_AGE_MS` is 10 min (`:162`).
5. Replay and rate limit (`admitInbound`, `:1697+`): `SEEN_KEPT=200` ids remembered, `RATE_CAP=40` per 10-minute window, stored in `~/.openclaw/orion-controlled/remote-inbound.json`.
6. Size: `MAX_BRAIN_BYTES=4000`.

The comment at `:1550-1556` explains chat mode: "No, I mean the task page" used to parse as `deny`, so in chat mode nothing is treated as a verb. Every decision is logged to `remote-audit.jsonl`.

**11. `askBrain` / `askBrainOnce` and the call to the gateway** — `scripts/orion-remote:91, 95-96, 723-745, 790-812`
```js
const BRAIN_SESSION = process.env.ORION_BRAIN_SESSION || "orion-app-v2";
const BRAIN_TIMEOUT_S = 90;
...
["agent", "--session-key", BRAIN_SESSION, "--timeout", String(BRAIN_TIMEOUT_S),
 ...((model ?? process.env.ORION_BRAIN_MODEL) ? ["--model", ...] : []),
 "--thinking", process.env.ORION_BRAIN_THINKING ?? thinkingLevel(...),
 "--json", "--message-file", file],
{ timeout: (BRAIN_TIMEOUT_S + 30) * 1000, maxBuffer: 32 * 1024 * 1024 },
```
- It runs `~/.openclaw/bin/openclaw agent` (`OPENCLAW`, `:60`), which talks to the gateway.
- The prompt goes in a 0600 temp file, `orion-controlled/brain-<hex>.txt`, never on the command line. It is made of `phoneContext()` (live facts, SCHEDULING.md, open apps), any saved standing rules, `briefFor(sender)`, the `--- Nick's message follows ---` marker, and your text.
- Data in: the `--json` envelope. The reply is `result.payloads[].text` joined together, with lines starting "⚠️ 🛠️" removed, and passed through `fixReply` and `lintReply`.
- Shortcuts: `quickAnswer` answers time and date with no model call.
- It may ask a second time when the model claims something was done, says it can't, or gives no reply (`CHECK_DONE`, `CHECK_CANT`, `CHECK_SILENT`, `:726-745`).
- Failures: "You have a turn running at the Mac — give it a moment…" if the session is busy; "Orion is taking too long to answer" if killed or `Command failed:`.
- Thinking policy: `scripts/lib/thinking-policy.mjs:23-26` gives `off`, or `low` when `needsReasoning`; ollama models are always `off`.

**12. Reading the "thinking" text** — `native/OrionMobile/Sources/MobileCore/ChatThinking.swift:4-25` (used at `CommandRunner.swift:74`)
```swift
let base = home.appendingPathComponent(".openclaw/agents/main/sessions")
... let entry = index[("agent:main:" + session).lowercased()], let file = entry["sessionFile"] as? String,
...
let values = content.filter { $0["type"] as? String == "thinking" }.compactMap { $0["thinking"] as? String }
```
After a successful chat turn (exit 0 only), the helper reads the session transcript from disk and collects the assistant's `thinking` blocks timestamped after the turn began. It does not come from the gateway's JSON response.

**13. Writing the reply back** — `LinkEngine.swift:416-428`
```swift
record[LinkSchema.commandStatus] = (result.ok ? LinkCommandStatus.done : .failed).rawValue as CKRecordValue
if kind == .chat { archiveChat(record, text: text, sentAt: sentAt, result: result) }
record[LinkSchema.commandThinking] = result.thinking as CKRecordValue?
record[LinkSchema.commandReply] = result.reply as CKRecordValue
record[LinkSchema.commandRepliedAt] = Date() as CKRecordValue
do { try await save([record], policy: .changedKeys); commandsHandled += 1 }
catch { problem = "Could not send a reply: ..." }
await publishState(force: true)
```
- Data out: the **same record**, now with `status` done/failed, `reply`, `thinking`, `repliedAt`, and `conversationID`.
- If no conversation was given, `conversationID` is set to `"phone-history"` (`:512`, `:517`).
- If saving the reply fails, nothing retries: the record stays "running" in CloudKit.
- `archiveChat` (`:510-518`) also merges the exchange into `~/.openclaw/orion-controlled/chats` (`ChatStore`), the same store Orion.app reads (`AppState.swift:82`).
- In the other direction, `publishChats` (`:519-551`) copies chats started on the Mac to the phone as `LinkCommand` records with `device="mac-chat"`, deduplicated by a fingerprint in UserDefaults `link.chatExports`.

**14. Phone subscriptions and polling** — `CloudLink.swift:50-62, 82-114`
```swift
let zoneSub = CKRecordZoneSubscription(zoneID: zoneID, subscriptionID: "orion-link-zone")
let silent = CKSubscription.NotificationInfo()
silent.shouldSendContentAvailable = true
...
while !Task.isCancelled { await self?.refresh(); try? await Task.sleep(for: .seconds(4)) }
```
- Two subscriptions: a silent zone subscription (`orion-link-zone`) and a visible alert subscription on `LinkAlert` (`orion-link-alerts`).
- If subscribing fails it retries after 60 s (`:158`).
- Silent pushes arrive at `OrionMobileApp.swift:86-88`, which posts `.orionLinkChanged`; that triggers `refresh()`.
- There is also a 4 s poll while the app is open.

**15. Reading the change feed (phone)** — `CloudLink.swift:129-187`
- `recordZoneChanges` since UserDefaults `link.phoneToken`. The first fetch after launch starts from nil, so the whole history is rebuilt.
- `MacState` records are decoded into `snapshot`, which drives presence.
- `LinkCommand` records become `Message` (`text`, `sentAt`, `kind`, `status`, `reply`, `repliedAt`, `thinking`, `conversationID`, `model`).
- Only the last 200 are kept (`:190`).

**16. Display** — `RemoteViews.swift:128-131` (`absorb` keeps `.chat`, merges with `localConversation`), then `ConversationView.swift:112-128`
```swift
case .pending, .running:
    Text(message.status == .pending ? waitingText : "ORION is thinking…")
case .done, .failed:
    Text(message.id.hasPrefix("local-") ? "ORION · ON YOUR IPHONE" : "ORION")
    if let thinking = message.thinking, !thinking.isEmpty { DisclosureGroup("Thinking") { ... } }
```
- `waitingText` (`:140-141`) is "Sent to your Mac…" when the Mac is online, otherwise "Waiting for your Mac to come online…".
- Voice mode (`PhoneVoice.swift:138-150`) waits for the reply id and gives up after 90 s ("That's taking a while…").

**17. Presence** — `MobileCore/RemoteLink.swift:133, 154-163`
```swift
public static let standard = HeartbeatPolicy(interval: 30, staleAfter: 120, offlineAfter: 300)!
```
Presence comes from the age of `MacState.generatedAt`: under 120 s is online, 120–300 s is stale, 300 s or more is offline. The helper republishes at least every ~32 s (every 8 ticks of 4 s), and sooner when something changes (`LinkEngine.swift:225-255`).

**18. When the Mac is not reachable** — `RemoteViews.swift:166-200`, `OfflineBrain.swift:1-43, 115`
- Today (`answerOnDevice = false`) the record just sits in CloudKit as "pending". When the Mac comes back, anything under 10 minutes old runs; anything older fails with "Not run: … more than ten minutes ago."
- If the switch were flipped (iOS 26+, Apple Intelligence available), `OfflineBrain` would answer with Apple's on-device model (FoundationModels `LanguageModelSession`) using fixed rules and no tools. The id gets a `local-` prefix, the conversation is stored in UserDefaults `orion.localChat.v1`, and when the Mac returns `syncOfflineConversation` sends it as `.note` logs, deduplicated through `orion.localChat.synced`.
- "Flux" is not involved: `MobileCore/FluxTurns.swift` is Deepgram's `flux-general-en` speech-turn detection for voice mode.

## Things that are not on this path
- **`GatewayClient.swift`** is Orion.app's own chat. It makes the same kind of `openclaw agent` call (`:115-128`), with `sessionKey = "orion-app-v2"` (`:53`) and `agentTimeout` 300 s (`RunTimeouts.swift:54`). A phone message with no conversation chosen therefore shares the `orion-app-v2` session with the Mac app, which is where the "turn running at the Mac" collision message comes from.
- **`MessageBridge.swift`** reads iMessage history for the socket. It has nothing to do with this.
- **`PhonePlanRequests.swift`** only handles `kind=plan`.
- **The plugin** (`plugin/orion-control/src`) only touches this path in `episodic.ts:71-75`: `nickWords()` drops everything before the "Nick's message follows" marker and any `[orion-remote]` lines from journal capture.
- **`backend/`** is the v1 phone backend (an idempotent Python sync engine in `backend/sync/engine.py`). `HANDOFF.md:365` says it is kept only because the schema and sync checks import it. The phone app has no HTTP path to it; `PhoneHTTPReadSession.swift` is simulator-only (`#if targetEnvironment(simulator)`).

## Timeouts, retries and problems I noticed
- **Timeouts and polling:** phone poll 4 s; Mac poll 4 s; heartbeat about 32 s; command expiry 10 min on both the helper and orion-remote; brain `--timeout 90` with a 120 s kill; CommandRunner 180 s; voice gives up after 90 s.
- **A long answer can be cut off.** `askBrain` can make two brain calls of up to 120 s each, about 240 s in total, which is longer than CommandRunner's 180 s. A turn that gets re-asked can be killed before it answers.
- **Long answers make the Mac look stale.** `tick()` handles commands one after another and only publishes the heartbeat afterwards. A chat lasting over 120 s makes the phone show the Mac as "stale", and delays check-ins and outreach. The bubble already says "running", so the effect is mostly cosmetic for now.
- **Duplicate runs are blocked in three places:** the CloudKit record name equals the orion-remote `--id` (replay guard); `link.appliedLogs` (last 300) covers logs; `link.alertedApprovals` covers approval alerts.
- **Deploy drift:** the helper runs the installed `~/.openclaw/orion-remote/scripts/orion-remote`, not the repo copy.

## Names
- **CloudKit container:** `iCloud.com.nickmadaio.orion`; private database; zone `OrionLink`; environment `development` (from the entitlements).
- **Record types:** `MacState` (record name `mac`; fields `json`, `updatedAt`), `LinkCommand` (fields listed in hop 4, plus `conversationTitle`), `LinkAlert` (`text`, `kind`, `at`, `level`).
- **Subscriptions:** `orion-link-zone`, `orion-link-alerts`.
- **App groups:** `group.com.nickmadaio.orion` (phone), `JQNK3T6ACY.com.nickmadaio.orion` (Mac). Helper bundle id: `com.nickmadaio.orion.link`.
- **Environment variables:** `ORION_REMOTE_ALLOW`, `ORION_BRAIN_SESSION`, `ORION_BRAIN_MODEL`, `ORION_BRAIN_THINKING`, `ORION_BRAIN_BIN`, `ORION_DEVICE_ID`.
- **Phone UserDefaults keys:** `link.phoneToken`, `orion.localChat.v1`, `orion.localChat.synced`, `orion.outbox.v1`.
- **Mac UserDefaults keys:** `link.changeToken`, `link.alertTypeReady`, `link.alertedApprovals`, `link.appliedLogs`, `link.chatExports`.
- **Session keys:** `orion-app-v2`, `orion-chat-<uuid>`. Transcript index key: `agent:main:<session>`.

## Git history (`-12`)
- **`RemoteViews.swift`:** a44ce44 2026-10-12 phone never answers with the on-device model; ff0ec35 2026-10-02; 51e0b56 2026-10-01; b59bdca 2026-09-30 ORION for iPhone.
- **`CloudLink.swift`:** 094ebe2 2026-10-07; ff0ec35 2026-10-02; b59bdca 2026-09-30.
- **`LinkEngine.swift`:** dce48ae 10-08; a139f4b 10-07 reach; ae41446 10-02; ff0ec35 10-02; 017d51c 10-01; 51e0b56 10-01; b59bdca 09-30.
- **`CommandRunner.swift`:** ff0ec35 2026-10-02; b59bdca 2026-09-30.
- **`scripts/orion-remote`:** a139f4b 10-07; 54f5e05 10-07; a7f506b 10-07; 9e901a9 10-07 think only when it matters; 6eb4dca 10-06; 75ebf7e 10-06; 2b4301c 10-06 stuck turn ends; e568abb 10-06; b1b530b 10-06; e11dc82 10-06; cd1bcb6 10-05; 295000a 10-05.
- **`LinkSnapshot.swift`:** dce48ae, ae41446, ff0ec35, 017d51c, 51e0b56, b59bdca.
- **`ConversationView.swift`:** a139f4b 10-07; 138c00a 10-07; 4000a9d 10-06; 0903801 10-02; ff0ec35 10-02; d73711b 10-02; b59bdca 09-30.
- **`GatewayClient.swift`:** a139f4b 10-07; 9e901a9 10-07; ae41446 10-02; ff0ec35 10-02; d0eeebb 09-07; 3e14200 09-05; 93e9a42 08-20; 3a87a71 08-04; 8f1f4e5 07-30; 2f6bc6e 07-30.
- **`ChatThinking.swift`:** 9e901a9 2026-10-07; ff0ec35 2026-10-02.

`git status` shows no uncommitted changes in any of these files.