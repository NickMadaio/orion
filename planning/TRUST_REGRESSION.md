# The trust regression — diagnosis (2026-07-30, evening)

## Symptom

Orion: "The `orion_task_run` tool is still broken—same error as before."
Every gated action rejected with:

```
{"code": "no_authenticated_user_turn",
 "message": "No authenticated user turn was bound to this tool call…"}
```

## What is actually happening

From `orion_permission_status` → `trustProvenance`, on the live system:

```
channelMessageHookFired: false
promptHookFired:         false
toolCallHookFired:       true
retainedTurns:           0
lastBinding:             "none"
```

The hook API works — `before_tool_call` fires. But the two hooks that carry
**user text** do not:

- `message_received` is a *channel* event (Slack, iMessage). A turn started by
  `openclaw agent` or by Orion.app is not a channel message, so it never fires.
  This is correct behaviour, not a bug.
- `llm_input` does not fire for this run shape either.

So zero authenticated turns are ever captured. The hardening fails closed by
design, and with no source of user text it therefore rejects everything.

This is a regression I introduced with plugin 0.7.0. The security property is
sound; the input channel it depends on does not exist for local runs.

## The fix: a third provenance source

`before_tool_call` supplies a `sessionKey`/`runId` the model cannot forge, and
the **host** writes the session transcript at
`~/.openclaw/agents/<agent>/sessions/<id>.jsonl` as newline-delimited JSON:

```json
{"type":"message","id":"…","timestamp":"…",
 "message":{"role":"user","content":[{"type":"text","text":"…"}]}}
```

The model cannot author a `role: "user"` entry in that file — the host does.
Reading the newest user-role message for the bound session therefore gives a
genuine, unforgeable user turn, and preserves the strongest part of the
model: that the user's *own words* must name the operation and exact target.

Roughly 100 lines in `src/provenance.ts` plus tests, a rebuild, a redeploy to
`~/.openclaw/extensions/orion-control`, and a gateway restart.

## The interim alternative

Revert the trust check to the pre-0.7.0 behaviour (model-supplied
`trusted_user`). Orion works immediately; the model can assert its own
authorization, which is the injection hole the hardening closed.

That hole is materially smaller than it was this morning: `group:runtime`
(`exec`, `process`, `code_execution`) and `group:fs` (`write`, `edit`,
`apply_patch`) are now denied at the gateway, so `orion_task_run` is the only
route to the filesystem and every action lands in the audit ledger regardless.

## Unrelated but confirmed fixed this session

- MLX pinned to one thread — the warm engine was silently unused, every reply
  went through `say` at 3.2s. Now `engine=mlx-warm`, ~1.5s.
- `AVAudioEngine` released after speech — it was holding the output device at
  24 kHz mono, degrading all system audio while Orion was open.
- Reply parser reads `result.payloads[].text` — was reading one level too high.
- Setup no longer rebuilds unconditionally, which was resetting Accessibility
  on every launch while ad-hoc signed.
- `exec` / `write` / `edit` denied — Orion had been creating Desktop folders
  through a raw shell with an empty audit ledger.

## Still outstanding

- ElevenLabs key returns `http 401 invalid_api_key`.
- Deepgram STT unverified.
- No stable signing identity, so Accessibility still resets on a real rebuild.
