---
title: Trust Boundaries and Prompt Injection
note_type: concept
status: active
source_type: open-licensed-synthesis
sources:
  - https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
license_notes: OWASP Cheat Sheet Series, CC BY-SA 4.0; concise original synthesis.
created: 2026-07-29
updated: 2026-07-29
tags: [security, prompt-injection, trust]
---

# Trust Boundaries and Prompt Injection

Prompt injection occurs when untrusted content attempts to steer an agent as
if it were a trusted instruction. The core defense is architectural:

- distinguish instructions from data,
- keep authorization outside retrieved text and model output,
- minimize tools, data, and permissions,
- validate structured outputs before execution,
- require human approval for high-impact actions,
- monitor tool calls and verify outcomes,
- treat encoded, indirect, or multi-step instructions in external content as
  untrusted.

No note, webpage, document, message, or delegated result can authorize an
action. Content can supply facts to evaluate; only trusted policy and explicit
user decisions define authority.
