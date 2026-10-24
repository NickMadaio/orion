# Index fragment for chapter 09 (evals, tests, agentic dev loop, process)
Snapshot 6c93032 (2026-10-14). Paths from repo root. Secrets by name only.

### API calls
| Service | Endpoint / method | Called from (path:line) | Auth (by name only) | Purpose |
|---|---|---|---|---|
| Ollama | POST `/api/chat` (stream) | scripts/lib/eval/v3/ollama.mjs:58 | none (loopback; host `OLLAMA_HOST`) | V3 eval model calls |
| Ollama | POST `/api/show`, GET `/api/tags` | scripts/lib/eval/v3/ollama.mjs:88-89 | none | model digest, quantization, thinking support |
| Ollama | POST `http://127.0.0.1:11434/api/chat` (non-stream) | scripts/orion-conversation-bench:28 | none | shadow-routing bench |
| Anthropic | POST `https://api.anthropic.com/v1/messages` | scripts/orion-conversation-bench:30-31 | `ANTHROPIC_API_KEY` | optional hosted bench candidates (opt-in, costs money) |
| Anthropic | GET `https://api.anthropic.com/v1/models?limit=1` | scripts/orion_v2_anthropic_key_status.py (API_URL) | Keychain account `openclaw` / env | verify a key without printing it |
| OpenClaw CLI | `openclaw agent --session-key ... --message ... [--json]` | scripts/orion-eval:571; scripts/orion-bench:155-162; scripts/eval/v3/gauntlet/run.sh:11 | gateway config | live turns (gateway default model; may cost money) |
| OpenClaw CLI | `openclaw agent ... --model --thinking` via `orion-remote handle` | scripts/orion-remote:800-812; orion-eval-run:39; orion-eval-schedule:75; orion-v3-pipeline:87 | gateway config | eval turns through the phone route |
| OpenClaw CLI | `openclaw audit --session ... --json`; `openclaw memory search/index` | scripts/orion-eval:427; scripts/orion-bench:63,184 | n/a | audit trail; memory recall bench |
| OpenClaw CLI | `openclaw gateway restart` | scripts/orion-deploy (step 6 and rollback) | n/a | restart onto the candidate plugin |
| Ollama | POST `/api/generate` (stream; also `keep_alive:0` unload) | scripts/lib/agentic/models.mjs:213-217,297-301 | none (loopback enforced :151-155) | agentic worker/reviewer generations, probe, unload |
| Ollama | GET `/api/ps`, `/api/tags` | scripts/lib/agentic/models.mjs:282-295; settings.mjs:33,61 | none | residency / installed models |
| Ollama (legacy) | POST `/api/generate` non-stream | scripts/orion-code:54,161-207 | none | legacy offline coder |
| Discord webhook | via `scripts/orion-discord-alert` (curl) | scripts/lib/agentic/escalation.mjs:68-91; orion-projects:153 | `ORION_DISCORD_WEBHOOK_URL`, `ORION_DISCORD_NOTIFICATIONS` (.env), `ORION_DISCORD_SILENT` | escalation alerts and digests |
| TCP probe | `1.1.1.1:443` | scripts/orion-code:90-103 | none | legacy online/offline detection |
| GitHub | `git push/pull/fetch` over HTTPS via `gh` browser auth | process rule AGENTS.md:738-746 | `gh` login (no token files) | remote `github.com/NickMadaio/orion` |
| Sparkle | feed URL placeholder | native/Orion/Sources/Orion/UpdateController.swift | EdDSA key in login Keychain | auto-update (no feed yet) |
| macOS tools | `ioreg`, `pmset`, `swift -e`, `vm_stat`, `sysctl`, `caffeinate`, `codesign`, `security find-identity` | scripts/lib/eval/v3/battery.mjs:34,91; agentic/resources.mjs, awake.mjs; make_app_bundle.sh:149,274 | n/a | telemetry, keep-awake, signing |

