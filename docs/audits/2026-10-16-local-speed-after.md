# Local speed after today's fixes (measured 2026-10-16, read-only)

Sources: sweep results (`day/results.jsonl`, 71 items, 14:18-15:01 BST), `shadow.jsonl(.trace)` (UTC; +1h = BST), the gateway log `/tmp/openclaw/openclaw-2026-10-16.log` (UTC), Ollama `~/.ollama/logs/server.log` (BST, per-request `print_timing` and checkpoint lines), trajectory `e8965c8d` (d001), round-8 results `r8/rerun4-ro-results.jsonl`. Nothing was changed or sent. No curl replay was run: the Ollama log already records re-evaluated tokens per call, so a replay would add nothing. The only files I edited were my own scratch scripts.

## Short answer

1. The deployed fixes work only partially. They remove the clock from the top of the prompt, but the cache still re-reads about 1000 tokens on every call. The 9B reuses only 462 tokens and the 4B only 1468.
2. The bigger cause is not the prompt. At 14:19, before any coding agent started, Ollama ran about 2.5x slower than in round 8 on the same prompts. Decode fell from 63 to 27 tok/s (front desk) and 42 to 15 tok/s (worker).
3. A fixed 4-5 s per turn sits outside the plugin: CLI spawn plus gateway prep.
4. The 30-90 s turns start at 14:44:04. A gpt-oss:20b load evicted both models, and long gpt-oss chats then ran alongside the sweep. They do not start with the 14:25-14:35 builds.

## Q1. Per-stage breakdown (early items, BST; Ollama GIN times are 1 s resolution)

Client ms = pre-hook gap + front desk + gateway prep + worker + tail.

| Item | Client | Pre-hook (CLI spawn, session open) | Front desk 4B (re-eval / out / wall) | Gateway prep (hook end to tool-search done) | Worker 9B (prompt / re-eval / out / wall) | Revise, extra calls |
|---|---|---|---|---|---|---|
| d001 | 18.3 s | ~4.7 s | 999 / 65 / 4.18 s | 2.5 s | 1486 / 1486 (full) / 40 / 6.58 s | none |
| d004 | 15.0 s | ~4.6 s | 1000 / 65 / 3.14 s | 2.3 s | 1443 / 981 / 40 / 4.80 s | none |
| d007 | 13.1 s | ~3.2 s | 1001 / 66 / 2.62 s | 2.4 s | 1489 / 1027 / 43 / 4.66 s | none |
| d010 | 13.2 s | ~3.7 s | 1003 / 61 / 3.34 s | 2.6 s | 1446 / 812 / 22 / 3.18 s | none |

- The pre-hook gap is client ms minus (before_model_resolve to before_agent_finalize), with 0.6 s of tail.
- Each turn has exactly 2 `/api/chat` calls (plus a `/api/tags` of 10 ms). Passes were 0 and there were no tool_search second calls. The only extra work is the gateway's own 33-tool catalog.
- Across all 71 items, the non-plugin overhead is a median of about 4.5 s. That is roughly a third of a 13 s turn.

## Q2. Is the prefix cache hitting?

- Ollama logs it per call. The gateway usage field cannot show it: trajectory `cacheRead` is always 0 and `usage.input` is the full prompt.
- **Front desk (prompt ~2467 tokens).** It restores the checkpoint at 1468 and re-evaluates 999-1003 tokens every turn. That costs 0.6-1.4 s of prefill and the call takes 2.6-4.2 s.
  - The log shows a prefix match of about 2444 of 2470 tokens.
  - The checkpoint at 2462 sits past the point where the prompts diverge, so it is discarded. The next older checkpoint, at 1467, is used.
  - The hybrid (recurrent) model can only restore saved checkpoints, not an arbitrary prefix.
- **Worker (prompt ~1450 tokens).** It restores a checkpoint at about 462 (323-634 on some items) and re-evaluates 800-1200 tokens. The first call after a pause does a full re-process ("forcing full prompt re-processing", d001: 1486 tokens, 3.65 s).
  - The worker prompt is the system prompt (identity, day block, a "Now:" minute line), then a cache-boundary comment, then the user text, plus 4 tool schemas of 2929 chars.
  - Ollama renders the tools after the system text. The "Now:" line therefore still precedes about 1000 tokens of tool schemas and user text, so any change to the line forces re-evaluation of those tokens.
  - This is my reading of the numbers (re-evaluated tokens equal prompt minus about 462). I did not confirm the template order.
- Net effect: the fixes help a little. The re-evaluated share is about 70% on the worker and 40% on the front desk.

## Q3. Why does a 1.4k-token 9B call take 3-6 s?

