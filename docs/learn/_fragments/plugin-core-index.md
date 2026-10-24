# Fragment: plugin core (04_plugin_core_actions_gate.md)
> Snapshot 6c93032 (2026-10-14). Paths relative to repo root; `src/` = `plugin/orion-control/src/`.

### API calls
| Service | Endpoint / method | Called from (path:line) | Auth (by name only) | Purpose |
|---|---|---|---|---|
| Open-Meteo geocoding | GET `https://geocoding-api.open-meteo.com/v1/search?name=…&count=1&format=json` | `src/ambient.ts:28`, `:114-140` | none (keyless) | Resolve a place for `weather_now` |
| Open-Meteo forecast | GET `https://api.open-meteo.com/v1/forecast?latitude&longitude&current&daily&hourly&forecast_days&timezone=auto` | `src/ambient.ts:29`, `:144-224` | none | Weather report |
| Atlas local bridge | file-drop JSON RPC in `~/Library/Containers/<com.nickmadaio.atlas[.local|.staging]>/…/AgentBridge/` | `src/atlas.ts:208-251` | owner-only file permissions | Atlas notes actions |
| macOS LaunchServices / AppleScript | `/usr/bin/open`, `/usr/bin/osascript`, `plutil`, `pmset`, `defaults`, `lsof`, `df` | `src/executors.ts` (§14 of 04) | macOS Automation permission per app | App, browser, media, tuning, status |
| OpenClaw gateway hooks | `api.on(...)` | `src/index.ts:1544-1718` | host | Provenance, guards (see Tool calls) |

### System prompts / instruction text sent to models
| Name | Source (path:line) | Sent to (model/route) | When | Summary |
|---|---|---|---|---|
| `orion_task_run` description | `src/index.ts:1114-1151` | whichever model has the tool (OpenClaw tool schema) | every turn the tool is exposed | How to call, never send risk/hashes, read `executed`/`confidence`, approval-id procedure, all 119 action names, optional args |
| Other tool descriptions | `src/index.ts:1231-1254`, `:1292-1293`, `:1321-1322`, `:1350`, `:1361-1362`, `:1438-1439` | same | same | propose/list/run/status/permission tools |
| Repeat-guard block reasons | `src/index.ts:1601-1602`, `:1621-1622` | model, as tool refusal | on loop | "Reply to Nick NOW…" / "change the arguments or stop" |
| Exec-routing block reason | `src/index.ts:1641` (text from `src/exec-routing.ts`, see 05) | model | doomed exec | names the right route |
| Result notes | `src/index.ts:1020-1041`, `:1058-1064` | model, in tool result | approvals/cancel | "Waiting on Nick. Tell him the id out loud…", "do not claim you approved anything" |
| Outcome envelope | `src/outcome.ts:92-164` | model, in tool result | every run | `executed`, shouted `outcome`, `reportToUser`, `nextStep` |
| Integrity refusal | `src/index.ts:735-743` | model | tampered install | "NOT DONE. ORION's installed controls were changed outside a deploy…" |
| Account-health / local-routing prompts | `src/account-health.ts:238-243`, `src/local-routing.ts` | — | — | covered in 05 |

### Memory reads/writes (anything that persists knowledge about Nick or the conversation)
| Store (path or system) | Op | Code (path:line) | What |
|---|---|---|---|
| `~/.openclaw/agents/main/sessions/*.jsonl` | read | `src/transcript.ts:211-306`, `src/index.ts:681-707`, `:1696` | Last ≤8 user turns as trust source; latest turn for episodic capture |
| `~/.openclaw/workspace/memory/<YYYY-MM-DD>.md` | write | `src/episodic.ts:111-146`, `src/index.ts:1688-1717` | `## Episodes` auto lines from Nick's durable statements |
| `~/.openclaw/orion-controlled/task-ledger.jsonl` | append/read | `src/ledger.ts:8-65`, `src/controller.ts:145-152` | Every run with arguments and outputs |
| `~/.openclaw/orion-controlled/archive/ledger-<day>.jsonl.gz` | write (script) | `scripts/orion-daily:185-215` | Daily rotation of ledger rows |
| `~/.openclaw/orion-controlled/actions/{running,cancel}/` | write/read | `src/cancellation.ts:28-45` | Running-task marks, cancel requests |
| `~/.openclaw/orion-controlled/permission-state.json`, `permission-audit.jsonl` | read/write | `src/permissions.ts:231-316` | Profile + audit |
| `~/.openclaw/orion-gate/strictness.json` | read | `src/strictness.ts:430-493` | Delegation |
| `~/.openclaw/orion-gate/approvals/{tickets,grants,used,chat}` | read/write | `src/approvals.ts:133-414` | Tickets, grants, spends, chat grants |
| `~/.openclaw/orion-gate/integrity/orion-control.json` | read | `src/integrity.ts:51-73` | Install manifest |
| In-memory `HarnessProvenance` | write/read | `src/provenance.ts:163-522` | Turns, bindings, observed content (10 min), self-authored paths (12 h) |
| `reminders.json`, `health-log.json`, `waiting.json`, `trips.json`, `workshop.json`, `automations/proposed/*.json`, `selfdev-queue.json` (all `~/.openclaw/orion-controlled/`) | read/write | `src/ambient.ts:320-360`, `src/health.ts`, `src/executors.ts:3587-3961`, `src/workshop.ts:107-123`, `src/executors.ts:3481-3585`, `:3428-3479` | Feature stores |
| `~/Library/Messages/chat.db` (via `scripts/orion-messages`) | read | `src/executors.ts:4181-4209` | iMessage history reads |
| `UserDefaults` `com.nickmadaio.orion.app` | read/write | `src/executors.ts:2433-2534` | Voice tuning keys |

