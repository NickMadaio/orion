# Adopt an existing runtime, or keep building Orion?

Decision record — July 28, 2026. Researched at Nick's request before committing
to Phase 8 (MCP client), which is where duplicated effort starts getting
expensive.

**Recommendation: keep building Orion. Mine OpenClaw's security research for
design requirements rather than adopting its code.**

The reasoning below is mostly about risk, because on capability the answer was
initially the other way around.

---

## The candidates

**OpenClaw** — ~347k GitHub stars, the most-starred project on the platform.
Local-first agent runtime, MCP-based skill system, gateways for 15 messaging
platforms, browser automation, terminal, calendar, Docker sandboxing. Installs
with one curl command. On capability alone it is roughly two years ahead of
where Orion is.

**Hermes Agent** — Nous Research, MIT licensed, released February 2026. Smaller
and more focused. Model-agnostic via any OpenAI-compatible endpoint, so Ollama
works. Its distinguishing feature is a "do, learn, improve" loop: after finishing
a task it reflects and writes reusable skill files. Memory is three layers —
an identity snapshot, a SQLite FTS5 index over every past session, and those
procedural skill files. That memory design is better than what Orion has and
better than OpenClaw's file-based approach.

**OpenJarvis** — local-first on-device framework, tools plus memory plus
learning. Less mature than either.

---

## What the security research found

There is a peer-reviewed analysis of OpenClaw: *A Security Analysis of the
OpenClaw AI Agent Framework* (Suwansathit, Zhang, Gu — SUCCESS Lab, Texas A&M,
arXiv:2603.27517v3). It is not a red-team stunt; it is a taxonomy of **470
security advisories filed against OpenClaw between January 31 and April 15,
2026**, grounded in the actual patch diffs.

Distribution of the 470: gateway WebSocket 25.7%, messaging channel input
25.3%, exec policy engine 16.4%, tool dispatch 14.7%, container boundary 8.3%,
plugin/skill distribution 6.0%.

Four findings that matter for this decision:

**1. The sandbox was never actually enforced.** In the authors' words, *"sandbox
isolation was never enforced by the framework itself, leaving the strength of
containment entirely dependent on how the underlying container runtime was
configured."* The fix was +691/−6 lines — a validation module that had never
existed. The isolation guarantee was emergent from Docker's defaults.

**2. The approval state itself was remotely writable.** `system.execApprovals.set`
was reachable via `node.invoke`, meaning an attacker could write to the
persistent allowlist — the thing that remembers what you approved. Combined with
an SSRF and a token-leaking WebSocket handshake, that formed a complete
unauthenticated chain from model output to host code execution.

**3. A real malicious skill shipped and worked.** The `yahoofinance` skill on
clawhub.ai told the agent a prerequisite binary was needed; the visible `echo`
showed a plausible HTTPS domain while a base64 second stage fetched a payload
from a raw IP. It required no vulnerability at all — the agent relayed the
install instructions with the same authority as operator-authored prompts, and
the user ran them. There is still no skill signing and no registry review.

**4. These are design flaws, not just bugs.** The paper is explicit that
patching individual advisories does not close the class, because *"trust
decisions are made locally (per call site, per subsystem, per handler) without
a global invariant enforced across component boundaries."*

**In fairness to OpenClaw:** 470 advisories in ten weeks partly reflects
extraordinary scrutiny of a project that hit 200k stars before it had a mature
disclosure process. That is a healthy signal, not only a damning one. All the
specific bugs above are patched.

---

## The uncomfortable part — this cuts against Orion too

The hardest finding in the paper applies to Orion's permission model exactly as
much as it applies to OpenClaw's:

> *"A model that has been successfully prompt-injected may voluntarily invoke a
> tool that policy would otherwise have denied, rendering the policy irrelevant
> without ever triggering it."*

Orion's approval gate is "the agent asks, Nick clicks yes." A prompt-injected
agent produces a request that *looks* legitimate, and it gets approved. Building
it yourself buys nothing on that axis. Do not let the approval UI create false
confidence.

The paper's framing of the root cause is worth internalizing:

> *"data paths that terminate in the context window were treated as information
> channels rather than as potential instruction channels. This is the correct
> default assumption for a system that does not use LLMs; it is the incorrect
> default assumption for a system where the context window is the program."*

---

## Why building still wins

Not because Orion's code is better. Because of **surface area**.

Every one of those 470 advisories exists because OpenClaw connects to 15
messaging platforms, runs a WebSocket control plane, brokers a public plugin
registry, drives a browser, and manages Docker containers. Orion has none of
those. A personal assistant that you talk to directly, that reads your files
under explicit scopes, and that calls a small set of vetted MCP servers has
almost none of that attack surface — not because it defends it well, but
because it does not have it.

The paper's own conclusion supports this:

> *"Securing AI agent frameworks is not primarily a matter of enumerating and
> patching vulnerabilities; it is a matter of designing a coherent trust model
> that remains sound when the layers of the system are composed in the manner
> an adversary will inevitably treat as a single unified attack surface."*

A small system you understand end to end has a coherent trust model available
to it. Per this paper, OpenClaw does not yet.

The secondary reason: making OpenClaw safe on your primary Mac requires no
third-party skills ever, no messaging adapters bound, loopback-only gateway, no
browser automation, a hand-verified Docker config denying `docker.sock` and
defaulting `network: none`, and credentials in a separate trust domain. That is
a lot of hardening — and it removes most of the convenience that made adoption
attractive in the first place.

---

## What to take from them anyway

Steal the designs, not the dependency:

1. **Direct-argv exec, never a shell wrapper.** The paper's best single
   recommendation. Orion has no `system.run` yet — keep it that way, and when
   you add one, never hand a string to a shell. Three separate allowlist
   bypasses in OpenClaw came from shell parsing semantics.
2. **Provenance tags on every string entering the context window.** Tag each
   piece of context as `user`, `tool_result`, `web`, `file`, or `system`, and
   condition tool authorization on origin rather than on content. Orion already
   labels fetched web content as untrusted — generalize that into a real type.
3. **Identity checks on immutable IDs only.** When Phase 11 adds messaging,
   never key an allowlist on a display name or `@username`. Thirteen advisories
   came from exactly that; someone renames themselves and walks in.
4. **Hermes's three-layer memory.** Identity snapshot + FTS5 session search +
   procedural skill files is a better design than Orion's current flat memory
   table, and SQLite FTS5 is a drop-in you already have available.
5. **Treat MCP servers as untrusted code.** When you build the MCP client, do
   not auto-trust discovered tools. Default unknown tools to requires-approval,
   and pin server versions.

## If you want OpenClaw's capabilities anyway

Run it on a spare machine or a VM, with throwaway credentials, and treat
anything it touches as untrusted. That is a genuinely useful way to learn from
it. Full access to your primary Mac is the one configuration the evidence does
not support.

---

## Sources

- [A Security Analysis of the OpenClaw AI Agent Framework (arXiv:2603.27517v3)](https://arxiv.org/html/2603.27517v3)
- [What is OpenClaw? — DigitalOcean](https://www.digitalocean.com/resources/articles/what-is-openclaw)
- [Hermes Agent](https://hermes-agent.org/)
- [Hermes Agent vs OpenClaw — MindStudio](https://www.mindstudio.ai/blog/hermes-agent-vs-openclaw-comparison)
- [Hermes Agent Memory vs OpenClaw Memory](https://openclawlaunch.com/guides/hermes-agent-memory)
- [OpenJarvis](https://github.com/open-jarvis/OpenJarvis)