- `usage.input` equals Ollama's prompt count exactly (1486 = 1486), so the 4 tool schemas and the system prompt are included. History is empty (messages: 0).
- Output is short (22-43 tokens). There is no revise pass and no tool call on these items.
- The time breakdown for d001/d004:
  - Prefill of the re-read ~1000 tokens: 2.1-3.7 s, at 400-460 tok/s.
  - Decode of ~40 tokens at 13-17 tok/s: 2.4-2.9 s.
- The 9B decoded at 13-17 tok/s, against about 35 tok/s idle in the earlier audit and 42 tok/s in round 8. Machine speed is the main factor (Q4).

## Q4. Was the round-8 baseline comparable?

- Round 8 ran at about 11:08-11:12 BST: 16 items, 17 turns, q-ids. There is no id overlap with the d-ids.
- The prompts are the same size. Median worker input was 1323 tokens against ~1450 now. The decisions are mostly tool/escalate.
- The Ollama logs for the same prompt shapes show the machine speed difference:

| | Round 8 (11:07-11:13) | Sweep (14:19-14:24) |
|---|---|---|
| Front desk decode | 63 tok/s | 27 tok/s |
| Front desk prefill | 1662 tok/s | 1194 tok/s |
| Worker decode | 42 tok/s | 15 tok/s |
| Worker prefill | 1005 tok/s | 446 tok/s |
| Median front-desk time | 1.76 s | 3.3 s |
| Median non-plugin overhead | 2.4 s | 4.5 s |

- Median turn: 8.2 s then, 13-17 s now.
- The regression is real, but it is not item mix and not the fixes. It is machine throughput, about 2.3x slower at 14:19.
- The cause of the slow throughput at 14:19 is unproven. Candidates:
  - a third resident model: the DavidAU "Defiant" 9B was loaded at 14:08, though it was idle;
  - Orion.app, which is using about 50% CPU now;
  - the TTS and audio daemons.
- The earlier audit saw the same "half of idle" pattern with no cause found.

## Q5. Late slowdown

- Timeline:
  - 14:18-14:43: stable. Overhead is 4-5 s and Ollama rates are flat (prefill 1200 tok/s, decode 25 tok/s). The slow items in this stretch (d012-d036) have 5-10k-token inputs and 1-3 tool round trips.
  - The six coding agents ran from about 14:25-14:35. They show no visible effect on the metrics above.
  - **14:44:04: the break.** The log says "predicted to exceed available memory, evicting" (predicted 13.4 GiB, available 5.9 GiB).
    - gpt-oss:20b loaded at 14:44:09 and evicted both qwen models.
    - Both qwen models were reloaded at 14:44:14-26.
    - The d055 front-desk call hit its 8 s abort and got an HTTP 500 at 14:44:20. The 8 s abort turns a slow 4B into "escalate".
  - gpt-oss then ran long `/api/chat` calls every ~2-3 min:

| Call end | Duration |
|---|---|
| 14:45:28 | 1m23s |
| 14:47:51 | 2m23s |
| 14:50:28 | 2m36s |
| 14:52:07 | 1m38s |
| 14:54:12 | 2m05s |
| 14:57:00 | 2m48s |
| 15:05:43 | 3m43s |

  - These ran concurrently with the sweep. The caller is not the ORION plugin, which uses only the qwen models. I did not identify the caller.
  - The app's own narrative job no longer uses gpt-oss. It ran on the 9B at 14:18:11 and 14:19:40.
- Effect after 14:44:
  - Ollama's own rates halve: front desk decode 24 to 13 tok/s, prefill 1200 to 450 tok/s, worker decode down to 5-10 tok/s.
  - Front desk time rises from 3.4 s to 6-8 s.
  - The gateway tool-search catalog stage is CPU-bound and does no Ollama call. It rises from 2.3 s to 6-15 s (up to 30 s) and is logged as "prep stages" warnings. Median hook-end to done: 2.3-2.5 s through 13:4x UTC, 12.6 s at 13:5x UTC, 22.6 s at 14:0x UTC.
  - The time before the gateway even receives the request (CLI spawn) goes from about 4 s to 18-40 s.
  - The cause of the CLI spawn and tool-search slowdown (CPU or memory contention, since they use no GPU) is not proven.
  - Plugin turnMs doubles (10 to 20-28 s).
- Memory pressure is a candidate: system_free was 5.9 GiB at 14:44:04, and the Mac has 48 GiB.

## Proposed next fixes (proposals only, nothing applied)