### System prompts / instruction text sent to models
| Name | Source (path:line) | Sent to (model/route) | When | Summary |
|---|---|---|---|---|
| V3 judge | scripts/lib/eval/v3/judge.mjs:14-20,35 | `--judge` model (calibration default gpt-oss:20b) | J7 judging | one dimension 1-5 or unknown, JSON out |
| Front desk p0-p6 | scripts/eval/v3/prompts/j1/*.md | J1 candidates (frozen: qwen3.5:4b p6+restate) | J1 evals | move: answer/tool/escalate/ask/ignore as JSON |
| J1 key rules, COMPACT | scripts/lib/eval/v3/prompts.mjs:9-13,29 | J1 | J1 | three key rules; one-line JSON |
| Tool prompts J2/J4/J5, J3/J6 (pfull, coach, examples) | scripts/eval/v3/prompts/j{2..6}/* | tool-job candidates | J2-J6 | command reference, honesty, coaching |
| blocks (rules/procedure/selfcheck/restate/honesty) | scripts/eval/v3/prompts/blocks.json:3-7 | tool jobs | ladder steps | never claim unless a tool result shows it |
| J7 spoken style | scripts/eval/v3/prompts/j7/p0.md:1 | J7 candidates | J7 | 1-3 spoken sentences |
| Cascade self-check | scripts/eval/v3/ops/cascade.mjs:66 | `--selfcheck` model | try-check-escalate replay | ok/problem JSON |
| Declarative planner / steps scheduler | scripts/eval/v3/ops/declarative.mjs:28-40; steps.mjs:26-44 | qwen3.5:9b default | prototypes | plan the day as JSON / typed steps |
| Shadow-routing SYSTEM | scripts/lib/conversation-bench/core.mjs:1 | bench candidates (Ollama, Anthropic) | conversation bench | route answer vs escalate |
| orion-bench live turns | scripts/orion-bench:166-168,187,198,213-216 | gateway default | `--live` | plant and recall a token |
| worker-system | scripts/lib/agentic/prompts/worker-system.md:1-254 | worker (qwen3.6:27b) | every worker exchange (worker.mjs:105) | contract authority, marker protocol, never-do list |
| reviewer-system | scripts/lib/agentic/prompts/reviewer-system.md:1-170 | reviewer | checkpoint review reviewer.mjs:52; final :270 | verdicts PASS/PASS_WITH_TASKS/BLOCKED JSON |
| reviewer-repair | scripts/lib/agentic/prompts/reviewer-repair.md:1-101 | reviewer | bounded repair reviewer.mjs:158 | minimum fix, JSON first |
| extension SYSTEM | scripts/lib/agentic/extension.mjs:55-60 | reviewer think:false | worker short of time | grant 0-MAX minutes |
| recovery system | scripts/lib/agentic/recovery.mjs:101 | reviewer | after runtime failure | retry / reload_models / escalate |
| final review prompt | scripts/lib/agentic/reviewer.mjs:272-283 | reviewer | all tasks accepted | cross-task coherence |
| orion-code prompts | scripts/orion-code:238-273,356-361,631-640 | gpt-oss:20b default | legacy coder | whole file / pick file / pick next |
| Front-desk / job instructions exports | scripts/eval/v3/ops/export-front-desk.mjs; export-job-instructions.mjs -> plugin/orion-control/src/front-desk-prompt.ts, job-instructions.ts | live 4B / 9B | live local routing | frozen eval prompts become production code |

### Memory reads/writes (anything that persists knowledge about Nick or the conversation)
| Store (path or system) | Op (read/write) | Code (path:line) | What |
|---|---|---|---|
| ~/.openclaw/orion-controlled/evals/v3/ledger.jsonl | write (append, 0600) | scripts/lib/eval/v3/ledger.mjs:8-15 | every eval run result; "not in the ledger, it did not happen" |
| ~/.openclaw/orion-controlled/evals/v3/{cases/real, sandboxes, runs, configs, review, queue} | read/write | orion-v3-eval; sandbox.mjs:20,52 | real-use cases (private, outside Git), sandboxes, frozen configs |
| ~/.openclaw/agents/main/sessions, orion-controlled/chats, remote-audit.jsonl | read | scripts/orion-v3-logs:27-29 | mined for real turns (counts only printed) |
| ~/.openclaw/orion-controlled/eval-mode | write/read | scripts/lib/eval-mode.mjs:10-14 | eval marker, 2 h freshness |
| ~/.openclaw/orion-controlled/eval-calendar.json, eval-remote-inbound.json, eval-checkins.json, eval-life-config.json | write | bridge-path.mjs:16; orion-eval-schedule:62-69 | sandbox state |
| ~/.openclaw/orion-controlled/local-routing/acceptance.json | write | scripts/eval/v3/ops/local-acceptance.mjs | real-route gate for localRouting on |
| ~/.openclaw/orion-controlled/account-health.json | write | plugin/orion-control/src/account-health.ts | dead-account episode state |
| memory files (episodic) | write (excluded for eval keys) | plugin/orion-control/src/index.ts:1693-1694 | session-key regex keeps eval/cron/test traffic out |
| ~/.openclaw/orion-controlled/agentic-config.json | read; write by `set-model`, `launch --enable` | scripts/lib/agentic/models.mjs:41,134-191; settings.mjs:55-83 | agentic runtime enablement and models |
| <root>/state.json, journal.jsonl, heartbeat.json, activity.json, alerts.json, briefs/astra-*.md, run.json, project.json, launch.json | read/write | scripts/lib/orion-project-agent.mjs:109-116; journal.mjs; supervisor.mjs:70-80; escalation.mjs | durable agentic run state (root = ~/.openclaw/orion-controlled/project-agent/projects/<id>) |
| supervisor.lock/, worker.lock/, launch.lock/, active-project.lock/ | lease | scripts/lib/agentic/lease.mjs:116-159 | single-writer proofs (pid+boot+start) |
| ~/.openclaw/orion-controlled/forge-ledger.jsonl, Orion-previous.app | append/copy | scripts/orion-forge:35-36,134-170 | self-edit ledger and rollback app |
| ~/.openclaw/orion-controlled/selfdev-*.json(l) | read/write | scripts/orion-code:49-53,405-410 | legacy coder state |
| ~/.openclaw/backups/orion-control/<stamp>/ | write (5 kept) | scripts/orion-deploy:173-193 | plugin rollback snapshots |
| .builds/ (repo-local, gitignored) | write | .gitignore:42 | ad hoc rollback copies and logs |
| HANDOFF.md, NICK-TODO.md, docs/planning/v2/PHASE_GATES.json, ROADMAP_AMENDMENTS.json | read/write | AGENTS.md:166-178 | the cross-assistant relay record |
| ~/Desktop/ORION-archive/2026-10-14/ | archive | commit b90e577 | old 273 KB HANDOFF.md, ORION_V3_CONTINUE.md |
| ~/.codex/sessions/**/rollout-*.jsonl | read | AGENTS.md:105-109 | recover a dead Codex session |

