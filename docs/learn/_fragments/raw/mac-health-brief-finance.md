<!-- prompt: You are a research helper for a study guide about the ORION repo at /Users/nickmadaio/Desktop/ORION (snapshot HEAD 6c93032, 2026-10-14). STRICTLY READ-ONLY: do not edit, create, or delete any file; do not run builds, tests, installs, git commands that modify anything, or anything that calls a network API. Reading files, grep, wc, and `git log` are fine. Never copy secrets or personal health values -->

# Study notes: ORION Health, Brief and Finance (native/Orion), snapshot 6c93032

I only read files. Nothing was built, run or edited. Data files are described by shape only.

## 1. File table

| File | Lines | Purpose |
|---|---|---|
| `Sources/Orion/HealthLog.swift` | 719 | Model and store for `health-log.json`, which two processes write: supplements, workouts, nutrition, water, wearable day records. Uses a FileLock read-modify-write and a 3 s poll. |
| `Sources/Orion/HealthSummary.swift` | 176 | `HealthFacts`: app-written facts for the Health rail, plus a "select one id" JSON prompt. `WhoopSnapshot.healthSummaryDetails` reports availability and dates only. `Takeaway` row and parser. |
| `Sources/Orion/HealthSectionsModel.swift` | 300 | Phase 34. Builds the seven sections from WHOOP and HealthLog inputs. Handles confidence, trend direction and number formatting. |
| `Sources/Orion/HealthSectionsView.swift` | 202 | Draws the seven sections and the journal input. Additive under the HealthTab headline. Always shows confidence. |
| `Sources/Orion/HealthTab.swift` | 727 | The Health tab: phase-aware headline, week, sections, reading rail, sheets. Calls `NarrativeWriter` with `.selectionJSON`. |
| `Sources/Orion/JournalStore.swift` | 194 | Phase 35. Disk store for `health-journal.json`: append, correct-by-replace, FileLock. |
| `Sources/Orion/NutritionSheet.swift` | 172 | Local food log sheet. No portion guessing, no online food database. |
| `Sources/Orion/SupplementSheet.swift` | 198 | Sheet for editing the supplement list and ticking supplements. |
| `Sources/Orion/WorkoutSheet.swift` | 219 | Workout logger sheet: sets, previous best, recent exercises. |
| `Sources/Orion/WhoopSeries.swift` | 177 | `WhoopDayPoint`, `Trend` (baseline excludes the latest day), `WhoopWeek` (merge, `readingsByDay`), `StrainTarget` bands. |
| `Sources/Orion/PlanningSignal.swift` | 250 | Phase 33 firewall. Turns raw readings into categories (`derive`), plus `promptLines`, `StrainPosition`. |
| `Sources/Orion/BriefHealth.swift` | 32 | Brief reading age from the oldest component record, and number-free brief health highlights. |
| `Sources/Orion/NightMarkers.swift` | 51 | Reads `night.json`, written by orion-watch, for the wake/bed/asleep markers in the day view. |
| `Sources/Orion/MorningScreen.swift` | 366 | Full-screen morning panel (day plus weather) shown via `orion://morning-screen`. Wakes the display and raises brightness. |
| `Sources/Orion/MorningBriefView.swift` | 335 | The in-app brief, full or parked, remembered per logical day. `ParkedBriefCard`. |
| `Sources/Orion/BriefClock.swift` | 75 | Civil-date clock for the brief: greeting/salutation by hour, freshness checks, events and tasks due today. |
| `Sources/Orion/FinanceTab.swift` | 487 | Finance UI: net worth, month figures, categories, recurring charges, accounts, recent transactions, and the "Orion reads this as" rail. |
| `Sources/Orion/FinanceSummary.swift` | 90 | `FinanceFacts` and its takeaway prompt (raw dollar figures, local model only). |
| `Sources/Orion/PlaidModels.swift` | 246 | `PlaidItem`, `PlaidAccount`, `PlaidTransaction`, and the `Money` analytics (net worth, spending, recurring detector). |