### Tool calls (tools exposed to a model, or CLIs a model invokes)
| Tool / CLI | Defined at (path:line) | Who calls it | Args | Side effects / gate |
|---|---|---|---|---|
| `orion_task_run` | `src/index.ts:1110` | model | `graph` or `{action, arguments, approvalHash?}` or `{steps}` | runs catalog actions; integrity + provenance + validator + approvals + ledger |
| `orion_tool_propose` | `src/index.ts:1228` | model | name, description, rationale, parameters, steps | writes workshop.json (proposed) |
| `orion_tool_list` | `src/index.ts:1289` | model | — | read |
| `orion_tool_run` | `src/index.ts:1318` | model | name, arguments | expands approved recipe → `runAuthorizedGraph` |
| `orion_task_status` | `src/index.ts:1347` | model | taskId | read live ledger |
| `orion_permission_status` | `src/index.ts:1358` | model | — | read |
| `orion_permission_change` | `src/index.ts:1435` | model | requestedProfile, expectedVersion, context, approvalHash? | writes permission state + audit; raise needs hash echo + Nick's words naming profile |
| action `atlas_collections_list` | `src/catalog.ts:1603` | model via `orion_task_run` | — | tier `atlas_notes`, risk low; exec `atlas`; verifier `atlas_collections_reported` |
| action `atlas_notes_search` | `src/catalog.ts:1612` | model via `orion_task_run` | query | tier `atlas_notes`, risk low; exec `atlas`; verifier `atlas_notes_reported` |
| action `atlas_note_read` | `src/catalog.ts:1635` | model via `orion_task_run` | noteID | tier `atlas_notes`, risk low; exec `atlas`; verifier `atlas_note_reported` |
| action `atlas_note_create` | `src/catalog.ts:1648` | model via `orion_task_run` | collectionID, title, markdown | tier `atlas_notes`, risk medium, irreversible; exec `atlas`; verifier `atlas_note_created` |
| action `atlas_note_update` | `src/catalog.ts:1676` | model via `orion_task_run` | noteID, expectedUpdatedAt | tier `atlas_notes`, risk medium, irreversible; exec `atlas`; verifier `atlas_note_updated` |
| action `self_source_list` | `src/catalog.ts:1727` | model via `orion_task_run` | — | tier `desktop_read`, risk low; exec `self_source`; verifier `self_source_listed` |
| action `self_source_read` | `src/catalog.ts:1736` | model via `orion_task_run` | file | tier `desktop_read`, risk low; exec `self_source`; verifier `self_source_read` |
| action `self_modify` | `src/catalog.ts:1752` | model via `orion_task_run` | file, find, replace | tier `self_modification`, risk high; exec `self_modify`; verifier `self_modify_applied` |
| action `self_plugin_list` | `src/catalog.ts:1801` | model via `orion_task_run` | — | tier `desktop_read`, risk low; exec `self_repair`; verifier `self_repair_listed` |
| action `self_plugin_read` | `src/catalog.ts:1810` | model via `orion_task_run` | pluginFile | tier `desktop_read`, risk low; exec `self_repair`; verifier `self_repair_read` |
| action `self_plugin_modify` | `src/catalog.ts:1825` | model via `orion_task_run` | pluginFile, find, replace | tier `self_plugin`, risk high; exec `self_repair`; verifier `self_repair_applied` |
| action `self_plugin_authority_modify` | `src/catalog.ts:1847` | model via `orion_task_run` | pluginFile, find, replace | tier `self_plugin`, risk critical, approval, user-named `pluginFile`, authority words; exec `self_repair`; verifier `self_repair_applied` |
| action `self_plugin_revert` | `src/catalog.ts:1865` | model via `orion_task_run` | — | tier `self_plugin`, risk medium; exec `self_repair`; verifier `self_repair_reverted` |
| action `self_script_list` | `src/catalog.ts:1874` | model via `orion_task_run` | — | tier `desktop_read`, risk low; exec `self_repair`; verifier `self_repair_listed` |
| action `self_script_read` | `src/catalog.ts:1883` | model via `orion_task_run` | script | tier `desktop_read`, risk low; exec `self_repair`; verifier `self_repair_read` |
| action `self_script_modify` | `src/catalog.ts:1898` | model via `orion_task_run` | script, find, replace | tier `self_scripts`, risk high; exec `self_repair`; verifier `self_repair_applied` |
| action `self_script_authority_modify` | `src/catalog.ts:1909` | model via `orion_task_run` | script, find, replace | tier `self_scripts`, risk critical, approval, user-named `script`, authority words; exec `self_repair`; verifier `self_repair_applied` |
| action `self_script_revert` | `src/catalog.ts:1926` | model via `orion_task_run` | — | tier `self_scripts`, risk medium; exec `self_repair`; verifier `self_repair_reverted` |
| action `self_config_list` | `src/catalog.ts:1935` | model via `orion_task_run` | — | tier `self_config`, risk low; exec `self_repair`; verifier `self_repair_listed` |
| action `self_config_set` | `src/catalog.ts:1944` | model via `orion_task_run` | key, value | tier `self_config`, risk medium; exec `self_repair`; verifier `self_repair_applied` |
| action `self_config_authority_set` | `src/catalog.ts:1958` | model via `orion_task_run` | key, value | tier `self_config`, risk critical, approval, user-named `key`, authority words; exec `self_repair`; verifier `self_repair_applied` |
| action `self_config_revert` | `src/catalog.ts:1975` | model via `orion_task_run` | — | tier `self_config`, risk medium; exec `self_repair`; verifier `self_repair_reverted` |
| action `self_repair_status` | `src/catalog.ts:1984` | model via `orion_task_run` | — | tier `desktop_read`, risk low; exec `self_repair`; verifier `self_repair_status` |
| action `folder_create` | `src/catalog.ts:1993` | model via `orion_task_run` | path | tier `simulation`, risk low; exec `simulate`; verifier `folder_exists` |
| action `app_open` | `src/catalog.ts:2002` | model via `orion_task_run` | application | tier `app_control`, risk low; exec `app_control`; verifier `application_is_open` |
| action `app_quit` | `src/catalog.ts:2020` | model via `orion_task_run` | application | tier `app_control`, risk low; exec `app_control`; verifier `application_is_closed` |
| action `email_send` | `src/catalog.ts:2038` | model via `orion_task_run` | to, subject, body | tier `simulation`, risk high, approval, irreversible; exec `simulate`; verifier `message_in_sent_mail` |
| action `browser_open_url` | `src/catalog.ts:2047` | model via `orion_task_run` | url [opt: browser] | tier `browser_control`, risk medium; exec `browser_control`; verifier `browser_tab_shows_url` |
| action `browser_new_tab` | `src/catalog.ts:2063` | model via `orion_task_run` | — [opt: browser] | tier `browser_control`, risk low; exec `browser_control`; verifier `browser_tab_count_increased` |
| action `browser_close_tab` | `src/catalog.ts:2077` | model via `orion_task_run` | — [opt: browser] | tier `browser_control`, risk low, irreversible; exec `browser_control`; verifier `browser_tab_count_decreased` |
| action `browser_list_tabs` | `src/catalog.ts:2091` | model via `orion_task_run` | — [opt: browser] | tier `browser_control`, risk low; exec `browser_control`; verifier `browser_tab_list_matches` |
| action `browser_switch_tab` | `src/catalog.ts:2106` | model via `orion_task_run` | tab [opt: browser] | tier `browser_control`, risk low; exec `browser_control`; verifier `browser_active_tab_matches` |
| action `browser_read_page` | `src/catalog.ts:2123` | model via `orion_task_run` | — [opt: browser] | tier `browser_control`, risk medium; exec `browser_control`; verifier `browser_active_tab_url_matches` |
| action `media_play_pause` | `src/catalog.ts:2140` | model via `orion_task_run` | — [opt: player] | tier `media_control`, risk low; exec `media_control`; verifier `media_player_state_toggled` |
| action `media_now_playing` | `src/catalog.ts:2154` | model via `orion_task_run` | — [opt: player] | tier `media_control`, risk low; exec `media_control`; verifier `media_track_reported` |
| action `media_next_track` | `src/catalog.ts:2163` | model via `orion_task_run` | — [opt: player] | tier `media_control`, risk low; exec `media_control`; verifier `media_track_advanced` |
| action `media_previous_track` | `src/catalog.ts:2175` | model via `orion_task_run` | — [opt: player] | tier `media_control`, risk low; exec `media_control`; verifier `media_track_returned` |
| action `volume_set` | `src/catalog.ts:2187` | model via `orion_task_run` | level | tier `media_control`, risk low; exec `media_control`; verifier `system_volume_matches` |
| action `volume_mute` | `src/catalog.ts:2200` | model via `orion_task_run` | — | tier `media_control`, risk low; exec `media_control`; verifier `system_volume_muted` |
| action `volume_unmute` | `src/catalog.ts:2208` | model via `orion_task_run` | — | tier `media_control`, risk low; exec `media_control`; verifier `system_volume_unmuted` |
| action `display_sleep` | `src/catalog.ts:2216` | model via `orion_task_run` | — | tier `media_control`, risk low; exec `media_control`; verifier `display_sleep_command_accepted` |
| action `file_copy` | `src/catalog.ts:2224` | model via `orion_task_run` | root, relativePath, destinationPath | tier `file_mutate`, risk medium; exec `file_mutate`; verifier `file_copy_matches_source` |
| action `file_move` | `src/catalog.ts:2231` | model via `orion_task_run` | root, relativePath, destinationPath | tier `file_mutate`, risk medium; exec `file_mutate`; verifier `file_present_at_destination` |
| action `file_rename` | `src/catalog.ts:2244` | model via `orion_task_run` | root, relativePath, newName | tier `file_mutate`, risk medium; exec `file_mutate`; verifier `file_present_at_destination` |
| action `file_delete` | `src/catalog.ts:2262` | model via `orion_task_run` | root, relativePath | tier `file_mutate`, risk high, approval; exec `file_mutate`; verifier `file_in_trash` |
| action `test_marker_create` | `src/catalog.ts:2268` | model via `orion_task_run` | marker, content | tier `test_workspace`, risk low; exec `create_only_text`; verifier `test_marker_content_matches` |
| action `scratch_text_create` | `src/catalog.ts:2286` | model via `orion_task_run` | name, extension, content | tier `scratch_workspace`, risk low; exec `create_only_text`; verifier `scratch_text_content_matches` |
| action `desktop_list` | `src/catalog.ts:2304` | model via `orion_task_run` | — | tier `desktop_read`, risk low; exec `list_directory`; verifier `desktop_listing_matches` |
| action `desktop_metadata` | `src/catalog.ts:2324` | model via `orion_task_run` | relativePath | tier `desktop_read`, risk low; exec `path_metadata`; verifier `desktop_metadata_matches` |
| action `desktop_text_read` | `src/catalog.ts:2342` | model via `orion_task_run` | relativePath | tier `desktop_read`, risk low; exec `read_text`; verifier `desktop_text_content_matches` |
| action `desktop_test_text_create` | `src/catalog.ts:2367` | model via `orion_task_run` | name, extension, content | tier `desktop_test_workspace`, risk low; exec `create_only_text`; verifier `desktop_test_text_content_matches` |
| action `desktop_text_create_confirmed` | `src/catalog.ts:2385` | model via `orion_task_run` | relativePath, content | tier `desktop_modify`, risk medium; exec `mutate_text`; verifier `desktop_text_result_hash_matches` |
| action `desktop_text_append_confirmed` | `src/catalog.ts:2386` | model via `orion_task_run` | relativePath, content | tier `desktop_modify`, risk medium, irreversible; exec `mutate_text`; verifier `desktop_text_result_hash_matches` |
| action `desktop_text_replace_confirmed` | `src/catalog.ts:2387` | model via `orion_task_run` | relativePath, content | tier `desktop_modify`, risk medium, irreversible; exec `mutate_text`; verifier `desktop_text_result_hash_matches` |
| action `desktop_folder_create_explicit` | `src/catalog.ts:2388` | model via `orion_task_run` | relativePath | tier `desktop_direct_write`, risk low; exec `create_directory`; verifier `scoped_directory_exists` |
| action `desktop_file_write_explicit` | `src/catalog.ts:2392` | model via `orion_task_run` | relativePath, operation, content | tier `desktop_direct_write`, risk medium, irreversible; exec `mutate_file`; verifier `scoped_file_result_hash_matches` |
| action `scratch_folder_create_explicit` | `src/catalog.ts:2396` | model via `orion_task_run` | relativePath | tier `scratch_direct_write`, risk low; exec `create_directory`; verifier `scoped_directory_exists` |
| action `scratch_file_write_explicit` | `src/catalog.ts:2400` | model via `orion_task_run` | relativePath, operation, content | tier `scratch_direct_write`, risk medium, irreversible; exec `mutate_file`; verifier `scoped_file_result_hash_matches` |
| action `home_list` | `src/catalog.ts:2406` | model via `orion_task_run` | — | tier `home_read`, risk low; exec `list_directory`; verifier `home_listing_matches` |
| action `home_metadata` | `src/catalog.ts:2428` | model via `orion_task_run` | relativePath | tier `home_read`, risk low; exec `path_metadata`; verifier `home_metadata_matches` |
| action `home_read_text` | `src/catalog.ts:2448` | model via `orion_task_run` | relativePath | tier `home_read`, risk low; exec `read_text`; verifier `home_text_content_matches` |
| action `weather_now` | `src/catalog.ts:2485` | model via `orion_task_run` | location [opt: days] | tier `ambient_info`, risk low; exec `ambient_read`; verifier `weather_reported` |
| action `clock_now` | `src/catalog.ts:2510` | model via `orion_task_run` | — | tier `ambient_info`, risk low; exec `ambient_read`; verifier `clock_reported` |
| action `system_status` | `src/catalog.ts:2527` | model via `orion_task_run` | — | tier `ambient_info`, risk low; exec `ambient_read`; verifier `system_status_reported` |
| action `timer_set` | `src/catalog.ts:2544` | model via `orion_task_run` | seconds | tier `reminders`, risk low; exec `reminder`; verifier `reminder_stored` |
| action `alarm_set` | `src/catalog.ts:2570` | model via `orion_task_run` | at | tier `reminders`, risk low; exec `reminder`; verifier `reminder_stored` |
| action `reminder_list` | `src/catalog.ts:2591` | model via `orion_task_run` | — | tier `reminders`, risk low; exec `reminder`; verifier `reminders_listed` |
| action `reminder_cancel` | `src/catalog.ts:2601` | model via `orion_task_run` | id | tier `reminders`, risk low, irreversible; exec `reminder`; verifier `reminder_absent` |
| action `voice_tuning_read` | `src/catalog.ts:2620` | model via `orion_task_run` | — | tier `self_tuning`, risk low; exec `self_tuning`; verifier `tuning_readback` |
| action `voice_tuning_set` | `src/catalog.ts:2630` | model via `orion_task_run` | setting, value | tier `self_tuning`, risk low; exec `self_tuning`; verifier `tuning_readback` |
| action `supplement_take` | `src/catalog.ts:2664` | model via `orion_task_run` | name | tier `health_tracking`, risk low; exec `health_log`; verifier `health_log_readback` |
| action `supplement_add` | `src/catalog.ts:2680` | model via `orion_task_run` | name | tier `health_tracking`, risk low; exec `health_log`; verifier `health_log_readback` |
| action `supplement_remove` | `src/catalog.ts:2708` | model via `orion_task_run` | name | tier `health_tracking`, risk low; exec `health_log`; verifier `health_log_readback` |
| action `supplement_update` | `src/catalog.ts:2722` | model via `orion_task_run` | name | tier `health_tracking`, risk low; exec `health_log`; verifier `health_log_readback` |
| action `supplement_status` | `src/catalog.ts:2743` | model via `orion_task_run` | — | tier `health_tracking`, risk low; exec `health_log`; verifier `health_log_readback` |
| action `workout_log` | `src/catalog.ts:2753` | model via `orion_task_run` | exercise, sets | tier `health_tracking`, risk low; exec `health_log`; verifier `health_log_readback` |
| action `workout_status` | `src/catalog.ts:2791` | model via `orion_task_run` | — | tier `health_tracking`, risk low; exec `health_log`; verifier `health_log_readback` |
| action `calendar_event_add` | `src/catalog.ts:2808` | model via `orion_task_run` | title, start | tier `calendar`, risk medium, user-named `title`; exec `calendar`; verifier `calendar_event_present` |
| action `calendar_event_remove` | `src/catalog.ts:2839` | model via `orion_task_run` | title | tier `calendar`, risk high, approval, irreversible, user-named `title`; exec `calendar`; verifier `calendar_event_absent` |
| action `apple_reminder_add` | `src/catalog.ts:2856` | model via `orion_task_run` | title | tier `calendar`, risk medium, user-named `title`; exec `calendar`; verifier `apple_reminder_present` |
| action `apple_reminder_complete` | `src/catalog.ts:2882` | model via `orion_task_run` | title | tier `calendar`, risk low, user-named `title`; exec `calendar`; verifier `apple_reminder_completed` |
| action `messages_recent` | `src/catalog.ts:2912` | model via `orion_task_run` | — | tier `messages_read`, risk low; exec `messages_read`; verifier `messages_reported` |
| action `messages_from` | `src/catalog.ts:2925` | model via `orion_task_run` | person | tier `messages_read`, risk low; exec `messages_read`; verifier `messages_reported` |
| action `messages_search` | `src/catalog.ts:2943` | model via `orion_task_run` | text | tier `messages_read`, risk low; exec `messages_read`; verifier `messages_reported` |
| action `messages_chats` | `src/catalog.ts:2961` | model via `orion_task_run` | — | tier `messages_read`, risk low; exec `messages_read`; verifier `messages_reported` |
| action `messages_whoami` | `src/catalog.ts:2990` | model via `orion_task_run` | — | tier `messages_read`, risk low; exec `messages_read`; verifier `messages_reported` |
| action `messages_contacts_status` | `src/catalog.ts:3000` | model via `orion_task_run` | — | tier `messages_read`, risk low; exec `messages_read`; verifier `messages_reported` |
| action `git_status` | `src/catalog.ts:3056` | model via `orion_task_run` | repository | tier `dev_operations`, risk low; exec `dev_operation`; verifier `git_status_reported` |
| action `git_log` | `src/catalog.ts:3057` | model via `orion_task_run` | repository | tier `dev_operations`, risk low; exec `dev_operation`; verifier `git_log_reported` |
| action `git_diff` | `src/catalog.ts:3064` | model via `orion_task_run` | repository | tier `dev_operations`, risk low; exec `dev_operation`; verifier `git_diff_reported` |
| action `git_pull` | `src/catalog.ts:3070` | model via `orion_task_run` | repository | tier `dev_operations`, risk high; exec `dev_operation`; verifier `git_pull_reported` |
| action `tests_run` | `src/catalog.ts:3071` | model via `orion_task_run` | repository | tier `dev_operations`, risk high; exec `dev_operation`; verifier `tests_reported` |
| action `build_run` | `src/catalog.ts:3072` | model via `orion_task_run` | repository | tier `dev_operations`, risk high; exec `dev_operation`; verifier `build_reported` |
| action `package_install` | `src/catalog.ts:3073` | model via `orion_task_run` | repository | tier `dev_operations`, risk high; exec `dev_operation`; verifier `install_reported` |
| action `selfdev_queue` | `src/catalog.ts:3099` | model via `orion_task_run` | repository, task | tier `dev_operations`, risk medium; exec `selfdev`; verifier `selfdev_task_queued` |
| action `selfdev_status` | `src/catalog.ts:3128` | model via `orion_task_run` | repository | tier `dev_operations`, risk low; exec `selfdev`; verifier `selfdev_status_read` |
| action `automation_propose` | `src/catalog.ts:3137` | model via `orion_task_run` | name, intent, trigger, action, expiresOn | tier `automation`, risk medium; exec `automation`; verifier `automation_proposed` |
| action `automation_list` | `src/catalog.ts:3147` | model via `orion_task_run` | — | tier `automation`, risk low; exec `automation`; verifier `automation_listed` |
| action `automation_simulate` | `src/catalog.ts:3156` | model via `orion_task_run` | name | tier `automation`, risk low; exec `automation`; verifier `automation_simulated` |
| action `automation_withdraw` | `src/catalog.ts:3169` | model via `orion_task_run` | name | tier `automation`, risk low; exec `automation`; verifier `automation_withdrawn` |
| action `waiting_add` | `src/catalog.ts:3192` | model via `orion_task_run` | id, what, who, expect, dueBy | tier `waiting_on`, risk low; exec `waiting`; verifier `waiting_stored` |
| action `waiting_list` | `src/catalog.ts:3202` | model via `orion_task_run` | — | tier `waiting_on`, risk low; exec `waiting`; verifier `waiting_reported` |
| action `waiting_resolve` | `src/catalog.ts:3211` | model via `orion_task_run` | id | tier `waiting_on`, risk low; exec `waiting`; verifier `waiting_stored` |
| action `waiting_dismiss` | `src/catalog.ts:3221` | model via `orion_task_run` | id | tier `waiting_on`, risk low; exec `waiting`; verifier `waiting_stored` |
| action `waiting_snooze` | `src/catalog.ts:3231` | model via `orion_task_run` | id, days | tier `waiting_on`, risk low; exec `waiting`; verifier `waiting_stored` |
| action `waiting_draft` | `src/catalog.ts:3248` | model via `orion_task_run` | id | tier `waiting_on`, risk low; exec `waiting`; verifier `waiting_reported` |
| action `prep_card` | `src/catalog.ts:3268` | model via `orion_task_run` | title | tier `prep`, risk low; exec `prep_card`; verifier `prep_card_rendered` |
| action `trip_detect` | `src/catalog.ts:3304` | model via `orion_task_run` | — | tier `travel`, risk low; exec `travel`; verifier `travel_reported` |
| action `trip_list` | `src/catalog.ts:3313` | model via `orion_task_run` | — | tier `travel`, risk low; exec `travel`; verifier `travel_reported` |
| action `trip_add` | `src/catalog.ts:3322` | model via `orion_task_run` | id, name, startsOn, endsOn | tier `travel`, risk low; exec `travel`; verifier `travel_stored` |
| action `trip_remove` | `src/catalog.ts:3332` | model via `orion_task_run` | id | tier `travel`, risk low; exec `travel`; verifier `travel_stored` |
| action `trip_brief` | `src/catalog.ts:3342` | model via `orion_task_run` | id | tier `travel`, risk low; exec `travel`; verifier `travel_reported` |
| action `screen_observe` | `src/catalog.ts:3364` | model via `orion_task_run` | — | tier `computer_observe`, risk medium; exec `computer_observe`; verifier `screen_observed` |
| action `screen_capture` | `src/catalog.ts:3365` | model via `orion_task_run` | — | tier `computer_observe`, risk medium; exec `computer_observe`; verifier `screen_captured` |
| action `screen_click` | `src/catalog.ts:3367` | model via `orion_task_run` | expectedBundleId, x, y | tier `computer_control`, risk critical, approval, irreversible; exec `computer_control`; verifier `screen_controlled` |
| action `screen_type` | `src/catalog.ts:3392` | model via `orion_task_run` | expectedBundleId, typedText | tier `computer_control`, risk critical, approval, irreversible; exec `computer_control`; verifier `screen_controlled` |
| action `screen_key` | `src/catalog.ts:3423` | model via `orion_task_run` | expectedBundleId, keyName | tier `computer_control`, risk critical, approval, irreversible; exec `computer_control`; verifier `screen_controlled` |
| action `terminal_run` | `src/catalog.ts:3453` | model via `orion_task_run` | command [opt: cwd] | tier `raw_terminal`, risk critical, approval, irreversible; exec `raw_terminal`; verifier `command_exited` |
| action `messages_send` | `src/catalog.ts:3476` | model via `orion_task_run` | recipient, body | tier `messages_send`, risk high, approval, irreversible, user-named `recipient`; exec `messages_send`; verifier `message_sent` |
| `scripts/orion-forge` | repo script | `self_modify`, `self_source_*` (`src/executors.ts:3091`, `:3963`) | edit/list/read | Swift edit + build + launch gate |
| `scripts/orion-repair` | repo script | `self_plugin_*`, `self_script_*`, `self_config_*`, `self_repair_status` (`src/executors.ts:3184`) | `<surface>-<op>` … | plugin/script/config repair with rollback |
| `scripts/orion-agenda-change` | repo script | calendar actions (`src/executors.ts:4218`) | add/remove-title/task-add/task-done | EventKit writes; not on exec allowlist |
| `scripts/orion-messages`, `orion-messages-send` | repo scripts | messages actions (`src/executors.ts:4181`, `:4272`) | see 04 §14 | read chat.db / send one iMessage |
| `scripts/orion-computer` | repo script | screen actions (`src/executors.ts:4040`, `:4137`) | observe/capture/click/type/key | Swift bridge with denylist |
| `scripts/orion-gmail-search`, `orion-recall`, `orion-agenda` | repo scripts | `prep_card`, `trip_detect` (`src/executors.ts:3717`, `:3830`) | query | reads |
| `/usr/bin/sandbox-exec … /bin/zsh -lc` | `src/executors.ts:4090` | `terminal_run` | command, cwd | sandbox denies writes to protected paths; approval each time or per chat |
| `python3 dist/file-copy-helper.py` | `src/executors.ts:1685` | `file_copy` | copy/verify | bounded copy |
| `git`, `npx vitest run`, `npm run build`, `npm ci` | `src/devops.ts:136-191` | dev actions | repository key | fixed argv, allowlisted env, timeouts |
| `scripts/orion-approve` (human only) | repo script | Nick | approve/deny/revoke-chat `<id>` | writes grants; not on exec allowlist; FORBIDDEN_SCRIPT |
| `scripts/orion-mode`, `orion-tools review`, `orion-automation install`, `orion-deploy`, `orion-daily` (human/scheduled) | repo scripts | Nick / scheduler | — | strictness, workshop approval, automation install, deploy, ledger rotation |
| host hook `message_received` | `src/index.ts:1544` | OpenClaw | event | record user turn |
| host hook `llm_input` | `src/index.ts:1552` | OpenClaw | event | record prompt turn |
| host hook `after_tool_call` | `src/index.ts:1564` | OpenClaw | event | record untrusted content |
| host hook `before_tool_call` | `src/index.ts:1572` | OpenClaw | event | repeat guard, exec routing, bind toolCallId |
| host hook `agent_end` | `src/index.ts:1655` | OpenClaw | event | clear guard state |
| host hook `before_agent_finalize` (episodic) | `src/index.ts:1688` | OpenClaw | event | journal append |
| account-health / local-routing hooks | `src/account-health.ts:221-238`, `src/local-routing.ts:269-396` | OpenClaw | — | see 05 |

