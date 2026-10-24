# history-d index — 02d_history_oct02_now.md (2026-10-02 to now)

Line numbers are at HEAD `b90e577` unless a row says otherwise. Code cited here is the plugin built in this period.

### API calls
| Service | Endpoint / method | Called from (path:line) | Auth (by name only) | Purpose |
|---|---|---|---|---|
| Ollama (local) | POST `127.0.0.1:11434/api/chat` | `plugin/orion-control/src/front-desk.ts:80` | none | Front desk (qwen3.5:4b-q4_K_M) picks one move |
| Ollama (local) | POST `/api/chat` (JSON-schema form, `think:false`, `FORM_OPTIONS`) | `plugin/orion-control/src/local-routing.ts:159` | none | Scheduling form fill (9B) |
| Ollama (local) | POST `/api/chat` (extraction) | `plugin/orion-control/src/local-routing.ts:180` | none | Plan extraction and reminder time/label extraction |
| Ollama (local) | GET `/api/ps` | `plugin/orion-control/src/front-desk.ts:112` (post-snapshot `e3fe000`) | none | See which models are loaded and at what `num_ctx` |
| Ollama (local) | POST `/api/generate` with `keep_alive:"24h"` | `plugin/orion-control/src/front-desk.ts:116` | none | `keepWarm`: load missing models every 5 min |
| Ollama (local) | POST `/api/chat` (streaming, TTFT) | `scripts/lib/eval/v3/ollama.mjs:58` (per eval dossier) | none | V3 evaluation client |
| OpenClaw CLI | `openclaw agent --session-key K --message M --timeout 240` | `scripts/eval/v3/gauntlet/run.sh:11` | gateway config | Live gauntlet through the real route |
| Anthropic (via gateway) | error bodies read from `llm_output` / `agent_end` events, not called directly | `plugin/orion-control/src/account-health.ts:92` (`classifyAccountError`) | provider key held by gateway | Detect credit / usage cap / bad key |
| Canvas LMS | GET-only `orion-connect canvas-course <id>` | commit `320626f` (script not re-read) | Keychain item (token not read) | Course facts into brain notes |
| Basic Memory | `orion-brain search/read/context/learn/recent` CLI | commit `cd1bcb6` | none (local) | Brain reads and writes |
| macOS | `ioreg`, `pmset`, `ProcessInfo.thermalState` | `scripts/lib/eval/v3/battery.mjs` | none | Energy and thermal gating of runs |

### System prompts / instruction text sent to models
| Name | Source (path:line) | Sent to (model/route) | When | Summary |
|---|---|---|---|---|
| FRONT_DESK_SYSTEM | `plugin/orion-control/src/front-desk-prompt.ts:6` | qwen3.5:4b-q4_K_M via Ollama | every message when localRouting is shadow/on | V3-frozen p6+restate: choose answer / tool / escalate / ask / ignore, JSON |
| LOCAL_IDENTITY | `plugin/orion-control/src/local-routing.ts:189` | 9B worker system prompt | local turns | "You are ORION, Nick's personal assistant..." plus time; replaces the 17k-token workspace prompt (`b4c8b55`) |
| SCHEDULING / BRAIN / GENERAL instructions | `plugin/orion-control/src/job-instructions.ts:5` (exported by `scripts/eval/v3/ops/export-job-instructions.mjs`) | 9B via `before_prompt_build` | by job | Tuned coach guide, full `orion-reschedule` usage, honesty block |
| LOOK_IT_UP | `plugin/orion-control/src/local-routing.ts:133` | 9B | local turns | Manual and memory live in the brain; look it up; plus pre-fetched brain matches (`15f0775`) |
| HONEST_STOP | `plugin/orion-control/src/local-routing.ts:211` | 9B revise turn | check still fails after one retry | Undo any change and say plainly what did not happen |
| retryInstruction | `plugin/orion-control/src/work-check.ts:210` | 9B revise turn | first check failure | Lists the findings to fix |
| FORM_PROMPT | `plugin/orion-control/src/schedule-flow.ts:64` | 9B, temp 0, JSON-schema constrained | calendar change request | Fill ONE form of steps using real block ids B1..Bn |
| EXTRACT_PROMPT | `plugin/orion-control/src/schedule-flow.ts:92` | 9B | "plan" intents | Extract where, travel minutes, items with minutes |
| Reminder instruction | `plugin/orion-control/src/local-routing.ts:327` | 9B | reminder requests (`b5bf4ab`, `26f914d`) | "Set it with ONE orion_task_run call using exactly these arguments" |
| Account alert text | `plugin/orion-control/src/account-health.ts:118` (`alertText`) | phone via outbox | account problem | Names console.anthropic.com Plans & Billing / Limits |
| Always-on workspace files (AGENTS, SOUL, USER, MEMORY) | `plugin/workspace/*.md` | Claude via gateway | every cloud turn | Trimmed in `f17471c`, restored in `0691dc4` |
| Eval prompts p0..p6, pfull, pcoach, honesty block | `scripts/eval/v3/prompts/**`, `prompts/blocks.json` | evaluated local models | evals only | See the eval dossier |