### Tool calls (tools exposed to a model, or CLIs a model invokes)
| Tool / CLI | Defined at (path:line) | Who calls it | Args | Side effects / gate |
|---|---|---|---|---|
| `exec` (allowlisted scripts) and `orion_task_run` | scripts/lib/eval/v3/fixtures.mjs:60-65 (eval copy); production in plugin | V3 eval models (T1 interface) | plain args, no pipes/&& | sandbox: only orion-agenda, orion-reschedule, orion-tasks run for real (sandbox.mjs:22) |
| T2 per-tool functions | fixtures.mjs:68-74; scripts/eval/v3/front-desk-menu.json | V3 eval models | 17 abstract tools | scripted replies |
| `### SUBTASK / READ / SEARCH / EDIT / FILE / CHECK / DONE / BLOCKED / PROPOSE` | prompts.mjs:193-261; worker.mjs:402-646 | agentic worker | see Part 2 | scope-gated writes (boundary.mjs:182-218), fixed-argv checks, commits only via commitCheckpoint |
| Reviewer EDIT/FILE | reviewer.mjs:190-224 | reviewer in repair mode | <= repairMaxFiles (2) | same gates; recorded separately |
| Check registry (node-syntax, agentic-tests, plugin-tests, secret-scan, mobile-swift-tests, mac-build, no-orphan-exports ...) | scripts/lib/agentic/checks.mjs:40-171 | worker `### CHECK`, reviewer re-run | none (names only) | fixed argv, own process group, fixed env |
| orion-agent / orion-projects / orion-project-agent | scripts/orion-agent; orion-projects; orion-project-agent | Nick, Discord `agent ...` verbs | see 2.7 | pause/stop/exterminate, launch needs enabled file |
| orion-forge edit/apply/revert | scripts/orion-forge:192-241 | plugin runSelfModify (executors.ts:3090-3135) | path, find, replace | clean-repo gate, build, backup, launch gate, auto-restore |
| orion-eval / orion-eval-run / orion-eval-schedule / orion-v3-* | scripts/ | Nick/assistants | see Part 1 | hit gateway model route or local Ollama; write eval marker |
| orion-deploy | scripts/orion-deploy | Nick/assistant with OK | `--dry-run --rollback --status --allow-dirty` | restarts gateway; auto-rollback |
| orion-identity-check | scripts/orion-identity-check | before shipping the app | [candidate] [reference] | read-only; exit 0/1/2 |
| orion_v2_* checks | scripts/orion_v2_* | CI, deploy, assistants | see 3.5 | mostly read-only; some sandboxed |
| orion-lock | scripts/orion-lock | Nick | status | drops profile to restricted_read_only, disables cron |

