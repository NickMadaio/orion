## 2026-10-02 — Orb-first middle-ground hologram (Codex)

- User found the literal original shell still overwhelmed Thinking Orbs. Hybrid now makes the orb the main foreground shape in every state (scale0.95 idle/1 thinking, intensity0.90/1). Idle dot size raised so the breathing geometry stays readable; thinking remains gold and prominent.
- Original geometry becomes a light outer scaffold: shell radius enlarged, radial filaments shortened to an edge band and sampled at stride4, filament intensity25%, arcs/chips/motes32%, great circles45%. Core/flare/ambient bloom22%. Original-only renderer is unchanged. Retains actual original depth, shell and audio response without the old starburst. Single Canvas and batching preserved; fewer particles should reduce work further.
- Native debug/source and signed release builds pass. Installed Mac **build491**, deep/strict signature verified with unchanged171a72ab designated requirement and embedded Link present. Prior489 backup: `/Applications/.Orion-previous-489-orb-balance.app`. Real Home screenshot confirms the bright dotted breathing orb stands out, with the old shell reduced to a lighter outer halo and short edge accents; no dense central starburst. Thinking foreground branch retained, now with the same subdued backdrop. Source/history scan recorded under `.builds/orb-balance/secrets.log`. Other session's evaluation artifacts preserved.

## 2026-10-02 — Gold thinking with prominent orb geometry (Codex)

- Thinking Orion stays gold while thinking. Hybrid shell tint no longer targets purple; the shared orb painter uses the gold palette for solving/searching/weaving. Original Orion retains its legacy state colours.
- While thinking, the solving orb draws in front of the filament shell, with scale0.95 instead of0.78, full intensity instead of0.65 and larger points. Its twisting-band motion now signals thinking. Slow45% motion, the single Canvas, batched particles and audio response remain.
- Native debug/source and signed release builds pass. Installed Mac **build489**, deep/strict signature verified with unchanged171a72ab designated requirement and embedded Link present. Prior487 backup: `/Applications/.Orion-previous-487-gold-thinking.app`. Live harmless solar-panel question entered thinking; Back to Home exposed the primary hologram, visibly gold with larger foreground dots while the THINKING indicator remained active. Source/history secret scan clean (10961 reviewed fixtures). No inference/voice/scheduling settings changed; other session’s evaluation artifacts preserved.

## 2026-10-02 — Combined hologram lag repair (Codex)

- User reported severe lag after the literal hybrid. Profile showed SwiftUI Canvas/display-list work; an eight-second visible-Home sample measured Orion20.5% of one CPU and WindowServer40.5%. The hybrid had two animated canvases plus opacity/additive compositing and a full-size blur, while the original shell emitted individual strokes for1500 filaments.
- Replaced the stacked views with one Canvas. The shared orb renderer exposes a direct drawing API, inserted between the original back/core/front depth passes. Removed the extra orb shadow/offscreen layer; the original core/bloom still provides projected light. Batched hybrid filaments into108 colour/width/alpha paths per depth pass and orb dots into16 alpha paths. Geometry, audio deformation, 45% speed and visual alternatives remain. Original uses its unchanged per-element painter.
- Swift247 tests pass. Installed signed Mac **build487**, deep/strict signature and exact171a72ab designated requirement verified; embedded Link present. Previous485 backup: `/Applications/.Orion-previous-485-hologram-performance.app`. Actual Home screenshot confirms dense original shell/core plus orb geometry retained. Eight-second steady-Home samples: Orion20.5%→16.5% of one CPU, WindowServer40.5%→14.2%. First post-install sample overlapped an unrelated Ollama workload and is retained separately (Orion17.7%, WindowServer92.1%); repeat after it ended avoids that confound. These are local CPU measurements, not an FPS guarantee or isolated GPU benchmark. Source/history secret scan clean (10901 reviewed fixtures). No voice/scheduling changes; other session's schedule-eval files are preserved.

## 2026-10-02 — Slower combined hologram and voice-only speech (Codex)

- Thinking Orion now literally renders the original HologramModel shell (filaments, latitude arcs, chips, back/front depth passes, hot core, lens streak and audio deformation) together with Thinking Orbs geometry across the same volume. Both motion clocks run at45% speed; waveform attack/decay remains real-time. Finer orb points leave the original geometry visible. Intentional30fps rendering now uses the matching adaptive-quality budget rather than treating30fps as a performance failure. Original and Black Hole remain separate options.
- Pending chat turns read actual saved session thinking once per second with turn-generation gating, falling back to honest progress when no model thinking is available. Returned thinking is visible rather than hidden inside a collapsed disclosure. No thinking/provider setting was changed.
- Reply origin is captured per request: only physical voice turns may invoke SpeechOutput. Typed quick answers, gateway replies and typed resume stay silent. Reminders and focus/session effects remain visible and no longer summon/speak; queued timer speech removed. Typed thinking cannot open the speech barge-in monitor from ambient sound. Legacy orion-focus now writes feedback in text instead of /usr/bin/say.
- Orion Swift247/247 passed; shared phone views also compile in the iOS simulator. Installed signed Mac **build485**, exact designated requirement matches the prior171a72ab identity and deep/strict verification passes. Previous483 is backed up at `/Applications/.Orion-previous-483-orb-voice.app`. Actual UI shows the dense gold combined shell/core; a typed clock question returned its answer with no SpeechOutput start in the fresh app log. The user returned to Home during verification, so further chat UI actions were not pursued. Physical wake-word/PTT speech and live model reasoning were not exercised; their route compiles and only one gated SpeechOutput call remains. Remote scripts reinstalled; focus script source/installed copies match. Node syntax check and source/history secret scan clean (10841 reviewed fixtures). Other session’s schedule evaluation files are preserved.

## 2026-10-02 15:34 BST — Early exit, scheduling memory, notification isolation and Thinking Orion (Codex)

- Replaced Mac/phone early choices with one compact **I'm out early** button. Removed Already home and its command. Infer current class/task only, not a class that ended earlier. Class clipping now persists the occurrence end in the undoable calendar transaction; it previously existed only in planner memory. Final-class exit preserves saved commute45 plus transition5; another later class keeps campus time. Regression covers real fake-bridge writes and exact undo.
- Created tracked/live **SCHEDULING.md**, read/injected into Mac and remote planning turns, with to-do planning, buffer5, commute45, nap75, side-project60, campus and check-in rules. Saved only these explicit values in live life-config, preserving ready105; native planning reads shared transition/commute/minimum values. Native planning adds travel commitments. Combined `day --todos --plan …` now actually supports named plans and prioritizes them over optional backlog. Fixed agenda's evaluation reads to use the sandbox instead of Nick's real calendar/reminders.
- Found confusing live notifications came from two test-generated check-ins (still in the lab / eat and take a break). Backed up state and cancelled those specific records. Evaluation check-ins now use isolated storage, skip history writes and return no live alerts; evaluation cleanup resets that store. Watcher pauses during evaluation. Classes get one reminder in the ten-minute lead window, labelled Devon House for Macro/Marketing and Portsoken for DS/CS. During-class start nags are suppressed; class loops never demand Started/Done. Expired timers no longer claim he ate or finished. Latest phone coordinate signal was stale; campus attendance is not asserted from that evidence.
- Replaced the small overlay with a full-size **Thinking Orion** gold/purple state-responsive vector hologram, using upstream semantic geometry, orbital shell, audio reactivity, brightness and reduced-motion support. Current Original renderer is restored without the overlay; Original and Black Hole remain options. The selected design applies to Home and summon; phone uses the shared new renderer.
- Validation so far: full Node 963/963, targeted scheduling/notification/early checks and native Orion247 + Mobile25 tests pass; iOS simulator build passes after correcting scheme to OrionPhone. Live isolated Haiku whole-day request initially still omitted tasks; after repairing combined syntax/guidance and sandbox reads it passes with research and resume scheduled after commute and named food/club present. One scenario is integration proof, not universal planner-quality proof. Source/history scan clean. Installed/deployment proof follows.
- Deployment complete: installed signed Mac **build 483**, deep/strict codesign verified with the same designated requirement. Real UI selected Thinking Orion, confirmed full-size gold orbital geometry on Home and Original/Black Hole choices, verified the single compact early-exit button in Plan, then returned to Home. No real class was shortened during UI verification. Previous build backup: `/Applications/.Orion-previous-481-early-memory-orb.app`. Remote scripts installed with fingerprint **78008a7e411c**, launchd running; scheduling memory synced. Final added early-exit regressions pass19/19 after the full963 Node suite, covering exact45-minute return travel plus5-minute transitions.
- Phone: simulator and signed generic-device Release builds succeeded; strict signature verified. Physical iPhone was unavailable, so this new phone build was **not installed** and physical-phone behavior remains unverified, respecting the request to focus on Mac.
- Backups/private evidence: `.builds/early-memory-orb-2026-10-02/` contains checkins/life-config/USER backups, test logs and isolated live regression traces. Do not restore old check-in state and reactivate the cancelled synthetic alerts. Other session's Qwen-medium schedule-eval files remain untouched.

## 2026-10-02 14:26 BST — Model usage and later conversation benchmark (Codex)

- Added read-only `orion-usage`: retained current/archive usage, exact-entry deduplication, London calendar windows, model/day/inferred-lane breakdowns, separate recorded and current-rate equivalent costs, unpriced cloud coverage, current budgets and explicit accounting limits. Corrected the legacy budget command's unsupported zero-cost/subscription assertion. Pricing is a separate documented snapshot; no provider configuration or budget values changed.
- Mac Settings gains **Model usage**, date filters and Refresh. It reads installed local metadata without inference or credentials. Private actual-usage and scheduling review reports live in the current Codex task outputs, not in Git.
- `orion-conversation-bench` defaults to dry run; 12 calibration cases and local 3B/9B/27B plus hosted Haiku/Sonnet candidates. Serial, seeded repeated short/long-context trials record latency, load/generation statistics, tokens, errors, objective checks and explicit pending human review. Tools never execute. Guide requires expanded held-out data, blind review, cold/warm controls and gateway validation. TTFT is intentionally unavailable until a streaming adapter is added. No model inference benchmark ran for this setup.
- Scheduling review found the actual 13:32 BST Mac request read only calendar, then booked food/club via day --plan; no to-do read. Active override is only readyMinutes:105; defaults are buffer10/commute30, differing from Nick's buffer5/commute45. Nap75 exists episodically but not as an enforced minimum. Native/Node planners use separate preferences and commute walls have no en-route task representation. Personal rules/calendar were not edited; review and live files opened for Nick.
- Validation: new aggregation/routing regressions 3/3; full Node 960/961 with one existing supervisor grace-window JSON race, then isolated agentic-halts 5/5; Orion Swift 247/247, debug/release build and embedded Link helper successful. Source/history secret scan clean (10,691 reviewed fixtures allowlisted). Remote scripts installed and live CLI verified; installer fingerprint covers unchanged remote entry points, so the new script was additionally invoked directly.
- Installed signed Mac **build 481**, deep/strict signature passes and exact designated requirement matches previous 171a72ab leaf. Actual Settings UI shows 30-day and All retained reports; all-history totals match CLI (2,281 calls, 54,296,696 tokens, $7.1418 recorded, 1,470 unpriced cloud calls). No model call was needed to verify the view. Backup: `.builds/model-usage-2026-10-02/Orion-before.app` and `/Applications/.Orion-previous-479-model-usage.app`. Revert feature commit and restore backup for rollback; no personal rule changes need undoing.
- Preserve the other session's uncommitted schedule-eval SUMMARY and Qwen-medium results.

## 2026-10-02 12:25 BST — Compact planning composer; Tasks renamed Plan (Codex)

- `8dd68c4` replaces the embedded sidebar/thread/model-picker chat in Tasks with a small Home-style text box, waveform and send button. No fixed 280-point chat region. It grows only to three input lines; after sending it shows a two-line reply preview or Thinking, with **Open chat** for the retained full Home conversation.
- The visible tab is **Plan**, reflecting calendar and daily planning as well as to-dos. Existing tasks/plan/calendar routing and persisted tab identity are preserved; the to-do section still correctly says Tasks.
- Signed release and embedded Link helper build passed. Installed Mac **build 479** passes deep/strict codesign verification and exactly matches the prior 171a72ab designated requirement. Phone/scripts/gateway settings were untouched.
- **Live UI:** Plan shows a single compact composer with no chat sidebar. Sent a harmless clock question, received its brief answer while staying on Plan, opened the full chat, and used Back to Home. Returned to Plan and left the app showing the clean composer. Release build plus actual input/send/navigation verification cover this reversible presentation change; no new mirrored implementation test was added.
- **Rollback:** prior signed build 477 is `/Applications/.Orion-previous-477-compact-plan.app` and `.builds/compact-plan-2026-10-02/Orion-before.app`. Quit Orion/ORION Link, restore and relaunch; revert the feature commit for source rollback. Source and history secret scans are recorded under `.builds/compact-plan-*`.

## 2026-10-02 11:23 BST — Return from chat to the main Home view (Codex)

- `499f02e` adds an explicit **Back to Home** control at the top left of Home chat. It exits chat mode and parks the morning brief, restoring the original hologram, app shortcuts and main composer. The active conversation, selected model and draft are retained.
- Signed Mac release build **477** and its embedded Link helper succeed; deep/strict signature verifies and the designated requirement exactly matches the installed 171a72ab identity. Installed and relaunched `/Applications/Orion.app`.
- **UI proof:** opened retained chat from planning, selected Home, verified Back to Home is present, and clicked it. The installed app restored QUICK OPEN, app shortcuts, TODAY'S BRIEF and the “What do you need?” composer. No new test was added for this reversible presentation change; the release build and real button interaction verify it.
- **Rollback:** prior signed build 475 is `/Applications/.Orion-previous-475-home-return.app` and `.builds/home-return-2026-10-02/Orion-before.app`. Quit Orion/ORION Link, restore that bundle and relaunch; revert the feature commit for source rollback. No scripts, gateway/provider settings or phone app changed in this follow-up.

## 2026-10-02 11:20 BST — Schedule repairs and live Mac surfaces wired (Codex)

- **Schedule:** `0a0aa7e` persists explicit calendar IDs per date in pins.json (eval-pins.json in the sandbox), restores pins through undo, reuses an existing replacement task, applies standing minimums to today's future blocks, and implements signed `move --by`. Still-doing guidance uses extend. The final calendar writer compares against the original day so shrink-to-fit writes all cascaded moves; dinner floors and sequential additions keep sensible order. Regression coverage includes relative shifts, existing rename, minimums, pins, undo, shrink cascades and morning sequence. Calendar unit tests now isolate pin files as well as undo history.
- **Evaluation:** minute-resolution session/envelope IDs caused immediate no-reply exit 1 when a scenario was rerun in the same minute: the inbound replay guard rejected it before inference. Millisecond IDs and separate eval replay/rate state fix that. The grader now accepts a displaced task only when the reply names it and asks a decision; real overlap, duplicate, silent-loss, required length/order and transport checks remain. Six combined/day-quality scenarios supplement the 16 core cases. Latest Sonnet 5 medium: **15/16 core, 21/22 total, median 9.5 s**; preceding full run: 16/16, 20/22, 9 s. Haiku 4.5 medium full run: **16/16 core, 20/22 total, median 13 s**; updated six-case stress rerun 5/6, median 12 s. Qwen 3.5 9B off: **8/16 core, 10/22 total, median 34 s**. Exact results and changed fixture boundaries are retained under `docs/evals/2026-10-02-schedule/`; do not combine reruns into a fictitious single trial.
- **Recommendation:** Sonnet medium for complex schedule edits, Haiku for quicker API work; Qwen 9B has not passed the scheduling gate. Current OpenClaw's native Ollama adapter forwards thinking levels and streams real reasoning deltas for reasoning-capable catalog entries; non-reasoning entries expose off only. This run evaluated Qwen with off. Provider settings in openclaw.json and the gateway were not changed/restarted. Phone with Mac off remains Apple's on-device fallback; no independent phone API transport was added.
- **Mac surfaces:** `ff0ec35` links OrionViews into Orion; Home switches into shared chat on send and parks the orb top-right; planning uses the same history. Conversation sidebar, rename/delete and model selection connect to the coordinated ChatStore and stable gateway session. Floating SummonComposer sends through submitTyped, closes/mutes, grows to four lines, and retains nonactivating/no-appearance-focus rules. Main window moves/resizes, saves/restores its frame, fits visibleFrame initially and recovers after screen changes. ThinkingOrb phase mapping blends into the shell. Actual assistant thinking is stored after answers; the tested lowercase session lookup fixes UUID normalization. Sending/model switching is disabled during a pending chat answer.
- **Voice:** DeepgramSpeech uses Flux v2 with FluxConfig/FluxTurnTracker. EndOfTurn delivers the hands-free/held-key turn; AdaptiveEndpointModel remains for Apple fallback, not Flux. STT seed and controlled runtime role are deepgram/flux-general-en. No provider configuration or native self-development authority boundary was weakened.
- **Finished early / focus:** Mac buttons and CloudKit actions call reschedule early with check context. Live Activity Done follows WidgetSender's existing record path to early block, then closes the check-in. ScheduleFocusWatcher samples foreground app/title and idle time; installed orion-ontask-watch applies the escalation ladder and named phone-list policy. Direct argv execution fixes spaced app names. Intrusive Mac actions retain the existing enforcement switch. Phone selection migration, per-list warning at 10 min/block at 15, limits, grace/expiry and bounded coarse usage are wired; stale usage is not reused for a new restriction. The focus tools are in runtime AGENTS and the explicit execution allowlist.
- **Validation:** full Node **958/958**; Swift MobileCore **25**, Orion **247**, LinkCore **29** (301 total), all passing. Signed Mac release plus embedded signed Link helper, iPhone simulator and signed device builds succeed. Tree secret scan clean (30 reviewed fixtures allowlisted); history scan recorded separately. Installed scripts fingerprint **53a64aaa1ceb** matches repo and integrity is unchanged; launchd loaded/running. Workspace sync confirms tracked instructions are live.
- **Installed proof:** `/Applications/Orion.app` **1.2.0 build 475**, deep/strict signature verified and exact designated requirement matches prior app's leaf 171a72ab. Mac/embedded Link relaunched; Link reports Connected without a problem. Real Mac UI: planning/Home chat, selected Haiku answer (37×29=1073), retained chat after relaunch, final answer (41×23=943) and expanded genuine Thinking all verified. Resizing changed saved frame from 1728×1084 to 1513×940. Completed surfaces run remains 14/14, 100%, final review passed; its accepted tasks were not reclassified or replayed by this integration work.
- **Phone boundary:** signed build installed and launched on physical iPhone 00008140-00013C1C213A801C. Before Nick asked to stop phone checks, mirroring showed Mac's clock exchange in phone history, visible Chats/Model menus after correcting hidden navigation chrome, and the surfaces run as Complete, 100%, 14/14. No phone finished-early/Live Activity tap, Screen Time threshold enforcement or phone reasoning disclosure was verified. At Nick's direction further checks focus on Mac. Phone install evidence is in `.builds/phone-wiring-install-ui.log`.
- **Not yet proven:** live spoken Flux socket/audio round trip; floating-panel caret preservation and all composer controls in an interactive session; physical monitor-disconnect recovery; real schedule-driven focus restrictions/warnings; finished-early/Live Activity mutation on real calendar. Native builds/unit tests and source routing support these, but do not substitute for those live checks. No QA calendar edits were applied to Nick's real day.
- **Rollback:** revert the feature commits rather than reset published history. Quit Orion and ORION Link, restore `/Applications/.Orion-previous-471-surfaces-wiring.app` to `/Applications/Orion.app`, and relaunch. Identical prior bundle is `.builds/surfaces-wiring-2026-10-02/Orion-before.app`. Reinstall remote scripts and reapply workspace sync after source reverts. Restore the previous STT role deepgram/nova-3 in controlled model-roles.json if rolling back Flux; provider settings were untouched. The prior completed project run state needs no rollback and must not be replaced while a supervisor is active.

## 2026-10-02 02:45 BST — Qwen surfaces escalation repaired; run completed (Codex)

- **Found:** latest run “ORION surfaces” (`project-ac531385-b605-4b4a-a2dc-296d14bef7a0`, branch `orion-agent/12c3eb5b`) stopped at 54%, with seven accepted tasks, three blocked and four queued. Its Flux repair EDIT matched two places; the runtime called that a judgement refusal. Phone tasks also hit an out-of-scope widget build diagnostic and unfinished Swift code. The watchdog repeatedly counted the already parked Flux blocker while other tasks ran, causing a false run-level escalation.
- **Runtime fixes:** `d2f7745` routes wholly rejected repair edits into the existing bounded failure/retry path with diagnostics, and counts distinct failed executions rather than repeated observations of parked blockers. During operator handover an invalid run-status update exposed that transactions validated only on subsequent reads; it was corrected immediately, and `ad02048` now validates the full next snapshot before publication. Regression proves rejected host updates leave snapshot, journal and revision unchanged.
- **Finished by handover:** Flux URL/parser/tracker and 12 tests; phone orb and slimmer composer; finished-early button with cancellation-safe confirmation/choice timers; shared floating composer and chat mode; phone app lists with separate named shield store. Public chat value constructors and explicit discard of the widget write result are recorded operator prerequisite repairs. Every handover commit and real registered check was submitted through `runProjectAgent`, `recordReviewerRepair` and `reviewProjectTask`; code authorship is Codex operator, not Qwen. No task criteria were weakened.
- **Independent live closure:** Qwen (`qwen3.6:27b`) reviewed the combined diff through the real supervisor and returned PASS. Controller revision 135 reads `completed`, `finalReview: true`, 14/14 accepted (one reviewer correction), 100%, zero blocked tasks and zero open escalations. Supervisor/worker leases are released. CLI and the installed app's Projects screen both showed 100% and “Run complete — 14/14 tasks accepted”.
- **UI correction:** `e7b0efa` removes the contradictory supervisor-restart hint for final-reviewed runs in both progress detail and agent panel. Built and installed signed Mac app 1.2.0 build 471; candidate and installed deep signatures verify, and designated requirement exactly matches the old app (171a72ab). Reopened Projects and visually verified “Finished · all tasks accepted and final review passed” plus 100% and 14/14.
- **Verification:** 242 controller/agentic tests; 946 full Node tests after merging; 64 Swift XCTest cases (41 existing + 10 chat + 12 Flux + one target smoke); Mac debug build and iPhone simulator build succeed. Repo and worktree secret scans clean with 30 reviewed fixtures allowlisted. Evidence/state backup under `.builds/agentic-surfaces-repair-2026-10-02/`. An additional temporary probe confirmed numeric turn_index 0 parses; that probe is not a committed test or included in the 64 count.
- **Source integration:** completed surfaces branch merged into the primary checkout. The prior schedule-eval untracked files are preserved. This run's stated scope is modules/CLIs/views: it does NOT prove live Flux socket integration, Mac panel/chat wiring, Screen Time migration, Live Activity taps or installed phone behavior. Phone composer source uses the new orb; no phone deployment was performed.
- **Rollback:** revert the surfaces merge for feature source, `d2f7745`/`ad02048` for runtime changes and `e7b0efa` for the UI hint; never reset published history. Pre-handover state and partial FinishEarly source are retained in the evidence directory. Do not restore old state while a supervisor is running. Prior signed app is `.builds/agentic-surfaces-repair-2026-10-02/Orion-before.app`; quit the app, restore that bundle to `/Applications/Orion.app` and relaunch if a regression appears.
- **Next:** integration/device/design pass described by `docs/agentic/plans/orion-surfaces.md` and its briefs. The older “Tighten ORION” escalation is a separate run and was not altered by this request.

## 2026-09-30 13:43 BST — Adaptive rescheduling: incremental first, priority rebuild when needed (Codex)

- **Nick's clarification:** replacement is one tool, not the default. Normal changes should move only what needs moving; when the remaining day becomes impossible or badly tangled, ORION should rebuild it from the most important must-haves and then fill the gaps.
- **Behavior:** ordinary `orion-reschedule day` remains incremental. If anything cannot fit, it automatically retries the remaining movable day as a priority rebuild; `--rebuild` requests that directly, while `--replace` remains the explicit complete-new-schedule path. Rebuilds keep classes, deadlines, social/fixed commitments and work already in progress; then place explicit must/high-priority items, normal work and optional/maybe items. Existing tasks named again are updated rather than duplicated, and an already-identical fixed plan is kept rather than re-created. Lower-priority existing blocks that still cannot fit are removed in the same undoable transaction. If a must-have cannot fit, nothing is written and ORION reports the conflict.
- **Language/tooling:** `plan-parse` now carries must/high-priority/important/have-to language as importance 0 and maybe/optional/if-there-is-time language as importance 2 without polluting event titles. The phone context now explains incremental, automatic rebuild, explicit rebuild and full replacement as distinct choices.
- **Verification/install:** `node --test tests/life-*.test.mjs tests/tighten-*.test.mjs` passes 207/207. The remote snapshot was reinstalled at fingerprint `2624cdc762f3`; `orion-remote-install --status` reports loaded/running with unchanged integrity and the installed `orion-remote` matches the repo. No live calendar rewrite was needed for this clarification; `orion-agenda today` still shows exactly the corrected six-block schedule from the prior entry.

## 2026-10-01 12:01 BST — Day rules: no overlaps by construction, a cascade, true-size drawing

- **Nick:** "lunch goes into my break which goes into my lab. things are smooshed … even after you reviewed and fixed it yourself there was still overlaps … that a design flaw we need to polish out."
- **Root causes found:**
  1. Drawing: the Mac (20 pt) and phone (~20 pt) gave every block a minimum height, while 15 minutes is 13 or 16 pt, so short blocks were drawn over the next one.
  2. Planning packed blocks edge to edge, with no breathing room.
  3. No invariant: "what stays" was decided block by block against walls only. The property tests found existing overlaps kept, and in-progress blocks running into classes.
  4. Incremental mode evicted a block into the first far gap (a tidy preview put dinner at 22:33 and dropped four blocks), and keepFree dropped existing plans.
  5. An ORION block filed as "class" (the to-do "DS lab") made its own commute walls and pushed itself two hours.
  6. Nap and wind-down ranked as "rest", the first thing dropped.
- **Fixes:**
  - `day-check.mjs`: the day rules, applied to the part of the day still ahead. `orion-reschedule` checks the projected day before any write (refuses with NOTHING WAS CHANGED) and reads back after.
  - replan:
    - in-progress blocks stay only if their remaining time is clear;
    - stays are kept greedily, each checked against what is already kept, with `buffer`;
    - `buffer` and `keepFree` options, where keepFree only limits additions.
  - The CLI always lays out as a cascade (rebuild): blocks keep their time where there is room, otherwise just after the previous block plus the gap.
  - Config `bufferMinutes` 10.
  - Commute and "home" come only from real fixed classes. An ORION class or deadline mark is read as study.
  - Nap, wind down and sleep rank as sleep.
  - New `orion-reschedule tidy` ("fix my schedule").
  - Drawing: Mac and phone blocks at true size (4 pt floor), compact one-line labels, clipped. The phone no longer layers TodayPlan blocks that collide with calendar events.
- **Tests:** `tests/life-day-invariants.test.mjs`: 3,000 + 1,000 random days (once run at 20,000 + 5,000), no ORION overlap, the gap kept; checkDay unit test. Plus gap/keepFree scenarios, an existing-overlap repair test, a commute test for ORION's "lab", and priority. All Node tests pass.
- **Today:** tidied to Break 11:53, DS lab 12:18, side project 13:58, nap 15:08, study 16:03, apply 17:13, internship applications 18:08, dinner 19:48, resume 20:43, review CS lect 2 22:23, wind down 23:30. "Research backpacking stuff" is named as not fitting.
- **Deployed:** Mac app (DR 171a72ab, backup `.Orion-previous-*-truesize.app`); scripts and workspace.
- **Pending:**
  - phone build ready but not installed (device 4016, locked);
  - the Day view not yet seen on screen after the drawing change (synthetic clicks hide the window).

## 2026-10-01 11:39 BST — "Just got home, eating now, rearrange": the `now` command

- **11:28 BST** (the session log shows 10:28Z): "I only just got home … going to eat now so put my break now and rearrange my schedule accordingly." ORION retyped the whole day with `day --plan` and invented times:
  - nothing went in now, and DS lab stayed at 11:00 during lunch;
  - the side project went to 12:55 and the break to 14:45;
  - dinner moved EARLIER, to 18:15.
- **New `orion-reschedule now "<title>, <min>" … [--at HH:MM]`:**
  - books what he is doing from now (or from when he started);
  - a later block with the same name is moved, not doubled ("put my break now");
  - every movable block not yet done, including one already under way when he got in, slides after it in order, through `replan` rebuild with a blocked window;
  - whatever still has room keeps its time.