### Memory reads/writes (anything that persists knowledge about Nick or the conversation)
| Store (path or system) | Op (read/write) | Code (path:line) | What |
|---|---|---|---|
| `~/Documents/orionBrain` (Basic Memory, project `orion`) | write | commit `cd1bcb6`, `scripts/orion-brain-seed`, `orion-brain learn` | 93 seeded notes, "Learned about Nick", "ORION repair queue" |
| same | read | `plugin/orion-control/src/local-routing.ts:377` (brain pre-fetch) | Notes matching the message are prepended for the worker |
| same | write | `scripts/orion-brain-manual` (`15f0775`) | ORION's manual as 53 notes plus index |
| Obsidian course notes | write | `orion-brain canvas-refresh` (`320626f`) | Marked Canvas sections only, with backups |
| Reminder notes (Apple Reminders via EventKit) | read/write | `scripts/lib/life/task-notes.mjs`, `MobileCore.TaskNotes` | Spread, parts, `Tags:`, `Order:`, `Notes:` |
| `~/.openclaw/orion-controlled/local-routing/shadow.jsonl` (+ `.trace`) | write | `plugin/orion-control/src/local-routing.ts` (`log`, ~line 255) | Per-turn decision, tools, findings, `turnMs` (mode 0600) |
| `~/.openclaw/orion-controlled/local-routing/acceptance.json` | write / read | `scripts/eval/v3/ops/local-acceptance.mjs`; `local-routing.ts:219` | Real-route acceptance record gating "on" |
| `~/.openclaw/orion-controlled/account-health.json`, `alerts-outbox.jsonl` | write | `plugin/orion-control/src/index.ts:1664-1665` | Episode state; phone alert queue |
| `~/.openclaw/orion-controlled/places.json` | read | `plugin/orion-control/src/schedule-flow.ts:102` | Known commute minutes |
| `~/.openclaw/orion-controlled/evals/v3/ledger.jsonl` and `cases/`, `runs/` | write | `scripts/lib/eval/v3/ledger.mjs` | Every eval run; private real-derived cases (0600) |
| `pins.json`, `ontask-state.json`, `orion-controlled/*` | write | `0a0aa7e`, `6eb4dca` | Pinned calendar times per date; schedule-focus state |