1. **Find and stop the gpt-oss:20b caller, and keep the sweep off the machine's other loads.** gpt-oss loads and evictions cost 20-60 s per turn after 14:44. Measure with the sweep rerun on an idle machine first. Expected: back to ~13 s median at current per-call speeds.
2. **Find why the machine ran 2.5x slower at 14:19 than at 11:08.** Check GPU contention from Orion.app, the TTS/audio daemons and the idle third resident model (unload "Defiant"). Expected: 13 to about 8 s, the round-8 level, if it is contention.
3. **Cut per-turn re-evaluation and fixed overhead.**
   - Move "Now:" and the day block after the tool schemas, or drop the schemas on turns that cannot use tools. Expected: about 1-2 s per turn.
   - Trim the front-desk system prompt, or shorten its 65-token JSON output (about 2.4 s of decode). This needs the V3 eval re-run, as the earlier audit notes.
   - Cut the fixed 4-5 s CLI spawn and gateway prep. This is mostly in openclaw, not this plugin.

---

# Follow-up: who loaded gpt-oss:20b, and why the GPU was 2.3x slower (read-only, 2026-10-16 evening)

Nothing was changed, killed or sent. Evidence: Ollama `server.log` (BST), `launchctl`, the LaunchAgents plists, `pmset`, the V3 queue log, `cron-delivery-history.jsonl`, and the repo sources. Times are BST.

## A. The 14:44 gpt-oss caller: NOT identified, but narrowed

**What the log proves about the 14:44 load**
- It is a different request shape from every earlier gpt-oss load today. Loads before it were started with `-c 32768` and the first request was `/api/generate` (sometimes `/api/chat`). The 14:44:05 load was started with `-c 16384`, so the caller sent `num_ctx: 16384` itself, and its first request was `/api/chat`.
- After the load, gpt-oss served a **single sequential client**. Each long call starts the moment the previous one ends:

| End | Duration | Notes |
|---|---|---|
| 14:45:28 | 1m23s | 3024-token prompt, 1543 tokens out (reasoning), 20.5 tok/s |
| 14:47:51 | 2m23s | |
| 14:50:28 | 2m36s | |
| 14:52:07 | 1m38s | |
| 14:54:12 | 2m05s | |
| 14:57:00 | 2m48s | |
| 15:02:00 | 5m0s | HTTP 500, looks like a 300 s client or server timeout |
| 15:05:43 | 3m43s | |

- The prompts are about 3000 tokens, sharing a prefix of about 1300 tokens (prefix match 1318/3007) with the previous call. That is a fixed instruction block plus varying content.
- The runner was not resident at 17:14. `/api/ps` shows only the two qwen models: 9B until 2026-10-17 17:00, 4B until 2026-10-17 15:00. That is keep_alive 24h, as intended.
- The only calls I can attribute to gpt-oss are the long ones above. Ollama's GIN lines do not name the model, so I could not attribute the short calls between them.

**Candidates, with evidence for and against**

| Candidate | Verdict |
|---|---|
| launchd job | **Against.** `launchctl list` has dashboard, tts, voiceid, link, remote, the gateway, the app, and `orion.sweep.day`. None has `StartInterval` or `StartCalendarInterval`. All of `com.nickmadaio.orion.*` and the gateway are `RunAtLoad`/`KeepAlive` daemons. `orion.sweep.day` is the sibling session's on-demand sweep (no gpt-oss, it talks to the gateway). No crontab. |
| ORION app (Orion.app) | **Against for 14:44.** The binary was rebuilt at 14:17:57. The new `LocalModel` uses `/api/generate`, and a non-resident model such as gpt-oss would get `keep_alive 0` and no `num_ctx`. The 14:44 load was `/api/chat`, ctx 16384, and stayed up for 20 minutes. The app **was** the likely source of the earlier loads (`/api/generate`, ctx 32768, up to 13:40) before the rebuild. |
| Gateway or plugin | **Against.** `local-routing.ts` line 21 mentions gpt-oss only in a comment. The gateway log and `shadow.jsonl` have 0 gpt-oss occurrences. The gateway logs `model overridden to qwen3.5:9b` for every turn. gpt-oss appears in `openclaw.json` and in session trajectories only as a configured model catalog entry, not as a call. |
| The five scripts | **Against.** `orion-standing` (polish), `orion-focus`, `orion-mission`, `orion-learn` and `orion-code` all use `/api/generate`, and none passes `num_ctx: 16384`. `orion-code` passes 65536. `orion/provider.py` uses `/api/chat` but sends no `num_ctx`, so its load would be 32768. |
| Test suite in the aw-wp* worktrees | **Not proven either way.** The tests I checked inject fakes: `tests/v3-judge.test.mjs` passes `chatImpl`, `tests/v3-ollama.test.mjs` passes `fakeFetch`, `tests/test_runtime.py` patches `OllamaProvider`, and `agentic-supervisor.test.mjs` only mentions 11434 in error strings. I did not find a test that reaches the real Ollama. The agents' `node --test` runs I can see started minutes ago, so they say nothing about 14:44. |
| V3 eval library (best match on shape) | **Matches the request shape, no process found.** `scripts/lib/eval/v3/ollama.mjs` is a streaming `/api/chat` client, and `configure()`, `run-j1`, `run-tools` and `run-schedule` all default to `ctx = 16384`. `scripts/eval/v3/ops/judge-calibration.mjs` defaults the judge to `gpt-oss:20b`, and `auto-freeze.mjs` lists it among its models. But no run directory or ledger entry was written 14:40-15:08 (the last V3 ledger entry is 2026-10-12), and no matching process exists now. So a V3 eval, or a one-off run in a sibling Claude session, fits the shape, but I cannot prove it. |