**Tests** (paths relative to `native/Orion/Tests/`): `HealthFirewallHarness/main.swift` (108) and `Stubs.swift` (19); `HealthSectionsHarness/main.swift` (279); `JournalStoreHarness/main.swift` (113); `RaceHarness/main.swift` (120); `race-node.mjs`; `TodayPlanAppTests/BriefClockTests.swift` (104), `BriefModelBoundaryTests.swift` (77), `BriefNarrativeTests.swift` (152), `HealthSummaryTests.swift` (175).

The `run-*.sh` scripts are in `native/Orion/Tests/`, not in `native/Orion/`.

## 2. HealthLog

**Path.** `~/.openclaw/orion-controlled/health-log.json`. The env var `ORION_HEALTH_LOG` overrides it (tilde is expanded). The override exists only for the race harness (`HealthLog.swift:203-213`). The directory is created 0700 and the file is written 0600 (`:339-343`, `:427`).

**Schema** (`HealthLogFile`, `:159-175`). `schema` is `"orion.health.v3"`. The top-level keys are:
- `updatedAt`
- `supplements: [Supplement]` (fields `id`, `name`, `dose`, `timeOfDay` ∈ morning/lunch/evening/anytime)
- `supplementLog: [day: [id]]` (legacy)
- `workouts: [WorkoutSession]` (fields `id`, `day` yyyy-MM-dd, `startedAt` as an ISO string, `title`, `exercises[{id, name, sets[{id, weight, reps, unit="lb"}]}]`, `notes`)
- `calorieLog?: [day: Int]` (legacy)
- `days?: [day: HealthDayRecord]`
- `nutritionLog?: [day: [NutritionEntry]]` (fields `id`, `title`, `meal`, `calories`, `protein`, `carbohydrates`, `fat`, `fiber`, `notes`, `loggedAt`)
- `nutritionGoals?` (defaults: 2200 kcal, 150 g protein, 250 g carbohydrates, 70 g fat, 30 g fiber; `:151-157`)

`HealthDayRecord` (`:93-104`) has `waterBottles`, `calories`, `supplementIDs`, `recovery?`, `sleepPerformance?`, `sleepHours?`, `hrv?`, `restingHeartRate?`, `strain?`, `updatedAt`.

Unknown top-level keys are kept when the file is rewritten (`knownTopLevelKeys` `:281`, `readForMutation` `:290`, `retainingUnknownTopLevelFields` `:306`). On every mutate, `migrateLegacyDays` (`:364-387`) folds `supplementLog` and `calorieLog` into `days`. For a pre-v3 file it also writes an "Imported daily total" nutrition entry, then stamps v3.

**Poll watcher.**
```swift
// native/Orion/Sources/Orion/HealthLog.swift:224
    func start() {
        load()
        // Polled rather than watched with FSEvents for the same reason the
        // reminder store is: a poll cannot get into a state where it believes
        // it is subscribed and is not.
        watcher = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            self?.load()
        }
    }
```
`load()` skips republishing when `updatedAt` and the logical day are both unchanged (`:253-258`). A missing file is treated as normal (`:245`). A file that fails to decode sets `lastError` (`:249-251`). `HealthLog.today` is `OrionDay.current.key`, the logical day: 4 am floor, or the WHOOP wake time if that is later (`:222`; `OrionDay.swift:56`, `:69-75`).

**FileLock** (`Sources/SessionService/FileLock.swift`). The lockfile is `<path>.lock`, created with `O_CREAT|O_EXCL`. A lock older than `staleAfter = 15` s is broken (`:61`). A writer gives up after `giveUpAfter = 6` s (`:64`) and polls every 20 ms (`:71`). `mutate` (`HealthLog.swift:335-362`) does the read inside the lock, then migrate, change, stamp, encode, and `publish`. `publish` (`:408-442`) writes to a unique scratch file `.health-log.<UUID>.tmp` and then calls POSIX `rename(2)`. It does not use `replaceItemAt`, and it deliberately avoids `.completeFileProtection`. The work runs synchronously on the main thread.