### Tool calls (tools exposed to a model, or CLIs a model invokes)
| Tool / CLI | Defined at (path:line) | Who calls it | Args | Side effects / gate |
|---|---|---|---|---|
| `orion-reschedule` (`show --json`, `move`, `add`, `resize`, `extend`, `drop`, `skip`, `swap`, `clear`, `day --plan`, `undo`) | `scripts/orion-reschedule` (NOTHING WAS BOOKED at :990) | Flow code, 9B worker, Claude | See `schedule-flow.ts:112` compile | Writes Apple Calendar, undoable; refuses unknown options and glued commands (`1e99edc`, `a7f506b`) |
| `orion-tasks` (`add/set/list/plan/sub/sweep`) | `scripts/orion-tasks` | Claude / 9B / watcher | `--due`, `--spread`, `--priority` | Reminders list; refuses unknown options (`b5bf4ab`); `sweep` drops sessions of finished to-dos (`6c93032`) |
| `orion_task_run` with `alarm_set` | plugin action catalog (`05_plugin_turn_pipeline.md`) | 9B via code-built args | `{steps:[{action:"alarm_set",at,label}]}` | Goes through the permission gate |
| `orion-agenda` (`today/tomorrow/day <word>`) | `scripts/orion-agenda` | worker, flow | day word | Read only; `tomorrow` accepted since `18c8f85` |
| `orion-brain` | `scripts/orion-brain` | worker, Claude | `search/read/context/learn/recent` | Writes only via `learn` |
| `orion-session` | `scripts/orion-session` | Claude | `start --minutes|--until|--sequence`, `recover`, `today` | Starts focus; `orion-focus` removed from allowlist (`6eb4dca`) |
| `orion-reach`, `orion-presence`, `orion-watches`, `orion-proactive`, `orion-morning`, `orion-lights` | `scripts/` (`a139f4b`, `094ebe2`, `dce48ae`, `f1fe2b2`) | app timers, ORION | various | Outbound messages, Bluetooth strip, morning screen |
| `orion-usage`, `orion-log-audit` | `5b24215`, `de87e8c` | Nick / Claude | none | Read-only reports |
| `orion-project-run`, `orion-project-queue` | `de9221b`, `b748c40` | ORION chat | `<ids>` | Starts registered Qwen projects (never `--enable`) |
| `orion-approve` -> `orion-approve-resume` | `e568abb` | approval flow | approval code | Runs the approved call in the asking conversation |
| `scripts/orion-v3-eval`, `-logs`, `-pipeline`, `-queue`, `-energy` | `scripts/` | Claude sessions | see CONTINUE section 4 (archived) | Local only; pipeline uses the eval-mode marker |
| Live gauntlet | `scripts/eval/v3/gauntlet/run.sh` | Claude with Nick's OK | stdin messages | **Touches his real calendar** |