**Other facts found**
- `scripts/orion-v3-queue work` (pid 73030) has been alive for 7 days. It is idle: no `.job` files, last job finished 2026-10-10. It runs `orion-v3-eval` when jobs exist and pauses on battery. It is not the caller today, but it is a standing launcher for gpt-oss evals.
- 19 gpt-oss loads today, 00:00 to 13:40 plus the one at 14:44. All the 32768 ones are the `/api/generate` pattern (the old app narrative path, or the scripts). Overnight loads at 02:03-04:00 recur every 4-35 min, with 7-9 s first calls and some 57-64 s chats.
- `orion-focus check` runs every minute through the gateway cron (`focus-guard`, 126 `no_match` runs since 15:13 today, no model call). gpt-oss is only used on the `appeal` path (a user argues to be let off). `standing-orders` ran twice, both `silent`. Nothing in the repo passes `--polish`.

**What to measure next time (all read-only):** run `lsof -nP -iTCP:11434 -sTCP:ESTABLISHED` or `sudo nettop -p ollama -L 1` during an active gpt-oss call to get the client pid. Or set `OLLAMA_DEBUG_LOG_REQUESTS=true` for one session. At the moment the Ollama log does not say who is calling.

## B. gpt-oss users still in live code, and the recommended swap

All are `/api/generate` with no `num_ctx`, so each loads at 32768 and, with default keep_alive, stays about 5 min and evicts a qwen.

| User | What it does | Schedule | Swap to resident qwen3.5:9b (32768, 24h, think false)? |
|---|---|---|---|
| `orion-standing --polish` | Rewrites a notification, guarded by a digit-invention check | Only when `--polish` is passed. Nothing passes it. | **Yes.** Digit guard stays. Short rewrite, `num_predict` small. |
| `orion-focus` (appeal judge) | One-line `GRANT n reason` / `DENY reason`, 180 s curl | On demand when Nick argues, not scheduled. The every-minute `check` makes no model call. | **Yes, with a test.** Output is a constrained one-liner. Fail-closed (answer no) already exists. Re-run the 9B on a few grant/deny cases before relying on it. |
| `orion-mission` (`LOCAL_MODEL`) | Plan, execute, fix and inspect steps for missions, after the brain fails | Manual/resumed missions, fallback only | **Partly.** The prompts are long and agentic. The 9B should do plan and inspect. If execute needs reasoning, use `keep_alive 0` for that call or run it only when Nick is idle. |
| `orion-learn --judge` | Second-opinion review of proposals, to catch a confidently worded bad heuristic | Manual flag, run after hours | **Keep gpt-oss, but `keep_alive 0` and not while Nick is active.** The point of this judge is a different, stronger reviewer. The 9B is a weaker check for a bad heuristic. Or run it overnight. |
| `orion-code` (default coder) | Long coding loops, `num_ctx` 65536, thinking | Manual, `ORION_CODER_MODEL` overrides | **No, never the 9B.** It also needs 65536, which would force a reload of the 9B. Keep `gpt-oss:20b` or the 27B, run overnight or when idle, `keep_alive 0`. |
| `lib/agentic/models.mjs` | Only a comment about gpt-oss, plus the evict-check. | n/a | No change. Keep the evict logic. |
| `lib/eval/v3/presets.mjs` | Maps think levels per model family | n/a | No change, gpt-oss is a valid eval target. |
| `orion/runtime.py`, `orion/provider.py` | Python runtime, default `gpt-oss:20b`, `/api/chat`, 180 s timeout, no `num_ctx`, no keep_alive | Whenever the Python server runs | **Yes**: default to `qwen3.5:9b` with `num_ctx 32768`, `keep_alive 24h`, `think false`. Also `.env.example` (`ORION_MODEL_LOCAL=gpt-oss:20b`). Note `tests/test_v2_model_contract.py` and `test_v2_mac_ledger_adapter.py` pin gpt-oss as the `local` and `coder` role, so they would need updating. |