**Other writer.** `plugin/orion-control/src/health.ts`. Its default path is the same file (`:119-123`). It holds `${file}.lock` with `open(lock,"wx")` (`:194-203`) and uses random-byte scratch names. It accepts schemas v1, v2 and v3, promotes them to v3, and passes unknown fields through (`:150-160`). It refuses to replace a file it cannot parse (`:146`). Exports include `addSupplement`, `takeSupplement`, `removeSupplement`, `updateSupplement`, `logExercise`, `supplementStatus`, `workoutStatus`.

**Inside the app**, `DashboardView.swift:66` owns `HealthLog()`, `:290` calls `health.start()`, and `:230` calls `health.recordWearable(week.readingsByDay)`, which back-fills all 7 days.

**Race numbers.**
- `HealthLog.swift:326-328`: with the lock removed the store kept 284 of its 908 writes; with the lock it kept 671 of 671.
- `health.ts:28-31`, unlocked: 1965 of 5725 lost (34%), ranging 27–38% over three runs.
- `health.ts:28-31`, locked: 0 of 2187 and 0 of 4062 lost, nothing refused. Node cycles about 5x faster, so it is the UI edits that lose.

`run-race-test.sh` runs an unlocked round and then a locked round, by default 4 s each and bounded by time. It exits 1 if the locked round lost anything ("Do not deploy"). It reports refused writes separately.

## 3. JournalStore

**Path.** `~/.openclaw/orion-controlled/health-journal.json`, overridden by `ORION_HEALTH_JOURNAL` (`JournalStore.swift:58-67`). The file is `JournalFile{entries, updatedAt?}`.

**Stored entry** (`StoredJournalEntry`, `:31-42`). The five manifest fields are `eventType`, `time` (ISO-8601 UTC, GMT formatter `:69-74`), `source`, `confidence`, `notes`. The store adds `id` (`"j-"` plus 8 lowercase UUID characters, `:189`), `originalText` and `recordedAt`.

The enums are in MobileCore `HealthJournal.swift`:
- event types: caffeine, alcohol, exercise, meal, stress, unwell (`illness` is a forbidden clinical word), travel, screen, social, note
- source: extracted, correction, inferred
- confidence: low, medium, high

**Writing.** `add` calls `JournalExtractor.extract` and appends the entry. It sets `pendingClarification` if the extractor raised a question. `correct(id:)` goes through `JournalEvent.correcting`, which forces `source = .correction` and `confidence = .high` and keeps `id` and `originalText`. It removes the old row by id and appends the corrected one (`:132-146`). The result is a replacement, not a second row.