### Config flags & env vars
| Name | Where read (path:line) | Default | Effect |
|---|---|---|---|
| `enable<Tier>Actions` (TestWorkspace, ScratchWorkspace, DesktopRead, DesktopTestWorkspace, DesktopModify, DesktopDirectWrite, ScratchDirectWrite, AppControl, BrowserControl, MediaControl, HomeRead, AmbientInfo, Reminder, FileMutate, SelfTuning, HealthTracking, Calendar, SelfModification, SelfPlugin, SelfScripts, SelfConfig, DevOperations, Automation, WaitingOn, Prep, Travel, AtlasNotes, ComputerObserve, ComputerControl, RawTerminal) | `src/index.ts:498-597` | off | adds the tier to configured set (∩ profile) |
| `enableMessagesReadActions`, `enableMessagesSendActions` | `src/index.ts:551`, `:557` | off | messages tiers; **not declared in either schema** |
| `desktopRoot` | `src/index.ts:581-592`, `:923` | unset | required for desktop tiers |
| `ledgerPath`, `testWorkspaceRoot`, `scratchWorkspaceRoot`, `homeRoot`, `trashRoot`, `remindersPath`, `healthLogPath`, `workshopPath`, `defaultWeatherLocation`, `browserPreference` | `src/index.ts:444-496`, `:913-934` | see 04 §3 | paths/defaults |
| `permissionStatePath`, `permissionAuditPath`, `strictnessStatePath`, `approvalRoot` | `src/index.ts:456-488` | `.orion-control/…`, `~/.openclaw/orion-gate/…` | authority state locations (forbidden to self-config) |
| `trustAllowPromptSource`, `trustAllowSessionBinding`, `trustAllowRecentBinding`, `trustAllowTranscriptSource`, `trustTranscriptAgent`, `trustTtlMs`, `trustRecentWindowMs` | `src/index.ts:608-627`, `src/provenance.ts:67-84` | true ×4, `main`, 15 min, 10 min | provenance policy |
| `enableStrictArguments` | `src/index.ts:842` | off | reject undeclared args (actions without validators) |
| `enableV2SystemStatusAdapter` | `src/index.ts:970-972` | off | v2 observer bridge |
| `enableEpisodicCapture`, `episodicMemoryPath` | `src/index.ts:1687-1709` | off, `~/.openclaw/workspace/memory` | journal capture |
| `accountHealth`, `accountFailFast`, `localRouting*` | `src/index.ts:1661-1686` | on/off/off | see 05 |
| `ORION_PROTECTED_PATHS` (env) | `src/protected-paths.ts:18` | empty | adds protected paths |
| env passed to `terminal_run` | `src/terminal-sandbox.ts:34-47` | allowlist | PATH, HOME, TERM, USER, LOGNAME, SHELL, LANG, LC_ALL, TMPDIR |
| env passed to dev ops | `src/devops.ts:205-226` | built | HOME, PATH, LANG, TMPDIR, CI=1 |
| `GOVERNED_SELF_DEVELOPMENT_ENABLED` (constant) | `src/self-development-authority.ts:83` | false | selfdev loop off |