### Config flags & env vars
| Name | Where read (path:line) | Default | Effect |
|---|---|---|---|
| `localRouting` (`off|shadow|on`) | `plugin/orion-control/src/index.ts:1673-1680` | off | Local routing mode |
| `localRoutingTrace` | `index.ts:278` area | off | Stage trace to `shadow.jsonl.trace` |
| `localRoutingScheduleToCloud` | `local-routing.ts` (option `scheduleChangesToCloud`) | false | Calendar changes use the cloud model |
| `localRoutingTestingUntil` | `index.ts:276`; `local-routing.ts:51, 235-244, 284` | unset | Time-boxed "on" without acceptance, max 48 h, checked per turn |
| `ACCEPTANCE` {0.85, 20000 ms, 14 d, 20 cases} | `local-routing.ts:218` | const | The gate |
| `accountHealth` / `accountFailFast` | `index.ts:274, 1663-1667` | on / off | Alerts; answer-at-once while a problem is fresh (ignored if localRouting is on) |
| `FORM_OPTIONS` | `schedule-flow.ts:62` | temp 0, num_predict 500, num_ctx 32768 | Sampling for the form |
| `FRONT_DESK_CTX` | `front-desk.ts:21` | 16384 | One `num_ctx` for every front-desk call |
| `LATE_NIGHT_UNTIL` | `schedule-flow.ts:213` | 5 | Before 05:00, "tomorrow" means today |
| `models.providers.ollama.models[qwen3.5:9b].params` | live `~/.openclaw/openclaw.json` (not in git) | temp 0.2, top_p 0.9, top_k 20, presence 0, num_ctx 32768, keep_alive 24h, think false, num_predict 2048 | Fix for the Ollama-defaults root cause |
| `reasoning:false` on the 9B model entry | live config (`e3fe000` body) | set 2026-10-14 | Stops session thinkingLevel overriding `think:false` |
| `agents.defaults.bootstrapMaxChars` | OpenClaw (per LOCAL_FAILURES.md #4) | 20000 | Truncation of AGENTS.md |
| `cacheRetention: "long"` | live config (`f17471c` body) | long | 1-hour prompt cache for Haiku/Sonnet |
| `ThinkingPolicy` | `scripts/lib/thinking-policy.mjs:8-30`; `MobileCore/ThinkingPolicy.swift` | off for talk and one-step commands | Think level by message; "off" for any `ollama/` model |
| `ORION_V3_DIR`, `ORION_EVAL_MARKER`, `ORION_SANDBOX_CALENDAR`, `OLLAMA_HOST` | eval dossier part 8.3 | see dossier | Eval isolation and endpoints |
| `OLLAMA_KEEP_ALIVE` (server), `OLLAMA_MAX_LOADED_MODELS` | RESEARCH_IDEAS.md / CONTINUE | 5 min / unset | Serving ideas, not applied in git |

### Glossary terms
| Term | Meaning |
|---|---|
| Prompt diet / trim | `f17471c`, 10-07: always-on prompt files cut by a third; reverted by `0691dc4` |
| Front desk | 4B model that picks answer / tool / escalate / ask / ignore |
| Worker | The 9B model that does tool and calendar jobs |
| Work check | Code comparing the reply with tool output (`work-check.ts`) |
| Try, check, escalate | 9B tries, check decides, retry once, then escalate/undo; replaced the "deep" tier |
| Shadow / on | Local routing logs only / local routing answers |
| Acceptance gate | Real-route pass record required for "on" |
| Testing window | `localRoutingTestingUntil`, max 48 h |
| Gauntlet | Live script of real-style messages against the real calendar, 12/12 on 10-12 |
| Scheduling flow | Fixed sequence: code reads day, 9B fills form, code compiles argv, scheduler runs, code speaks |
| Invisible commute | Travel time that is not a calendar block |
| Account health | Detect dead provider account, alert once |
| keepWarm | Keep both local models loaded at their real `num_ctx` (post-snapshot) |
| Handover (Codex) | Human-operator completion of the Qwen "surfaces" run |
| Sweep | `orion-tasks sweep`: drop sessions of finished to-dos |
| Practice / held-out / pass^3 / Wilson | See the eval dossier glossary |

## Decisions & reversals
| Date | Decision | By | Reversal | Evidence |
|---|---|---|---|---|
| 10-02 | Finish the Qwen surfaces run by Codex handover, labelled honestly | Nick, Codex | none | `357a227` |
| 10-05 | Basic Memory as the brain | Claude | none | `cd1bcb6` |
| 10-06 | Retire `orion-focus`; focus is `orion-session` | Claude | none | `6eb4dca` |
| 10-07 | Local 9B filters overheard speech | Claude | removed 10-08 07:45 | `18c29b9`, `e5cd0d0` |
| 10-07 | Trim always-on prompt | Claude | reverted 10-08 15:26 | `f17471c`, `0691dc4` |
| 10-07 | Per-message topic rules | Claude | rejected (12x cache-write cost) | `f17471c` body |
| 10-08 | Tuning may differ per model | Nick | none | `c505cbd` |
| 10-09 | Judge rubric v2 | Claude | reverted same day | `db6e1ac`, `c95e5d4` |
| 10-09 | 40 J1 examples for 9B | Claude | re-frozen at 25 | CONTINUE (archived) |
| 10-10 | No category deep tier; try, check, escalate | Nick | none | `72f7dbf`, `1719a48` |
| 10-11 | localRouting "on" live | Claude (go-ahead not recorded) | shadow 10-12 09:55 via gate; window from 13:03 | routing log, `612f962` |
| 10-12 | Gate: "on" needs real-route acceptance | Nick | none | `612f962` |
| 10-12 | Phone never uses on-device model | Nick | none | `a44ce44` |
| 10-12 | Manual in the brain | Nick | none | `15f0775` |
| 10-12 | Scheduling as fixed sequence | Claude | none | `f0b2b67` |
| 10-12 | Commutes invisible | Nick | none | `70ebf12` |
| 10-13 | Reminders via code-built `alarm_set` | Claude | none | `b5bf4ab`, `26f914d` |
| 10-14 | Keep both models warm; reasoning:false; window renewed | Claude | none yet | `e3fe000` |
| 10-14 | Repo cleanup, new short HANDOFF | Claude | none | `b90e577` |

## Eval results over time
Sources: `docs/evals/v3/REPORT.md`, the (now archived) CONTINUE file and run folders, eval dossier part 5. "Held-out" = honest number.

| Date | Eval | Model / setup | Result | Note |
|---|---|---|---|---|
| 10-01 | Schedule core 16 | Haiku 4.5 medium | 6/16, median 14 s | Pre-fix tools and grader |
| 10-01 | Schedule core 16 | Sonnet 5 medium | 8/16, 10 s | same |
| 10-01 | Schedule core 16 | Qwen 9B / 27B medium | 1/16 each | **Transport failures, not model results** |
| 10-01 | Schedule core 16 | Qwen 9B off / 27B off | 5/16 (27 s) / 4/16 (93 s) | |
| 10-02 | Schedule 22 (16 core + 6) | Sonnet 5 medium | 20/22 then 21/22 (core 15 to 16/16), 9 to 9.5 s | After `0a0aa7e` |
| 10-02 | Schedule 22 | Haiku 4.5 medium | 20/22 (core 16/16), 13 s; stress 5/6 | |
| 10-02 | Schedule 22 | Qwen 9B off | 10/22 (core 8/16), 34 s | Gate not passed |
| 10-02 (uncommitted at snapshot) | Schedule 22 | Qwen 9B thinking medium | 14/22, median 29 s | `qwen-thinking-medium.log` |
| 10-07 | Prompt diet core 22 | Claude, before/after | 22/22 both (after2 21/22) | Scheduling-only; missed the real regression |
| 10-07 | Prompt diet hard 14 | Claude | 10/14 early, 9/14 final, headline 13/14 | Headline includes reruns |
| 10-08 | Thinking policy | Claude | core 21 to 22/22, hard 7/14 to 11/14 | Network failures re-run |
| 10-08 | V3 J1 baseline (97 practice) | llama / 4B / 9B / gpt-oss | 14 / 29 / 53 / 54 | 27B stopped at 33 (battery) |
| 10-09 | J1 4B | p4 vs p6 | practice 89 to 94/97; held-out 123/138 both | Overfitting evidence |
| 10-09 | J1 9B | 25 vs 40 examples | held-out 111 vs 105/138 | Re-frozen at 25 |
| 10-09 | J4 honesty | 9B / gpt-oss held-out | 24/24 / 23/24, 0 false claims | Passes |
| 10-09 | J2 simple tools | 9B held-out | 33/33 | Passes |
| 10-09 | J3 scheduling | 27B / gpt-oss / 9B held-out | 26 / 25 to 27 / 23 of 36 (re-graded 24 / 27 / 23) | None pass 90 percent |
| 10-09 | J5 brain | 9B | practice 10/12, held-out 7/18 (tiny set); after 3x set, 33/36 | Adding cases beat patching |
| 10-09 | J7 judge | gpt-oss v1 / v2 | 82.5 percent then 84 percent / v2 worse | Bar 85; provisional |
| 10-10 | Final held-out | J1 4B 123/138 (89.1%); J6 9B and 27B 18/27 (3 FC each) | no J1 or J6 pass | `REPORT.md:204-342` |
| 10-10 | Phase 8 end to end (real route) | 4B front + 9B | **7/21, ~35 s** | Wrote the acceptance record |
| 10-10 | Cascade J3 held-out | 9B alone / gpt-oss alone / cascade / cascade+retry | 23 / 27 / 27 / **28 of 36**; p50 15 / 28 / 21 / 21 s; escalated 0 / all / 9 / 4 | 0 false claims; J6 false claims 3 to 0 |
| 10-11 to 10-12 | Live real requests ("fill the time between my classes") | 9B route "on" | **0/3** | Eval 89 to 100 percent vs live 0/3 |
| 10-12 | Offline replay, Nick's real day | 9B form flow | 7/8; then 10/10; then 5/5 (plans) | `f0b2b67`, `110bc80`, `cd91e9d` |
| 10-12 | Live gauntlet | real route, real calendar | round 0 **3/8** then **12/12**, 7 to 12 s | `a847ba8`, `3389cd4` |
| 10-12 | Plugin routing log | "on" turns (91 with `turnMs`) | median 15.2 s overall; 10.9 s after 10-12 12:00Z | Read from private log |
| 10-14 | Live after `e3fe000` | 4B + 9B warm, no thinking | 4.5 to 5.8 s a turn, 44 tok/s | Commit body, was 15 to 23 s |