The write runs under `FileLock.withLock` and re-reads inside it. It writes `<file>.tmp` (a fixed name, unlike HealthLog's UUID scratch name) and then calls `replaceItemAt` (`:166-178`). If the file cannot be read, `load()` sets `lastError` and does not reset to empty (`:84-91`). Rows that fail to decode are dropped silently by `compactMap` (`:92`).

**Callers** (from grep): `HealthTab.swift:20` owns `@StateObject JournalStore()`. `HealthSectionsView.swift:136` calls `journal.add`. Nothing in `Sources`, `plugin/src` or `scripts` calls `correct(id:)` or touches `health-journal.json`. Only the harness calls `correct`.

## 4. HealthSections, PlanningSignal, firewall

**The seven sections** (`HealthSection.allCases`, MobileCore) are today, sleep, recovery, activity, energy, trends and journal (`HealthSectionsModel.swift:127-137`). Every builder falls back to a `happened`-only observation, so all seven always render. Each section reads:
- **Today**: lists which WHOOP parts are available (recovery, sleep, strain). Its confidence uses the minimum sample count among those parts.
- **Sleep**: "WHOOP reports XhYY in bed" and "performance N%".
- **Recovery**: "N%".
- **Activity**: strain to one decimal.
- **Energy**: logged calories and bottles. Source is `.manual`, confidence always low.
- **Trends**: count of time-in-bed readings, capped at 14.
- **Journal**: count of today's entries.

**Confidence rules** (`:90-95`, `:228-232`):
- A section is `.low` unless `readingAgeHours` is finite, at least 0 and at most 24 (inclusive).
- Otherwise confidence comes from `seriesConfidence(count)`, which reuses `PlanningSignal.derive`: under 7 is low, 7 to 20 moderate, 21 or more high.
- Sample counts are per measurement (`HealthTab.swift:104-106`).

MobileCore `SectionNarrative` (`HealthSections.swift:106-200`) enforces three more rules:
- It refuses `likelyMeans` or `consider` at low confidence.
- It refuses clinical vocabulary.
- `figureBudget = 3` figures per text. A decimal, colon or comma joins digits into one figure.

`HealthTrend.maximumPoints` is 14. `direction` needs at least 4 points and permission to interpret; it compares the recent half with the older half and calls a change above ±5% improving or declining (`HealthSectionsModel.swift:260-274`). Series are newest-first, converted by `newestFirst` (`:280`).

**What stays local and what reaches a model:**
- The sections and tiles show raw numbers. That is allowed by the comment at `:14-19`.
- The **Health rail** model call is `HealthFacts.prompt()` (`HealthSummary.swift:65-78`). It sends only source availability with record dates, plus manual log counts (bottles, sets, calories, supplements x of y). It asks for `{"highlight": id|"none"}`. It goes through `writer.load(key:, style: .selectionJSON)` (`HealthTab.swift:486-489`). The model response can only reorder app-written rows (`takeaways(selection:)`, `:90-95`).
- The brief's health highlights (`BriefHealth.swift:16-31`) carry only `recoveryWord` and record dates.
- `BriefFacts.readings` carries raw recovery, sleep, HRV delta and resting heart rate. `MorningBriefView.swift:91-140` renders them, but a test asserts they do not change the prompt (see section 9).

**`PlanningSignal.derive` thresholds** (`PlanningSignal.swift:154-201`):
- Recovery at 67 or above is good / high capacity; 34 to 66 is moderate / moderate; under 34 is limited / low. Cognitive capacity is just a copy of recovery.
- Sleep performance at 85 or above is aboveBaseline; 70 or above atBaseline; 55 or above belowBaseline; otherwise wellBelow.
- If there is no performance score, sleep hours decide: 7 or more is atBaseline (never above), 6 or more belowBaseline, otherwise wellBelow.
- Strain at 14 or above is heavy / building; 8 or above steady / steady; otherwise light / easing.
- Confidence: sampleCount 21 or more is high, 7 or more moderate, otherwise low.
- Freshness: up to 6 h is current, up to 24 h today, up to 48 h stale, beyond that veryStale. Missing, NaN or negative is unknown.
- `reason` (`:205-220`) gives number-free sentences. With no reading it says "no health readings yet"; at low confidence it says "not enough history yet…". Otherwise the (sleep, recovery) pair picks one of four sentences.

`StrainPosition` (`:228-250`) turns strain against a band into under, inBand, over or nothingLogged.

**`promptLines()` (`:119-131`) is not called by any production code.** The grep hits are only `Tests/HealthFirewallHarness/main.swift:64,88-98`, `Tests/TodayPlanAppTests/BriefNarrativeTests.swift:131`, and a symbol in `.build` dSYM. `derive` is called from `DashboardView.swift:446`, `BriefHealth.swift:19` and `HealthSectionsModel.swift:229`. `MorningBrief.swift:62` uses `signal.hasAnything` to decide whether the readings row appears. `StrainPosition` has no caller in production (inferred from grep).

**What the Phase 33 firewall harness asserts** (`HealthFirewallHarness/main.swift`). It compiles the real `PlanningSignal.swift` together with a `StrainTarget` stub. It runs five readings, three of them adversarial, through `derive(sampleCount: 38, readingAgeHours: 3)`. It extracts every number from `promptLines()` and fails if any number is within ±1 of recovery, sleep score, sleep hours, HRV, resting heart rate or strain. It also checks:
- A good and a poor day produce different, non-empty prompt lines.
- 3 samples gives low confidence, and 96 h gives veryStale ("several days old").
- `cognitiveCapacityWord` maps to elevated, reduced or unknown.

The harness tests a function the live prompt path no longer uses (inferred). The live boundary is covered by `HealthSummaryTests` and `BriefNarrativeTests`.

## 5. MorningScreen, MorningBriefView, BriefClock

**MorningScreen** is not triggered by wake detection inside the app.
- `scripts/orion-morning signal unplugged|used|up` receives phone wake signals (charger off, Screen Time use, ORION opened).
- It applies `shouldBrief`/`alarmClock` from `scripts/lib/reach/morning.mjs`: after or just before the alarm, before 1 PM, once a morning, with state in `morning-sent.json`.
- It writes `~/.openclaw/orion-controlled/morning-view.json` and runs `/usr/bin/open -g orion://morning-screen` (`scripts/orion-morning:98-99`).
- `AppDelegate.swift:181-182` handles the URL; a `?close` query dismisses the screen.

`MorningView` decodes greeting, date, events (title/start/half/end/kind), leaveBy, due, top, and weather (now/high/low/symbol/hours/sky/rain/wet) (`MorningScreen.swift:16-35`).

`show()` steps:
- Calls `IOPMAssertionDeclareUserActivity` and takes a `PreventUserIdleDisplaySleep` assertion (`:104-111`).
- Sets brightness to 1.0 through private DisplayServices via `dlopen`/`dlsym`, restoring it on dismiss (`:117-150`).
- Shows a borderless `.screenSaver`-level panel with a frosted effect view.
- Escape (keyCode 53), a click, or a 30-minute timer dismisses it (`:83-85`).
- It cannot unlock the Mac.

The layout puts the day on the left at 56% width (up to 5 events, "Leave by", up to 4 due/top items) and weather on the right.

**NightMarkers** is separate from the morning screen. It reads `~/.openclaw/orion-controlled/night.json`, shaped as `days[{date, wake, bed, woke, asleepAt}]` in minutes after midnight, written by orion-watch from `scripts/lib/life/night.mjs`. It is for day-view lines. An `asleepAt` of 1440 or more on the previous day becomes `fellAsleep` on this day (`NightMarkers.swift:34-50`).

**MorningBriefView (in-app brief).** `BriefPresentation` is stored in UserDefaults under `orion.brief.state.<logicalDayKey>`. With no stored value it is `.full` if `OrionDay.isFirstSession`, otherwise `.parked` (`MorningBriefView.swift:21-36`). "Start the day" parks it. First session means no `noteSession` since the logical day began; app launch does not count.

**BriefClock** (`BriefClock.swift:23-38`) uses the civil calendar.

| Hour | greeting | salutation |
|---|---|---|
| 0–3 | "Up late" | "Here's the day ahead" |
| 4–11 | "Good morning" | "Good morning" |
| 12–17 | "Good afternoon" | "Here's where the day stands" |
| 18–23 | "Good evening" | "Here's what's left of today" |

The calendar dateKey is the civil date. Activity logs keep the separate 4 am logical day (`:4-5`, `OrionDay.cutoffHour = 4`, with a wake time valid for up to 26 h). Other checks:
- `readingIsFresh`: age between −30 s and 600 s.
- `calendarReadingIsCurrent`: also requires the same time zone and a loaded interval covering the whole civil day.
- `needsSourceRefresh`: dateKey or time zone changed.
- Date-only tasks are due at the end of that day.

`recordLabel` is in `BriefNarrative.swift:56` and formats as `"<subject> d MMM yyyy at HH:mm"`. It returns "unknown" for a future or nil date.

## 6. Finance

**`Money`** (`PlaidModels.swift:100-246`):
- **Sign convention:** Plaid `amount` is positive when money leaves the account (`isSpending`: amount > 0; `isIncome`: amount < 0).
- `isLiability`: account type `credit` or `loan`.
- `netWorth`: assets minus liabilities.
- `isTransfer`: category contains TRANSFER or LOAN_PAYMENTS. Transfers are excluded from spending, income, categories and daily spend.
- `byCategory`: top 6 by default, 4 for the prompt.
- `dailySpend(days: 30)` in the tab: zero-filled, oldest first.
- `format`: no cents once the absolute value is 100 or more.

**Recurring detector** (`:205-234`):
- Group by lowercased merchant/name.
- At least 3 occurrences.
- Median above 0.5.
- Every amount within 12% of the median.
- Every gap between 24 and 36 days.
- Sorted by amount, top 8.
- The tab shows the sum as "/mo".

`PlaidItem` stores `accessToken` per institution (`:26-32`). I did not check where it is persisted (outside scope: `PlaidClient`).

**Narrative.**
- `FinanceTab.loadSummary` (`FinanceTab.swift:319-333`) builds `FinanceFacts` (month start, top 4 categories, recurring total and count). It calls `writer.load(key: facts.narrativeKey, style: .lines)`.
- `NarrativeWriter` (default closure at `NarrativeWriter.swift:54`) calls `LocalModel.complete`, an HTTP POST to `http://127.0.0.1:11434/api/generate` (Ollama-style) with temperature 0.4, `num_predict` 1600 and a 90 s timeout (`LocalModel.swift:88-113`).
- The prompt contains formatted dollar figures (`FinanceSummary.swift:44-89`). It asks for 3–4 lines of "LABEL — one sentence.", under 18 words each, no new numbers and no generic advice.
- The output goes through the permissive `Takeaway.parse` (separators — – : |, label 22 characters or fewer). If parsing finds nothing, the raw text is shown (`FinanceTab.swift:288-305`).
- `narrativeKey` is `NarrativeKey.make("finance.<day>", facts: prompt)`.
- `.onAppear` calls `plaid.refresh()` (a network call through PlaidClient).

## 7. I/O inventory

**Files read or written:**
- `~/.openclaw/orion-controlled/health-log.json`: read and written, plus `.lock` and `.health-log.<UUID>.tmp` (`HealthLog.swift:203-213,344,409`).
- `~/.openclaw/orion-controlled/health-journal.json`: read and written, plus `.lock` and `.json.tmp` (`JournalStore.swift:58-67,166,175`).
- `~/.openclaw/orion-controlled/night.json`: read (`NightMarkers.swift:28-30`).
- `~/.openclaw/orion-controlled/morning-view.json`: read (`MorningScreen.swift:31-34`).

**UserDefaults:**
- `orion.brief.state.<day>` (`MorningBriefView.swift:21`).
- `orion.narrative.*` prefix (`NarrativeWriter.swift` defaultsPrefix).
- `orion.day.lastWakeAt` and `orion.day.lastSessionAt` (`OrionDay.swift:58-59`, used indirectly).

**Env vars:** `ORION_HEALTH_LOG` (`HealthLog.swift:204`), `ORION_HEALTH_JOURNAL` (`JournalStore.swift:59`). `ORION_CONTROLLED_DIR` exists only in `scripts/orion-morning`.

**Network and other system calls:**
- `LocalModel`: localhost:11434, via NarrativeWriter, from HealthTab and FinanceTab.
- `plaid.refresh()` (`FinanceTab.swift:37`).
- MorningScreen: IOKit assertions, `dlopen` of DisplayServices, `OrionLog.write`.
- No `Process` calls in these files. POSIX `rename`/`open` in HealthLog and FileLock.

## 8. History

- **HealthLog:** 93e9a42 2026-08-20 checkpoint; 694b762 08-11 Gate 10 day score; 8d72467 08-11 SessionService target + shared FileLock; b35a731 08-11 fix health-log lost updates; 4c3bee9 08-07 day starts when you wake; 0b2049b 08-06 real supplements/workouts/Whoop/Plaid.
- **HealthTab:** 882681a 09-14 ground summaries in validated facts; 7fdba72 09-14 fix source availability / unsupported interpretations; 53cd339 09-01 phase-35 journal; 8caec71 09-01 phase-34 seven sections; 7c69a47 09-01 phase-33 firewall; 93e9a42 08-20.
- **HealthSectionsModel:** 7fdba72 09-14; 8caec71 09-01.
- **PlanningSignal:** dfcaee2 09-12 ground brief wording in verified facts; 7c69a47 09-01.
- **JournalStore:** 53cd339 09-01.
- **MorningScreen:** 188afeb 10-08 one wake alarm, clearer weather; 98a810c and 27242e0 10-08 morning screen.

## 9. Gotchas and what each test proves

**Gotchas:**
- **Day-key mismatch (inferred):** the plugin's `today()` uses civil midnight (`health.ts:125-131`), but Swift `HealthLog.today` uses the logical day (4 am / wake). A voice "took X" at 1 am probably lands on the next civil day while the UI ticks under the logical day.
- **Stale path:** the `health.ts:37` comment points to `native/Orion/Sources/Orion/FileLock.swift`. The file is actually `Sources/SessionService/FileLock.swift`.
- **Lock name is the contract:** Swift `<path>.lock` and node `${file}.lock` must match, or neither excludes the other.
- **JournalStore scratch name:** it uses a fixed `.tmp` name and `replaceItemAt`, which `HealthLog.publish` warns against. It is safe only while the journal has a single writer.
- **Dates:** `startedAt` is an ISO string because Swift `Date` decoding would silently fail on files the plugin wrote (`HealthLog.swift:73-81`).
- **Two orderings:** `WhoopWeek.points` is oldest-first; the section series are newest-first. Swapping them inverts every trend.
- **Missing readings:** wearable nils never overwrite a stored value, and `recordWearable` skips writes that change nothing (`:119-135`, `:599-616`).
- **Cognitive capacity:** it is just recovery for now (`PlanningSignal.swift:166-169`).
- **Main-thread blocking:** HealthLog writes block the main thread, at most 6 s (`giveUpAfter`).
- **Raw numbers on screen are intended:** HealthTab and MorningBriefView show raw figures on purpose. Do not strip them.

**Tests:**
- **HealthFirewall:** checks that no raw value (±1) appears in `promptLines()`, that good and poor days give different lines, and the confidence/freshness and capacity-word mappings.
- **HealthSections:** checks:
  - there are always 7 sections in manifest order with sources;
  - no inference or advice at any confidence in the current builders;
  - low confidence when readings are thin or older than 24 h, with 24 h inclusive;
  - per-measurement sample counts;
  - no "0" for a missing reading;
  - clinical words and the figure budget are refused;
  - the owner still sees "71" and "7h30";
  - `hours()` and `oneDecimal` edge cases (NaN, infinity, 6.999 → "7h");
  - trend cap at 14, ±5% direction, `newestFirst`.
- **JournalStore:** checks:
  - the env override works and data survives a round trip to disk;
  - a correction replaces the row, keeps the id and `originalText`, and sets source to correction at high confidence;
  - correcting an unknown id returns nil;
  - an unreadable file sets `lastError` and is not treated as empty;
  - per-day counts;
  - ids are unique, `j-` prefixed and lowercase.
- **Race:** checks that the real HealthLog and the real `dist/health.js` lose 0 updates when locked, against an unlocked baseline.
- **BriefClockTests:** checks civil and activity day separation (03:21 is "Up late" / "Here's the day ahead"; 04:00 is "Good morning"), date-only due dates, time-zone refresh, and whole-day calendar coverage.
- **BriefModelBoundaryTests:** checks the `.selectionJSON` path, that bad output cannot be repaired into a valid selection, and that a stale selection is rejected and an empty response never falls back to "thinking" output.
- **BriefNarrativeTests:**
  - The test at `:136` shows raw `BriefFacts.readings` do not change the prompt.
  - Recovery 48 and 49 give the same prompt; 85 gives a different one.
  - Source titles cannot close their quotation or reverse the text direction.
  - A fetch time cannot make old sleep data look current.
- **HealthSummaryTests:**
  - The test at `:38` checks no raw value appears in the rail prompt and that high and low scores give identical prompts.
  - Manual logs respect the activity day.
  - A removed supplement does not count.
  - Hostile or malformed model output falls back to the facts.
  - A valid choice changes emphasis, not wording.