### Glossary terms
| Term | Meaning |
|---|---|
| Task graph | `{goal, steps[]}` the model submits; each step names a catalog action |
| Action catalog | `ACTION_CATALOG`, 119 typed actions with risk/tier/verifier/policy |
| Capability tier | One of 33 switch groups; needs config flag AND profile |
| Permission profile | 5-rung "what exists" axis (`restricted_read_only` … `external_connected`) |
| Strictness mode | 4-rung "how much to ask" axis (`contained`, `guarded`, `open`, `sovereign`) |
| Floor | Per-action minimum gate level no mode can lower (authority change, third-party reach, irreversible) |
| Trust anchor | Authenticated user turns bound to a tool call (run/session/recent/none) |
| `trusted_user` / `untrusted_external` | Input trust assigned only by `authorizeTaskGraph` |
| Taint check | Refuse a target that appears in content ORION read but not in Nick's words |
| User-originated argument | Arg that must appear in Nick's own turns (recipient, calendar title, authority target) |
| Canonical hash | SHA-256 of `{action, arguments, workingContext}`; binds approvals and idempotency |
| Ticket / grant | Plugin-minted approval request (`A-XXXX`, 15 min) / person-written yes with matching nonce |
| Chat grant | "Allow for this chat" for `terminal_run`, ≤8 h, one session |
| Self-authored artifact | Path ORION wrote and verified; exempt from taint on later edits (12 h) |
| Verifier | Independent post-check; success = observed |
| Confidence | known/observed/inferred/uncertain/unable_to_verify, weakest step wins |
| Protected paths | `~/Desktop/ORION`, `~/.openclaw`, `~/Library/LaunchAgents`: no file action may change them |
| Integrity manifest | SHA-256 tree of the installed extension recorded by deploy/repair |
| Workshop / composed tool | Named recipe over catalog actions, approved by hash |
| Repeat guard | `before_tool_call` loop breaker (3 consecutive / 5 total; lockout after 3 blocks) |