- **Root bug also fixed:** an ORION-made block was fixed when its title read like a class ("DS lab", a to-do), so it could never move. `toBlocks` now makes every `[orion:…]` block movable, and `day --todos` never files a to-do as class or deadline.
- **Today repaired:** undid ORION's 11:28 rewrite, then `now "Lunch, 25" "Break, 15" --at 11:28`: Lunch 11:28, Break 11:53, DS lab 12:08, side project 13:38 … Dinner 18:38.
- **Guidance** (AGENTS, live facts, TOOLS blurb): use `now` for "doing X now / rearrange"; never retype the day.
- **Live eval** ("just got back, gonna grab a snack real quick and then take a 10 min break. rearrange my stuff"): ORION made one `now` call and the reply named the next two things. Undone afterwards.
- **Tests:** two `now` CLI tests from his real times, and a toBlocks test; all Node tests pass.

## 2026-10-01 07:10 BST — "Plan from my to-do list" books one block per to-do

- **Bug:** at 23:23 Nick asked ORION to plan Thursday from his to-do list ("don't include any of the groceries"). ORION pasted the list (Hairspray included) into `day --say`.
  - plan-parse read "review CS lect **2**" as 2 PM, glued it to the following items as "Review CS lect , research backpacking stuff, Online learning for Northeastern, f…", and silently dropped finish resume, apply to SOMEWHERE and the rest.
  - Its comma splitting joins pieces without an activity word, so it is not a list parser.
- **Fixes:**
  - `orion-reschedule day --todos [--date]` reads the Orion list itself and books one movable block per to-do, with its real title.
  - Estimates come from Qwen's todo-parse, used for minutes and optional only, since it splits "thinking fast and slow book".
  - Due later or already on the calendar is left out and named. It keeps `freeMinutesKept` free, overdue and due-today first; what does not fit is named "no room today".
  - plan-parse shields numbers that label something (lect/lab/quiz/chapter/week … N) from time parsing.
  - AGENTS, the TOOLS blurb and the live facts say: never paste the list.
- **Today repaired:** the merged block was dropped and the to-dos booked properly (apply 14:00, send internship applications 16:45, finish resume 19:15, review CS lect 2 20:45, research backpacking 21:30; DS lab already at 11; the optional study did not fit).
- **Live eval:** "can you plan tomorrow out based off my todo list" → ORION ran `day --todos --date 2026-10-02` and named what did not fit. Friday restored to its two lectures.
- **Tests:** the plan-parse label-number test; the `--todos` end-to-end test (fake reminders in `tests/fixtures/fake-bridge.mjs` via FAKE_REMINDERS). All Node tests pass.

## 2026-10-01 06:57 BST — The wake line follows when he actually woke; the night lock ends in the morning

- **Nick:** "have the wake up line move to when I actually wake up" (up before 7 after a 7:15 alarm). And: "is my phone just locked forever now … it's a new day."
- **Actual sleep:**
  - `WhoopClient.exportNights` writes `~/.openclaw/orion-controlled/sleep-actual.json` (fell asleep and woke, per night, scored or not) on every WHOOP sync.
  - `night.mjs` `actualWake` uses WHOOP, then the phone's "up", then the first phone use after 4 AM (unplugged or moving). `actualSleep` uses WHOOP, then "bed".
  - `orion-watch` writes `wake` (actual, `woke: true`, `wakeSource`), `plannedWake` and `asleepAt` into night.json. Yesterday's entry is re-enriched as data arrives.