### Config flags & env vars
| Name | Where read (path:line) | Default | Effect |
|---|---|---|---|
| `ORION_EVAL_MARKER` | scripts/lib/eval-mode.mjs:10 | ~/.openclaw/orion-controlled/eval-mode | marker path; active when < 2 h old |
| `ORION_SANDBOX_CALENDAR` | sandbox-bridge.mjs:8; bridge-path.mjs:16 | .../eval-calendar.json | sandbox day file |
| `ORION_BRIDGE_BIN` | bridge-path.mjs:24,39 (stripped sandbox.mjs:75) | real bridge | test override; disables sandbox |
| `ORION_RESCHEDULE_NOW`, `_PINS`, `_UNDO`; `ORION_SKIPS_FILE`, `ORION_LIFE_CONFIG`, `ORION_LIFE_HISTORY`, `ORION_PATTERNS_FILE`, `ORION_CHECKIN_FILE` | bridge-path.mjs:30; v3/sandbox.mjs:62-66 | live files | per-trial isolation |
| `OLLAMA_HOST` | v3/ollama.mjs:10 | 127.0.0.1:11434 | Ollama base |
| `ORION_V3_DIR` | v3/ledger.mjs:8; orion-v3-queue:10 | ~/.openclaw/orion-controlled/evals/v3 | V3 data root |
| `ORION_REMOTE_ALLOW`, `ORION_BRAIN_SESSION`, `ORION_BRAIN_MODEL`, `ORION_BRAIN_THINKING` | orion-remote:192,91,803-810 | local / orion-app-v2 / gateway default / ThinkingPolicy | eval routing overrides |
| `CASCADE_THINK`, `CASCADE_DEBUG` | ops/cascade.mjs:65,69 | off | self-check options |
| `DAYARG` | gauntlet/run.sh:6 | today | which day to print |
| `--oracle --schema-all --history --iface --limit --label --change --hypothesis --cold --n --since --jobs --dry --write --live --run --long --repeats --seed --model --out` | orion-v3-eval:125-148,338-339; ops/*; orion-bench:19; orion-conversation-bench:8-22 | see Part 1 | run controls |
| `localRouting`, `localRoutingTestingUntil`, `acceptancePath` | plugin local-routing.ts:52,62,212-241 | off/shadow | "on" needs acceptance record (>=85%, <=20 s, <=14 d, >=20 cases) or <= 48 h testing window |
| `accountHealth`, `accountFailFast` | plugin account-health.ts | on / off | dead-account alert and fail-fast |
| agentic config `enabled` + `limits.*` | models.mjs:93-141 | false / see 2.3 | runtime gate and ladder bounds |
| `ORION_EXTERMINATE_GRACE_SECONDS` | scripts/orion-project-agent:140 | 20 (1-300) | reaper grace |
| `ORION_LAUNCH_REVISION` | orion-projects:111,136-137 | set by launch | pre-launch halts cleared |
| `ORION_DISCORD_SILENT`, `ORION_ENV_PATH` | escalation.mjs:85; orion-discord-alert:16,48 | unset / <repo>/.env | quiet alert; env path |
| `ORION_AGENTIC_CHECK`, `ORION_REPO_ROOT`, `CI` | checks.mjs:186-196 | set for checks | check environment |
| `RUNS` | agentic/evals/reviewer-hard.mjs:180 | 2 | runs per model |
| `ORION_CODER_MODEL/THINK/CTX` | orion-code:74,77,185 | gpt-oss:20b / on / 65536 | legacy coder |
| `ORION_REPO` | orion-forge:31 | $HOME/Desktop/ORION | forge repo |
| `--project`, `--until`, `--until-stopped`, `--hours`, `--enable`, `--keep-display-on`, `--no-keep-awake`, `--nudge-minutes`, `--candidates` | orion-agent; orion-projects; awake.mjs:88-109 | see 2.7 | agentic run options |
| `DEVELOPER_DIR` | run-domain-test.sh:25; orion_v2_mobile_check.sh | /Applications/Xcode.app/Contents/Developer | XCTest without changing xcode-select |
| `PYTHONPATH=.`, `PYTHONDONTWRITEBYTECODE=1` | AGENTS.md:356,533 | unset | unittest discovery; avoid poisoned .pyc |
| `ORION_CATALOG_DIST` | orion_v2_inventory_check.py; orion-deploy:156; ci.yml | installed dist | check docs against candidate catalog |
| `ORION_VERSION`, `ORION_BUILD_NUMBER`, `ORION_BUNDLE_OUT` | make_app_bundle.sh:22,68-69 | VERSION file / commit count | release/update-test overrides |
| `--allow-adhoc` | make_app_bundle.sh:10-18 | off | only way to unsigned build |
| `ORION_REAUTH_BIN`, `ORION_OPENCLAW_BIN`, `ORION_GATE_DIR`, `ORION_INTEGRITY_REFUSE_DELAY_MS` | orion_v2_reauth_check.sh; run-timezone-set-test.sh; integrity check | unset | test stand-ins |
| `--allowlist`, `--history`, `--include-ignored` | orion_v2_secret_scan.py:210-217 | none / off / off | scanner modes (no default allowlist) |
| `--phase`, `--require-open`, `--file` | orion_v2_phase_gate.py:88-90 | phase 0 | gate check |
| `--quick` | orion_v2_ci_check.sh | off | skip npm audit |

### Glossary terms
| Term | Meaning |
|---|---|
| J1-J7 | V3 jobs: front desk, simple tools, scheduling, honesty, brain, continuity, conversation |
| Practice / held-out | tuning set vs never-seen set (1/3, seed 20261008, stratified) |
| Provenance | observed-failure / observed-everyday / synthetic-edge |
| Oracle dry run | labelled answers fed in; must score 100% |
| pass^k, Wilson, rule of three, McNemar, paired bootstrap | the statistics used to compare models |
| Claim checker | eval grader that finds false claims / omitted failures / false denials / wrong detail |
| Eval mode / marker | file that makes send-scripts print "Not sent" |
| Sandbox bridge / preflight / TEST CLOCK | fake calendar; proof scripts see it; line giving the sandbox time |
| Ledger | append-only record of eval results |
| Cascade / try-check-escalate | 9B first, mechanical check, escalate to bigger model |
| Acceptance record | real-route gate for `localRouting: on` |
| Gauntlet | live, real-calendar test script |
| Astra | ChatGPT/Codex as senior architect, invoked manually |
| Worker / reviewer | the two Qwen roles of the agentic loop |
| Task contract / brief / checkpoint | normalized task spec; reference text; verified commit awaiting review |
| Deferral / run-level escalation | parks one task / stops the run |
| Bounded repair | reviewer writes at most 2 files, recorded separately |
| Lease, heartbeat, journal, exterminate, reaper | single-writer proof; liveness file; append-only audit; abort now; SIGKILL backstop |
| Forge | orion-forge: Orion edits his own Swift app with launch-gate rollback |
| Mutation testing | break a rule, confirm a named test fails, restore |
| Machine-bound / source-bound check | asserts about the live Mac / about the source |
| Phase gate | per-phase requirements record in PHASE_GATES.json |
| `entrySatisfied`, `nextPhaseAllowed` | previous phase passed; all requirements passed |
| Phase 32.5 | documentation checkpoint, not a numbered phase |
| REC-* | additive recovery gates in ROADMAP_AMENDMENTS.json (human-enforced) |
| pendingGateAmendments / scopeNotInManifest | register of dead gate assumptions / asks no phase covers |
| Batch A/B | labels for 2026-09-01 work (Phase 33+43, Phase 40); no Batch C |
| Relay / handoff | files as the channel between Claude and Codex |
| Designated requirement | the code-signing identity string macOS/TCC binds permissions to |
| CFBundleVersion | `git rev-list --count HEAD`; Sparkle's only comparison |
| orion-deploy | protected plugin deploy: gate suites, snapshot, install, probe, auto-rollback |
| .builds/ | gitignored repo-local rollback/log folder |
| b90e577 | 2026-10-14 commit that replaced the 273 KB HANDOFF.md with a short one |