Rule of thumb: anything that is a short text transform can use the 9B. Anything that needs deliberate reasoning or a long context (`orion-code`, `orion-learn --judge`, V3 judge) should name `keep_alive 0` and be gated on idle time.

## C. Why the GPU was about 2.3x slower at 14:19: most likely battery and Low Power Mode

The slowdown is **not** caused by the 14:44 gpt-oss load. It started about 13:00.

- **Decode on the 9B** (32768-context calls, median over 30-minute buckets from the Ollama log):

| Time | Median decode |
|---|---|
| 11:00 | 39.7 tok/s |
| 12:00 | 35.9 tok/s |
| 12:30 | 33.7 tok/s |
| 13:00 | 17.0 tok/s |
| 13:30 | 15.2 tok/s |
| 14:00 | 15.4 tok/s |
| 14:30 | 14.6 tok/s |

  This is a step at about 13:00, not a gradual drift and not tied to the agents (14:25-14:35) or the gpt-oss load (14:44).
- **The V3 queue worker logs power transitions** (it checks every 60 s). Its log ends `12:56:07 on battery - paused` and then `17:13:18 on AC - resuming`. That puts the Mac on battery from 12:56 to 17:13, exactly covering the slow period and the sweep. It matches the step at 13:00.
- **Power settings:** `pmset -g custom` has `powermode 1` (low power) on battery and `powermode 2` (high power) on AC. `system_profiler` reports Low Power Mode as enabled in the settings listing. The battery is at 42% and charging now on a 140 W charger.
- **No thermal evidence:** `pmset -g therm` reports no thermal, performance or CPU power warning level recorded.
- **Memory pressure was also present:** swap is 6.6 of 8 GB used, with 57% memory free right now. At 14:44:04 Ollama saw `system_free` 5.9 GiB on a 48 GiB Mac, which is why it evicted the qwen models for the 13 GiB gpt-oss load.
- **Other load:** `ps` now shows XprotectService at 72% CPU (running for 1h40m), Orion.app at 57%, and Simulator/Xcode builds. The only GPU users are the two Ollama runners and the TTS daemon (mlx-audio, pid 76756, up 6h28m). No third LLM runner is resident now. The earlier Defiant 9B load (14:08) was idle after that.

**What can and cannot be known after the fact**
- Known: the step time (about 13:00), the battery interval from the queue log, the current power settings, and that no thermal warning is recorded.
- Not known: whether Low Power Mode was actually on during the slow period. The `pmset -g log` history query would not return in time, so I did not confirm it from there. GPU clock, power draw and GPU contention at 14:19 were not recorded, and `powermetrics` needs sudo.
- Not proven: causation. The correlation with battery is strong (one step, right at the logged transition), but I did not re-run the model on AC to confirm. The current decode on AC has not been measured, because that would send a model request.

**To confirm next time**
1. Run the sweep plugged in with `pmset -g custom` showing `powermode 2`, and compare decode against 11:08 (about 40 tok/s).
2. During a slow stretch, log `pmset -g batt`, `pmset -g therm` and `sudo powermetrics --samplers gpu_power,thermal -n 3`.
3. Make Ollama's tok/s part of the sweep's own record (it already prints it), plus the power source per run.
4. Check `pmset -g log | grep -E "Using (AC|Batt)"` for the 12:56 transition.

## D. Answers in short

1. **Caller at 14:44:** not identified. It was one sequential `/api/chat` client with `num_ctx 16384`, running back-to-back from 14:44:05 to about 15:05. No launchd job, the app (rebuilt 14:17:57), the gateway/plugin, or any of the five scripts matches that request shape. The V3 eval library matches it exactly (`ctx 16384`, `/api/chat`), but there is no run record. It is not on a schedule I can find, and it has not recurred since 15:06.
2. **Swap:** `orion-standing --polish`, `orion-focus` and `orion/runtime.py` and `provider.py` can move to the resident 9B. `orion-mission` is partial. `orion-learn --judge` and `orion-code` need gpt-oss or the 27B, with `keep_alive 0`, overnight or idle only.
3. **Slowdown:** most likely the Mac running on battery in Low Power Mode from 12:56 to 17:13. The decode step is at about 13:00. It is unconfirmed until re-measured on AC.