- **Display:** the Mac shows "Woke" in place of "Wake", plus a "Fell asleep" line for last night's actual sleep after midnight. The link sends `LinkSnapshot.night` (`SnapshotReader.night`) and the phone draws the same lines.
- **Verified on real data:** WHOOP says asleep 01:31, woke 06:21 (planned 07:15); night.json has wake 6:21 AM from WHOOP. LinkCore 29 pass, MobileCore 41, Node all pass.
- **Morning unlock:** `FocusLock.releaseNightLock` runs only in the morning (04–14) and only for a night lock (including the old build's locks, which carry no reason).
  - It is called when ORION opens, when the phone logs "up", and in background refresh once the Mac says he woke (no need to open ORION).
  - ScreenMonitor's night-window end clears any non-work lock, and `releaseIfExpired` runs in the background too.
- **Deployed:** phone (installed twice this morning; the last build has the unlock) and Mac (DR 171a72ab, backup `.Orion-previous-*-sleep.app`).
- **Noticed, not fixed:** today's calendar has a block titled "Review CS lect , research backpacking stuff, Online learning for Northeastern, f…": several to-dos merged into one block by last night's "plan tomorrow from my to-do list" (phone plan request → Mac planner). That path should use the to-do parser and give each to-do its own block.

## 2026-10-01 06:45 BST — ORION truthful finished for Qwen; both projects merged; phone updated

- **Phone:** the iPhone was connected this morning and `OrionPhone.app` was installed, with nothing in `native/OrionMobile` newer than the build. On the phone now: night markers, the 105-minute ready time, lock reporting and grants. The real-device unlock test is still to do with Nick.
- **ORION truthful (project-37a62c0e)** was left by Qwen with todo-parse accepted, triage awaiting review, reply-times blocked (implementation without tests), trace blocked (the runtime, not the task) and scenarios not started. Finished by hand-over:
  - triage was reviewed against its brief (accepted);
  - reply-times was rewritten: it passed its brief but scrambled real replies, so times now belong to their clause, an unmarked time takes the reading that fits the booking, and a lone time must be the start (30 September reply added as a test);
  - trace and scenarios (150 messages over 16 areas, plus the validator) were written;
  - the commits are `claude(<task>)` on `orion-agent/156a78ea`.
- **Run state:** closed through the runner's own library (`resolveProjectEscalation`, `mutateProjectAgent`, `acceptProjectFinalReview`): completed, 100%, finalReview true, and readProjectAgent validates it.
- **ORION truthful 2 (project-2f12825d):** completed by Qwen overnight (the chained launch at 03:48). It was spot-checked on real cases: the reply-person rewrite of the 2026-10-01 reply; grant-policy refuses "pretty please" and gives 20 minutes to "text my friends then bed".
- **Merged** both branches (they only add new files): 855 Node tests pass.
- **Life loop project (project-992584c3):** its state was invalid after the 2026-09-29 hand-over (13 accepted tasks still carried review evidence). Cleared, and it validates as completed 20/20. Backup: `state.json.bak-20261001`.
- **Not yet wired (next):** todo-parse into orion-reschedule; trace and expectTools into orion-eval-run; reply-times and reply-person into orion-remote's reply path; grant-policy into orion-phone-time; triage behind a notification reader; day-review as the evening message; then run the 150 scenarios.

## 2026-10-01 01:04 BST — Phone unblocking did not work for Nick; first job tomorrow

- **What Nick saw:** at first ORION did not recognise the block; when he asked again, ORION said "Done" and nothing unlocked. He turned the lock off by hand in Settings.
- **Cause:** every phone-side part (lock reporting, acting on grants, re-locking) is in the phone build that was never installed. devicectl reports the iPhone `unavailable` (error 4016).
- **Now:** a grant to a phone that has never reported prints SENT, NOT CONFIRMED, plus how to unlock it by hand (ORION → Focus lock off, or Settings → Screen Time).
- **TOMORROW, FIRST:**
  1. With the phone on the same Wi-Fi with the screen on (or on USB), install `OrionPhone.app` from the dd-dev build (rebuild if the scratchpad is gone; the scheme is OrionPhone).
  2. Open ORION on the phone once, so it mirrors the lock state to the app group.
  3. Test end to end on the real device. Turn Focus lock on; get it locked (a work block, or a check-in left ignored to level 3); send "unlock my apps for 10 minutes, I need to reply to my mom"; check that `orion-phone-time status` shows LOCKED before the reply and UNLOCKED on extra time after it; check the apps really unlock and lock again at the end.
  4. Only then call it fixed.
- **Chained run:** `~/.openclaw/orion-controlled/project-agent/chain-truthful-2.sh` (nohup) launches "ORION truthful 2" once "ORION truthful" has been idle for two 5-minute checks. Log: `chain-truthful-2.log` beside it.

## 2026-10-01 01:02 BST — Qwen project unblocked and running; ORION truthful 2 queued; honest grants

- **Block:** "ORION truthful" stopped at 15:51 on `trace`, three attempts gone in three seconds with "could not evict gpt-oss:20b before loading qwen3.6:27b". It was not Qwen's work. The ORION app keeps its fallback `gpt-oss:20b` loaded, `ensureExclusive` checked the unload once, instantly, and the error counted against the task.
  - Fixed in `scripts/lib/agentic/models.mjs`: it polls for up to 20 s, re-asking for the unload, and a failure is `recoverableRuntime` (attempt refunded). Test: `tests/agentic-evict.test.mjs`.
  - The escalation was resolved with the cause, and the project relaunched (`--until-stopped`, AC power). The model handoff was confirmed (qwen3.6:27b resident alone), and it is now on `reply-times`. `trace` gets its one extra attempt.
- **New project "ORION truthful 2"** (project-2f12825d, `docs/agentic/plans/orion-truthful-2.md`), imported and not started (a started project cannot take new tasks):
  - `grant-policy`: consistent extra-phone-time decisions;
  - `reply-person`: rewrite "his apps" as "your apps";
  - `day-review`: planned against done, as an evening message.
- **Phone grant honesty:** Nick asked again at 23:47 and ORION granted 20 minutes, but the phone still runs the old build, so nothing unlocked, yet ORION said "Done". Now `orion-phone-time grant` prints "SENT, NOT CONFIRMED … Do not say he is unlocked" while the phone has never reported, and AGENTS says the same.
- **The phone install is still pending:** devicectl reports the iPhone `unavailable`. It must be on the same Wi-Fi with the screen on, or on USB.
- **Flaky:** two timing tests failed once under load (exterminate / reconcile); three later full runs passed (790).

## 2026-10-01 00:40 BST — ORION can see and ease the phone's app lock

- **Why:** at 00:24 Nick asked ORION from the phone "can you pretty please unblock my apps just until 12:45". ORION checked `orion-focus` (the Mac's timer) and said nothing was locked. The lock lives on the phone (Screen Time), and the Mac had no view of it.
- **Phone → Mac:** a new `LinkLog.screen(at, locked, until, why, graceUntil)`, sent before every chat message and after a grant. The helper's `TrackingLog` stores it as `phoneScreen` (latest) plus `screenLog` (history) in the health log.
- **Mac → phone:** `LinkSnapshot.screenGrant` (id, until, because), from `~/.openclaw/orion-controlled/screen-grant.json` via `SnapshotReader.screenGrant`.
  - The phone's `FocusLock.grant` lifts the shield, sets `graceUntil`, and starts a DeviceActivity "grace" interval ending at `until`.
  - `ScreenMonitor.intervalDidEnd("grace")` re-shields if the lock window still runs, even with ORION closed.
  - A lock threshold inside a grace period is noted but not applied. The grant also arrives through background refresh.
- **Fixed along the way:** the Screen Time monitor never set `orion.screen.lockedBy`, so the end of a work window could not unlock. And the app read the lock from standard defaults, while the monitor wrote to the app group.
- **`scripts/orion-phone-time`:** `status | grant <min|HH:MM> --because | revoke`, max 60 minutes. It is allowlisted, has a TOOLS blurb and AGENTS guidance (decide like a friend; past bedtime prefer 10–20 minutes; talk to him, not about him). `orion-remote` adds the lock line to live facts.
- **`orion-remote` live facts:** the day guidance is replaced with tonight's rules (`--plan` in his order, no invented times, drop/overrun/add), and the watch question only shows when under 6 hours old.
- **Tests:** `phone-time` (5), LinkCore +3 (28 in total), MobileCore 41 pass, 789 Node tests, ci check OK. Live eval `orion-eval-phonelock-0034`, with a simulated "locked until 7:15, night" report:
  - the vague ask was refused, with 10 minutes offered for a reason;
  - 2 hours was refused;
  - "reply to my mom about flights, 10 min" was granted until 12:45 with the reason recorded.
  - The test state and the grant were removed afterwards.
- **Deployed:** Orion.app with the new ORION Link helper (DR 171a72ab; previous copy at `/Applications/.Orion-previous-*-phonelock.app`). The helper restarted 00:36 and is connected.
- **PENDING:** the phone build (markers, 105-minute ready time, lock reporting, grants) is not installed. The device reported error 4016 (locked). Until it is installed, `orion-phone-time status` says Unknown, and grants wait for the phone.

## 2026-10-01 00:04 BST — Wake / asleep-by markers; one to-do list; optional workshops removed

- **Markers.** The Mac day view (Tasks → Day) and the phone day view draw a dashed "Wake" line and an "Asleep by" line.
  - The rule is `scripts/lib/life/night.mjs`, the phone's NightPlan rule: wake = a morning alarm he asked for, else min(usual wake, first real commitment − readyMinutes 75); asleep by = min(bedtime, next wake − 8 h), or after a night out plus the trip home.
  - `orion-watch` writes `~/.openclaw/orion-controlled/night.json`: yesterday (kept as it was computed, because the calendar feed starts at now), today and tomorrow. The Mac reads it through `NightMarkers.swift`.
  - `orion-reschedule` ends the day at asleep-by, so Wind down ends on the line.
  - The phone filters `[orion:…]` blocks and "(optional)" events out of `firstTimedEvent`, so ORION's own blocks never set the alarm.
  - Bug found live: the 3:30 PM nap alarm (`wake-request.json`) drew the wake line at 3:30 PM. Only morning requests count now.
- **Reminders.**
  - Bridge (rebuilt; TCC kept): `list_incomplete_reminders` carries `list` and `due` and takes a `list` filter; new `list_reminder_lists` and `move_reminder`; `create_reminder` takes `list`.
  - `todoList` "Orion" and `sweepLists` ["Reminders"] in life config. `orion-agenda tasks` reads only Orion (`--all` for every list). `task-add` writes to Orion.
  - `orion-agenda-change tasks-sweep`, plus a sweep on every `orion-watch` tick, moves the phone's default-list reminders onto Orion; a duplicate is ticked off (reopenable).
  - Merged tonight: 6 moved, 1 duplicate ("finish resume") ticked. Groceries and the Family packing list are untouched and never planned from.
- **Workshops.** `ignoreTitles` ["(optional)"] is filtered from the planner and the agenda. The bridge's `delete_calendar_event` takes `span: future` + `start`. Both optional series were deleted from 7/8 Oct onward (0 left in 60 days).
- **Not done:** the phone build (with markers) is built but not installed: the device reported error 4016 (locked/asleep). Install with `xcrun devicectl device install app --device 00008140-00013C1C213A801C <dd-dev>/Build/Products/Debug-iphoneos/OrionPhone.app`. The previous Mac app bundle was not kept as a `.Orion-previous` copy this time.

## 2026-09-30 23:33 BST — Scheduling rebuilt from Nick's real day; optional workshops ignored

- **What went wrong on 2026-09-30.** Soccer 5-7 was added to a day ORION had already filled. The two phone sessions (11:06-11:19, 13:16-13:18 BST) then went through repeated overlaps, "did not fit" refusals, chains of undo that removed soccer, a crash in `--say`, and in the end a rebuild that put gym at 1 PM before soccer. Afterwards, Nick's review of test runs: "why am i reading at 8 am, why am i doing my yt side project right after class with no getting back home buffer … the timing of things are terrible."
- **Scheduler (`scripts/lib/life/replan.mjs`, rewritten):**
  - three kinds of time: walls (fixed), pinned (a time he stated; placed exactly, ORION's blocks move), flexible (laid out in time order);
  - importance only decides what is left out, never the order;
  - a stated time that cannot be kept becomes flexible and never bumps other blocks (`shifted`);
  - `soft` walls (travel) guard flexible work but never override his time.
- **Sensible times (`scripts/lib/life/sensible-time.mjs`, new):**
  - untimed plans wait until he is home: after his last class plus the commute, or after waking on a day without classes;
  - each kind has a natural time: evening for reading and relaxing, 5 PM gym, 6:30 PM dinner.
- **Travel (`commute.mjs`):** plans away from home (soccer practice, nights out) get travel before and after, including ones added in the same call.
- **`orion-reschedule`:**
  - `drop "<title>"` (tomorrow is the fallback when no date is given);
  - `overrun <min>` (a class running over, any day; what follows slides back in order);
  - `late`, `busy` and `overrun` cascade;
  - a bare `2026-10-01` or `tomorrow` is the date, and times already over today are refused;
  - "X after/before Y" is read from titles, and untimed plans chain after the one before;
  - restating a block replaces it, and `--replace` keeps a fixed plan he restated;
  - `add "title, 30"` is accepted;
  - `live-day` honours `ORION_BRIDGE_BIN`.
- **Ignored events:** `ignoreTitles` in life config (default `["(optional)"]`), filtered in `live-day` and `orion-agenda`. Nick: "i never go to them so get rid of all of them going forwards". Tomorrow's workshop occurrence was deleted. The bridge only deletes `.thisEvent` and resolves the series by identifier, so the recurring series stays in Calendar.app. PENDING: add `span: future` to `deleteCalendarEvent` and rebuild the bridge, with Nick present in case calendar access has to be re-granted.
- **ORION guidance (AGENTS.md + TOOLS.md blurb):** never invent a time; "nap 60 so 3" ends at 3; relative wording goes in titles; `drop`, not undo; move one block with `add`; `overrun` for classes; `--fill` only when asked.
- **Tests:** `life-day-scenarios`, `life-reschedule-cli` (end-to-end against `tests/fixtures/fake-bridge.mjs`), `life-sensible-time`, commute. 774/774 Node tests pass; ci check OK.
- **Live proof:** seven `orion-eval-run` sessions (`orion-eval-sched*`) texting as Nick about 2026-10-01; the last two runs gave correct layouts. Every test change to 2026-10-01 was reverted to the snapshot. A wrong-day run (a bare date, before the fix) wrote to 2026-09-30; it was undone from the journal and leftovers were dropped.
- **Open:**
  - ORION's reply can still misstate times the calendar has right (the reply-times task in the Qwen "ORION truthful" project);
  - `--say` still mangles narrated days, so ORION is told to write `--plan` itself.

## 2026-09-30 20:37 BST — Repository cleanup for readers; CI green again

- **Why:** Nick is putting the repo on his resume. An interviewer's first two impressions were clutter and a red CI badge (red since 3 September).
- **Moved out of the repo** to `~/Desktop/ORION-archive/2026-09-30/` (nothing deleted; all still in git history): `native/health-log-race`, `docs/handoffs/briefs-research-2026-09-23`, `tests/workspace/artifacts`, `docs/planning/_archive`. `var/brain` (personal Obsidian vault) is untracked and gitignored; it stays on disk where `orion-note` writes. `capabilities.md` → `docs/vision/original-wishlist.md`. Added `docs/README.md` index and a repository map in `README.md`.
- **Kept on purpose:** `orion/` (the Python policy engine and capability registry: the deploy's registry builder and the CI contract checks import it) and `backend/` (v1 phone backend; the schema and sync checks and its tests import it). README describes both honestly.
- **CI fixes:**
  - four sandbox-exec terminal tests are macOS-only (`it.skipIf`);
  - remote-agent fixtures now copy `scripts/lib`;
  - automation-install passes its fixed `NOW` instead of a 2026-09-27 expiry against the real clock;
  - inventory and deferred checks read the committed build via `ORION_CATALOG_DIST`;
  - the model-contract check SKIPs (not DRIFT) when there is no OpenClaw config;
  - rule 20 no longer flags `supplement_remove` (a health-log edit, not a calendar cancellation).
- **Proof:** all Node tests pass (746/746). Every CI step passes locally with `HOME` pointing at an empty directory to mimic a runner. Rule 5 (`raw_terminal` exists) is still reported, as before; CI marks that step continue-on-error.

## 2026-09-30 12:36 BST — Schedule replacement repaired and live day recovered (Codex)

- **Observed failure, from the real phone session:** repeated `orion-reschedule day` calls added new requests on top of the existing movable plan. Untouched blocks stayed by design, so the requested replacement could not fit; repeated fixed additions created two Soccer practice events. `day --say` then crashed on a bare hour (`Assignment to constant variable`). The model finally fell back to generic `calendar_event_remove`, whose irreversible delete correctly required per-event approval, and then fabricated `A-XXXXX` ids instead of completing the schedule rewrite.
- **Repair:** `orion-reschedule day --replace` now replaces every future non-class/deadline block when Nick explicitly asks to redo the whole schedule, and writes removal + additions as one reversible transaction. `orion-reschedule clear` is the narrower command and clears only future movable planning blocks. `calendar-write.mjs` journals deleted event contents for undo and rolls back partial mutations if a write fails. Natural-language parsing now handles compact ranges (`5-7`), bare-hour PM resolution, duration/title cleanup and team practices. The phone context explicitly routes whole-day clear/redo/rebuild requests through one `--replace --say` call instead of generic calendar deletion or approval loops.
- **Live state:** applied Nick's exact replacement request. Readback now shows Nap 13:00–14:30, Application progress 14:30–16:00, Snack 16:00–16:30, Soccer practice 17:00–19:00, Dinner 19:30–20:00 and Workout 20:00–21:00; the 13 stale/duplicate blocks were removed. One `orion-reschedule undo` restores the prior calendar state and removes this replacement.
- **Verification:** targeted parser/replanner/transaction suite: 19/19 passed. Broader life + tighten run: 203/203 relevant tests passed; the combined run reported 220/223 because three pre-existing installed-copy agent tests omit `scripts/lib/remote/claims.mjs` from their fixture and fail before exercising this change. The Python suite is not a usable gate in this dirty checkout: `.venv` is absent and the system-Python run reached 1,520 tests but failed on the already-staged removal/relocation of `planning/v2`, packaging drift and existing model-role fixture mismatch. Live dry-run produced the six requested non-overlapping blocks; post-write `orion-agenda today` read back those six blocks exactly.
- **Install/rollback:** `scripts/orion-remote-install` was rerun after final tests; the launch agent is loaded/running and the installed/repository fingerprints match (`2cc3c5449aa6`, integrity unchanged). Code rollback is the commit before this entry; calendar-only rollback is `scripts/orion-reschedule undo`.

## 2026-09-30 10:00 BST — Qwen batch finished + wired; supplements; connections (orion-connect), finance, Shortcuts, Screen Time (Claude)

- **Qwen "Tighten ORION"**: run escalated overnight (deadline-ramp worker_stuck on the cap/spill). Took over: brought the 5 accepted modules from `orion-agent/30a6ca83` (reply-lint, claims, eval-grade, lateness, plan-parse) into the tree; wrote deadline-ramp, morning-brief, distraction to their briefs. 205 node tests (life + tighten + connect). Wired: orion-remote truth check uses `claims.classifyClaim` (edits like "combined" now count), every reply goes through `fixReply` (24-hour/mixed times, repeats; `lint` recorded); orion-patterns uses `lateness`; orion-watch sends a once-a-day morning brief (`morning-brief`, assessments only — holidays filtered); orion-reschedule books ramped study via `deadline-ramp` (fill and day --fill; holidays filtered — "Study for Halloween" was one dry run away) and takes `day --say "<his words>"` (plan-parse; title joining words stripped); distraction rules drive the phone's Screen Time monitor.
- **Supplement failure (07:02)**: "combine" had no remove/rename → ORION added two items and said "Combined". Added `supplement_remove`, `supplement_update` (health.ts find/remove/update + verifiers + tests), AGENTS rule "combine = remove + add; done only if every part ran", "actions are not tool ids" in the task-run description. Nick's list fixed via the real route: Ashwaganda, Creatine, "magnesium, zinc & calcium", "vitamin D3 & K2". Plugin 380 tests; deployed (registry needs `npm run build` first — it reads dist/).
- **Connections**: `scripts/orion-connect` (list = live status of every connection incl. Gmail revoked; run/show/create/set/how) + `lib/connect/spec.mjs` (declarative GET-only connectors: one https host, Keychain secrets read only there, writes need `orion-connect-admin allow-writes`, not allowlisted) + built-ins `connectors/tfl.json` (live), `canvas.json` (needs domain + "ORION Canvas" token). Live eval: ORION built a `crypto` connector himself in 15 s (how → web_search → create → run). `orion-finance` + `FinanceExport.swift` (Orion.app writes finance-summary.json after each Plaid refresh; live: $382.58 this week). `orion-shortcut` runs only Shortcuts named "ORION …" (folder filter lists everything when missing). All allowlisted, TOOLS/AGENTS updated; CI OK.
- **Screen Time**: phone target `ScreenMonitor` (DeviceActivity monitor) + `App/ScreenWatch.swift`: work blocks nudge 15/30, lock 45; after bedtime 10/20, lock 30; free time nudges 60/120, never locks; lock only with Focus lock on; shared selection via the app group. Installed; the monitor process is running on the phone.
- **Eval safety**: `lib/eval-mode.mjs` + guards in orion-discord-alert / orion-messages-send; `scripts/orion-eval-run` (marker on during a run, always removed; grades with orion-eval-grade). Use it for all scenario runs.
- Calendar "bug" closed: this week's "Academic Writing Workshop (optional)" occurrence (30 Sep) was deleted as a one-off exception; the series is intact; the search is right. Cause not found.
- Voice ID floor 0.45 lets synthetic voices through (0.49/0.58); Nick's short wake scores ~0.50 → needs re-enrollment with short "Orion" phrases before the bar can rise.
- Nick to do: Canvas (domain + token), Gmail re-grant, voice re-enroll, choose Focus-lock apps if not done, turn Focus lock on for locking.

## 2026-09-30 10:24 BST — Backlog committed and pushed; commute buffer; Nick's day planned; ORION truthful project

- **GitHub is current.** The mixed dirty tree was secret-scanned: no keys; the only hits were refusal-test fixtures. It was then committed in ten grouped commits (agentic runtime, plans, life loop, chat path, voice, plugin, Mac, phone, docs, README). `orion-v2/backlog-checkpoint` was pushed and `main` fast-forwarded to it. README rewritten around the live stack; repo description updated. New standing rule in AGENTS.md: commit and push finished work, including `main`.
- **Commute buffer.** `scripts/lib/life/commute.mjs` walls off 30 min (`commuteMinutes` in config) before the first class and after the last. Used by `orion-reschedule` and by the short-night nap in `orion-watch`. Tests: `tests/life-commute.test.mjs`.
- **Nick's 09:34 to-do request, done by hand.** Movable blocks: fix Orion stuff 14:00, finish resume 15:00, internship applications 16:30, study (optional) 21:00, plus gym, dinner and side project. Four reminders were created. The nap was moved to 13:00, after the commute.
- **Qwen project "ORION truthful"** (`docs/agentic/plans/orion-truthful.md`, 5 tasks, lint clean, imported as project-37a62c0e): to-do parser, session-trace + expectTools grader, reply-time checker, notification triage/digest, 150-scenario catalog.
- **Claude next:** wire those in; to-do path (reminders + movable blocks + SAY line); Claude API for the phone's offline brain instead of the local model; run the 150 scenarios; notification gate (ORION Focus + Mac reader of mirrored notifications); AppleScript runner with an app allowlist; ignore the wake word during classes.

## 2026-09-29 21:12 BST — Tighten list; Qwen project "Tighten ORION" imported; last fixes (Claude)

- Full list: `docs/planning/v2/TIGHTEN_LIST_2026-09-29.md` (fixed today / Qwen / Claude next / Nick).
- Qwen: `docs/agentic/plans/tighten-orion.md` + briefs, 8 independent standalone modules (reply-lint, claims, eval-grade, lateness, deadline-ramp, plan-parse, morning-brief, distraction); `orion-agent plan` clean; imported via `orion-projects add` — not started (Nick turns Qwen on).
- Since the 20:55 entry: `orion-weather-alert` now described as SENDS (a test answer to "umbrella?" ran it and posted to Discord); weather/orion-show/tick-off rules in AGENTS; CLAIMS_CANT restored for "don't have a … tool" and "… through the phone"; the can't-retry fires only on a leading refusal and quotes his message (a re-ask had answered the previous question); gateway "⚠️ 🛠️ Exec failed" lines stripped from replies (kept as `toolNoise`); `media_now_playing` verifier observes the read. Re-runs in fresh sessions: tick-off (reminder really completed), umbrella (forecast), desktop files, who, now-playing — all correct. Plugin 374, remote check OK; deployed and installed.
- All retest side effects undone (6 events, check-in, reminder); memory unchanged (eval capture skip works).
- Open: EventKit range search omits "Academic Writing Workshop (optional)" (exists, found by id).

## 2026-09-29 20:55 BST — Voice fixed (Mac + phone), 60-scenario review, fixes deployed (Claude)

Nick: "fix voice and do a once over of the entire project … run at least 50 scenarios." Then, live: he cut himself off, heard his own name, slurred "PM", slow for the time.
- **Mac voice, root causes and fixes** (`native/Orion`):
  - Keychain on the press path: a locally-signed rebuild made every key read a hidden prompt → 26 s freezes / "NO KEY". `Secrets` now never prompts (`kSecUseAuthenticationUIFail`), falls back to `/usr/bin/security`, caches, and `Secrets.prefetch()` runs at launch.
  - Mic died mid-turn on device changes: config-change observer now always installed and restarts the mic under an open turn; a dead-engine watchdog (no buffers 1.5 s) restarts it (max 3), else says so.
  - Self-echo: `MobileCore/SelfEcho.swift` (tests) + `BargeInPolicy` (speakers route): echo compared on letters/digits and words; on laptop speakers only an interruption word he isn't saying himself ("stop/wait/hold/no/cancel/Orion") cuts him off; wake ignored while/just after speaking; a follow-up transcript that is his own words is dropped (`[echo]`). Turn-taking harness 123/123 (now compiles SelfEcho).
  - Voice ID was dead since 31 Jul (hand-started only; `~/scripts` path): `scripts/orion-voiceid-install` (launchd, copy in `~/.openclaw/orion-voiceid`); enrollment from 31 Jul loads (`enrolled=True`); synthetic voices score 0.49/0.58 vs 0.83 → rejected. Wake word back on.
  - `orion://listen` starts a hands-free turn as a follow-up (waits for speech); the Mac hologram widget uses it.
  - `MobileCore/QuickAnswer.swift`: time/date answered locally, 12-hour ("It's 8:14 PM."); same list in `orion-remote` (`quickAnswer`).
  - Spoken turns tell the brain "one to three short sentences" (a 699-char reply was read aloud).
  - TTS: Flash model slurred "8:14 PM." → `spoken_times()` in `orion_tts_daemon.py` writes clock times as words (unittest 180/180); installed.
- **Phone voice** (`PhoneVoice.swift`): early replies (offline answers arrive before `sent(id:)`) kept; 90 s wait timeout; no tight retry loop (back-off, on-device → server fallback, stop after 4); `.default` mode (voiceChat was quiet); recognizer uses the phone's locale.
- **Phone widgets/lock screen:** glance written on every launch and every snapshot even with no screen (`GlanceWriter.publish(snapshot:)`), thin writes avoided (cached snapshot/night), BG refresh every ~30 min by day. Live Activity buttons are `LiveActivityIntent`s run in the app (card redraws at once); card persists through snoozed/active; first "10 more min" is a real snooze (`orion-checkin defer --snooze`); mini hologram stills for the lock screen. Verified on device: glance has lectures, tomorrow, 4 projects, 5 deadlines, tracking, bed 23:45/alarm 07:45; Live Activity started for a test check-in; taps reached the Mac.
- **60 scenarios** (`scratchpad eval2`, sessions `orion-eval-v2-c1..c6`, phone+discord): most right and 4–7 s. Fixed from them: fake-"can't" check no longer fires on "I don't have [data]" and retries never narrate tools; `apple_reminder_complete` (bridge `complete_reminder`, `orion-agenda-change task-done`); `media_now_playing`; `weather_now(location, [days])` documented; desktop listing → `desktop_list` (exec `ls ~/Desktop` hung 95 s); undo = one step per command, empty steps never recorded (tests `life-undo-journal`); planner prints "NOTHING WAS BOOKED on <day>" (it had told Nick a side project was booked when nothing was); AGENTS: `--date` for other days, act on "plan it for me", social plans need no questions, bedtime via `orion-now`, patterns via `orion-patterns` (now reports start lateness), identity answer, 12-hour times (USER.md); check-in/watch messages 12-hour; episodic capture skips `eval` sessions; bridge list limit 25→200.
- All scenario side effects undone (4 events, 2 reminders, water/meal, memory lines, history, patterns, check-in; test text to Mom denied A-DUCA). Tests: MobileCore 41, LinkCore 25, plugin 374, life 132, turn-taking 123, TTS 180, remote/mobile/CI checks OK; plugin deployed; TOOLS.md regenerated.
- Nick to do: Gmail re-grant (`gog auth manage`, token revoked); web search is off in OpenClaw (needs a provider key) — his call.
- Open: the bridge's upcoming list omits "Academic Writing Workshop (optional)" though `get_calendar_event` finds it — not investigated further.
## 2026-09-29 15:42 BST — Widgets (Mac + iPhone), lock-screen presence, time-sensitive check-ins, night signals, model escalation (Claude)

Nick's asks: finish the four open items (Live Activity, time-sensitive notifications, the alarm shift not needing the phone to see him awake, the model decision) and make widgets for Mac and iOS: many variations, hologram / schedule / to-do / project.
- **Shared data:** `MobileCore/Glance.swift` (`OrionGlance`: blocks, tomorrow, todos, projects, checkin, deadlines, tracking, night, recovery, approvals; `mood`, `line`, `current`, `timelineMoments`, `merge`, `kind`, `isDeadline`; `GlanceFile`). `LinkSnapshot` gained optional `checkin`, `deadlines`, `lastInputAt`. Tests: MobileCore 33/33 (GlanceTests 12), LinkCore 25/25 (GlanceReaderTests 5).
- **Mac:** the ORION app writes `~/.openclaw/orion-controlled/glance-calendar.json` (`GlanceExport.swift`, every 2 min and on EventKit change). ORION Link composes the glance (`SnapshotReader.checkin/glanceCalendar/glance`) into the app group `JQNK3T6ACY.com.nickmadaio.orion`, reloads widgets only on change, and carries out widget taps from `widget-requests.jsonl` (`LinkCore/WidgetRequests.swift`). Status file shows `widgets:` (live: "2 blocks, 0 to-dos, 4 projects, 5 deadlines…"). Widget extension `OrionWidgetsMac.appex` inside ORION Link (team-signed, sandboxed); pluginkit shows it registered. Orion.app DR unchanged (171A72AB…), reinstalled.
- **Widgets** (`native/OrionWidgets/Shared`, compiled into both extensions): ORION (hologram S/M/L/XL), Event Horizon (S/M), Command Center (L/XL), Now & Next (S/M + lock screen rect/circle/inline), Today (M/L/XL), To-dos (S/M/L), Projects (S/M/L), Check-in (S/M + rect, Started/Done/10 min buttons), Day Rings (S/M + circular, +1 water), Tonight (S/M + rect), Countdown (S/M). Hologram stills are renders of the real `HologramModel` / black-hole study (`Assets.xcassets`). Rendered offscreen and inspected; fixed horizon crop, large-widget overlap, progress bars.
- **iPhone:** targets `OrionWidgets` (widgets + Live Activity + AlarmKit countdown) and `OrionNotify` (notification service: check-in level ≥2 and approvals → time-sensitive; subscription now `shouldSendMutableContent`). App: `GlanceWriter`, `LivePresence` (Control ▸ Lock screen toggle; starts when ORION is opened, updates from background), `BackgroundRefresh` (push + BGAppRefresh night check; fetches MacState directly; `SnapshotCache`), night signals without the app: motion history after bedtime, phone unlocked during the night check, Mac input after bedtime. `orion://show/<tab>` opens tabs. Entitlements: app group `group.com.nickmadaio.orion`, time-sensitive. Simulator build OK.
- **NOT on the phone yet:** device build fails with "No Accounts" — Xcode has no signed-in developer account, so the new App Group / Time Sensitive capabilities can't be added to the profile. Nick: Xcode ▸ Settings ▸ Accounts ▸ sign in, then rebuild/install (same xcodebuild + devicectl commands).
- **Model decision:** stay on Haiku 4.5 (measured week incl. evals ≈ $1.57 → ≈ $7/month; Sonnet for every turn ≈ $20, over the $0–10 budget). Truth-check retries (fake "done", false "can't", silent turn) now re-ask on `anthropic/claude-sonnet-5` (`ORION_ESCALATION_MODEL`, "off" disables). Added `anthropic/claude-sonnet-5` to `agents.defaults.models` (backup `openclaw.json.pre-escalation-20260929`); probe answered. orion-remote reinstalled; remote check OK.
- Test check-in ci-4307e3 fired its 15:05 message and was cancelled. Crash reports at 15:36 were the simulator (unsigned test build → CloudKit entitlement trap), not the phone.
- Don't `ls` the Mac group container from a terminal: macOS's app-data protection blocks it with a prompt.

## 2026-09-29 14:45 BST — The day, moved and filled; late nights; reaching out; patterns (Claude)

Nick's asks: schedule real + reaching out, patterns structure, moving his day, filling empty days by asking first, the executive-function loop, auto-moving the alarm after a late night, background signals, app blocking, offline completion.
- **Moving the day:** bridge `move_calendar_event` + an `[orion:<kind>]` marker on blocks ORION creates. `lib/life/replan.mjs` (stable; his plans before ORION's suggestions; clashes reported), `live-day.mjs` classify/isSocial/movable (people/classes fixed; study, gym, games, rest, errands, chores, side projects, meals alone movable). `scripts/orion-reschedule late|busy|add|day|fill|undo` (lock; undo journal; `day --plan "<title>, <min>, HH:MM, fixed" … --fill` — commas because exec reads "|" as a pipe). `orion-plan-study … --book` spreads sessions one a day and books movable blocks; study-request parses "two one-hour sessions" and "this/next week".
- **Filling the day / probing:** `lib/life/fill-day.mjs` + `config.mjs` (`scripts/orion-life`, e.g. sideProjectLabel). `scripts/orion-watch` (run by the ORION app every 5 min via `LifeWatch.swift`, installed copy + bridge copied to `~/.openclaw/orion-remote/bin`): asks about an empty day in the morning and right after the last class; after a short night (<6 h WHOOP or a late "bed") reshapes the morning (nap, early work later) and tells him. Alerts go through `alerts-outbox.jsonl` → LinkEngine → phone. Verified the app-run watcher reads the calendar (`watch.json` calendar: ok). **Today it will ask after Marketing (~17:00).**
- **Late nights (phone):** NightPlan: a real plan through bedtime (club) moves bedtime after it +30 min and drops wind-down; being seen awake after bedtime (app open, "Going to bed", a background significant-location change) moves the alarm later automatically up to first event − get-ready (Nick's Monday example: up till 03:00, Macro 13:30 → alarm 11:15) and leaves a morning note. Signals asks "Always" location for significant changes.
- **Reaching out:** check-in pushes carry Started / 10 more min / Done (answered through the link to `orion-checkin`); level ≥3 ignored check-ins engage **Focus lock** (FamilyControls individual auth; development entitlement is in the signed profile) on apps Nick picks; released on Started/Done or after 45 min.
- **Patterns:** `lib/life/history.mjs` — planned-vs-actual from check-ins → `life-history.jsonl`; `patterns.json` refreshed by the watcher; used by check-in wording, `orion-now`, and the reschedule window (wake median) once ≥3 samples.
- **Offline completion:** phone "note that… / remember… / idea:" and offline conversations → `LinkLog.note` → `MemoryNote` appends to `~/.openclaw/workspace/memory/<day>.md` under "## From the iPhone".
- **Memory bug fixed:** episodic auto-capture was saving the remote transport brief as Nick's words (5 junk entries removed, backup in scratch); `episodic.ts nickWords()` + test; plugin deployed (orion-deploy --allow-dirty; only those two files differed).
- **Brain runs b10–b13** of Nick's real evening (club 22–02, clean after class, meal prep ~18:00, two macro sessions, class late, undo) — final run correct in one call; all test events undone (calendar back to the two lectures).
- Checks: life 130/130, LinkCore 20/20, MobileCore 21/21, remote OK, phone UI OK, mobile OK, workspace in sync. Mac app + phone reinstalled.
- **Not done:** Live Activity lock-screen presence (needs a widget extension target); time-sensitive interruption level (needs the entitlement); a Monday-night-style late-night alarm shift only happens if the phone sees him awake (app, notification answer, or background location with Signals on).

## 2026-09-29 14:00 BST — Life loop merged and wired into ORION (Claude)

- Merged `orion-agent/21eb0d9f` → `e7a1f94` on orion-v2/backlog-checkpoint (112/112).
- Wired: `scripts/lib/life/live-day.mjs` (real calendar → blocks via the bridge); `orion-now` (next action + sleep plan + phone signal + side-project hour + open check-ins); `orion-plan-study` (real free slots to the deadline, prints calendar_event_add args); `orion-patterns` (sleepLog/phoneSignals/WHOOP: 14-day avg 5.6 h sleep, 4 red days); **`orion-checkin`** (follow-through loop + deferral classifier; state `~/.openclaw/orion-controlled/checkins.json`). The phone link runs `orion-checkin tick --json` (installed copy) every ~30 s and sends each message as a LinkAlert; the phone's alert subscription now shows the alert's own text (`alertLocalizationKey "%1$@"`, args `text`). All allowlisted, in TOOLS.md, rules in AGENTS.md, and each phone message carries open check-ins + the loop rules.
- orion-remote: a turn that ends with the runtime's "Agent couldn't generate a response" is asked once for its words (test added).
- Brain runs (b7–b9): check-ins used for starting/done/one-more-video/friend-cancel/eat-first/shower; "what now" uses orion-now; study uses orion-plan-study; sleep uses orion-health.
- A single test check-in is set for 15:05 today (active loop → one "Still on…" message, no escalation) to prove delivery to the iPhone.
- Checks: life 112/112, LinkCore 19/19, phone UI OK, mobile OK, remote OK, workspace in sync. Mac app + phone app reinstalled.

## 2026-09-29 13:45 BST — Life loop finished by Claude; marked complete in ORION (Claude)

Nick: "just take over all of qwen's work. mark it as done in orion aswell." qwen had accepted 6 tasks + 1 fix before Nick stopped it for class; reviewed (41 tests green, code matches the briefs). Claude built the other 13 on the same branch `orion-agent/21eb0d9f` (worktree under the project), one commit per task (`claude(<task>)`): fit-study, sleep-state, bedtime, follow-through, deferral, after-late-night, patterns, sync-event/merge/apply, next-action, `scripts/orion-next`, `scripts/orion-study`, `docs/planning/v2/LIFE_LOOP_REVIEW.md`. `node --test tests/life-*.test.mjs`: 112/112. Project state set to completed (20/20 accepted, finalReview true; backup `state.json.bak-before-claude-takeover`; journal event `project_completed`). ORION's Projects tab shows "Ready for your review", 100%. **Not merged** into orion-v2/backlog-checkpoint yet; wiring into the brain/phone is the next step (see the review packet's "Needs wiring").

## 2026-09-29 04:25 BST — Real scenario runs: what broke, what was fixed (Claude)

Nick: run many realistic, day-to-day scenarios — real, not just logic — before calling anything done.
- **Brain, 59 real turns** through orion-remote as the phone (chat mode, isolated `orion-eval-life-*` sessions, same model and tools). First batch 7/12; after fixes 10/12 and 8/10, with the remaining misses listed below. Side effects were undone: 3 calendar events deleted via the bridge by id, 2 test reminders deleted, health log restored from a copy under the shared lock, test wake request cleared.
- **Fixed from the runs:** fabricated "Done. I'll wake you at 7:30" (no tool) → `orion-wake` (phone alarm via the link snapshot `wakeRequest`) + a **truth check** in orion-remote (a claimed action or inability with zero tools is re-asked once; missing toolSummary = zero, found when it never fired); "I don't have sleep data" → `orion-health`; quiz 17 days out unseen → bridge `list_deadlines` (90 days, one-off events) + `orion-agenda deadlines`, event locations shown; approvals guessed → `orion-waiting`; water/food not logged → `orion-log` (same lock, `ORION_HEALTH_LOG` for tests, decoded by the app's types); timed reminders (`due`), gated titles (Nick's words), `minutes` for event length, screen_capture name — all in AGENTS.md. All four new wrappers allowlisted and in TOOLS.md.
- **Phone nights:** scenario run found a 13:30 class set the alarm to 12:15; wake is now min(usual wake, first event − get-ready).
- **Offline brain redesigned:** with write tools, Apple's on-device model invented reminders and times and re-logged food. Now actions come from plain rules (water, "remind me to X at T", food with a portion table; Mac-only requests refused), schedule/sleep/next answers are fixed text from real data, and the model only chats (no tools, facts pasted, no arithmetic).
- **Voice:** daemon synthesis verified for both providers (local 3.3 s for 5.4 s audio; ElevenLabs 1.6 s). Mac turn-taking verified only by the harness; phone voice untested on hardware.
- **Needs Nick:** Screen Recording for the gateway process (screen_capture blocked); the phone install; the model decision. Known remaining: no reminder delete; brain's small factual slips (e.g. lecture weekdays); the life loop (follow-up check-ins, "move my day") is the qwen part.
- Checks: remote OK (truth-check tests added), phone UI OK, mobile OK, LinkCore 19/19, turn-taking 118/118.

## 2026-09-29 03:55 BST — Phone: bedtime/alarm, offline ORION, signals (Claude)

Nick: "do whats left except for qwen part". qwen (Life loop) still stopped.
- **Night routine** (`App/NightRoutine.swift`): bed = min(latest bedtime, first calendar event tomorrow − get-ready − sleep need); local notifications wind-down → bedtime → +15/+30/+45/+60/+90 (ordinary alerts so Sleep Focus silences them), actions "Going to bed" / "15 more min"; past bedtime at open → nudges from now. **AlarmKit** wake alarm at first event − 75 min with snooze (iOS 26). Today shows a Tonight card, or "It's 03:42. Go to sleep. Xh left" past bedtime. Bed/up logged to the Mac (`LinkLog.sleep` → health-log `sleepLog`). Greeting says "Up late" after 23:00.
- **Offline ORION** (`App/OfflineBrain.swift`): when the Mac isn't `online`, chat goes to Apple's on-device model (Foundation Models) with tools: readSchedule, addReminder (EventKit), logWater, logFood, tonight. Replies tagged "ON YOUR IPHONE", kept on the phone. Tested on this Mac with the same model: ~1 s answers, correct tool calls, prompt tightened (name the class, 24h times, plain sleep warnings). Falls back to queueing for the Mac if Apple Intelligence is unavailable.
- **Outbox**: tracking entries that iCloud can't take are kept and retried every 10 s instead of dropped.
- **Signals** (`App/PhoneSignals.swift`, off by default, Control ▸ Signals): motion, charging, place rounded to ~100 m, sampled on open and every 10 min while open → `LinkLog.signal` → health-log `phoneSignals` (last 2000). Background sampling ("Always" location) deferred to life-loop wiring.
- **Bug caught**: the mic/speech usage strings from the voice-mode commit had not been written (a replace with count 0) — the mic would have crashed the app. Fixed; all six usage strings verified in the built Info.plist.
- Context size finding corrected: ~15k tokens base per model call (instructions + 35 tool schemas) growing with conversation; the "240k" was a multi-step turn's total. Not trimmed.
- Checks: LinkCore 19/19, MobileCore tests 21/21, mobile check OK, phone UI suite OK. Mac app reinstalled (helper restarted on new code). **iPhone build ready but not installed — phone unavailable.**

## 2026-09-29 03:40 BST — Claude's part before qwen: voice back, tools taught, phone voice (Claude)

Nick asked me to do my share before qwen resumes (Life loop stopped after its first task via `agent stop`).
- **Mac voice was dead for three weeks**: the TTS daemon stopped 2026-09-07 and nothing restarted it (launchd can't run ~/Desktop code). New `scripts/orion-tts-install` runs a copy from `~/.openclaw/orion-tts` under launchd (KeepAlive). Doctor: `responding, engine=mlx-warm`. ElevenLabs key present but not selected (Nick's choice in Preferences).
- **Interrupting**: widened trailing continuation cues (fillers, articles, prepositions, dangling pronouns) in `AdaptiveEndpointModel`; the harness section that said fillers never extend was rewritten to the new rule (118/118). Nick's endpointing default raised 1400 → 1800 ms (`defaults write com.nickmadaio.orion.app OrionVoiceEndpointingMs`).
- **Tab switching**: `orion://show/<tab>` in the Mac app (AppDelegate `application(_:open:)` → `state.requestedTab`), `scripts/orion-show` (allowlisted). Verified: a phone-sender "go to the health page" → the Mac showed Health.
- **Run status**: `scripts/orion-runs` (read-only, allowlisted) — ORION kept saying he couldn't see the coding run.
- **Brain instructions** (plugin/workspace AGENTS.md + USER.md, synced live): remote ≠ fewer tools; he is a native app, never localhost; try app_open before "not installed"; Nick's mission, priorities and school facts. TOOLS.md regenerated with the two wrappers. Phone chat brief carries open apps + orion-show/orion-runs.
- **Phone voice mode** (`App/PhoneVoice.swift`): mic button in the ORION tab → on-device speech recognition, 1.6 s end-of-turn, sends as chat, speaks the reply with the best installed English voice, listens again; "stop"/"that's all" ends. Built for device; NOT yet installed (iPhone unavailable). Mic/Speech usage strings added.
- **Finding for Nick**: the brain is `anthropic/claude-haiku-4-5` with thinking off (Sept: 347 of 349 replies). This is the main cause of weak conversation and flaky tool use; upgrading is a cost decision (USER.md budget $0–10/mo). Each turn also carries ~240k cached tokens of context — worth trimming before or with any upgrade.
- Checks: remote OK, phone UI suite OK, workspace sync OK, LinkCore 17/17, turn-taking 118/118.
- Still Claude's: on-device model + offline event log on the phone; phone signals (location/motion/sleep/Screen Time) and notification/escalation delivery; wiring the Life loop modules once qwen finishes.

## 2026-09-29 03:23 BST — v1 list received; life-loop handed to qwen; timetable imported (Claude)

- Nick's v1 list + mission statement saved: `docs/vision/ORION_PURPOSE.md` (mission, priorities: classes > sleep > gym > deadlines/study > ≥1h side project daily > other > rest).
- Timetable (12 weekly classes, Sep 28 → Dec 11) and 5 deadlines (Macro quizzes Oct 16 / Nov 20; Marketing Oct 26 13:00 ×2, Dec 4 13:30) generated as ICS and opened in Calendar for Nick to import. End times are read from a screenshot (1h30 lectures; Wed writing workshop 1h; Thu workshop 2h) — confirm. Term end date Dec 11 is assumed.
- qwen project **Life loop** (`project-992584c3…`, 19 tasks, until 20:00 today): pure modules under `scripts/lib/life/` — block/priority/weekly/daily-needs/gaps, study request parse + fit, sleep-state, bedtime ladder, follow-through escalation, deferral classifier, after-late-night replan, patterns, sync event/merge/apply, next-action, CLIs `orion-next`/`orion-study`, review packet.
- Kept for Claude (harder / wiring): phone voice; Mac voice + turn-taking (interruptions); on-device model on the phone (Apple Foundation Models) + offline event log; conversation quality and false "I can't"; tool-call reliability; phone signals (location, motion, sleep, Screen Time — FamilyControls entitlement needed for app restriction); notifications/escalation delivery; wiring the life modules into the brain and apps; `orion-show` tab switching.
- Also in this session (uninstalled-to-commit): phone chat always goes to the brain (`--mode chat`), live phone context in the brief (open apps, what ORION's app is), remote-check assertion.

## 2026-09-28 11:16 BST — Home restored; plan, tracking and chat connected phone↔Mac (Claude)

Nick's list: original Mac Home back, finalize scheduling, talk to ORION from the phone, phone tracking (water/calories/supplements), Plan tab "not connected", drop "From your Mac" from the phone's Today.

- **Mac Home** is the pre-Astra version again (orb, orbiting Quick Open apps, parked brief rail); tab renamed back to "Home". Astra's Today plan moved to the **Tasks tab** as a compact "ORION's plan" panel (TodayPlanView/TodayPlanContent rewritten; time budgets folded away). Planner logic (TodayPlanModel/Scheduler/Store) unchanged except completion callbacks and `reloadIfChanged()`.
- **Scheduling, one plan on both devices.** Phone "Plan my day / Replan / Undo" → `LinkCommand` kind `plan` → the ORION Link helper writes `~/.openclaw/orion-controlled/today-plan-request.json` (MobileCore `PlanRequestFile`) → the ORION app (`PhonePlanRequests`, 3s ticker in DashboardView) refreshes Calendar + Orion Reminders, previews, accepts, writes the outcome back. The snapshot now carries `plan` and `planRequest`; the phone's Plan grid and Today "Now/Next" use the Mac's plan. Free-time blocks are no longer drawn on the phone grid. Verified live: a request was handled in <3s (rev 9) and undone the same way (rev 10, old plan back).
- **Tracking from the phone.** Kind `log` carries a `LinkLog` (water ±, meal, remove meal, supplement) as JSON; the helper writes health-log.json itself via LinkCore `TrackingLog` using the app/plugin lock protocol (`<file>.lock`, 15s/6s), dictionary-level so unknown keys survive, complete day records. Logs use their sent time (valid 36h, so the Mac sleeping doesn't lose a bottle) and have a replay guard. Proven readable by the app's own `HealthLogFile` decoder on a copy. Phone: Health tab gains Water / Food (log sheet with recents) / Supplements; Today gains a compact tracking strip. Taps are optimistic and reconcile with the next snapshot.
- **Chat.** orion-remote's brain brief was telling ORION every remote message "arrived over Discord"; it now has per-channel lines (`@discord`/`@phone`, `briefFor(sender)`). Verified: a phone-sender question answered "coming through the ORION app on your iPhone". Replies render light markdown on the phone. Message limit 500 → 2000 chars.
- **Phone Today**: "From your Mac" removed; only a one-line approval banner (links to Control) remains, plus tracking. Plan tab status line now reflects the CloudKit link, not the old Simulator reader.
- **Fixes on the way:** `orion-remote-install` raced bootout/bootstrap and left the Discord bridge unloaded while printing success — now waits, retries, fails loudly (bridge verified running). ORION Link helper kept running old code after app updates — `PhoneLink.ensureRunning` now restarts a helper older than its binary (kernel start time; `launchDate` is nil for it). Verified on install.
- **Checks:** LinkCore 17/17, MobileCore tests 21/21, mobile check 703/703, phone UI suite passed, remote check OK, TodayPlanAppTests pass, Tasks layout harness PASS. Installed Orion build 374 (DR 171A72AB… unchanged, TCC kept); rollback `/Applications/.Orion-previous-374-pre-tracking-20260928.app`.
- **Not yet on the iPhone:** device build is at `$SCRATCH/phonedd/Build/Products/Debug-iphoneos/OrionPhone.app` (11:15); iPhone (5) is "unavailable". Needs a cable once + Xcode "Connect via network". Then verify on device: chat round trip, water/meal log landing on the Mac, Plan my day, approval push.

## 2026-09-28 10:29 BST — One Mac app; phone tabs made real (Claude)

**Consolidated without a permission reset.** The CloudKit helper is now embedded in Orion.app at `Contents/Library/LoginItems/ORION Link.app`.

- The helper is headless, has no menu, and is signed by team JQNK3T6ACY.
- `make_app_bundle.sh` builds and embeds it before signing Orion. Orion keeps "Orion Local Signing", so its designated requirement is unchanged and every TCC grant is kept, Full Disk Access included.
- Orion starts it and registers it as a login item (`PhoneLink.swift`).
- **Settings → iPhone** shows its status.
- The standalone `/Applications/ORION Link.app` was removed. Rollback: `/Applications/.Orion-previous-275-pre-phonelink-20260928.app`.

**Phone:**
- **ORION tab:** a real conversation (`ConversationView.swift`). Each message is a LinkCommand of kind "chat", the Mac hands it to ORION's brain through orion-remote (the conversation the Mac, voice and Discord share), and the history lives in iCloud.
- **CloudLink:** rewritten around one zone-changes feed carrying the snapshot, replies and history.
- **Control:** the duplicate "Ask ORION" and history were removed; approvals come first; answers to "Check the Mac" and "Open apps" show in place; there is a real Connection section (iCloud, Mac presence, notifications).
- **Today:** on the device, the real day plus "From your Mac" (approvals, attention feed, live run, Ask ORION).
- **Health:** the Mac's `health-log.json`, day-level numbers only, last 7 days, in `LinkSnapshot.health`. A WHOOP-style ring and a 7-day chart.
- **Simulator:** the old pairing/HTTP/sample harness is Simulator-only, so the UI tests and Phase 49 evidence are kept. `--link-fixture` renders the real screens with fixture data for design review.

**Checks:**
- LinkCore 8/8, MobileCore 19/19 and mobile check OK.
- The phone UI check is 2/2. `orion_v2_phone_check.sh` now resets the Simulator's privacy grants for the app first: a Calendar grant from 09-25 made the sample test fail.
- A conversation message through orion-remote as "phone" got a real answer in 6 s.

**Pending:**
- Installing the newest phone build: iPhone (5) was unplugged. Nick should tick "Connect via network" in Xcode ▸ Devices the next time it is plugged in.
- A Mac app pass.

## 2026-09-28 10:00 BST — Phone ↔ Mac link over CloudKit: built and live one way (Claude)

**The design.** iCloud container `iCloud.com.nickmadaio.orion`, a private database, zone `OrionLink`. Contract: `native/OrionMobile/Sources/MobileCore/LinkSnapshot.swift`.

- **Record types:**
  - `MacState`: one record, "mac", holding the JSON snapshot; the Mac writes it every ~30 s, or on change.
  - `LinkCommand`: written by the phone; the Mac fills in status and reply.
  - `LinkAlert`: written by the Mac for each new approval request; it triggers a push.
- **Every command is text in orion-remote's grammar.** It runs as `handle --from phone --id <record> --at <ms>` with `ORION_REMOTE_ALLOW=phone`, so the lock, replay, rate and verb rules apply exactly as for Discord.

**Mac:** `native/OrionLink`.
- **LinkCore** (SwiftPM, 7 tests): `SnapshotReader` reads project runs, approval tickets, running actions, `attention-today.json` and `lock.json`; `CommandRunner` calls the installed `~/.openclaw/orion-remote` copy.
- **The ORION Link.app menu-bar helper**, bundle `com.nickmadaio.orion.link`: team-signed, installed at `/Applications/ORION Link.app`. It writes `~/Library/Application Support/ORION Link/status.json`.
- **Orion.app keeps its local signing**, so no TCC grants were lost.

**Phone:**
- `App/CloudLink.swift` plus a rewritten `RemoteViews` Control tab (no preview data): Mac presence, approvals with Approve/Deny, agent runs with Stop/Pause/Resume, running actions with Stop, the attention feed, "Ask ORION", and recent replies.
- Push registration, with `UIBackgroundModes` remote-notification via `App/OrionPhone-Info.plist`.
- The entitlements add the container and aps.

**Verified on real devices:**
- the Mac publishes (after a ~15 min wait for Apple to link the container to the Mac app: CKError 10 / internal 2007 "Invalid bundle ID for container");
- iPhone (5) reads the snapshot;
- MobileCore mobile check is 703/703 and package tests 19/19.

**Not yet verified:** the command round trip, waiting on Nick tapping "Mac status", and a real approval push.

## 2026-09-28 09:33 BST — Merged the qwen branches; ORION installed on Nick's iPhone (Claude)

**Merge.** Four `--no-ff` merges into `orion-v2/backlog-checkpoint`:
- 57 (`58af930`), 58 (`636036b`), the roadmap packets (`33dbcae`) and attention/ops (`efcdac9`);
- no file overlapped the dirty tree;
- merged tree: 296 automation/attention/ops tests and 224 agentic tests pass, CI is OK, and the secret scan is clean;
- `orion-cron-deliver` now records history live, to `~/.openclaw/orion-controlled/cron-delivery-history.jsonl`.

**Phone ↔ Mac.** Nick chose CloudKit as the backbone, with Tailscale as an optional fast lane later. He joined the Apple Developer Program: Team **JQNK3T6ACY**, Individual.

**iPhone (5)**, an iPhone 16, is set up:
- paired, Developer Mode on, and registered to the team;
- the WWDR G3 intermediate was missing (only the 2023-expired one was present), and Nick installed it;
- OrionPhone is built, signed by the team, and installed and launched on the device; the profile runs to 2027-09-28;
- `DEVELOPMENT_TEAM` is saved in the phone project.

**Next:** the CloudKit command/state layer. The Mac app is still on "Orion Local Signing"; moving it to team signing needs a plan for the TCC grants.

## 2026-09-27 22:23 BST — Review sweep of all qwen branches (Claude)

All four projects are complete: Phase 57 at 7/7, Phase 58 history at 6/6, the roadmap at 44/44, and attention/ops at 32/32. Every branch stayed inside its scope.

**Tests re-run on each branch:**
- attention/ops: 139/139;
- history: 31/31, plus the 82 existing automation tests;
- installer: 43/43, plus the same 82.

**Two defects fixed, with fix commits on the branches:**

1. **attention (`a76bd9e`):** `orion-attention-collect` put full error text, including local file paths, into the Today feed and digest outages. They are now source names only, and `buildTodayFeed` reduces objects to their source. About 20 lines of leftover model reasoning comments were removed.
2. **history (`4a2816d`):** `orion-cron-deliver` recorded "silent" before the silence check, so every delivered run wrote two history lines. Fixed, with a new test ("each run records exactly one outcome") that fails on the old code.

**Also checked:**
- An independent 37-check spec probe of the attention engine passes.
- The branch's `orion-automation simulate` ran end to end in a sandbox HOME with a fake history.
- All 40 roadmap reports pass `doc-report`. Of 126 requirement statuses, none over-claims against PHASE_GATES; one is conservative.

**Note:** many roadmap reports are thin (38–60 lines against the 100–180 asked for).

**Not merged.** The branches wait for Nick's review.

## 2026-09-27 09:50 BST — New all-day plan running: attention engine and ops tools (Claude)

**Where things stood.** The roadmap run finished at 44/44 accepted (40 planned + 4 corrections). Its packets mostly ended in evidenced blockers (phase-order gates, unregistered native checks, Nick-only decisions), so the new plan was designed, not copied.

**The plan.** `docs/agentic/plans/attention-and-ops.md` plus `.briefs/`. It is uncommitted and lints 0/0/0. It is project `project-f9a223a3-…`, launched `--until-stopped`.

- **30 tasks, 17 of them independent. Every written path is new**, so nothing collides with the dirty checkout.
- **The attention engine (Phase 59/63/64)**, under `scripts/lib/attention/`:
  - the item shape, urgency, novelty and scoring (unknown is never zero);
  - dedup, the quiet/focus gate and a durable queue;
  - calendar, waiting, focus and manual sources;
  - rank, explain, an interruption budget, collect, a Today feed JSON, a digest and a day simulator;
  - the `orion-attention` and `orion-attention-collect` CLIs, driven by fixtures only;
  - an architecture doc.
- **Ops tools:**
  - `orion-costs` (inference ledger, Phase 67);
  - `orion-incident-timeline` (audit logs, Phase 74);
  - `orion-focus-report` (Phase 60);
  - remote-audit stats.
- **A final review packet.**

Brief facts were checked against HEAD: the admission quiet-hours and focus semantics, host `legacyFocus`, the `waiting.ts` fields, agenda `--json`, and the real ledger, audit and focus-history row shapes.

**First task:** qwen wrote the module and tests on exchange 1, and they passed.

**Not wired on purpose:** live readers, a schedule, delivery and the Swift Today surface.

## 2026-09-26 15:51 BST — Roadmap run escalation: diagnosed, fixed, relaunched (Claude)

**What happened.** The run stopped at 2/40:

- Phase 48 and 49 were accepted. Both reports pass `doc-report` when rerun by hand.
- Phase 50 and 51 spent every exchange of three attempts on READ and SEARCH, and never wrote their report.
- The local reviewer declined to repair them, both tasks were deferred, and the recurring `worker_stuck` raised a run-level `repeated_failure` that halted the run.

**The fix:**

1. **Every brief's exchange plan** now says to write the report skeleton with FILE in exchange 1 (six sections and every requirement id), then EDIT at least every two exchanges.
2. **`common.md`** gained a "Write first" section. Astra's previous briefs are in Claude's scratchpad (`roadmap-briefs.pre-writefirst`).
3. **`worker.mjs`:** a worker that has written nothing by half its exchanges is told to write now, and a `worker_write_nudge` event is emitted.
   - A new supervisor test covers it, and fails without the change.
   - Agentic tests are 157/157, and lint is 0/0.

Then: `rebrief` (the briefs of 38 unfinished tasks changed), the three escalations resolved (50 and 51 requeued with one attempt each), the bridge reinstalled, and the run relaunched `--until-stopped`.

**Note:** the relaunch reset the saved "Keep the display on" to off.

**Open:** `orion-remote-install` left the bridge stopped on its first run, twice today; a second run fixes it. A task chip has been filed.

## 2026-09-26 12:01 BST — Projects: full-screen run view (Claude)

Nick asked for the ChatGPT voice-mode pattern: pressing Start pulls up only the run.

**The view** (`native/Orion/Sources/Orion/ProjectRunFocus.swift`):

- It covers the Projects tab, and both sidebars step aside.
- A pinned header holds the status orb, Pause / Stop and the overall %, with "task N of M · K accepted".
- The centrepiece is the live worker → tests → self check → review → correct loop, scaled up.
- It also shows:
  - a whole-plan bar, one segment per task (accepted, current part-filled, parked in orange);
  - the current task's ≈% with a stage rail and "Step x of y";
  - the live model stream: thinking or writing, character counts and the thinking tail.

**Per-task % is an estimate**, and is labelled one. `RunProgress` works it out from the recorded stage plus the worker's declared steps, and never reaches 100 before acceptance. The overall figure is weighted like the controller's.

**Opening and closing:**

- It opens on Start, via "Watch run" while live, and by itself when "Keep the display on" is set and a run is live, unless that run's view was dismissed.
- It closes with "Show everything" (verified by a real click), a swipe down, or Esc. Esc could not be exercised by synthetic input to this LSUIElement app.

**Checks:**

- 5 new tests (`ProjectRunFocusTests`).
- The full Swift suite has 0 failures.
- It was verified visually with a probe project, since deleted.
- Subtask captions no longer show the worker's leading "— ".

## 2026-09-26 11:44 BST — Roadmap plan made runnable; Projects view now refreshes itself (Claude)

**Astra's `orion-full-roadmap` project (40 tasks, not launched): two fixes.** Astra's original is kept in Claude's scratchpad as `orion-full-roadmap.pre-claude.md`.

1. **The context no longer says to READ `PHASE_GATES.json`.** That file is 553 KB and READ truncates at 90,000 characters, before phase 34, so the worker would have got about 22k tokens of the wrong phases. Each brief already embeds the phase's gate record.
2. **The only check is now `doc-report`** (`scripts/lib/agentic/doc-report-check.mjs`, registered in `checks.mjs`). It replaces `node-syntax`, which never ran on Markdown. It fails a report that:
   - is missing any of the six required sections;
   - leaves out any of its phase's requirement ids;
   - cites a repository path that does not exist, before "Smallest next slice".

Agentic tests are 144/144 and lint is 0/0. The project was refreshed, and the Discord bridge reinstalled; the first reinstall left it stopped, and a second brought it back up.

**The UI didn't update for anything:** the Projects list never showed new projects, and the plan tab never reloaded.

- **Root cause:** the dashboard re-renders every second (`SessionTabModel`'s media timer), which re-created the timers stored on child views before they could fire.
- **Fix:** `ProjectRefresh.swift`. `RefreshTicker` is an `@StateObject` timer that also ticks on app activation. `ProjectLibraryModel` backs the list.
- **Also:**
  - the plan reloads when `plan.md` changes;
  - there is a Refresh button beside `+`;
  - a `.DS_Store` file is no longer counted as a broken project;
  - DayTimeline's now-line had the same bug and is fixed.
- **Verified live:** a probe project appeared and disappeared by itself within 5 seconds. Swift tests show no failures, and there are 4 new tests.
- **Rollback:** `/Applications/.Orion-previous-275-pre-refresh-20260926.app`.

## 2026-09-26 — Astra full-roadmap transfer to offline model

Created `docs/agentic/plans/orion-full-roadmap.md` and 41 adjacent briefs; registered as **ORION full roadmap — implementation packets**, ID `project-756fe9c4-dd6d-492a-89ce-7377ccc9e5e5`. Import only, not launched; existing installer/history projects and overnight chain were not changed.

40 executable documentation contracts: one for each of 34 non-complete phase records, plus six cross-cutting original-vision packets. These investigate source and propose small implementation contracts; they do not implement features or grant blanket authority. Each worker receives the common architecture plus exact phase requirements. Existing 57/58 projects retain coding ownership. Native check registration, Phase 48/49 authority decisions, entry gates, dirty-source integration and real-device/provider proofs remain explicit prerequisites. No product completion percentage is implied.

Verified against HEAD `9855d99`: all required source preconditions exist in committed HEAD; plan validation/import each reports 0 errors, 0 warnings, 0 scope findings (40 informational documentation-review notes). Plan and brief snapshots match registration. Independent read-only review by review_local_today found no blocking findings and confirmed complete open-phase coverage, committed prerequisites, bounded scopes and preserved gates. Runtime/product tests were not rerun for this documentation-only transfer. Prior source/installed claims in the September26 Claude batch remain attributed historical evidence. The mixed dirty checkout was preserved.

Next: select this project in Projects when ready to run source reconciliation; independently review its output contracts before registering implementation batches. Outputs belong under `docs/planning/offline-roadmap-results/`. Full product roadmap and architectural boundaries are in the plan/common brief. No deployment, merge, new provider, new credentials or worker restart occurred. Rollback: leave the imported project unlaunched and remove only these newly authored plan/brief files if unwanted; no product behavior changed.

## 2026-09-26 04:37 BST — Overnight qwen run: Phase 57 finish, then Phase 58 automation history (Claude)

**What is running.** A detached chain, `~/.openclaw/orion-controlled/project-agent/overnight-chain.sh`, which logs to `overnight-chain.log` beside it:

1. First it relaunched `advance-orion-capabilities` (Phase 57) for its last 2 tasks, `auto-install-fixture-route` and `auto-install-review-packet`. The worker is qwen3.6:27b and alerts are quiet.
2. When that run ends it starts the new project `project-8478096a-…` ("Automation history", 6 tasks), unless the first run was halted by an operator.

**The new plan:** `docs/agentic/plans/automation-history.md` plus its `.briefs/`. It is uncommitted, and it lints clean (0 errors, 0 warnings).

- It targets Phase 58's last open requirement, `uses_historical_data_where_available`, with:
  - an append-only history ledger;
  - a pure summary;
  - recording in `runInstalledAutomation` and in `orion-cron-deliver`;
  - `simulate` printing observed numbers;
  - a review packet.
- Three tasks have no dependencies.
- Every brief claim was prototyped on a `git archive HEAD` copy, including that the cron-deliver tests stay off Discord under a temp HOME.
- The loop does not deploy or merge anything.

**To stop it:**

- the app's Stop, or Discord `agent stop` (the chain then does not start the next project);
- or `kill $(cat ~/.openclaw/orion-controlled/project-agent/overnight-chain.pid)`, then stop the running project.

## 2026-09-26 00:48 BST — Phases 40–52 batch: reviewed, repaired, deployed, checkpointed (Claude)

Report: `docs/planning/v2/PHASES_40_52_BATCH_REPORT_2026-09-26.md`.

**Phase state:**

- **Closed:** 40, 43, 44, 46 and 47.
- **Requirements pass, not closed:** 50 and 51. Both wait on 49 in sequence.
- **Open:**
  - 48: the broker split and signing are blocked on Nick, and plugin tamper protection is marked blocked because a self-check can't catch its own replacement.
  - 49: not started.
  - 52: built with its flag off, waiting on a gate amendment.

**Independent review:** 3 CRITICAL, 6 HIGH, 7 MEDIUM and 5 LOW findings. Everything fixable here was repaired, redeployed and re-verified. The main ones:

- **C1 (live before this batch):** ORION could rewrite `scripts/orion-remote` or `scripts/orion-approve` through an unapproved Desktop write. Now no file action may change `~/Desktop/ORION`, `~/.openclaw` or `~/Library/LaunchAgents`.
- **C2:** the approval card never named the command or the file. It now shows them in full.
- **C3:** `terminal_run` now runs under a `sandbox-exec` profile that denies writes to those paths, with a minimal environment and redacted output.
- **H1:** Stop no longer re-runs the command.
- **H2:** commands copied from pages are refused.
- **H4:** a grant is spent atomically.
- **H5:** integrity covers the whole extension and fails closed.
- **M3:** changing `orion-mode` scope needs the owner.
- **M4:** `orion-lock` stops running actions and withdraws chat grants.
- **M6:** `orion-undo` bounds its paths.

**Proofs:** plugin 374/374; `orion-deploy` all 7 suites OK; lock, reauth (12), strictness (34), remote, integrity and trash (`--live` through the installed plugin) all OK; Mac app rebuilt and installed; secret scan clean.

**Local commit:** this batch's files only. The remote-channel files (`orion-remote`, the bridge, `orion_v2_remote_check.sh`, `orion_v2_ci_check.sh`) are held back, because the `action` verb shares hunks with uncommitted Discord and agent work. Not pushed.

**Nick decides:**

1. whether to turn on `enableRawTerminalActions`;
2. whether to accept the Phase 52 amendment (in-app confirmation instead of Face ID);
3. whether to remove bare `env` and `find` from the main allowlist;
4. which Phase 48 broker isolation to use: a second macOS user, or `sandbox-exec` around the gateway.

## 2026-09-25 20:24 BST — Phone: day planning live on Calendar/Reminders; remote access UI (Claude)

Direction from Nick: the phone is for **remote access** and **day planning**.
Spec for Astra: `docs/planning/v2/PHONE_FOCUS_2026-09-25.md` (maps the
backend work to Phases 21–25, 39, 41, 44–49, 56, 65/66).

- **Day planning (real data).** `App/PlannerStore.swift` reads and edits
  Apple Calendar and the "Orion" Reminders list through EventKit.
  - Access is asked only on "Connect Calendar & Reminders", never at launch.
  - It merges ORION's plan blocks from the Mac's `GET /plan`, without
    duplicating commitments.
  - `App/PlanViews.swift`:
    - a calendar-style day grid with overlap columns, drawn from
      `MobileCore/DayLayout.swift` (10 new checks, 703/703);
    - a red now line and prev/today/next navigation;
    - event add/edit/delete, and to-dos add/complete/edit/delete;
    - ORION blocks drawn dashed and read-only.
  - Today shows Now/Next and the top to-dos once connected.
  - Usage strings are added to the build settings.
- **Remote access (UI, preview data).** `App/RemoteViews.swift` puts four
  sections on Control: your Mac, agent runs, approvals, and actions (using
  catalog names).
  - Everything is labelled PREVIEW, and every button says "not sent".
    `RemoteStore` is the seam the Phase 44 link fills.
  - The phone's identity, connection and privacy sections stay below, under
    "This phone".
- **Verified in the live Simulator panel:**
  - granted Calendar and Reminders on the Simulator's test data;
  - created "Seminar prep", which was saved to Calendar and drawn at 21:00
    with the now line;
  - added two to-dos, which were saved to Reminders and shown on Today;
  - the Control preview notice appears on Stop.
- **Tests:** `orion_v2_phone_check.sh` 2/2 and
  `orion_v2_phone_read_check.py` PASS, both on a separate iPhone 17 Pro
  Simulator. The pairing check is still not run (`cryptography` missing).
- **Tabs are still the manifest's five.** Control now means remote access.

## 2026-09-25 19:46 BST — Phone app visual redesign (Claude)

`native/OrionMobile`: the phone now uses the Mac app's language. Behaviour,
security flows and every UI-test identifier are unchanged.

- **`App/PhoneTheme.swift`** (new): tokens (ink, the Mac's cyan, green,
  violet, orange; mono labels; rounded display type) and components:
  PhoneBackdrop, PhoneHeader, SectionLabel (fading rule), PhoneRing,
  PhoneButtonStyle (outline capsule, glow when prominent), StatusDot, PhoneStat,
  PhoneEmptyState, TimelineRow, `.phoneScreen()`.
- **`App/PhoneTodayReader.swift`** (new): `PhoneTodayReader` and
  `NoReadRedirect` moved out unchanged. Both new files are registered in
  `project.pbxproj` (ids …29–2C).
- **`OrionMobileApp.swift`**: dark scheme, with these screens:
  - **Today:** date and greeting; the sample shows NOW big, then next
    commitment and free minutes as figures.
  - **Plan:** a timeline, coloured by block kind.
  - **ORION** and **Health:** designed empty states.
  - **Control:** sections under labels instead of a grouped List; user-facing
    wording.
  - The connection-review and connected-reading views are restyled.
  - Simulator-only launch arguments `--tab <today|plan|orion|health|control>`
    and `--sample` make screenshots reachable without taps.
- **Copy the UI tests pin is kept exactly** ("Wednesday, 9 September · London
  time", "No personal records loaded", all status strings). Caps are drawn with
  `.textCase`, so VoiceOver reads the original wording.
- **Verified:**
  - `scripts/orion_v2_phone_check.sh` passes (2/2).
  - `orion_v2_phone_read_check.py` PASS: real Simulator read, stale display,
    outage, recovery, revocation.
  - **Not run:** `orion_v2_phone_pairing_check.py`. No Python here has
    `cryptography`, and nothing was installed. It drives the pairing, session
    and HTTP-session UI tests. Their identifiers and element types are
    unchanged, but that is not proof.
- The Claude Simulator panel needs `sudo xcode-select -s
  /Applications/Xcode.app/Contents/Developer` (Nick). The builds here used
  DEVELOPER_DIR.

## 2026-09-25 18:43 BST — Every task checks what already exists first (Claude)

For Astra's full plan, parts of which may already be done (236/236 agentic):

- **Survey.** `scripts/lib/agentic/existing.mjs` `surveyExistingWork` runs at
  the start of every attempt.
  - It records, per scope file: exists, lines, exports, test count and last
    commit.
  - It records, per `Export foo(` promised in the contract: where it is
    already defined (git grep).
  - The worker sees it every exchange as "ALREADY IN THE REPOSITORY". The
    journal records `existing_work_surveyed`.
- **Overwrite guard.** `overwriteRisk` checks every worker write, and every
  reviewer-repair write, against HEAD. It refuses:
  - a write that removes existing exports the contract text does not mention;
  - a write that lowers a file's test count;
  - a whole-file write that discards more than half of a file of 40+ lines.

  The refusal says why. EDITs, and additions, pass.
- **Already satisfied.** A worker that changed nothing can finish with
  `### DONE` starting "ALREADY SATISFIED:", on fresh all-green checks.
  - The host makes an empty commit (`commitAlreadySatisfied`) and journals
    `already_satisfied`.
  - The reviewer gets the existing scope files in place of the empty diff and
    judges them criterion by criterion. There is no benefit of the doubt.
- Worker and reviewer system prompts are updated (step 0 "find out what already
  exists"; reviewer item 9 "existing work destroyed"). PLAN_STANDARD §1 notes
  the behaviour.

## 2026-09-25 15:07 BST — Plan standard, plan lint, scope-tests check (Claude)

**Added** (231/231 agentic tests):
- `docs/agentic/PLAN_STANDARD.md`, the baseline for every new plan:
  - what reaches worker, reviewer and repair, and what never does (plan prose,
    other tasks, the graph);
  - architecture rules A1–A8: independent branches, one owner per file, a
    task-specific check, checks registered before the run, sizing, docs-task
    criteria, scope as the grant, preconditions;
  - information rules I1–I8: objective as end state, one statement per
    criterion, named test scenarios, specified interfaces, task-specific
    context, described failure injection, real escalation conditions, no
    impossible instructions;
  - the brief structure, a plan and task template, and a pre-run checklist.
  - Linked from OPERATING.md §2.
- `scripts/lib/agentic/plan-lint.mjs`: advisory findings with codes, printed
  as `lint` by `orion-agent plan` and `orion-projects add`. It never
  refuses a plan. Its only error is scope-tests with no test file in scope.
- The `scope-tests` check runs `node --test` on the task's own
  `tests/**.test.mjs` scope files. The argv is fixed, and paths come only
  from the approved scope, so no per-plan registry edit is needed.
  - Scope is now passed at every `runChecks` call site.

**The current plan against it:** 0 errors, 16 warnings, 1 note.
- Structure: a linear chain, two shared files across four tasks, no
  task-specific check, and one context paragraph copied into all five tasks.
- Acceptance criteria: compound criteria, and bundled test scenarios (the one
  that blocked task 2 twice).
- Astra's task blocks are unchanged. Its briefs already compensate for the
  interfaces and the scenario lists.

## 2026-09-25 14:55 BST — Soft task hour; Projects run console redesign (Claude)

**Soft task hour** (227/227 agentic, 82/82 automation):
- `taskTimeoutMs` (60 min) is now the FIRST budget. `runProjectAgent` has an
  extendable deadline, capped by `taskHardTimeoutMs` (4 h) and the run's end.
- At each exchange boundary the worker checks whether the next exchange will
  fit, judged from the last three exchanges' real duration. Running out of
  exchanges triggers the same check.
- If so, and there was progress in the last 4 exchanges (host gate), the
  reviewer gets a short report. The call runs without thinking.
  - It grants 0–45 min plus an ETA. `extension.mjs` sets the bound.
  - Exchanges follow time: one per 5 min granted, never above `maxTurnsHard`
    (40).
  - An unusable answer falls back to the host's 20 min.
  - Every decision is journalled as `deadline_extended` or
    `deadline_extension_refused`.
- The live runner still predates this; it applies from the next launch.

**Projects run console** (`ProjectRunConsole.swift`, `ProjectTab.swift`
header; 522 Swift tests, 0 failures):
- A status orb that breathes (worker cyan / reviewer violet), spins while
  changing state, pulses orange when it needs Nick, and closes green when done.
- A large animated status word, plus who is working, the model, elapsed time
  and the task.
- One primary button that changes with state (Continue / Stop / Resume), with
  Pause and Exterminate beside it.
- **Proof a press landed:** Sent → Recorded → Done. Done is read from the loop
  (heartbeat/state), never assumed. `ProjectIntent.isDone` has unit tests.
- A per-task segmented progress strip in the header and sidebar; the task in
  flight shimmers.
- Asleep/Away alert switch (`orion-project-agent alerts`); heartbeat role and
  model are now decoded.
- Run settings are folded into one summary line.
- The old four-row halt list (`ProjectHaltControls`) is removed.
- A stale Swift test was aligned with the CLI: Resume may clear a stop on an
  interrupted run.
- `-orion.initialTab project` launch argument, so screenshot checks can reach a
  tab.
- Installed with the same designated requirement. Rollback:
  `/Applications/.Orion-previous-275-pre-console-20260925.app`.

**Run state:** Nick stopped the run at 14:33 BST (battery). Task 3 and both of
its corrections are accepted (5/7). Continue from the app when he is plugged in.

## 2026-09-25 14:12 BST — "Stuck" was retyping files; EDIT added; deferral + quiet alerts (Claude)

**Diagnosis of the overnight stop (task 3, 07:30 BST):** not stuck, and not a
model-quality problem. The block was `worker_timeout`: nine exchanges in the
hour, and the worker was making progress. The time went on output:
- Every change was a whole-file `### FILE`. At local generation speed that is
  about 7 minutes for the 20 KB module and 11 minutes for the 34 KB test file.
  Turns 6 and 8 each retyped the module for a small fix.
- Turns 6 and 8 wrote without a CHECK, so the worker was fixing a failure it
  could not see.
- The reviewer repair retyped the same file, hit the output cap
  (`doneReason: length`), and was cut off before its diagnosis.
- The last failure was a wrong TEST. Its child process ran the install to
  completion before `exit(73)`, so there was no crash to reconcile.

**Changes** (224/224 agentic):
1. **`### EDIT`**, SEARCH/REPLACE hunks, in `scripts/lib/agentic/edits.mjs`.
   - It is parsed in `prompts.mjs` and used by both the worker and the repair.
   - Each hunk must match exactly once. Trailing whitespace is forgiven. The
     edit is all-or-nothing, and a failure says which block failed and why.
   - The whole-file write still goes through `writeScoped`.
   - Documented in `worker-system.md`, `reviewer-repair.md` and the common
     brief (rebriefed, rev 3).
   - The repair now puts its JSON first, so a cut-off reply keeps its diagnosis.
2. **Checks run automatically after every write.**
3. **Deferral.** Every task-level escalation is `deferred: true`. The task waits
   for Astra; independent work continues (the plan forbids skipping
   dependencies, so dependents wait too).
4. **Alert modes**, via `scripts/orion-project-agent --project ID alerts
   quiet|away`. It applies live, and the default is quiet.
   - **quiet:** no per-deferral, stuck, repair or recovery messages. When the
     run stops, ONE digest goes out as a silent Discord message (flags 4096),
     plus `briefs/astra-deferred.md`.
   - **away:** each deferral is sent as it happens.
5. **More tries.** A repair that leaves checks failing no longer escalates: the
   worker continues from it. `repairRetryAttempts` goes from 1 to 3.

**Live result:** relaunched at 14:02 BST in quiet mode, with the diagnosis in
the resolution note.
- Worker turn 2 was an EDIT that took 51 seconds, and all checks were green.
- The task went to review 5 minutes after it started.
- It was ACCEPTED with two corrections, which are now running.
- The bridge was reinstalled (in sync).

**Open:** there is no app toggle for the alert mode yet; it is CLI only.

## 2026-09-25 07:40 BST — Task 2 ACCEPTED; four loop defects fixed during the night (Claude)

**Result:** `auto-install-transaction` was accepted at 07:30 BST (independent
review: transaction order, exclusive publish, all six scenarios). The run moved
straight to task 3 (`auto-install-reconcile`), which is healthy.

**Defects that kept stopping it, each fixed with a mutation-checked test**
(214/214 agentic):
1. **Unfinished work wiped on every resume** (`partial_work_discarded`):
   23-of-24-passing work was thrown away twice.
   - Now a task's own dirty files are kept when all are in its scope, it is not
     accepted, and it was the last task the worker wrote (from the journal).
     This applies at startup (`recoverRun`) and at claim (`partial_work_kept`).
   - Another task never inherits them.
2. **Green work called stuck:**
   - Self-review exchanges that may not say DONE counted toward the stuck
     gate, and the repetition gate ignored subtask labels.
   - Now, with fresh, all-passing checks, both gates submit the checkpoint to
     review (`worker_green_submitted`).
   - Stuck fixtures in 3 older tests now fail their checks, which is what stuck
     means.
3. **Kept files not counted as written,** so CHECK answered "nothing written".
   Kept in-scope files now seed `written`, and a checkpoint commits all changed
   in-scope files.
4. **Memory-pressure stops charged as failures** (previous entry).

**Task 2's actual last bug** was in its test: the ledger file name used the raw
installationId instead of its sha256.

## 2026-09-25 04:12 BST — Memory-pressure stop no longer ends a task; run relaunched (Claude)

- **What happened:** at 04:00 BST the resource guard stopped a worker
  generation ("swap is still climbing"). It was charged as an ordinary worker
  failure and spent task 2's last attempt, so the run escalated and stopped.
- **Fix:**
  - `resources.mjs` marks a guard stop `recoverableRuntime` + `resourcePressure`,
    so the controller refunds the attempt.
  - `recovery.mjs` handles pressure on the host, without asking the 27B
    reviewer: unload the model, wait `resourceSettleMs` (default 180 s), retry.
    This stays within the recovery budget of 2 per phase and 6 per run, so
    persistent pressure still escalates.
  - New test.
- **Verified:** 211/211 agentic tests. Bridge resynced.
- **Relaunched** at 04:06 BST after resolving the escalation; turns healthy.
  - Swap is 17 GB and mostly stale; a reboot before the next run would help.
  - Keep the lid open.

## 2026-09-25 03:40 BST — Run relaunched overnight on Nick's instruction (Claude)

- **Why it would not start:** the start button was disabled because task 2's
  escalation was still open, and the app said nothing about it.
  - Resolved the escalation by CLI with the defect-list note (revision 97).
  - Launched `--until-stopped --keep-display-on --nudge-minutes 5` on AC power.
  - The supervisor is live; keep-awake is bound to serve.
- **First turns are healthy:**
  - 41 s and 34 s turns with thinking off.
  - Turn 3 rewrote the installer, fixing every defect the note named.
- **Lid:** preflight says closing the lid will sleep the Mac, because
  Vorssaint's lid option is off.
- **App:** `ProjectTab.swift` now explains a disabled start (it says where to
  resolve). It builds but is NOT installed; install it while no run needs the
  app.
- **Do not initialize a new run.**

## 2026-09-24 23:22 BST — Why the 2026-09-24 morning runs died, and the fixes (Claude)

**Found:** Nick and Astra's morning restarts all stopped on task 2's last
attempt. The journal shows why:

1. 08:40Z: a worker turn thought for 23 minutes (64k chars) and produced
   nothing.
2. 09:13Z: the next call hit models.mjs's 30-minute "inference timeout". This
   was classed `worker_or_validation_failed`, which spends an attempt, not
   `worker_timeout`, which goes to the reviewer.
3. 09:22Z, with worker thinking now off in agentic-config: the worker sent the
   same `SUBTASK+READ+READ` three turns running. Reads of files already in view
   were ignored silently, so it never learned. The repetition gate blocked it as
   an ordinary failure.

No handoff entry was written for the 09:37-10:17 BST edits (worker, supervisor,
models, controller, Swift).

**Fixed:**
- A READ of a file already in view now gets a notice ("already in your working
  set ... write a file and CHECK").
- The repetition gate counts consecutive identical turns, as its comment always
  said, and routes to `worker_stuck`, the reviewer rung.
- "inference timeout" routes to `worker_timeout`.
- Regression tests for all three.

**Verified:**
- 210/210 agentic tests and 82/82 automation tests.
- `doctor`: worker qwen3.6:27b with think off, usable; reviewer with think on,
  usable.
- Bridge reinstalled and in sync.
- The installed app was built after the latest Swift sources.

**State:**
- Nothing running.
- Task 2 is blocked with an open escalation; attempts 3/3; its one reviewer
  repair is used. So a resolution gives it one attempt, and a stuck or timeout
  in that attempt escalates again rather than going to the reviewer.
- Swap 9.7 GiB; battery 36% (it drained ~60%/h during the run).

## 2026-09-24 03:37 BST — Plan briefs rewritten and delivered; three loop defects fixed (Claude)

**Found state** (the 00:44 entry was no longer true):
- The first real run stopped at 02:42 BST, status `escalated`. Task 1 is accepted
  (via repair `7898699`). Task 2 `auto-install-transaction` is blocked after all
  attempts; tasks 3-5 are queued behind it. Nick was alerted (journal:
  `escalation_notified delivered`). No supervisor is running.
- Task 2's history:
  1. Attempt 1: the worker read ~10 files in one exchange, evicting 7 of its
     own reads, then hit the repetition gate.
  2. Attempt 2: twice spent the whole 16k output budget thinking (empty
     replies), then timed out.
  3. A reviewer repair (`d7286b2`) was judged "structurally correct" but
     blocked for missing tests.
  4. The 02:39 resolution ("add the six missing tests") was wasted: the
     controller resubmitted the same repair checkpoint three seconds later, and
     the reviewer blocked it again.
- Codex then fixed the resolution path (orion-project-agent.mjs 02:46, with no
  handoff entry).
- **The repaired installer is not correct**, whatever the reviewer said:
  - it requires `now` to be a `Date` and passes it to `automationSchedulePlan`,
    which throws "Invalid current clock" on every call;
  - it nests `policy: plan.policy`, which dispatch and the runtime refuse;
  - it never releases its lock;
  - it stores neither plan nor record in the transaction;
  - it labels a failed read (id known) as `create_pending`;
  - it publishes with `rename`, which overwrites.
  No test exists to show any of this.
- Codex's briefs were accurate but thin: 14 KB across all six files.
- Astra's plan task blocks are unchanged: all five digests are identical to the
  2026-09-23 originals.

**What changed and why**
- **Briefs rewritten** (40.8 KB) from the verified research in
  `docs/handoffs/briefs-research-2026-09-23/`. Codex's versions are kept in
  `codex-briefs-v1/`. They give:
  - exact signatures and line references;
  - the installed-record shape;
  - adapter and transaction conventions, labelled as recommendations;
  - a test recipe per scenario, with a fixed clock;
  - an exchange plan sized to the stuck gate and output budget;
  - traps, taken from tonight's actual mistakes;
  - a per-criterion checklist for the reviewer, who cannot open files.
  - Task 5's brief quotes tasks 1-4's 19 criteria and the follow-on list
    verbatim, since the plan is not in the worktree.
- **Runtime fixes:**
  - a reviewed repair checkpoint is consumed by any verdict;
  - one exchange reads only what fits beside the task's own files, and the rest
    is skipped and named;
  - after a reply starved by thinking, the next exchange runs with
    `think: false` once (`models.mjs` now takes a per-call `think`).
- **New operator command:** `orion-projects rebrief <id>` refreshes briefs of
  unfinished tasks on a started run. It refuses while the run is live or if any
  task block differs, and bumps `rev`.
- **Earlier fixes, verified intact alongside Codex's work:**
  - the checks-heuristic fix;
  - reaper disarm on resume;
  - recovery for parked tasks and an unreachable reviewer;
  - own-file eviction pinning;
  - Continue gated on a run-level block.
- **Stale test updated:** `--until-stopped` replaced `--hours` in the resume
  hint.

**Verification**
- Node: 206/206 agentic tests (was 187) and 82/82 automation tests.
- Mutation checks: each new fix's test fails when that fix is reverted.
- Executable fact-check: a throwaway installer that follows the task 2 brief,
  run against the real modules. 7/7 tests covering 15+ brief claims passed:
  - the Date clock error and the refused nested record;
  - interop `succeeded`, `duplicate_or_old_trigger`, `not_due` at 09:05Z;
  - the six task 2 scenarios, including ENOTDIR publication failure;
  - `not_authorized`, `mode_mismatch`, `expired`, `focus_unknown`,
    `invalid_state`, `stopped`, `busy_or_unavailable` and `outcome_unknown`.
- `orion-agent plan`: every task has its own brief, 9.4-15.4k chars each.
- Briefs contain no marker lines and no triple backticks.
- A worker's first turn is ~7-9k of its 48.5k-token budget, leaving ~104-110 KB
  for files.

**Live/installed state**
- The run is stopped and escalated, revision 78. The rebrief is applied:
  tasks 2-5 are at rev 2 with the new briefs, and task 1 is untouched.
- The bridge is reinstalled and not DRIFTED.
- The app is unchanged: build 275 from Codex's 00:04 install.
- Nothing committed.

**Rollback:** copy `docs/handoffs/briefs-research-2026-09-23/codex-briefs-v1/*`
back into the briefs folder, then run `orion-projects rebrief`. The runtime
changes are small and each is covered by named tests.

**Exact next step (Nick's call):** resolve task 2's escalation and Continue. The
resolution note becomes the task's "why this came back". Suggested note:

> The installer from the reviewer repair has defects no test caught: `now` must
> be epoch-ms (a Date makes automationSchedulePlan throw); spread `plan.policy`
> into the record, never nest it; release the lock in finally; store the full
> plan and record in the transaction; a failed read after an id is `job_known`,
> not `create_pending`; publish with an exclusive link, not rename. Fix the
> module against the brief, then write the six test scenarios.

## 2026-09-24 00:44 BST — False worker-stop and repair-continuation defects fixed live

- The first real `advance-orion-capabilities` run never lost its supervisor:
  PID 20370 and its heartbeat stayed live. What looked like a stop was a false
  `worker_stuck` transition after four passing check cycles.
- Root cause: the stuck counter treated only the first write to a path as
  progress. A worker that corrected that same file during a required
  self-review was therefore classified as stuck immediately after making a
  useful correction. `worker.mjs` now resets the counter for a changed file at
  a runtime-requested self-review checkpoint while retaining the churn gate.
- A second evidence bug made `diffSince()` omit untracked files, so the repair
  reviewer was told the current diff was empty before the first checkpoint.
  `workspace.mjs` now appends read-only `/dev/null` diffs for allowed untracked
  files without staging or otherwise mutating them.
- The live recovery exposed one more controller fault: after a passing reviewer
  repair, the worker was required to rewrite the same files and say `DONE`
  before the checkpoint could be reviewed. Qwen kept returning `CHECK` and hit
  the repetition gate. Repair retries now durably carry the repair SHA/files;
  the host reruns every registered check against those exact files and submits
  the clean repair to the ordinary independent review gate without another
  worker-model generation.
- Regression coverage proves a self-review correction proceeds, unproductive
  rewrites still route to review, investigation is not called stuck, and an
  untracked first-checkpoint file appears in the repair diff and remains
  untracked. It also proves a repaired checkpoint is checked and submitted
  without rewrite. The complete supervisor suite passed, including recovery,
  halt, review, repair and timeout paths.
- The same run was resumed under the corrected backend as PID 31196. At 00:46
  the independent reviewer accepted repair commit `78986999` after all three
  checks passed again, and the loop immediately started task 2,
  `auto-install-transaction`. Two
  automatic repeated-failure alerts sent while the old processes were being
  drained were resolved in the durable ledger with the exact controller-fix
  reason; no escalation remains open. Do not initialize a new run.

## 2026-09-24 00:04 BST — Live monitoring verified during the first real run

- Nick started `advance-orion-capabilities` with `--until-stopped`. The run is
  live on branch `orion-agent/f3c41a5b`; supervisor and worker leases are held
  by the same healthy process. Do not restart or duplicate it.
- Installed build 275 now shows a permanent numeric weighted progress percent,
  accepted task count, heartbeat age/phase, current task and current subtask in
  the right workflow panel.
- **Activity** now shows the streamed local-model trace, the latest 160 lines
  of `run.log`, an **Open full log** button, every task and subtask state, and
  the latest 20 durable checkpoints. The views remain readable after a run
  stops. Installed UI proof showed all of these against the live run.
- At verification the run was healthy at revision 9, 0%, task
  `auto-install-readback`, attempt 2, with no escalation. The first attempt was
  automatically retried after a worker/validation failure, as designed.
- Validation: 49 targeted Node tests, 25 targeted Swift tests plus the new log
  tail test, four-state UI harness, signed release build, identity check, live
  backend doctor, project plan/brief validation, bridge status, and installed
  UI inspection. Closing/replacing the app did not interrupt the supervisor.

## 2026-09-23 23:51 BST — Wall-clock runs and full-width workflow UI installed

- Project launches now use either an exact `--until ISO_TIME` deadline or
  `--until-stopped`; the app no longer presents a relative hour budget. The
  legacy `--hours` parser remains only for compatibility with old scripts.
- Projects offers **At a time** (normal AM/PM time picker) and **When I stop
  it**. If the loaded calendar has an upcoming class/lecture/seminar/tutorial/
  workshop/lab, an Orion shortcut offers 30 minutes before its start.
- The Projects workspace now fills the window. Its workflow is a persistent,
  vertical five-stage loop in the right third; Plan/Activity/Reviews use the
  left two thirds.
- Installed `/Applications/Orion.app` remains signed build 275. The saved
  `advance-orion-capabilities` snapshot was refreshed. The Discord bridge was
  reinstalled after its continuation hint changed. No project was started.
- Verification: 61 targeted Node tests, 25 targeted Swift tests, 31 focused
  launch/keep-awake tests, four UI harness states, release build/signature, and
  installed UI inspection. Both run modes were exercised in the installed UI.

## 2026-09-23 23:31 BST — Projects workflow diagram restored and installed

- Restored the worker → tests → self-check → review → correction → Astra
  diagram in **Projects → Activity**. Before a run exists it shows the complete
  loop as a static blueprint; during a run it uses the existing live dial.
- Narrow verification passed: backend plan/doctor checks, 22 targeted Node
  tests, 16 targeted Swift tests, the four-state UI layout harness, release
  build, strict code-sign verification, and identity preservation.
- `/Applications/Orion.app` is the verified 1.2.0 build 275. The previous bundle
  is `/Applications/Orion-pre-diagram-20260923.app`. Installed UI proof showed
  the saved five-task project and the diagram through the normal Projects route.
- No project run was started and agent execution remains disabled until Nick
  presses **Enable & start**.

## 2026-09-23 22:40 BST — Safety handoff: plan briefs in progress (Claude)

Written at Nick's request, before continuing, in case this session runs out
again. The previous two background workflows died on the monthly spend limit.
**If this is the newest entry, the work below is where things stopped.**

**Found state**

- The **brief mechanism is built, tested and live** (ARCHITECTURE §4.26,
  OPERATING §2, handoff doc §14). Last full run: 184/184 Node, 514/514 Swift.
  - A plan may have `<plan>.briefs/common.md` and `<task-id>.md`, which the host
    renders after each contract for worker, reviewer and repair.
  - Astra's `docs/agentic/plans/advance-orion-capabilities.md` is unchanged.
- **No brief has been written yet.** The research for them is complete and saved
  in `docs/handoffs/briefs-research-2026-09-23/`: one JSON per task plus
  `environment.json`, each with verified APIs, data shapes, test patterns,
  per-criterion feasibility, pitfalls, exchange plans and reviewer checks, all
  with file:line evidence. Every writer, checker and cold-reader agent failed on
  the spend limit.
- **Final review of everything:** only the halts and remote dimensions finished.
  Controller, launch, briefs and readiness failed. Findings are in
  `docs/handoffs/briefs-research-2026-09-23/final-review-findings.json`.
  - **Confirmed by a verifier:**
    1. Resume after exterminate does not disarm the 20 s reaper, so it can
       SIGKILL the supervisor Nick just resumed. The fix is an exterminate token
       the reaper re-checks.
    2. After a hard-killed exterminate, `recovery.mjs allowed()` refuses runtime
       recovery for the rest of the night, because a reconciled task keeps
       blocker `worker_outcome_unknown`.
    3. `ProjectTab` disables **Continue project** whenever any task-level
       escalation is open. It should gate on run-level `isBlocked`.
  - **Unverified (the verifiers hit the limit):**
    - critical: "Orion can resume Nick's halted run by forging an inbox envelope";
    - high: "LOCK ORION disables Discord agent halts while the run keeps going";
    - high: "a halt issued just after Start is cleared by
      prepareProjectContinuation";
    - several lows (see the JSON).
- **Host defect found by research** (`environment.json` → planLevelIssues).
  `checks.mjs` marks a check UNUSABLE ENVIRONMENT whenever its first 2,000 chars
  of output match `ENOENT|No such file or directory|command not found`, even
  when the check is just a failing test. The worker then blocks humanOnly.
  Tasks 2–4 are about missing and partial files, so an honest failing test can
  park the night for Nick. Fix: apply the heuristic only to spawn failures and
  exit 127.

**Live/installed state:** nothing running. `agentic-config.json` is absent.

- The Discord bridge is installed and in sync (fingerprint covers the
  controller).
- `/Applications/Orion.app` is build 275 with keep-awake and the Plan-tab
  "Briefs" line. The previous app is kept at
  `/Applications/.Orion-previous-275-pre-briefs-20260923.app`.
- The saved project `advance-orion-capabilities` has never been started and has
  no briefs snapshot.

**Rollback:** the brief mechanism is inert without a `.briefs` folder. The app
can be restored by swapping in the `.Orion-previous-*` bundle above. Nothing is
committed.

**Exact next step, in order**

1. Fix the checks.mjs heuristic and the three confirmed findings, with tests.
2. Write the six brief files from the research JSON, verifying each fact at
   HEAD (`git show HEAD:path`; the worktree is HEAD).
3. Run `node scripts/orion-agent plan docs/agentic/plans/advance-orion-capabilities.md`,
   which must list every task with a brief, and measure the prompts.
4. Run `node scripts/orion-projects refresh advance-orion-capabilities`.
5. Reinstall the bridge after the lib changes; rebuild and reinstall the app
   after the Swift fix.
6. Verify the unverified review findings, highest first.

Shared files touched: `scripts/lib/agentic/*`, `scripts/orion-project-agent`,
`native/Orion/Sources/Orion/ProjectTab.swift` and `ProjectAgentStatus.swift`.

## 2026-09-23 16:30 BST — Agentic runtime readiness pass, installed

Acted on Nick's reply to the "will it run when I hit run" audit, then *"install
and make sure everything is ready for real use"*. Nothing was enabled or launched,
`agentic-config.json` still does not exist, and nothing was committed or pushed.
Full detail is in docs/handoffs/CLAUDE_TO_ASTRA_AGENTIC_RUNTIME_HANDOFF.md §13.

What changed:

- A mid-task exterminate can now be resumed.
- Halts need no revision.
- Exterminate hard-kills a supervisor that is still alive after 20 s.
- Stuck or timeout goes to the reviewer; a failing reviewer returns the work to
  the worker.
- Only reviewed commits are built on.
- The swap guard needs sustained growth before it trips.
- Runtime recovery keeps going after a parked task and when the reviewer is
  unreachable.
- Keep-awake options and a lid/power preflight are in the Projects view.
- Every printed command carries `--project`.
- Discord `agent` control reaches the installed controller under launchd.

Installed:

- Discord bridge: reinstalled, not DRIFTED, connected. The fingerprint now
  covers the controller copy.
- ORION app build 275: same signing identity. The previous app is at
  /Applications/.Orion-previous-275-pre-keepawake-20260923.app.
- Plugin: already current, not redeployed.

Verification:

- 174/174 Node tests.
- 513/513 `swift test`.
- UI harness pass.
- Quick CI OK and remote check OK.
- Secret scan: nothing in the agentic files.
- Plan validates; the committed baseline passes the plan's suites (82/82).

## 2026-09-23 14:59 BST — Installed saved Projects workspace

Implemented Nick's requested project library and modern Projects UI. The installed
app now lists saved projects, remembers selection, imports Markdown/JSON plans,
and exposes Plan / Activity / Reviews, Open Markdown, Start/Continue with a time
budget, Pause/Resume/Stop/Exterminate, steering, and escalation resolution.
Registered `advance-orion-capabilities` with the five-task development backlog;
its saved plan is under ~/.openclaw/orion-controlled/project-agent/projects/
advance-orion-capabilities/plan.md. Registration created no run or enablement.

New scripts/orion-projects and scripts/lib/agentic/projects.mjs provide validated
snapshot registration and detached launch. Both existing control CLIs accept
--project ID; absent that flag the legacy singleton remains the target. A shared
fleet lease permits one project run at a time. Continue reconciles provably dead
interrupted workers before clearing stop; unknown task outcomes remain blocked.
Concurrent dead-lease reclaim now serializes through an exclusive reclaim guard.
Remote/Discord commands still target the legacy singleton, not saved projects.

New Swift ProjectLibrary.swift and rewritten ProjectTab.swift provide the library
and workspace. ProjectAgentStatus.swift routes fixed argv controls by selected ID;
DashboardView.swift labels the tab Projects. The worker boundary protects the new
launcher. See docs/agentic/OPERATING.md for current project commands.

Verification: 105 Node tests passed, 17 selected Swift tests passed, UI harness
passed, screenshot inspected, and installed-app accessibility state confirmed the
correct project, plan, controls and Ready to start / Enable & start state.
Independent reviewer found Continue-after-Exterminate blocked; fixed and added a
regression. Reviewer then exhausted usage, so final independent review is partial.
No actual model run or production launch was performed by this task.

Signed candidate build275 (1.2.0) installed at /Applications/Orion.app after
codesign strict verification and identity check. Prior build272 retained at
/Applications/.Orion-previous-272-projects-20260923.app. Installed app left open
on Projects -> Advance ORION capabilities -> Plan. This local candidate includes
the existing mixed dirty source; no commit, push, public release or phase closure.
Evidence logs and projects-library.png are in the current Codex task work/outputs.

## 2026-09-23 09:20 BST — Executable Markdown capability backlog

Nick clarified that the requested document is the phased product work queue,
not worker operating instructions. Retrieved the actual **Advance Orion
capabilities** task and its final product checkpoint: Phase57 disabled scheduler
registration/read-back and later full-route proof remain next. Current source
confirms preview and guarded runtime already exist; do not redo their guards.

Created docs/agentic/plans/advance-orion-capabilities.md: five bounded source-only
tasks across verification/registration, crash reconciliation/integration proof,
and an Astra review packet. Later roadmap inventory is deliberately not queued.
Added deterministic Markdown plan parser at scripts/lib/agentic/plan.mjs and
wired plan/init; JSON still works. Only marked contract blocks grant task scope;
general prose/examples do not. Existing initialized runs are not hot-reloaded.
Added fixed automation-install-tests check and six parser/boundary regression
tests, wired into runtime checks and CI. CLI validates five tasks, weight12,
zero scope findings. Independent review found nested task examples inside spaced
outer fences could be queued; fixed generic fence scanning and regression-tested.

Final full run99 tests passed; independent final parser review passed6 tests. No run
initialized or launched, no feature implementation delegated to local models,
no schedule or installed state changed. Earlier mixed dirty source retained;
no commit, push, deployment or roadmap gate closure. User-facing copy:
/Users/nickmadaio/Documents/Codex/2026-09-22/cont/outputs/ORION-Development-Backlog.md.


## 2026-09-22 — Reviewer runtime recovery (Nick-authorized addition)

Nick requested automatic reviewer recovery when an issue occurs during an unattended run. The supervisor now asks the reviewer to diagnose thrown loop/review/repair errors before escalating. The reviewer can authorize retry, unload resident models and retry with a fresh session, or request human escalation. Existing task-code repair remains constrained to the task scope and configured repair budget; recovery grants no shell, policy-edit, integration, or permission authority.

Recovery claims are saved in `state.runtimeRecoveries` before inference. Defaults are two recoveries per operation phase/task and six per run, persisted across relaunches. Inference has a 120-second recovery deadline; model unloading propagates cancellation. Failed or refused diagnosis and exhausted budgets escalate and notify before exit. A successful diagnosis only authorizes another attempt: normal checks, checkpoint review and final review still decide completion.

Stop, Pause, Exterminate, held/unknown worker leases, uncertain worker outcomes, explicit BLOCKED verdicts, check disagreements and unresolved escalations are not auto-cleared. This operates while the supervisor is alive; it cannot repair a powered-off machine, a crashed supervisor, unavailable reviewer, or startup failure before loop initialization. It does not install or enable the runtime.

# HANDOFF — ORION

**Last updated 2026-09-22.** This is the only handoff. If you find another one
that is not `docs/planning/v2/HANDOFF.md` (kept solely because `PHASE_GATES.json`
cites it as evidence for phases 1–33, and marked CLOSED at the top), it is stale
and should be deleted rather than read.

Read this, then `AGENTS.md` for how the codebase works, then `NICK-TODO.md` for
what Nick himself is waiting on.

---

## 2026-09-22 22:01 BST — Five agentic review findings repaired (Codex)

Continued the dedicated local-agentic mission and Claude-to-Astra handoff, not
numbered phase advancement. The starting tree contained Claude's uncommitted
mission, runtime and UI updates plus earlier shared edits; capabilities.md was
preserved. The prior read-only review reproduced five defects despite 77 green
Node tests. This pass repairs those five, with no enablement or deployment.

- Worker leases now use the ownership-record API. Existing ownerless locks are
  treated as held/uncertain. Live owners block recovery; dead child-process
  owners can be recovered. Retained uncertain leases prevent cleanup beneath
  a potentially live worker, including after Exterminate.
- Exterminate reaches task review, repair and final review; late inference
  replies cannot write, commit or publish acceptance. Durable cancellation is
  checked before publication as well as via the heartbeat signal. A repair
  commit already in flight stays audited, but cannot notify or requeue after
  cancellation. Cancellation does not generate a new failure escalation.
- Ordinary worker failures retry from HEAD within the original attempt budget,
  then reach bounded repair. Human-only refusals and uncertain outcomes stay
  excluded. Explicit three-attempt and transient-recovery regressions pass.
- Stop controls can clear the durable request even in ready/waiting-for-review
  state. The UI exposes the local one-hour restart command; CLI/phone responses
  distinguish clearing the request from restarting a process. Remote controls
  still do not launch unattended work. A stopped heartbeat is immediately not
  live. Restarting the supervisor after clearing Stop reviews its existing
  checkpoint instead of rerunning the worker.
- Smoke task one now permits the local greeting import its acceptance requires.

Verification: 88 Node tests passed, 0 failed (agentic suites and controller);
15 targeted Swift ProjectAgent tests passed, 0 failed; smoke-plan validation has
zero scope findings; secret scan clean with 30 reviewed allowlisted fixtures;
git diff --check clean. Independent scoped review: no remaining actionable
findings; its final three targeted tests passed. Real-source UI layout harness passed in all four states (1136 pt short
trace; +133 pt long trace; 1290 pt escalated; 1130 pt without telemetry). No real-model or overnight run is claimed by these tests.

Installed/runtime state: execution remains disabled; no production run was
created, no model settings or permissions changed, no Discord messages sent,
and no app/plugin installed. Changes remain uncommitted in the shared dirty
tree; no mixed-work checkpoint or remote push was made.

Evidence/rollback: `.builds/agentic-five-fixes-2026-09-22/` stores verification logs
and `pre-five-fixes.patch`, preserving the pre-pass tracked diff. Revert only
this pass's reviewed hunks; do not reset or overwrite the shared dirty tree.
New cancellation helper is `scripts/lib/agentic/cancellation.mjs`.

Next gate: run the corrected bounded real-model smoke plan after deliberate
local enablement, before unattended production development. See
`docs/handoffs/CLAUDE_TO_ASTRA_AGENTIC_RUNTIME_HANDOFF.md` and the current
`docs/agentic/LOCAL_AGENTIC_DEVELOPMENT_MISSION.md`; no numbered phase closed.

---

## 2026-09-22 — Task-level escalation, measured model choice (Claude)

THE CONTINUITY FIX. Escalation was run-level: one BLOCKED review stopped
everything, and independent tasks sat untouched until morning. That contradicted
the stated intent directly. Schema v3 makes escalations a list, each naming a
task or the run; a task-level one parks that task alone and the loop carries on.
`escalated` now means "nothing claimable remains", not "an escalation exists" —
and the panel tells those apart, because conflating them teaches you to ignore
the alert. Proven end to end: a BLOCKED review parks one task while an
independent one still runs, reviews and commits.

Also fixed the defect three separate models tripped over: the reviewer was shown
the cumulative run diff and asked whether THIS task violated its scope. It saw a
forbidden file modified — by a task it had already accepted — and escalated.
`diffForCheckpoint` shows one checkpoint. That bug killed 2 of 3 benchmark runs
and read as model confusion.

Reviewer now RE-RUNS the contract's checks rather than trusting the worker's
report; a disagreement is a `contradiction` escalation. Subtasks exist durably
(`### SUBTASK: 2/4 label`), owned by the runtime, shown in the panel, with no
authority over acceptance. Informational Discord tier for reviewer repairs —
one line, own rate limit, never asks for anything. Bare-minimum repair tightened
6 files -> 2.

MODELS, MEASURED. Eight candidates, two evals, 15 reviewer runs, cross-checked
against published SWE-bench. qwen3.6:27b both roles: 3/3 planted defects with
zero false positives every run, 77.2% SWE-bench, and one model means residency
never changes. The quantized 80B codes well and reviews badly (1/2 judgment
defects, 4/4 runs) which matches published work on MoE routing damage under
aggressive quantization; it is retired. Model choice is settable from the UI;
`enabled` stays a deliberate file edit.

65 Node tests, 503 Swift cases, layout harness green, CI --quick OK, secret scan
clean. Still NOT run against ORION code; still gated on agentic-config.json
{"enabled": true}, which does not exist.

---

## 2026-09-21 20:1x BST — Project agent UI and the live reasoning channel (Claude)

Two clocks, not one: plan progress from accepted task WEIGHT, current-task
progress from the recorded stage. They answer different questions and one ring
would answer neither. Neither number comes from a model.

Inference now STREAMS, which is what makes a live reasoning channel possible and
also makes "it is thinking" an observed fact — a non-streaming request to a 27B
is indistinguishable from a dead runtime for nine minutes at a time. The trace
goes to activity.json: one disposable snapshot, throttled to ~400ms, never
fsynced, deliberately NOT the journal, which reasoning traces would bury.
Thinking transitions bypass the throttle because a lagging indicator cannot do
the one job it has.

Panel also reads the agent's own operating-system prompts from the repository
(never duplicated), marks review-authored tasks, surfaces reviewer-authored code
as work that was not independently reviewed, and shows settings READ-ONLY —
`enabled` lives outside the repo so moving it takes a deliberate act, and a
toggle in a window is not that act.

Streaming exposed that probe() checked a model was installed but not usable as
configured: `think: true` against a model that does not support thinking is a
400 on every generation, i.e. a run that does nothing all night. probe() now
does a one-token generation per role.

Verified by measurement, not by looking: Tests/run-project-agent-ui.sh lays the
real panel out in a real NSHostingView and checks the reasoning channel keeps a
viewport inside the dashboard's ScrollView (+133pt for a 6000-char trace). That
is the nested-same-axis-ScrollView defect this repo already lost time to.

Fixed a PRE-EXISTING breakage on the way: every GUI harness in native/Orion/Tests
was failing with "no such module 'MobileCore'" because SessionService began
importing it from OrionMobile and build-modules.sh never built or linked it.
LayoutHarness is still red for an unrelated reason (BreakSurface.isFullBleed).

59 Node tests, 503 Swift cases, CI --quick OK, secret scan clean. Still NOT run
against ORION code; still gated on agentic-config.json {"enabled": true}, which
does not exist.

---

## 2026-09-21 16:2x BST — Local agentic development runtime (Claude)

Built the unattended local development loop Nick specified: a ~27B worker
implements against explicit task contracts, a stronger local model reviews
against those contracts, and a deterministic supervisor owns every gate. Mission
recorded at docs/agentic/LOCAL_AGENTIC_DEVELOPMENT_MISSION.md; design and the
eleven deviations at docs/agentic/ARCHITECTURE.md; transfer at
docs/handoffs/CLAUDE_TO_ASTRA_AGENTIC_RUNTIME_HANDOFF.md.

Controller moved v1 -> v2 in place: full contracts, PASS / PASS_WITH_TASKS /
BLOCKED, bounded reviewer repair recorded SEPARATELY from reviews, escalation
state the loop cannot clear itself, append-only journal, lease with PID+boot+
start-time proof, crash recovery that discards partial writes to the last
accepted commit. Astra's 12 tests still pass unchanged in substance.

Worker gets a fixed tool vocabulary, never a shell; checks are registry names
with fixed argv, never strings from a task. Writes pass four gates, the last of
which loads ORION's INSTALLED self-change policy and fails closed. Reads are
deny-listed for var/brain/, .env and key material. Discord escalation carries a
phone-readable brief; Astra escalation stays MANUAL and pauses the run.

54 Node tests, 8 Swift tests (247 in the full app suite), CI --quick OK, secret
scan clean. Xcode license is now accepted, so the native build and XCTest run.
Tests caught three real bugs, including a `git status --porcelain` trim that
truncated the first changed file's path and would have wasted a whole night.

NOT RUN against ORION code. Execution is gated on ~/.openclaw/orion-controlled/
agentic-config.json {"enabled": true}, which does not exist. No 80B reviewer is
installed, so that half of the hierarchy is untested. Legacy scripts/orion-code
and GOVERNED_SELF_DEVELOPMENT_ENABLED untouched; do not launch the legacy loop.
No push, deploy, install or config write. capabilities.md and all worktrees
preserved. No numbered gate closed; scopeNotInManifest entry updated.

---

## 2026-09-21 15:31 BST — Disabled project-agent foundation; handoff to Claude

User requested stopping at a stable source checkpoint and a technical handoff,
not further agentic-workflow implementation. Authoritative transfer details:
docs/handoffs/ASTRA_TO_CLAUDE_AGENTIC_LOOP_HANDOFF.md. This is a scoped transfer
record; this file remains the live project handoff.

Built fixture-only durable controller, revisioned operator CLI and source Projects
view integration. No worker/model/reviewer transport enabled, no production run
state initialized, no app deployment. Independent review's three defects fixed:
lifecycle corruption, verification after timeout and pending steering at closure.
12 controller tests pass independently. Native status typechecks; six standalone
checks pass. Full native app build/XCTest blocked by unaccepted Xcode license.
Do not treat syntax checks as UI build proof. Existing self-development enablement
flag remains false. New scope registered without altering numbered gates.

46/85 complete (54%),25 in progress,14 not started. Preserve capabilities.md,
existing worktrees, personal state and installed configuration. Next work belongs
to Claude after this checkpoint; do not launch the legacy coder as a substitute.

---

## 2026-09-21 09:19 BST — Scheduler entry point and guarded preview

Added scripts/orion-automation-run and a sanitized tick adapter: accepts only an
installed name, evaluates the current minute through the guarded runtime, emits
status/reason only, and never prints calendar output into scheduler history.
Added human CLI schedule-plan <name> --timezone <IANA> with explicit expiry,
conditions, limits and derived argv. Installed OpenClaw help confirms --cron,
--tz and --command-argv; the old --schedule/--timezone route was obsolete and
bypassed runtime limits. Removed that route; install now explicitly refuses
until guarded registration exists. Existing jobs and removal are untouched.

Plan specifies disabled creation, exact timing and no fallback delivery. It is
not an installation. No scheduler job, installed policy or ledger was created.
Evidence: .builds/phase-57-schedule-2026-09-20/ (initial CI, installed CLI help,
actual install refusal) and .builds/phase-57-schedule-2026-09-21/ (final tests and
scan). Report: docs/planning/v2/PHASE_57_SCHEDULE_2026-09-21.md.
Review caught host-local expiry in the preview; fixed selected-zone current-date
and180-day validation plus invalid clock refusal.82 automation tests pass
independently; quick source CI passes348 plugin tests and82 automation tests.
Secret scan clean; dependency network audit skipped.

Overall46/85 (54%) unchanged. Next: human-only transactional registration of
policy/ledgers and a disabled job, exact read-back verification, then activation
and disposable full-route proof. Missed trigger minutes are not caught up.
No new hands-on task. Preserve capabilities.md. Rollback scoped source checkpoint;
no production schedule restoration needed. Checkpoint local, not pushed.

---

## 2026-09-20 01:44 BST — Candidate installed-policy executor

Added scripts/lib/orion-automation-runtime.mjs: reads existing installed record,
requires initialized runtime ledgers, dispatches exact agenda_today, rereads
policy and conditions before launch, then checks current authority. Explicit
installation timezone, bounded subprocess time/output, no inferred retry safety
after launch. No scheduler entrypoint, installation initialization or sender.
Extracted shared pure condition check from admission to prevent rule drift.

Independent review reproduced revocation during a slow final context probe;
fixed ordering so final authority is checked after context/record checks. All74
automation tests pass independently, including real disposable subprocess success
and write-then-fail/no-retry, policy changes, revocation, expiry/focus/mode and
midnight/quiet boundaries. Source quick CI and secret scan recorded in
.builds/phase-57-runtime-2026-09-20/. Report: PHASE_57_RUNTIME_2026-09-20.md.

Overall46/85 (54%) unchanged. No real calendar command, schedule, permission,
installed plugin or personal state changed. Next human installer migration and
scheduler entrypoint, followed by disposable complete-route proof. Existing old
installed records lack new ledger/identity fields and deliberately refuse. Policy
checks and process spawn are not atomic; timeout does not prove descendant
cancellation. No new hands-on task; preserve capabilities.md. Rollback scoped
local source checkpoint, no live restoration needed.

---

## 2026-09-20 01:08 BST — Live read-only automation host checks

Added scripts/lib/orion-automation-host.mjs: fresh installed authority map,
bounded native session status probe, conservative legacy focus handling and
eligibility for exact agenda_today only. No executor, installation grant or sender.
Unknown focus remains unknown; revoked/ambiguous authority refuses. Source-map
AUTO alone never enables standing routines or daily rollup. Candidate catalog
fallback and CLI mode/profile overrides refuse.

Live read-only proof: guarded mode, focus inactive, agenda eligible, standing
refused. No action, schedule, permission, installed plugin or personal-plan change.
11 host tests plus existing52 pass (63 total). Full quick CI passes348 plugin
tests and initial60 automation tests; final63 pass after extra review coverage.
Independent review and evidence recorded in PHASE_57_HOST_2026-09-20.md and
.builds/phase-57-host-2026-09-20/. Dependency network audit skipped by --quick.

Overall46/85 (54%) unchanged. Next: installation-bound production executor with
fresh authority at effect boundary, human installer wiring and disposable full
route proof. These checks establish eligibility, not an execution grant. Outbound
authority/transport remain absent. No new hands-on step. Preserve capabilities.md.
Rollback scoped local source checkpoint; nothing deployed by this slice.

---

## 2026-09-19 17:26 BST — Candidate delivery budgets and separate outcomes

Extended admission with separately keyed message reservations (0..48/day) and
candidate dispatcher with explicit installation-bound target plus exact-body
outbound authorization. Fresh conditions/expiry checked after action, reservation
and delivery-pending receipt persisted before fixture transport. Action completion
is separate from delivery failure/uncertainty; no automatic message retries.

Independent review reproduced cross-ledger clock regression permitting an extra
message; fixed delivery time floor against successful action admission.52 tests
pass independently (12 delivery+17 dispatch+15 admission+8 removal). Full quick
CI passes348 plugin+52 automation checks; dependency network audit skipped. Tests include
process contention and real exits before/after simulated delivery. No real sender,
schedule, permission, installed plugin or personal state changed. Report:
docs/planning/v2/PHASE_57_DELIVERY_2026-09-19.md; evidence:
.builds/phase-57-delivery-2026-09-19/.

Overall46/85 (54%) unchanged. Next production authority/context/execution/transport
adapters, human installer wiring and disposable complete-route proof. Provider
idempotency, approval consumption and power-loss recovery remain unproven. No new
hands-on task for this slice. Preserve capabilities.md; rollback scoped checkpoint.

---

## 2026-09-19 16:47 BST — Candidate automation dispatcher executes through guard

Built scripts/lib/orion-automation-dispatch.mjs around the durable admission
guard: fixed action table, installation fingerprint, trigger timing/replay guard,
exclusive execution lock, pending receipt, per-attempt authority/quota checks,
bounded safe retry and durable stopped/unknown states. No production adapters,
installer wiring or notifications enabled. Fixture proves actual disposable file
effect and refusal to replay it. No live schedule, permission or plugin change.

Review found ready state during retry could allow execution after adapter failure;
fixed to remain pending. Independent40 tests pass (17 dispatcher,15 admission,
8 removal), including real child exits and receipt publication faults. CI includes
all three suites. Full quick CI passes348 plugin+40 automation checks; dependency
network audit skipped. Report: docs/planning/v2/PHASE_57_DISPATCH_2026-09-19.md; logs:
.builds/phase-57-dispatch-2026-09-19/.

Overall46/85 (54%) unchanged; Phase57 remains open. Next production authority/
context/execution adapters plus message budgets, then human installer wiring and
disposable end-to-end proof. daily_rollup cannot be assumed retry-safe after an
ordinary process failure. No new hands-on task; old Trash ticket remains expired.
Preserve capabilities.md and personal state. Roll back scoped checkpoint only.

---

## 2026-09-18 13:40 BST — Durable automation admission guard built, not connected

Implemented scripts/lib/orion-automation-admission.mjs with explicit state
initialization, installation-bound policy, zoned inclusive expiry, daily attempt
limits, quiet/focus/effective-mode checks and fail-closed durable reservation.
Independent review found inconsistent day/timestamp could replenish quota; fixed
with stored-state invariants and regression tests.15 admission+8 removal tests
pass independently, including competing child processes, persistence failures and
process exits around atomic replacement. Full quick source CI passes348 plugin
tests and23 automation checks; network dependency audit skipped.
Report: docs/planning/v2/PHASE_57_ADMISSION_2026-09-18.md; evidence:
.builds/phase-57-admission-2026-09-18/. No real schedules/actions/state initialized.

This is admission-only. Installer/dispatcher/message limits/retry/trigger identity
and actual action authority remain unconnected. Phase57 expiry remains blocked;
46/85 (54%) unchanged. Next build bounded dispatcher, then fix install wiring and
prove disposable end-to-end execution. Existing Trash ticket expired ungranted;
no new hands-on step needed for this slice. Preserve capabilities.md and test
copy fixtures. Rollback scoped source checkpoint, no live restoration required.

---

## 2026-09-18 11:58 BST — Truthful automation removal; expired test approval

User continued after the earlier Trash ticket expired. Read-only check showed
A-QZV3 has no grant; no deletion occurred. Do not treat continue as granting the
human-only action. File-copy deployment d7d80e8 remains verified. Installed proof
and corrected Phase47 evidence saved in local checkpoint c07dc48.

Fixed Phase57 remove falsely reporting success after scheduler errors: complete
JSON list, exact unique name/ID, post-removal absence verification, no local
transition on uncertainty. Warn active tasks may finish.8 isolated tests plus
full quick CI (348 plugin tests) pass; independent code/CI reviews clear.
No real scheduler mutation. Read-only automation list:0 proposed,0 installed.
Report: docs/planning/v2/PHASE_57_REMOVAL_2026-09-18.md.

Corrected expiry evidence: required expiresOn metadata is not runtime enforcement.
Phase57 expiry is blocked; Phase58 dependency flag updated. Overall46/85 (54%).
Next implement bounded automation runner enforcing expiry/conditions/limits before
fixing install wiring. Trash recovery needs a fresh scoped human approval when
Nick is ready. Rollback scoped checkpoint; no production schedule restoration.
Preserve capabilities.md and disposable copy proof files. No remote push.

---

## 2026-09-18 04:02 BST — File copying deployed and proven; human Trash gate pending

Protected clean-checkout deployment of d7d80e8 passed rehearsal and all live
deployment suites. Installed/built fingerprint e0fbbeb7ab40. Gateway restarted,
114 actions loaded and normal tool discovery passed. Real copy and overwrite
refusal proven in ledger plus independent byte checks. Personal plan/config and
authority files unchanged. Mac app unchanged. Rollback snapshot20260918-035928
also saved under .builds/phase-47-76-2026-09-17/rollback/.

Independent review corrected inaccurate Phase47 scope prose and reopened Trash
recovery: previous passed row showed implementation, not actual recovered bytes.
Copy requirement passes; Phase47 and predecessor deviation remain open. Overall
46/85 (54%). Details: docs/planning/v2/PHASE_47_LIVE_COPY_2026-09-18.md.

Hands-on step presented immediately: Nick runs scripts/orion-approve A-QZV3 in
Terminal, for only disposable copy-proof-d7d80e8/copied.bin. Ticket expires04:16:47
BST today. The assistant must not grant it. No deletion happened. Once approved,
retry exact file_delete through gateway, inspect recorded Trash destination,
recover fixture and compare bytes. If expired obtain a fresh ticket. Preserve
unrelated capabilities.md; no remote push. The isolated deployment checkout's
audit-generated JSON changes are ours, not release source changes.

---

## 2026-09-18 03:17 BST — File-copy packaging and deployment prerequisites verified

Final independent review cleared helper packaging and fingerprinting. The full
candidate source preflight then caught file_copy missing from the capability
registry; the generator now records source-preserving read/write effects and
regeneration adds exactly one action (114 total), leaving all previous entries
unchanged. Independent review verified that result and the generated JSON.

After repair, the full quick source suite passes (348 plugin tests, typecheck,
schema, policy/catalog contracts, source secret scan and document checks). All
six other deployment suites pass: coverage, strictness (33 checks), authority,
lock, remote and phase-gate consistency. These were invoked directly against
the candidate; this was not an installation or a clean-tree deploy rehearsal.
Dependency-network audit was skipped by --quick. Evidence: preflight-*.log in
.builds/phase-47-76-2026-09-17/. Earlier source/history scan was clean with3671
reviewed allowlisted findings. The saved personal-plan hash is unchanged.

Formal progress remains46/85 (54%). File-copy installed-service proof remains
open. No restart, install, authority change, remote push or hands-on user step.
Save the scoped reviewed batch locally, preserving unrelated capabilities.md.
Next: prepare a clean deployment candidate, compare all candidate/installed
production differences, then controlled deployment and actual tool-route copy
verification. Do not bypass the dirty-tree gate to sweep unrelated work into a
release. Rollback this local checkpoint; production has not changed.

---

## 2026-09-17 09:07 BST — Phase76 closed; file-copy candidate built and reviewed

User asked for substantial total-percent progress. Audited numbered phases rather
than inflating phone sub-checkpoints. Fixed Phase76 checker ignoring deploy's
ORION_CATALOG_DIST: four before-fix assertion failures now pass, unsafe/missing/
malformed candidates refuse, installed+candidate audits pass. Independent review
cleared closure as a smoke alarm only, retaining Phase75's prerequisite deviation.
Formal roadmap is now46/85 complete (54%),25 in progress,14 not started.

Built file_copy for Phase47 under existing file_mutate authority: regular files
up to64MiB, same mutable root, no overwrites, descriptor-relative no-symlink I/O,
verified hashes and manual hash-checked Trash inverse. Copied inputs do not become
self-authored. Review found cleanup-result loss, misleading verification evidence
and ancestor-swap exposure; repaired with failure/adversarial tests. Final review
clear.348 plugin tests/8 Python tests/build/compiled controller proof pass. Candidate
inventory passes17 entries/32 tiers. Source/history scan log in evidence folder.

Installed catalog still lacks file_copy; Phase47 deliberately remains open pending
controlled deployment and live route proof. No gateway restart, permission changes,
physical-phone setup, Mac app install or remote push. No hands-on step yet. Report:
docs/planning/v2/PHASE_47_76_PROGRESS_2026-09-17.md; logs:
.builds/phase-47-76-2026-09-17/. Preserve capabilities.md. Revert scoped checkpoint
for rollback; no production state restoration needed.

Independent audit also exposed actual remaining Phase57/63/67/75 gaps; report
lists them. Do not close those from historical passed requirement rows. Next:
installed copy proof, then automation runtime enforcement defects. Persistent
phone enrollment remains open; no total progress claim was based on saving labels.

---

## 2026-09-17 03:34 BST — Remember and forget local connection details

Added an off-by-default Remember this connection choice to explicit review. Only
successful approved reads save display metadata, bound to the phone fingerprint;
no token, grant or plan is persisted. Control displays the record after normal
relaunch without connecting. Forget cancels pending work, clears live reading
and removes the saved record. Invalid metadata is not treated as verified.

All15 Swift tests pass. Actual Simulator opt-in/read/disconnect/relaunch/forget/
relaunch passes; cancellation with opt-in enabled saves nothing. Both scenarios
retain exchange/fallback-refusal/durable-revocation checks. Physical iOS compiles
unsigned only. Independent source review has no actionable findings. Report:
docs/planning/v2/REMEMBERED_CONNECTION_2026-09-17.md. Evidence:
.builds/phone-remember-2026-09-17/ plus phone-pairing-check xcresults.

This is display history, not durable account enrollment or reusable read authority.
No hands-on step required. Roadmap53% unchanged; Mac build232 and personal plan
hash unchanged. No production install or remote push. Next: durable host-side
read authorization tied to approved enrollment, retaining fresh phone-key proof
and revocation on every read; then connect that to user-controlled phone setup.
Rollback scoped checkpoint and use Forget for an opted-in record. Preserve
capabilities.md and persistent device keys.

---

## 2026-09-16 17:35 BST — Explicit local phone connection review

The Simulator can now review a validated local setup before exchanging its grant.
Connect uses the immutable reviewed value; decline makes no request. Cancel
connection prevents delayed exchange completion from installing a token or
replacing disconnected state. Review mode excludes legacy bootstrap loading.
Optional --review-connection on timed personal previews waits at most90 seconds
for approval/first read, then applies the existing bounded preview timer.

Actual review/decline/relaunch/approve/read/disconnect and delayed signed-exchange
cancellation scenarios pass. Cancellation reached both exchange endpoints but
made zero plan reads. Standard HTTP read/outage/recovery/revoke/fallback regression
also passes. Physical iOS compiles unsigned only. Independent review found no
open issues. Report: docs/planning/v2/PHONE_CONNECTION_REVIEW_2026-09-16.md.
Logs: .builds/phone-setup-review-2026-09-16/; UI xcresults in phone-pairing-check.

Still disposable account enrollment; this is explicit connection review, not
persistent account setup. Human-operated reviewed-preview invocation not claimed
as proven. No hands-on action required for this slice. Roadmap53% unchanged.
Mac build232/personal plan unchanged; no production install or remote push.
Next: durable user-approved configuration/enrollment and physical transport.
Rollback scoped checkpoint; preserve unrelated capabilities.md.

---

## 2026-09-16 15:05 BST — Immediate phone reading disconnect

Found that the authenticated phone reader had no local off control. Control now
clears its token, snapshot and history, cancels active transport and invalidates
old callbacks with a connection generation. This is local disconnect, not server
membership revocation; the UI states that distinction. Pending-refresh cancellation
is visible. Existing explicit harness launch may reconnect from development setup.

Actual Simulator delayed-refresh disconnect passes, including proof that refresh
was pending at the tap and that later completion cannot restore state. Independent
review caught a timing-test gap; synchronous pending-state evidence fixes it, final
review clear. Existing HTTP read/outage/recovery/revoke and fallback refusal pass.
Generic physical iOS compile passes unsigned only. Evidence:
.builds/phone-disconnect-2026-09-16/; report:
docs/planning/v2/PHONE_DISCONNECT_2026-09-16.md.

Mac remains build232; saved revision8 hash unchanged. No hands-on action required
for this slice, no new account/provider or physical installation. Roadmap53% stays
unchanged. Persistent user-approved setup remains next; immediate disconnect is
now a tested prerequisite. Preserve capabilities.md. Rollback scoped checkpoint;
no installed production state changed and no remote push.

---

## 2026-09-16 14:46 BST — Authenticated personal plan and timed preview

The previous HTTP exchange checkpoint used synthetic data. Explicit --source now
publishes the saved personal plan through that persistent-key authenticated route;
--preview-seconds 1..120 opens a timed Simulator preview after the first successful
read. Source remains read-only; revocation, listener shutdown and matching setup
cleanup run on exit/interruption. Enrollment is still a disposable account fixture.

Actual revision8 read/refresh/revoke-clearing and 15-second preview pass. Screenshot
visually matches the saved stale plan. Source SHA256 remains a4111fae45135cfc2bd14b48b07f761df286bb63b2de5cdd11c707779ff0a5b1.
156 backend/publication tests and synthetic HTTP regression pass; invalid CLI
options refuse before build. Temporary setup/pairing files confirmed absent.
Independent personal-publication and timed-preview reviews have no open findings.
Report: docs/planning/v2/AUTHENTICATED_PERSONAL_PLAN_2026-09-16.md; evidence:
.builds/personal-auth-read-2026-09-16/ (including secret-scan.log).

Bounded authenticated personal preview milestone100%; formal roadmap53% unchanged.
Mac build232 remains untouched; no production account, physical deployment,
provider, permanent service or remote push. Preserve unrelated capabilities.md.
Next: persistent user-approved enrollment/configuration, then physical transport;
work from the phone identity/session modules and local device registry contracts.
Rollback this scoped local checkpoint; no production state restoration required.
The legacy personal preview remains available separately for regression comparison.

---

## 2026-09-16 09:07 BST — Phone session challenge/proof/token over HTTP

LocalSessionExchange issues120-second trusted-host bootstrap grants fixed to an
owner/device/key, then accepts one signed exchange. Optional loopback POST routes
validate bounded exact-length JSON, no duplicate framing/fields; plan writes and
other verbs remain refused. Simulator PhoneHTTPReadSession gets challenge,
signs with persistent key and receives read token entirely over HTTP; token is
memory-only. Failed exchange clears old state; HTTP mode excludes legacy token.

Actual Simulator HTTP exchange/read/outage/recovery/durable-revoke-clearing and
old-mode fallback refusal pass.153 backend checks pass; physical iOS compile
passes unsigned only. Review found truncated-body admission and old-session
retention defects; fixed with socket/UI regressions, final review clear. Cleanup
tracks observed containers and preserves unrelated files. Secret scan clean
(3521 reviewed); temporary HTTP/read/pairing files verified absent.
Report: docs/planning/v2/HTTP_DEVICE_SESSION_2026-09-16.md. Logs:
.builds/http-session-2026-09-16/ and .builds/phone-pairing-check/.

HTTP exchange milestone100%; roadmap53% unchanged. Setup grant still injected
via privatefile; account/enrollment remain fixtures. No real-account sign-in,
physicaltransport/TLS, provider, remoteactions or personal-plan publication via
this route. Macbuild232 and personalplan unchanged. No service installed/push.
Preserve capabilities.md. Next: deliberate host setup plus saved personal-plan
publication on this authenticated route, then physical/account-auth gates.
Rollback scoped checkpoint; no production store/runtime changed.

---

## 2026-09-16 08:57 BST — Persistent phone key opens a local read session

DeviceReadChallenge binds owner/device/public key/server nonce with a distinct
message domain and signing-time expiry. Simulator-only bridge compares the
request key to its actual stored key and signs; DeviceReadSessions exchanges
that exact proof for the token used by the real Swift HTTP reader. Combined
pairing/approval/session/read/outage/recovery/revoke flow passes. A final isolated
--read-session rerun after cleanup repair also passes, including replay refusal
and durable revoke clearing reading and surviving process restart.

143 backend tests and13 Swift tests pass; generic physical-iOS build compiles
unsigned only. Independent review found intermediate Simulator-container cleanup
gap; all observed directories now tracked, two regressions independently pass,
no remaining findings. Source/history scan clean (3491 reviewed). Report:
docs/planning/v2/PHONE_KEY_READ_SESSION_2026-09-16.md. Evidence:
.builds/phone-key-session-2026-09-16/ and .builds/phone-pairing-check/.

Persistent-key issuance milestone100%; roadmap53% unchanged. Fixture enrollment
and private-file challenge/token delivery remain; no production auth endpoint,
real account or physicalphone proof. Personal-preview still separate legacy
development-token route. Mac build232/personal plan hash unchanged, temporary
files/stores cleaned, persistent Simulator key retained. Preserve capabilities.md.
Next: bounded authenticated local exchange transport replacing private files,
then real-account/physical deployment gates. Revert scoped local checkpoint for
rollback; no production service/store installed, no remote push.

---

## 2026-09-16 02:53 BST — Device-bound local read sessions verified

DeviceReadSessions now exchanges fresh single-use signatures bound to owner,
registered device/key and challenge for short-lived opaque local read tokens.
Every resolution checks fresh durable device trust; revoke/failed attestation
refuses401 and retires token. Storage lookup failure refuses503 without trusting
cache. Restart invalidates all sessions/challenges. HTTP remains loopback-only,
GET /plan, no session-exchange/sign-in endpoint or real account activation.

141 combined tests pass; actual Simulator identity/sample/read-recovery scenario
passes with durable registry revocation causing next refresh to clear reading.
Real-P256 exchange/revoke test passes. Independent review eight session/ten
real-crypto checks pass, no actionable findings. Source/history secret scan clean
(3461 reviewed occurrences). Report:
docs/planning/v2/DEVICE_READ_SESSIONS_2026-09-16.md. Evidence:
.builds/device-sessions-2026-09-16/ and .builds/phone-read-check/.

Local session-enforcement milestone100%; roadmap53% unchanged. Simulator credential
is still a synthetic registered HMAC fixture, not its persistent key. Phone-key
pairing/approval was proven separately; persistent phone-key session exchange is
next. Personal-preview script intentionally still uses legacy harness token.
Mac build232 and personal plan unchanged. Temporary grant/stores cleaned; no
production service/provider/install/push. Preserve capabilities.md.
Next: connect persistent phone key to bounded session exchange/trusted owner,
then real-account physical transport. Rollback scoped checkpoint; no production
registry or installed app state modified.

---

## 2026-09-16 02:43 BST — Explicit Simulator pairing approval verified

Added immutable PairingApprovalRequest and PairingApprovalView, showing exact
joining device ID/full grouped key fingerprint. Approval requires a comparison
toggle then tap; request/account/offering-key/expiry validation is repeated at
signing. UI says confirmation signed/awaiting service acceptance, never paired.
Simulator-only bridge/signing route; no real account authenticated. In the test,
fixture Mac first admits phone, then persistent phone key explicitly approves a
new joining fixture device through actual UI and backend confirmation.

Approve/reject/expired scenarios pass, with real signature/id binding, replay
refusal and durable revocation across process restart. 122 backend tests +9Swift
tests pass; final three existing identity/sample/read-recovery UI scenarios pass.
Physical iOS compilation passes unsigned only. Independent review found ID-format
and cleanup-failure gaps; both fixed, verified and tested. Fingerprint rendering
visually checked after grouping fix. Source/history scan clean (3431 reviewed).
Two overlapping resumed UI runs were stopped and rerun sequentially; final
isolated results are the evidence. Report:
docs/planning/v2/PHONE_PAIRING_APPROVAL_2026-09-16.md. Logs under
.builds/approval-2026-09-16/ and .builds/phone-pairing-check/.

Local approval-screen milestone100%; roadmap53% unchanged. No hosted account,
physical-device/biometric proof, remote transport, or actual user pairing. Mac
build232 and personal plan hash unchanged. No global install or push. Temporary
files cleaned; persistent Simulator key retained. Preserve capabilities.md.
Next: authenticated local transport/session lifecycle with durable device status
checked on every request, then physical/real-account pairing. Revert this scoped
checkpoint for rollback; no production service or store was installed.

---

## 2026-09-15 21:56 BST — Durable local device registry and revocation proven

DurableDeviceRegistry adds private SQLite storage while preserving existing
owner/signature contracts. Transaction reloads prevent stale writers restoring
revoked trust; pairing confirmation serializes trust check and admission with
revocation. Explicit create=True only creates a fresh store; reopening missing,
truncated, corrupt or unknown-schema storage refuses. No auto-reset/migration.
Failed durable confirmation cancels pairing rather than retaining completed.

121 combined tests pass; actual Simulator P-256 pairing harness passes and a
separate Python process observes persisted revocation. Independent review found
and verified fixes for lost database recreation and completed-label-after-failed-
commit;18 durable tests independently pass. No remaining review findings.
Source/history secret scan clean (3401 reviewed occurrences); matching Simulator
request/proof files removed after final run.
Report: docs/planning/v2/DURABLE_DEVICE_REGISTRY_2026-09-15.md. Evidence under
.builds/durable-devices-2026-09-15/ and .builds/phone-pairing-check/.

Local durability milestone100%; roadmap53% unchanged. Offering account/key remain
fixtures; temporary durable store removed after proof. Pending challenges and
pairings intentionally die on restart. No real account paired or bearer-session
revocation integration. Mac build232 and personal plan hash unchanged. No remote
push, production service/store install or new dependency. Persistent Simulator
key retained. Preserve unrelated capabilities.md.
Next: explicit offering-device confirmation UI and authenticated transport/session
lifecycle, with fresh durable device status on decisions. Rollback local checkpoint;
never delete a real registry/tombstones automatically.

---

## 2026-09-15 21:47 BST — Real phone pairing signatures verified locally

Added explicit P256Verifier with optional cryptography50.0.1 dependency; default
registry still refuses. Extracted PhoneDeviceIdentity.swift and added typed
pairing-claim signing. Simulator-only test bridge proves the persistent phone
key through existing registration/claim/confirmation/replay/revocation contracts.
Offering Mac key, account and registry are disposable fixtures; no real account
paired, no human confirmation UI or durable revocation claimed.

Fixed adoption's string-vs-tuple duplicate guard, which allowed a new key to
overwrite an existing/revoked device ID. Regression covered both with real crypto
and in the dependency-free suite. 60 identity/pairing tests +43 foundation/boundary
checks pass. Actual pairing UI/signature interoperability passes; three existing
Simulator identity/sample/read-recovery scenarios pass (46.035s). Unsigned generic
physical-iOS compilation passes. Independent review clean; reviewer reran60 tests.
Source/history secret scan clean (3371 reviewed occurrences).
Report: docs/planning/v2/PHONE_PAIRING_PROOF_2026-09-15.md. Logs in
.builds/phone-pairing-check/ and .builds/pairing-2026-09-15/.

Pairing-signature milestone100%; roadmap53% unchanged. Mac build232 and personal
accepted plan hash unchanged. No daemon, network endpoint, global dependency
install, real account pairing or remote push. Temporary bridge files cleaned;
persistent Simulator key intentionally retained. Preserve unrelated capabilities.md.
Next: owner-scoped durable device registry/revocation with restart proof, then
explicit offering-device confirmation UI and authenticated pairing transport.
Rollback: revert scoped local checkpoint; no installed Mac state to restore.

---

## 2026-09-15 14:22 BST — Persistent local phone identity verified

PhoneDeviceIdentity now creates/reloads P-256 Keychain references, exports only
the public key, and displays its fingerprint/status in Control. Lookup failure
does not regenerate; physical path requires Secure Enclave without software
fallback. Simulator key explicitly software-backed. No pairing/account claim.

Three actual Simulator UI scenarios pass including fingerprint persistence over
termination/relaunch, fresh challenge signing and changed-challenge rejection.
693 core checks + iOS library build pass; generic physical-iOS compilation passes
without signing/install. Independent review clean after retry-status fix.
Simulator scripts now use ad-hoc signing for Keychain entitlements. A missed
reorganization path in MobileCoreCheck now resolves docs/planning vectors.
Source/history scan clean. Report: docs/planning/v2/PHONE_DEVICE_IDENTITY_2026-09-15.md.

Local identity milestone 100%; physical hardware, biometrics, account pairing
and durable server revocation remain unproven. Key intentionally persists in
Simulator Keychain; temporary read credentials still cleaned. Mac build 232
unchanged. No REC/phase closure; roadmap 53% unchanged. Next: bind device public
identity into pairing/session contracts with approval and durable revocation.
Local checkpoint only; no remote push.

---

## 2026-09-15 14:09 BST — Personal accepted plan published to Simulator

Bounded personal-plan publication 100%. scripts/orion_phone_preview.py accepts an
explicit source, validates through Swift exporter and serves only the configured
owner via loopback. Refresh republishes valid revisions; export failure/rollback
refuses read and preserves durable snapshot. Actual revision 8 read+refresh UI
test passed; source date/reason/blocks matched visually and were labeled stale.
Normal 15-second preview exited with source unchanged; access file cleanup verified.
123 tests pass; independent publication review clean after fixing relative paths.
Report: docs/planning/v2/PERSONAL_PHONE_PUBLICATION_2026-09-15.md.

During continuation, unrelated repo reorganization landed through 3941e8f. Planning
is now docs/planning and plugin files live under plugin. Native paths unchanged;
relevant tests rerun on current tree. Do not undo those commits.
The reorganization dropped six historical fixture-path allowlist entries; exact
previously reviewed entries restored for the history scan, without new values.
Independent review confirmed restoration; full history scan clean (3311 reviewed
occurrences).

No physical pairing, production identity/TLS or installed background service.
Personal source unchanged, Mac build 232 unchanged, temporary copies cleaned.
Next: durable device/account identity and deliberate pairing, then remote
transport. REC gates remain open; formal roadmap 53% unchanged. Local checkpoint
only; no remote push.

---

## 2026-09-15 01:33 BST — Simulator read-only Today connection proven

Phone UI now reads actual loopback HTTP using synthetic data. Shared
TodayReadSnapshot validates owner/schema/plan, history rejects repeated old or
conflicting revisions, freshness preserves original evidence age. Explicit
TodayPlanExport validates a specified source without editing it; actual saved
revision8 export verified unchanged, never sent to Simulator.

Final twoUIscenarios pass: sample shell and network stale/outage/recovery/revocation.
Four Swift snapshot tests pass;693existing corechecks+iOSbuild passed before
explicit-null correction, which final Simulator build compiles. Python cleanup
regression passes. Independent review no remaining findings. Source/history
secret scan clean. Logs: .builds/phone-read-2026-09-15/ and .builds/phone-read-check/.
Report: docs/planning/v2/PHONE_READ_CONNECTION_2026-09-15.md.

Bounded Simulator connection100%; production auth/TLS/physical pairing and
normal personal-plan publication remain unimplemented. No permanent service
installed, no personal data sent to Simulator; fixture credentials cleaned.
Redirect/oversize transport cases source-reviewed only. Mac build232 unchanged.
Next: deliberate connection configuration and personal-plan publication, then
durable identity/remote transport. REC gates stayopen,45/85phases(53%) unchanged.
Preserve unrelated docs/planning/learning-proposals.md; local checkpoint only.

---

## 2026-09-14 22:42 BST — Local durable Today read-service foundation

Added backend/local_today/repository.py and backend/adapters/local_today.py:
private SQLite owner-scoped snapshots, transactional revision checks, read audit,
ephemeral local harness sessions and loopback-only GET /plan.119 combined tests
pass; final ten service tests and independent ten-test review pass. Secret scan
clean. Exact inbound http.server adapter exception preserves outbound restrictions.
See docs/planning/v2/LOCAL_TODAY_SERVICE_2026-09-14.md and backend/local_today/README.md.

Local service proof100%; phone remains sample-only. This is not account auth,
a deployed server or a connected-client closure. No real plan imported or daemon
installed; tests use disposable stores/sockets. Mac build232 untouched. Next:
validated Mac exporter and Simulator client with stale/offline/reconnect proof.
All live foundation/client REC gates remain open; roadmap53% unchanged. Preserve
unrelated docs/planning/learning-proposals.md. Local checkpoint only, no remote push.

---

## 2026-09-14 22:22 BST — Real phone Simulator shell delivered

The old “no iPhone app target” gap is now narrowed: native/OrionMobile has
OrionMobile.xcodeproj, the OrionPhone SwiftUI target, five tabs and clearly
labeled opt-in Today/Plan fixtures from shared TodayPlanScheduler. Default
state is disconnected. One actual XCTest UI route passed on iPhone17 Pro
Simulator/iOS26.5, including sample-open relaunch and dismissal;693 core checks
and iOS library build pass. Independent source review clean;secret scan clean.
See docs/planning/v2/PHONE_SHELL_2026-09-14.md and native/OrionMobile/README.md.

Simulator shell milestone100%; connected client remains unimplemented. No
authentication, pairing, real Today sync, durable backend, chat, push, HealthKit
or physical-phone proof. No phase/REC closure;45/85 phases remain marked complete
(53%). Mac build232 and accepted plan untouched. Next: authenticated read-only
Today route with owner-scoped durability and stale/offline/reconnect proof.
No provider choice, new integration, recurring cost or remote push. Preserve
docs/planning/learning-proposals.md. Outputs include phone screenshots and code links.

---

## 2026-09-14 21:47 BST — Today source recovery 100%; installed build 232

Source `0404632` prevents late callbacks and changed/unauthorized sources from
revalidating a stale preview. Direct EventKit status checks run at callback,
preview and acceptance. Final 56 focused tests +40 connection checks pass;
independent seven race tests pass with no remaining review finding. Earlier
full suite 489 passed before final permission correction. Secret scan clean.

Signed clean build 232 installed with matching identity and executable. Actual
Today refresh/preview showed an existing off-hours commitment unchanged,
insufficient free time and task deferral. Preview discarded; saved revision-8
plan unchanged. Permission-loss and recovery proof is controlled tests only.
Rollback: .builds/today-source-race-2026-09-14/rollback/Orion-229.app.
Report: docs/planning/v2/TODAY_SOURCE_RECOVERY_2026-09-14.md. No phase/REC closure,
remote push, external record mutation or permission/gateway change. Preserve
unrelated docs/planning/learning-proposals.md. Formal roadmap remains53% (45/85).
Next: numbered-manifest connected-client/durable-bridge gaps; physical
permission/overlapping-event experiments remain unproven.

---

## 2026-09-14 15:57 BST — Health summary 100%; installed build 229 live selection proven

The pending source-access gate cleared. Already-installed build 229 showed
real WHOOP refresh at 15:42, dated source facts and unchanged missing-log
uncertainty. Actual local-model completion at 15:56:05 produced a valid selection;
the Health UI displayed the selection attribution and leading Recovery Source
fact for the associated sleep ending September 14 at 07:19. Earlier invented
advice and the visible fixed-score coaching card are absent. No protected
dialog was operated and no reinstall was needed. Deep signature passes; saved
revision-8 plan fingerprint remains unchanged.

Health-summary repair is 100% complete; source `882681a`, installed build 229.
Proof: docs/planning/v2/HEALTH_SUMMARY_GROUNDING_2026-09-14.md and
.builds/health-summary-2026-09-14/verification.json. Rollback remains
.builds/health-summary-2026-09-14/rollback/Orion-227.app. Existing source test and
review evidence below is unchanged. No new test run is claimed for read-only
installed verification. No external records, permissions, credentials or gateway
changed by the agent. No remote push or phase/REC closure.

Nick also requested a code walkthrough: outputs/ORION_CODE_GUIDE.md in this
Codex task lists the actual Desktop source tree, reading order and linked
Health example. Finder was asked to reveal the real HealthSummary.swift.
He then said to continue implementation. Preserve progress percentages per
bounded repair and explicitly distinguish formal total: 45/85 phases marked
complete (53%), 26 in progress, 14 not started. Next work follows the product
delivery plan: remaining Today conflict/recovery proofs, then connected client
and durable bridge work. Do not mistake the summary for personal-baseline or
health-aware-planning completion. Exclude unrelated learning-proposals.

---

## 2026-09-14 07:40 BST — Build 229 installed; Health summary 95%, source access pending

Installed Orion is build 229 (1.2.0), clean source `882681a`. Build 25.55 seconds;
candidate/rollback/installed deep signatures and exact identity pass, installed
executable matches candidate. Rollback is
.builds/health-summary-2026-09-14/rollback/Orion-227.app; install.json records the
additional previous bundle. No active focus interrupted; saved plan revision 8
byte-for-byte unchanged. No source record, credential, permission or gateway
change by the agent, no remote push.

Actual Health route proves factual fallback, activity date and missing-log
uncertainty; no arbitrary model prose is rendered. WHOOP remains Checking with
SecurityAgent present. Nick was asked asynchronously to handle the macOS
Keychain prompt. Computer Use cannot operate that protected dialog. Do not
attempt another tool to bypass it. No live refreshed Health or optional model
selection proof is claimed for build 229. Test-generated 0ms September-13
health-choice entries are not live completions.

Continue at 95% of this repair (user asked for progress percentages). After the
prompt clears, inspect already-installed Health and its valid factual selection;
verify record dates, no old advice/coaching and unchanged saved plan. Do not
rebuild/reinstall. Source gate is done: 481 earlier native tests + 40 connection
checks, 38 health firewall checks, final 28 focused independent tests after two
review fixes, source/history secret scan clean. Report:
docs/planning/v2/HEALTH_SUMMARY_GROUNDING_2026-09-14.md. No phase/REC closure or overall
program completion percentage. Preserve unrelated learning-proposals.

---

## 2026-09-14 07:36 BST — Health summary source gate passed (85% of this repair)

User asked to continue and show progress percentages. Percentages refer to this
bounded Health-summary repair, not overall Orion/phase completion. Build 227 is
still installed. The new rail renders app-owned source/log facts with an optional
validated model ID selection; no arbitrary prose or legacy advice cache reaches
the view. Missing logs stay unknown, source periods replace score-based claims,
and visible generic-score coaching is removed. Raw WHOOP values remain outside
the model prompt.

Independent review repaired heart-only availability and removed-supplement
counting. Final 28 focused tests pass; earlier native 481 + 40 connection checks,
38 firewall checks and source/history secret scan pass. Full report:
docs/planning/v2/HEALTH_SUMMARY_GROUNDING_2026-09-14.md. Verified rollback:
.builds/health-summary-2026-09-14/rollback/Orion-227.app. Current plan fingerprint
recorded, no active focus. Next: clean signed candidate, exact identity, install,
normal Health route and a real optional selection. No source records, credentials,
permissions, gateway or remote push changed. Preserve learning-proposals. No
phase/REC closure; personal baseline and broader health-aware planning remain.

---

## 2026-09-14 02:08 BST — Build 227 installed; missing and refreshed Health routes proven

Installed Orion is 1.2.0 build 227, clean source `7fdba72`. Candidate/rollback/
installed deep signatures pass, exact designated requirement is preserved, and
the installed executable matches candidate. Build took 23.24 seconds. Rollback:
`.builds/health-source-2026-09-14/rollback/Orion-225.app`; install.json records the
additional previous bundle. No active focus interrupted, no source records,
permissions, credentials or gateway changed by the agent. Revision-8 plan
fingerprint unchanged. No push.

Actual Health route first proved explicit missing-reading state, all seven
sections and expanded source provenance. WHOOP then refreshed at 02:06; live
Health showed real available metrics, hours-in-bed labeling and 9h12 rounding,
source age, high corresponding WHOOP history confidence, moderate 14-reading
trend confidence and low manual-entry confidence. Source access is now clear;
no pending Keychain action for this verification. Final source harness 175/175,
independent review clear, final app compilation passed; earlier native wrapper
471 + 40 connection checks. Full report: docs/planning/v2/HEALTH_SOURCE_TRUTH_2026-09-14.md.

The earlier build-225 brief model-selection gap is also now proven through the
normal Today → Read it route; see BRIEF_GROUNDING_2026-09-12.md. That proof belongs
to build 225; build 227 Health proof is current.

Next bounded repair: the separate freeform Health summary still turned an empty
water log into immediate hydration advice and a generic sleep score into a
personal-baseline claim. Its generated prose remains outside the seven-section
repair. Inspect HealthTab.readingRail, HealthFacts/NarrativeFacts, NarrativeWriter
and existing grounded-brief selection; preserve Phase 33 raw-health isolation.
Also review older headline advice. Do not reinstall just to resume inspection.
No phase/REC closure or phone/backend continuity claim. Exclude unrelated
docs/planning/learning-proposals.md from any checkpoint.

---

## 2026-09-14 02:03 BST — Brief selection proven; Health source-truth repair ready

Already-installed build 225 now refreshes real WHOOP data. Today → Read it showed
Monday September 14 at 01:51 and a valid optional model-selected calendar detail
matching the 22:30 agenda entry. This closes the previous brief selection proof
gap without reinstalling or operating the protected Keychain dialog. Plan revision
8 remains byte-for-byte unchanged. See BRIEF_GROUNDING_2026-09-12.md for scope.

Health seven-section source repair now distinguishes unavailable readings from
no sleep/workout, labels time in bed, removes unsupported personalised advice,
uses per-measurement history and actual record age, and expires age each minute.
Independent review's mixed-history finding was repaired; final harness 175/175,
final app compilation passed, earlier full native 471 + 40 connection checks.
Source/history secret scan clean. Report: docs/planning/v2/HEALTH_SOURCE_TRUTH_2026-09-14.md.

Build 225 is still installed. Verified rollback is
.builds/health-source-2026-09-14/rollback/Orion-225.app. No active focus. Next: clean
signed Health candidate, exact identity check, install, normal Health route and
unchanged-plan verification. Existing freeform Health rail/headline interpretations
and connector Checking lifecycle remain separate work. No external source writes,
new permission, gateway restart, push or phase/REC closure. Preserve unrelated
docs/planning/learning-proposals.md.

---

## 2026-09-13 15:45 BST — Build 225 installed; factual brief live, Keychain detail check pending

Installed Orion is 1.2.0 build 225, clean source `becb18c`. Deep signature and
identity checks pass; installed executable matches candidate. Build-223 rollback:
`.builds/brief-release-2026-09-13/rollback/Orion-223.app`; install.json records the
additional previous bundle. No active focus was interrupted. Plan revision 8 is
byte-for-byte unchanged; no source record, permission, credential or gateway change.

Actual Today → brief shows correct Sunday afternoon and advancing observation time,
all-day context and one unfinished reminder despite nothing due. The JSON client
fix passed 471 native tests, 40 connection checks and independent four-case review;
secret scan clean. Build-225 optional AI-selected detail is NOT yet proven: health
source is stuck Checking with SecurityAgent running. Computer Use explicitly denies
access to com.apple.SecurityAgent; Nick was asked to handle the macOS Keychain
prompt. Do not try another tool to operate that protected dialog.

Next after prompt: inspect live source refresh/selected detail in already-installed
build 225; do not rebuild or reinstall. Report and exact boundaries:
`docs/planning/v2/BRIEF_GROUNDING_2026-09-12.md`. Test-generated 0ms narrative log entries
are fixtures, not live proof. Existing Health sections also mislabel pending source
readings as no recorded sleep/workout with high confidence; keep that separate from
the now-grounded brief. No REC or phase closure; phone/backend and remaining Today
scenarios stay open. Exclude unrelated learning-proposals from checkpoints.

---

## 2026-09-13 15:39 BST — Live brief fallback proven; JSON client boundary repaired

Build 223 launched after unlock. Real Sunday afternoon brief correctly retained
all-day context and unfinished reminder scope; Tasks showed the unchecked source
reminder. Saved revision 8 is unchanged. Optional detail failed because the shared
LocalModel client required sentence punctuation for the JSON selection. The actual
app log and call path establish this defect; prior rendering tests missed it.

Source now uses selectionJSON style for the brief, retaining other prose guards.
Four boundary tests exercise actual response decoding → writer → renderer/cache.
Full native 471 tests and 40 connection checks pass; independent review is clear.
Details: `docs/planning/v2/BRIEF_GROUNDING_2026-09-12.md`. Next: clean signed candidate,
retain build-223 rollback, install and prove the model-selected detail in the app.
No task/calendar change, new permission, gateway restart or push. Exclude unrelated
learning-proposals. No phase or recovery gate is closed.

---

## 2026-09-12 16:44 BST — Build 223 installed; Mac locked at live verification

Installed app is now Orion 1.2.0 build 223, source `dfcaee2`, built from the clean
release checkout. Candidate and installed deep signatures pass and identity is
unchanged. Orion was not running; saved plan fingerprint is unchanged. Build 221
rollback is `.builds/brief-release-2026-09-12/rollback/Orion-221.app`; install.json
records the second previous bundle. No gateway restart, new permission or push.

Built/tested: deterministic brief plus validated optional model selection,
per-component source periods, unfinished-reminder context and hostile-title
handling. 467 native tests, 40 connection checks and 38 health firewall checks;
final 12 tests and firewall repeated after wording refinement. Independent review
clear; final source/history scan clean. Full report:
`docs/planning/v2/BRIEF_GROUNDING_2026-09-12.md`.

NOT YET PROVEN: build 223's actual visible brief and model selection. Computer Use
reported the Mac locked; automatic unlock failed and Nick was asked to unlock it.
The app was not launched. Next after unlock: open installed Orion, inspect Today →
brief using real sources, confirm valid dated detail or factual fallback and unchanged
plan, then record evidence. Do not rebuild/reinstall just to resume this check.
Prior build-221 UI proof is historical. REC-USABLE-CLIENT and phone/backend remain
open. Preserve unrelated learning-proposals work.

---

## 2026-09-12 16:40 BST — Grounded brief source checkpoint

Build 221 is still installed. Nick said continue on the remaining inaccurate AI
brief. The repaired view now renders a deterministic time/calendar/task summary,
with at most one model-selected, allowlisted factual detail. Raw generated prose
and old freeform cache entries cannot appear. Unfinished work remains visible
even when nothing is due. Per-component WHOOP provenance uses linked sleep/end
and cycle start, not fetch/edit times; unknown ages remain unknown.

Full native suite: 467 XCTest cases and all 40 connection checks pass; health
firewall: 38 checks. Independent review passed 12 new tests and is clear after
canonical JSON cache keys and hostile title delimiters/bidi were repaired. Final
freshness wording also receives focused verification. Source/history scan clean.

Report: `docs/planning/v2/BRIEF_GROUNDING_2026-09-12.md`. Next: clean signed candidate,
verify build-221 rollback, install, inspect the ordinary brief and a valid optional
selection, then record installed evidence. Keep local plan state, permissions and
gateway intact. No push or gate closure. Exclude unrelated learning-proposals.

---

## 2026-09-11 16:54 BST — Build 221 installed and normal routes checked

Installed `/Applications/Orion.app` is now signed build 221 (1.2.0), clean source
`12583fc`; the previous build-220 statement below is historical. Identity and
candidate/installed deep signature checks pass. Actual UI confirms the correct
civil-date brief, working Command-Q, launch and closed-window reopen, live source
refresh and a fresh 16:53–17:23 task preview ending the day at 22:00. Preview was
discarded; saved revision 8 remains byte-for-byte unchanged. No new permission,
external task/calendar change, gateway restart or remote push occurred.

Full repair proof: 455 native tests, 26 health checks, nine transport scenarios,
five menu checks; secret scan clean; independent review clear. Its concurrent
redirect test timed out once but all 40 gateway checks passed in isolation. Main
full wrapper passed first run. Report distinguishes actual installed observations
from the midnight/zone/coverage regressions and the prior pinning/mobile fixtures.

Rollback: `.builds/today-release-2026-09-11/rollback/Orion-220.app`; install and
verification manifests identify the additional hidden previous bundle. Build 217
rollback also retained. No plan data should be removed during app rollback.

Next concrete issue: optional generated prose said “full day” late in the afternoon,
although Today budgeted only remaining hours. Ground brief narration in observation
time and actual source age, verify its claims, then finish remaining Today scenarios
and proceed to the phone shell/durable bridge. Files: `MorningBrief.swift`,
`DashboardView.swift`, `NarrativeWriter.swift`, WHOOP snapshot metadata and existing
health firewall tests. No REC-USABLE-CLIENT closure. Detailed evidence is in
`docs/planning/v2/TODAY_INSTALLED_PROOF_2026-09-11.md`. Preserve unrelated learning-proposals.

---

## 2026-09-11 16:48 BST — Installed Today proof and brief repair candidate

The earlier installed-217 statement is superseded. Clean source `187fa15` was
built and installed as signed build 220 with the original designated requirement.
Actual UI checks on 10 September proved real Calendar/Orion Reminders → preview →
accept, pin preservation and conflict refusal, restart persistence, local Finish,
extra time and Undo. Source reminder stayed unfinished; final local revision 8
is unfinished, unpinned and back to 30 minutes. Gateway and permissions unchanged.

Live use exposed a civil-date/activity-day mix-up in the brief and missing standard
Quit/reopen behavior. The repair separates the civil clock from the 4am activity
boundary, invalidates stale narrative, verifies source freshness/window coverage,
handles zone changes and date-only reminders, and restores Quit/reopen. Full native
suite: 455 XCTest cases pass. Independent review is clear; all 40 connection wrapper checks pass. Installed
repair proof is pending.

Evidence, limitations, rollback and exact next gate:
`docs/planning/v2/TODAY_INSTALLED_PROOF_2026-09-11.md`. Build 217 rollback is in
`.builds/today-release-2026-09-08/rollback/Orion.app`; retain a verified build 220
copy before replacing it. Next: finish review, checkpoint only these repairs,
build from a clean checkout, install with the same identity, verify civil-date
brief and standard Quit/reopen, then update this record. No push, phase closure
or phone/backend claim. Exclude unrelated learning-proposals work.

---

## 2026-09-08 22:55 BST — Pinned slots and source reconciliation

Nick said “continue.” The initial Today slice was committed locally as `f597f7f`;
this follow-up adds accepted task-slot pins. Replanning preserves them, including
ongoing blocks. Missed pins and calendar/transition/duration/day-budget conflicts
refuse the proposal instead of moving a pin. Individual unpin, release-all,
completion and undo stay inside the existing preview/accept flow. Confirmed
source completion/deletion releases its pin in a disclosed preview; local undo
cannot reverse that external source change. Older unpinned files decode normally.

Proof: full 448 XCTest cases pass; the last narrow Unpin repair also passed the
14-case app suite. Reviewer independently reran 46 Today cases and confirmed the
final source repair, with no actionable findings left. Eight critical mutants
are caught; MobileCore 693 checks and iOS Simulator build pass. Actual expanded
pinned content rendered with labeled fixtures and inspected. The connection
wrapper's 26 health, nine transport and five menu checks also pass.

Review caught stale pins after completion in Reminders and a remaining visible
Unpin action checking the already-reconciled list. Both are repaired with actual
model regressions. See updated `docs/planning/v2/TODAY_PLAN_IMPLEMENTATION_2026-09-08.md`.
Scoped pinning patch/logs: `.builds/today-plan-2026-09-08/pinning/`.

Installed build remains 217. No install, restart, new permissions, external
calendar/task write or remote push occurred. Next gate is an identity-preserving
candidate and installed real-source acceptance pass, not more pinning scaffolding.
The source pinning gap in the earlier entry is superseded. REC-USABLE-CLIENT still
needs installed Mac evidence plus phone/backend work; no gate or numbered phase
has been marked complete. Keep the unrelated learning-proposals edit excluded.

---

## 2026-09-08 01:29 EDT — Today/Plan source implementation

Nick said “start implementation.” Starting HEAD was `d0eeebb`; the only prior
uncommitted edit was `docs/planning/learning-proposals.md`, left untouched. Installed
build 217 remains installed. No runtime/permission/install change was made.

Implemented: actual-day calendar/Orion Reminders adapter; MobileCore real-gap
scheduler with protected off-hours, transitions and free time; Today-first Home;
preview/accept, local Finish block, 15 more minutes, replan from now and one-level
undo. Atomic local snapshot includes revision, undo and replay receipts. Stale
sources cannot become current advice, and a competing writer is reloaded.
Reminders nil snapshots are now unknown instead of an empty task list. Calendar
and source reminder records are not changed by plan operations.

Proof: 437 native XCTest cases pass, including 26 planner/store and nine actual
app model/adapter/view tests; 26 health, nine transport and five menu checks pass.
MobileCore 693 checks and iOS Simulator build pass. Six deliberate source mutants
are caught. Actual TodayPlanView rendered from synthetic inputs and inspected.
Independent review repaired stale advice, elapsed free totals, deadline order and
omitted new-work summaries; final reviewer reran 35 cases, no actionable findings
within this scope. Source/history secret scan clean with the existing allowlist.

Full details and alternatives: `docs/planning/v2/TODAY_PLAN_IMPLEMENTATION_2026-09-08.md`.
Rollback: scoped local source commit/patch and logs in
`.builds/today-plan-2026-09-08/`; nothing installed to roll back. Exclude the old
learning-proposals edit from any checkpoint. No push/remote backup claim.

Next: explicit pinned task slots and conflicts, then identity-preserving candidate
and installed Calendar/Reminders → preview → accept → restart → completion/replan/
undo proof. Task pinning and installed product proof are unmet, so delivery-plan
step 2 is partial. Phone/backend work remains required by REC-USABLE-CLIENT. No
phase counts or recovery gates were advanced. Historical missing-Mac-consumer
statements are superseded by this source implementation, not installed evidence.

---

## 2026-09-07 22:47 EDT — Product vision and first connection repair

Nick asked to assess the supplied product vision and start implementation. The
full delivery map is `docs/planning/v2/PRODUCT_VISION_DELIVERY_2026-09-07.md`; the
first slice and proof record are in
`docs/planning/v2/RUNTIME_CONNECTION_IMPLEMENTATION_2026-09-07.md`.

Found: installed Mac build 217, gateway and remote bridge running, valid live and
ready gateway probes. This supersedes the supplied document's earlier down
snapshot. Gates contain 45 complete, 26 in progress, 14 not started; the old
AGENTS/CLAUDE phase summaries were stale and now route to the canonical records.
No phase was advanced. DayPlan.propose exists but has no Mac app consumer.

Changed: typed bounded gateway health/readiness probe, expiring evidence,
contextual Home connection state, consistent dashboard/menu/preferences labels,
open-menu expiry/recovery refresh, and honest static-readiness labeling. Readiness
is not proof of a complete turn or an individual connector. No service restart,
install, permission/configuration change, credential access or remote push.

Verification: Mac build passes; 402 native XCTest cases, 26 connection checks,
nine real loopback scenarios, five menu checks pass. Five critical mutants are
caught. Component render inspected; production probe passes against the installed
gateway. Independent review findings repaired. Source/history secret scan clean
with the existing reviewed allowlist. Full installed UI/voice/conversation proof
remains outstanding; build 217 is still installed.

Rollback: isolated local source checkpoint; patch and logs at
`.builds/product-vision-2026-09-07/`. Do not reset the mixed tree. The existing
`docs/planning/learning-proposals.md` edit was excluded. Next: finish candidate Home
layout/release proof, then wire real agenda/tasks to a persisted Today/Plan
revision with completion/replan/undo using MobileCore. Follow the delivery plan's
REC-USABLE-CLIENT and REC-LIVE-FOUNDATION path; do not mistake this first repair
for complete runtime recovery or delivery of the whole vision.

---

## 1. Where the program is

**45 of 85 phases complete.** 25 part-done, 15 not started. The manifest is
`docs/planning/v2/MANIFEST_PHASES.json`; the live state is `docs/planning/v2/PHASE_GATES.json`
and that file, not this one, is the source of truth — this table is a snapshot of
it and will drift.

Two things to know before reading the table:

**"part-done" is not a synonym for "nearly done".** Several phases sit there
because one requirement needs Nick at a keyboard — a TCC grant, an OAuth
re-auth, a device — and the rest of the phase is finished and proven. Others sit
there because the work genuinely is not done. The unmet-requirement column is the
only way to tell them apart, which is why it is printed in full.

**The interpretation rule still applies** (see `AGENTS.md`): where a phase's text
refers to the Python runtime or `orion/*.py`, read it against the LIVE stack —
the Swift app in `native/Orion` and the TypeScript plugin in
`plugin/orion-control`. That changes how a requirement is READ, never
the order phases are done in.

| # | phase | state | what is still unmet |
| -: | ----- | ----- | ------------------- |
| 0 | Freeze, Inventory, and Understand Existing ORION | **done** | — |
| 1 | Establish Repository and Module Boundaries | **done** | — |
| 2 | Build the Model Router | **done** | — |
| 3 | Create the Context Firewall | **done** | — |
| 4 | Formalize Tool Contracts | **done** | — |
| 5 | Build the Policy Engine | **done** | — |
| 6 | Build the Audit System | **done** | — |
| 7 | Build the Event System | **done** | — |
| 8 | Build the Job System | **done** | — |
| 9 | Security Invariant Test Suite | **done** | — |
| 10 | Backend Foundation | **done** | — |
| 11 | Database Foundation | **done** | — |
| 12 | Secret and Credential Vault | **done** | — |
| 13 | Authentication | **done** | — |
| 14 | Device Identity | **done** | — |
| 15 | Device Pairing | **done** | — |
| 16 | ORION Mobile Foundation | **done** | — |
| 17 | Conversation and State Sync | **done** | — |
| 18 | ORION Memory v2 | **done** | — |
| 19 | Today Screen | **done** | — |
| 20 | Unified Capture | **done** | — |
| 21 | Task System | **done** | — |
| 22 | Calendar Read Integration | **done** | — |
| 23 | Planner v1 | **done** | — |
| 24 | Schedule Stability | **done** | — |
| 25 | Calendar Writes | **done** | — |
| 26 | Gmail Read/Search | **done** | — |
| 27 | ORION Action Inbox | **done** | — |
| 28 | Gmail Drafting | **done** | — |
| 29 | Gmail Sending | **done** | — |
| 30 | HealthKit Local Layer | **done** | — |
| 31 | Health Baseline Engine | **done** | — |
| 32 | ORION Health State | **done** | — |
| 33 | Health Privacy Firewall | **done** | — |
| 34 | ORION Health UI | **done** | — |
| 35 | Natural-Language Health Journal | **done** | — |
| 36 | Behavior Correlations | **done** | — |
| 37 | Experiment Mode | **done** | — |
| 38 | Health-Aware Planning | **done** | — |
| 39 | Daily Planning | **done** | — |
| 40 | Travel and Timezone Support | part-done | the live cron weather and day boundary are re homed |
| 41 | Notification Engine | **done** | — |
| 42 | Security Center | **done** | — |
| 43 | LOCK ORION | part-done | requires reauthentication for sensitive operations |
| 44 | Mac Remote Connection Foundation | part-done | no named requirement recorded |
| 45 | Remote Mac Read-Only | **done** | — |
| 46 | Harmless Mac Actions | part-done | supports mobile cancellation, optional arguments are visible where the model reads its capabilities, a timed out action is retried at least once |
| 47 | File Capabilities | part-done | adds files copy |
| 48 | Mac Privilege Separation | not started | splits execution into user worker and privileged broker, privileged broker exposes only a tiny explicit interface, keeps privileged code minimal, signs and hardens executables, prevents unauthorized replacement or tampering, binds destructive authorization to the requesting turn |
| 49 | Remote Approval System | part-done | shows a human readable approval on iphone, requires face id where appropriate, signs approval with a device authorization key, mac verifies signatures independently |
| 50 | Delegated Policies | part-done | every delegation defines capabilities resources exceptions limits expiration ceiling and devices |
| 51 | Structured Terminal Operations | part-done | the bare git allowlist entry is retired |
| 52 | Raw Terminal Access | part-done | treat raw terminal as r5 with session visibility faceid duration audit and cancellation |
| 53 | Automation Sessions for Complex Computer Work | not started | creates bounded computer use sessions, every session defines goal device apps directories domains capabilities and ceilings, requires additional approval to expand scope |
| 54 | Screen Observation Privacy Layer | **done** | — |
| 55 | Prompt Injection Defense for Computer Use | **done** | — |
| 56 | Remote Session UI | not started | shows task device step elapsed risk and capabilities on mobile, uses live activities where appropriate |
| 57 | Automation Framework | part-done | no named requirement recorded |
| 58 | Automation Simulation | part-done | uses historical data where available |
| 59 | Proactive ORION | not started | scores items by urgency actionability novelty confidence importance and interruptibility, places low priority suggestions in today |
| 60 | Focus Sessions | part-done | no named requirement recorded |
| 61 | Prep Cards | not started | no named requirement recorded |
| 62 | Waiting-On Tracking | not started | no named requirement recorded |
| 63 | Explainability | part-done | no named requirement recorded |
| 64 | Confidence Handling | part-done | no named requirement recorded |
| 65 | App Intents and System Integration | not started | adds ask add start focus whats my day run automation and lock, exposes through siri shortcuts widgets and control center |
| 66 | Live Activities | not started | uses live activities for focus sessions and remote jobs |
| 67 | Cost Controls | part-done | no named requirement recorded |
| 68 | Reliability Testing | not started | no named requirement recorded |
| 69 | Security Attack Testing | part-done | no named requirement recorded |
| 70 | CI/CD Security | part-done | no named requirement recorded |
| 71 | Data Inventory | part-done | no named requirement recorded |
| 72 | Privacy Controls | part-done | no named requirement recorded |
| 73 | Backups and Recovery | part-done | tests the four named recovery scenarios |
| 74 | Incident Response | part-done | no named requirement recorded |
| 75 | Development Workflow | part-done | no named requirement recorded |
| 76 | Features Explicitly Deferred | part-done | no named requirement recorded |
| 77 | Future Apple Watch Expansion | not started | creates a lightweight watch companion |
| 78 | Future Travel Assistant | part-done | adjusts schedule timezone |
| 79 | Future Reservation Capability | not started | discovers inspects presents books and records a reservation |
| 80 | Future Call Capability | part-done | no named requirement recorded |
| 81 | Future Location Context | part-done | maintains retention limits |
| 82 | Public Release Preparation | not started | tests account recovery device loss and secret rotation, performs the external reviews |
| 83 | Multi-User Hardening | not started | enforces tenant isolation and object level authorization, adds rate limits quotas and abuse controls, isolates jobs connectors memories and encryption context |
| 84 | Final ORION Mobile Product Shape | not started | delivers today plan orion health and control surfaces |
---

## 2. What happened in the 2026-09-05 → 09-07 run

Nick set seven priorities in his own order, then extended them. Every claim below
was verified in the moderating session by re-running the check or the mutation,
not taken from an agent's report — several agent reports were wrong in ways that
only re-running caught, and that is recorded where it happened.

### 2.1 The seven

**1 — Discord dispatch.** It works. `files desktop` was driven end to end through
`inject` → `poll` → outbox against the *installed* bridge with the real
allowlisted sender. Non-allowlisted senders, replays, `local` approvals and
fabricated gate ids were each refused by exercise rather than by reading.

The defect was on the failure path: a crashed or timed-out brain call put raw
exec output into the Discord reply — absolute paths, the message-file location,
and the live session key, in a DM, on every crash. Discord is a third party, so
that is a disclosure. It answers in one plain sentence now.

**Still not installed.** `orion-remote-install --status` reported DRIFTED.
Installing restarts Nick's only proven remote route, and that script is off the
exec allowlist deliberately.

**2 — "Do actual tests."** Asked "I have something this Friday" four times from
identical state on a Saturday, Orion answered Sep 5, Sep 12, Sep 5, and "Sep 5 —
that's today". The answer was Friday **Sep 11**; Sep 5 and Sep 12 are both
Saturdays. He had no grounded clock and was doing weekday arithmetic from memory,
which is why every wrong answer sounded confident.

One baseline run is the whole diagnosis: it tried `orion-agenda friday`, got an
exec failure, and fell back to `upcoming`. He was asking for the capability that
was missing — the tool had three subcommands and no way to ask about a named day.

Four repairs: a real `orion-agenda day <date|weekday|today|tomorrow>`; a dated
header printed by every subcommand (suppressed under `--json`, since a
fingerprint carrying today's date changes at midnight); a `## Dates` rule saying
dates are read from tool output, never worked out; and reminders checked
alongside the calendar, because "something on Friday" is as likely to be a task.
Eleven runs under one rubric: **57.5 → 91.7 → 100**.

**The harness needed more repair than Orion did.** It accused him of mutating the
calendar by string-comparing JSON whose key order is not stable; it read
`replayInvalid` as "untrustworthy" when OpenClaw defines it as *unsafe to replay
after compaction*, which every tool-using run sets; its tool parser looked for
`tool_use`/`input` while OpenClaw writes `toolCall`/`arguments`, so the
tool-selection dimension scored real behaviour against an empty list; and its
misdate regex passed the exact answers it existed to catch. The first correction
to that regex also caught nothing — `sept` never matches "Sep 5", and a trailing
`\b` fails on "12th" — which is why the replacement was verified against all
nine stored answers *before* being written.

**3 — Timeouts and visible progress.** Three ceilings, and two were exactly
equal: the client's hard read deadline (180+30) and the thinking watchdog were
both 210s. A tie, not an ordering, so one failure produced either the gateway's
specific error or the watchdog's generic one at random — which is why the same
symptom never looked the same twice. `RunTimeouts` states the ordering as a check
rather than three literals in three files. The agent's own budget went 180s →
300s, because "update yourself" is a build, a copy and a relaunch.

`RunProgressModel` gives the feed Nick asked for by name — "Ran two commands." —
and says so honestly when it knows nothing: "Still working — nothing new for
14s." **`openclaw audit` cannot distinguish domain actions**: calendar, mail and
health all dispatch through `orion_task_run` with the action in arguments audit
never records, so "Checking your calendar" was left unbuilt rather than faked.
**Cancellation did not exist at all** before this run; Escape was not even armed
during `.thinking`.

**4 — "He STILL cuts me off."** The setting Nick raised from 900 to 1400 ms was
never read in hands-free mode. Two independent end-of-turn decisions existed:
Deepgram's server-side endpointing, which honours it, and `AppState.checkHandsFree`,
which ended the turn on a hardcoded `handsFreeHangover = 1.3` and consulted the
setting nowhere. 1.3 fires before 1.4. Across the whole app that setting was read
in exactly two places: the Deepgram query string, and the Settings row that
displays it back to him. He was turning a knob wired to a label.

It is an adaptive model now — transcript stability, terminal punctuation,
confidence, and a continuation vocabulary — and a preserved fragment is appended
to what follows, so a premature endpoint costs a late sentence instead of a lost
one. Spoken barge-in exists, gated on the audio route.

**Unmeasured, and the design note says so:** the confidence floor (0.55), speaker
energy floor (0.22) and extension multiplier (1.8×) are reasoned, not measured;
whether Deepgram populates `confidence` for this account is unverified; wired
headphones are not distinguished from speakers.

**5 — Local models and personalities.** A personality cannot express authority,
and the compiler proves it: `PersonalityProfile` has seven fields and no
capability, tier, profile or strictness field exists to be set. The test runs the
real TypeScript compiler over the actual source plus a fixture that tries to add
`capabilityTier`, and asserts TS2353 — with a clean fixture asserted to compile
with zero diagnostics, so it cannot pass vacuously.

**6 — "The audio is terrible the second I talk to him."** He asked us to mask it.
It was avoidable. His headset is both default input and default output; opening
its mic collapses output 44100/2ch → **16000/1ch** and leaves it there four
seconds after he stops. Capturing from the built-in mic held **44100 stereo
through three full turns**. And restoring the route politely between utterances
*re-triggers* the collapse, because `AVAudioEngine`'s input node tracks the
system default for as long as the engine object exists — so the lease is held for
the app's run. The media duck now spans listening, thinking *and* speaking.

**7 — Permissions.** Already shipped 2026-09-02 as the strictness axis
(`contained | guarded | open | sovereign`), composing with the five-rung
permission profile, with a floor no mode can lower. The machine sits on `guarded`.

### 2.2 Capability and permission repair

`scripts/orion-learn` had been reading Orion's sessions the whole time: **263
sessions, 157 findings, none ever applied.** Retry loops alone had burned
**11,826,304 tokens**.

The top finding was not a prompt problem. `episodic.ts`'s durable-signal
classifier did not recognise "before I forget", so the harness's own live test
for capturing a fact stated in passing failed regardless of the instructions. Two
lines. `orion-bench --live` went 2/4 → 3/4 and P4, P5, P6 and P7 now report zero.

**The 11.8M-token loop had a cause.** Every transcript was the same shape: a
correct refusal that taught nothing, answered by guessing a different command.
`grep` **is** allowlisted; the *pipe* was refused, so the second guess reasoned
from a false premise the error itself supplied. That message comes from the
vendored openclaw package and cannot be patched here — but `before_tool_call`
fires first, so `routeForDoomedExec` now names the route before the unhelpful
refusal happens.

**Web search was dead.** It was in the tool profile all along; the free
DuckDuckGo provider was one of 61 disabled plugins and `plugins.allow` blocked
enabling it. Fixed at all three layers and verified with a live query. `web_fetch`
and readability extraction are on. Orion did not know he had any of it, so his
operating rules say so now.

**Computer use exists.** `screen_observe` walks the AX tree; `screen_capture` is
the pixel fallback, because AX metadata is text — cheap, redactable, and it does
not carry pixels of a bank balance. `screen_click`/`screen_type`/`screen_key` are
floored at APPROVAL in every mode including `sovereign`, and that floor is earned
by `reversible: false` + `risk: critical` rather than by `approvalRequired`
alone. **Both capabilities are behind config flags; observe is on, control is
off.** Neither works until the TCC grants land (§4).

### 2.3 The offline coder

`scripts/orion-code` — Orion changes his own code with no network. Ollama on
loopback, git local, tests local.

- **`orion-code loop --hours N`** is the agentic one: it surveys what this
  repository records as unfinished — 44 unmet phase requirements, the
  `orion-learn` findings, TODO markers; 92 items on the first run — picks one,
  writes its own concrete task, works out which file that means, edits, checks,
  commits, and asks again. It stops only when the survey returns nothing
  unattempted, two tries per item.
- **`orion-code flight --hours N`** works a fixed queue instead.
- **`selfdev_queue`** is the typed action, so Nick says it in a sentence.

**Model: `gpt-oss:20b`**, on throughput. Ollama's server log gives it directly:
~30–53 tokens/sec against `qwen3.6:27b`'s **5.2**, because MXFP4 is natively
accelerated on Apple silicon and Q4_K_M is not. Over seven hours that is twenty
tasks versus a hundred. Both wrote correct code for the same real task; the 27b's
regex was more careful, at 392s against 106s.

**It is bounded by:** a git worktree on `orion-selfdev`; whole files rather than
diffs; the **installed** plugin's forbidden-surface table, so it cannot edit the
approval verifier or policy evaluator and cannot widen that list without a human
deploying first; a check that must pass; and it never pushes and never installs.

---

## 3. Lessons this program keeps re-learning

Written down because each of these has cost real time more than once.

**A count goes stale; pin contents.** `expect(dev.length).toBe(7)` broke the
moment a dev action was added — the third time a stale count has reported a
correct change as a regression. Assert the names.

**A line that MENTIONS an effect is not a line that performs one.** This has bitten
the `orion-authority` regex declarations, a secret scan on a comment, and a
deferred check reading source prose.

**The repo copy is not always the live copy.** `plugin/workspace/AGENTS.md` is
tracked; Orion reads `~/.openclaw/workspace/AGENTS.md`. Nothing kept them in
step, so two same-day edits were inert while looking authoritative. Seven live
*skills* existed in no repo at all, one of them actively telling Orion to
`npm install` a binary that is not allowlisted.
`scripts/orion_v2_workspace_sync.sh` reports both, and CI runs it.

**A check nobody runs is not a check.** Two Python contract checks refused
correctly for three days with no listener. So did `orion-learn`, for 263 sessions.

**A test whose verdict depends on the page cache proves nothing.** Four
compile-time proofs had no stated timeout: 1–3s warm, 8–16s cold, against
Vitest's 5s default. They passed here and failed in a fresh worktree.

**A refusal that teaches nothing invites a guess.** See the 11.8M tokens above.

**Measure the right thing.** Model choice was made on wall-clock over a tiny
prompt and was wrong; tokens/sec reversed it. Two jobs against one Ollama model
also serialise — a benchmark running beside the coder makes both crawl, which was
misread as the model being slow.

**A typecheck rewards dead code.** The first autonomous cycle passed by adding a
well-documented, correctly-typed function that nothing calls. The bar is the test
suite, and an added export that nothing references now fails the attempt.

---

## 4. What only Nick can do

1. **`gog auth manage`** — Gmail's refresh token is dead (`invalid_grant`). Click
   **"Add more permissions"** on the account row; that is the re-grant path,
   despite the label. Everything local reports healthy because a token *exists* —
   only Google can say it works. It has died twice and sat dead for three weeks.
   `orion-doctor` now makes a real read and says which failure it is.
2. **`scripts/orion-remote-install`** — the Discord leak fix is written, not live.
3. **TCC grants for computer use** — Accessibility, and Screen Recording for
   `screen_capture`, on `/Users/nickmadaio/.openclaw/tools/node-v24.15.0/bin/node`,
   then relaunch the gateway. Note that granting Accessibility to a bare `node`
   binary is a broad grant. Then, if wanted:
   `openclaw config set plugins.entries.orion-control.config.enableComputerControlActions true --strict-json`
4. **Talk to him with headphones on, and play music while you do.** Three voice
   thresholds are reasoned rather than measured, and whether the audio route
   *sounds* right is a judgement only he can make.
5. **Assign the `unrestricted` role** if he wants it. It is declared and
   deliberately unassigned in `model-roles.seed.json`; no uncensored model is
   installed and choosing one is his call. It inherits the permanent rule either
   way: unrestricted *speech*, never unrestricted capability.

---

## 5. Known-not-done, stated plainly

- **There is no iPhone app.** `native/OrionMobile` is a `MobileCore` library and
  a check executable. No app target, no `.xcodeproj`, nothing installable.
  Phases 49, 56, 65, 66 and 84 are written against an app that does not exist.
- **Phase 53's bounded automation sessions** are not built. 54 and 55 are.
- **Computer use has no click-by-element** — coordinates only — and no scroll or
  drag.
- **No clipboard capability.** `pbpaste` is refused and now says so rather than
  inviting a retry.
- **Phase 68 reliability testing**: 7 of 23 scenarios uncovered.
- **The remote bridge's reconnect log has no timestamps**, so its 36 socket
  errors and 36 session invalidations cannot be correlated to wall-clock time.
  That churn is the most likely explanation for "sometimes it doesn't work" and
  is currently unmeasurable.

---

## 6. Running things

```bash
scripts/orion_v2_ci_check.sh          # everything that can run without the Mac
scripts/orion-doctor                  # the live stack, including a real Gmail read
scripts/orion-deploy                  # build, full suites, install, prove, auto-rollback
scripts/orion_v2_workspace_sync.sh    # is the tracked copy what Orion reads
scripts/orion-eval replay             # re-score every stored eval run, offline
scripts/orion-learn                   # what his own sessions say he gets wrong
scripts/orion-code loop --hours 7     # he works on himself until nothing is left
```

Six suites assert against the live Mac and cannot run in CI — strictness, lock,
remote, backup, authority contract, mobile. `orion-deploy` runs them, which is
why a deploy is the real gate and "CI was green" is not a sufficient answer here.

Validation: 93/93 Node tests (`node --test tests/agentic-*.test.mjs tests/project-agent.test.mjs`), secret scan clean with reviewed allowlist, and `git diff --check` clean. Independent review reran four recovery tests and reported no remaining actionable findings. No live-model overnight proof or installation/enablement performed.
## 2026-09-23 23:15 BST — Agentic project ready for first Start (Codex)

Finished Claude's 22:40 safety handoff and audited the current tree rather than
assuming its older findings were still present. The saved project remains
unstarted and execution remains disabled; the next UI action is intentionally
**Enable & start**.

Completed the five task briefs under
`docs/agentic/plans/advance-orion-capabilities.briefs/` from Claude's verified
research, then refreshed the registered `advance-orion-capabilities` snapshot.
The plan reports five tasks, weight 12, zero scope findings, a common brief and a
task brief for every contract; every rendered common+task brief is below the
18,000-character limit. No state.json or agentic-config.json exists for this
project/system.

Closed all actionable findings from
`docs/handoffs/briefs-research-2026-09-23/final-review-findings.json`:

- disabled-schedule check failures no longer misclassify ordinary missing-file
  test output as a broken environment;
- Continue is gated only by a run-level block, and reconciled uncertain tasks do
  not disable runtime recovery for the rest of the night;
- Exterminate has a durable request-specific token. Resume disarms only that
  request, a later Exterminate cannot be killed by an old reaper, and unrelated
  state revisions cannot disarm a standing hard-kill. Paused supervisors wake
  immediately on exterminate;
- revision-free halts are truly revision-free; an operator halt that arrives
  during Start preparation wins and is not cleared; expected operator hard-kills
  produce a stopped receipt with no false failure alert;
- terminal escalation delivery retries three times with bounded delay, failed
  attempts are rate-limited, a single stable Astra brief is replaced rather than
  accumulated, and phone commands include a usable repository cwd;
- the Discord bridge passes authenticated author/id/timestamp directly to the
  controller. The local inbox cannot impersonate Nick. Replay/rate admission is
  serialized only for its short disk transaction, so a slow brain turn cannot
  block phone Exterminate. Controller refusals (exit 1 plus useful stdout) are
  relayed rather than becoming silence;
- LOCK ORION still blocks brain/resume/authority-increasing actions while
  explicitly allowing agent status, pause, stop and exterminate.

Independent review reproduced three races during this pass (global-revision
reaper token, slow-chat blocking emergency halt, and bridge refusal stdout
loss). All three were repaired and have focused regressions. Its broader
41-test review found no brief blocker or other actionable finding.

Final evidence:

- 198/198 Node agentic/controller tests passed after the final fixes.
- 247/247 Swift tests passed; UI/source compile succeeded (existing Combine
  import warnings only).
- quick CI passed: security 197, unit/integration 348, typecheck, schema,
  secrets, coverage maps, living docs, Python contracts and architecture rules.
- strictness/approval gate: 33 passed; authority contract, lock check and updated
  remote check all passed. Secret scan clean (30 reviewed allowlist findings).
- `orion-agent doctor`: installed qwen3.6:27b is usable for both worker and
  reviewer at 65,536 context; one 21 GiB resident model within the 40 GiB budget.
- preflight: AC power, charging, lid open, idle/display sleep disabled. Closing
  the lid would still sleep this Mac; Projects shows that warning before Start.
- remote bridge reinstalled and running with source/installed copies byte-equal.
  A real configured webhook test delivered successfully.
- `/Applications/Orion.app` remains signed build 275, identity verified, running.

No local-model project run, worktree, schedule, installation, commit, push or
phase closure was created by this pass. The live project is now technically
ready for Nick to press **Enable & start**.
