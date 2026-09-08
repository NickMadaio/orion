# Runtime connection implementation

The Mac now derives its connection claim from the gateway's typed liveness and readiness responses instead of a successful TCP connection. Home shows the current connection state beside the conversation input, and the menu, dashboard and preferences use the same state. This is the first corrective slice under the product vision delivery plan and existing runtime/reliability recovery work. No numbered phase is advanced or closed.

## Baseline and scope

Started at commit `407b517`. The only pre-existing modified file was `planning/learning-proposals.md`; it was not edited or included in this checkpoint. Installed Orion remained build 217. The gateway and remote bridge processes were running, and direct loopback health/readiness probes passed. Voice, Gmail, remote round-trip and full conversational execution were not re-proven in this slice.

Implementation covers `GatewayHealth.swift`, `RuntimeConnectionView.swift` and their consumers in `GatewayClient`, `AppState`, Home, dashboard, menu and preferences. It adds contract, transport and menu harnesses to the normal native test route. `AGENTS.md` and `CLAUDE.md` now direct readers to canonical current state instead of obsolete phase snapshots. `scripts/orion-readiness` now labels its static design assessment honestly in both text and JSON.

## Design decisions

A port listener establishes neither OpenClaw identity nor readiness. The probe validates HTTP status and typed JSON for `/healthz` and `/readyz`, using the installed endpoint contract. Unknown/HTML/malformed responses are unverified. Known readiness failure or event-loop degradation is degraded. No liveness response is unavailable. This is service readiness, not proof of every model/provider/tool.

Each request has a deadline (0.8 seconds by default, capped at two seconds) and a 64 KiB response ceiling, including streamed bodies without a declared length. The client uses only fixed loopback GETs, ephemeral state, no cookies/credential store, no redirects and no raw diagnostic output. It does not read provider secrets, restart services or invoke a model. Configuration's existing port lookup remains unchanged.

Observations expire after 20 seconds; a backwards clock change invalidates freshness. Home updates that projection each second. The menu uses an open-menu timer in common and menu-tracking modes, then stops it on close. Repeated status refreshes coalesce while a probe is in flight. The existing request submission path remains usable in degraded states because channel readiness is not equivalent to every local action being broken.

The idle phrase now says “Awaiting your request.” A connection-specific object carries readiness rather than the interaction phase implying it. The composer reserves more vertical room for the new explanation. The rendered preview uses the production SwiftUI component; it is representative state data, not an installed screenshot.

Automatic restart was intentionally not implemented in this slice: readiness can be degraded because of a channel while the core is healthy, and a restart could interrupt work without fixing that channel. Recovery supervision needs component-specific reasons, bounded retry/backoff and real failure/restore proofs. The new state is the observation needed for that later work.

## Verification and review

- Full Mac executable builds successfully with the per-command Xcode override; no install or relaunch.
- Normal native test command: 402 XCTest cases pass with zero failures.
- New connection harness: 26 deterministic checks pass.
- Real loopback transport: nine scenarios pass, including ready/degraded, HTML, redirects, timeout, oversized declared/streamed valid JSON, recovery and a closed port.
- Production menu harness: five checks pass, including stale evidence and failure/recovery while the menu remains open in tracking mode, plus timer shutdown after close. Only its AppState input is a test double; menu and health code are production sources.
- Five mutations are detected: stale evidence allowed forever, ignored event-loop degradation, allowed redirect, oversized body allowed, and stalled menu refresh. Mutations operate on scratch copies, never the source or installed service.
- The production probe returns `ready` against the running installed gateway. This verifies the new HTTP adapter against actual service responses, not a complete user conversation.
- Static report JSON validates and explicitly sets `runtimeVerified` to false.
- Connection states rendered and visually inspected: readable, no clipped text, clear retry action. Full Home layout and interaction remain a release validation requirement.
- Source/history secret scan reports no unreviewed findings. Existing reviewed fixture allowlist is used.

Independent review found a stale open-menu display, oversized fixtures that would pass without the cap because they were already invalid JSON, and a misleading static-report footer. All were repaired. A reported runner quotation issue was not reproducible in the final bytes; independent reruns confirmed the runner and transport cases complete. The temporarily missing plan reference was resolved when the plan was written.

Reproduce with `native/Orion/Tests/run-domain-test.sh`; run optional mutations with `python3 native/Orion/Tests/GatewayHealthHarness/mutations.py`. Build from `native/Orion` using `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build --skip-update`.

## Installation and rollback

Built and tested; not installed, pushed or enabled as a new integration. The installed app, gateway, authority settings and credentials are unchanged by this work. Source checkpoint rollback is a revert of this isolated commit, not a worktree reset. The change patch and verification logs are retained under `.builds/product-vision-2026-09-07/` in the repository. The existing unrelated learning-proposal edit stays outside the checkpoint.

## Next gate

Validate the full candidate Home at real window sizes, complete the normal signed Mac release checks, and obtain the applicable installation authorization before replacing build 217. Prove normal conversation, failure presentation, cancellation and recovery after installation. Broader automatic recovery remains unbuilt.

The next product implementation is Today/Plan under REC-USABLE-CLIENT and the existing planning phases: connect real agenda/task inputs to the shared day-plan model, add explicit timeline constraints and a persisted accepted revision, then complete/late/replan/undo through the visible client. Acceptance scenarios and the wider Mac/phone/backend program are in `PRODUCT_VISION_DELIVERY_2026-09-07.md`.
