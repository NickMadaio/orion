# Orion Build Roadmap

**ORION — Organized Reasoning and Information Operating Network**

A local-first personal AI system that can communicate through multiple interfaces, understand long-term context, operate the computer, interact with external services, monitor ongoing situations, and escalate difficult work to cloud models when necessary.

## Core architectural principle

Orion is not the desktop interface, chatbot, local model, or Claude integration.

Orion is the persistent background system coordinating:

- Models
- Tools
- Memory
- Permissions
- Tasks
- Events
- Connectors
- Communication channels

The desktop app, terminal, text messages, voice, and phone calls are different ways of communicating with the same Orion runtime.

---

## Phase -1 — Development intelligence

Set up Claude API access for researching, designing, debugging, and testing Orion.

This is separate from Orion’s eventual cloud escalation system. During development, Claude can help build Orion. Later, Orion itself will invoke Claude through a controlled provider and routing layer.

### Completion milestone

- Anthropic API key is secured.
- Claude requests work through the development interface.
- Spending can be monitored and limited.
- API credentials are excluded from Git.

**Status: complete.**

---

## Phase 0 — Architecture contract

Define the rules Orion’s entire system will follow before implementing the local agent.

### Decisions

#### Runtime

Orion will have a persistent Python background runtime.

The interface will communicate with this runtime rather than directly communicating with models or tools.

#### Model independence

Models will be accessed through interchangeable providers.

Initial providers:

- Ollama for local inference
- Claude API for cloud escalation

Future providers can include OpenAI, Gemini, or specialized local models without rewriting Orion’s core.

#### Local-first behavior

Orion uses local models and local storage by default.

Cloud models are invoked only when:

- The user explicitly requests one
- The local model reports low confidence
- A structured response repeatedly fails
- The task crosses a configurable complexity threshold
- A specialized cloud capability is required

#### Tools

Every capability Orion can execute is represented as a registered tool with:

- A name
- Description
- Structured input schema
- Permission level
- Execution handler
- Timeout
- Result schema
- Audit entry

Tools may initially be native Python functions. MCP adapters can later expose compatible external tools, resources, and services.

#### Permission levels

**Level 0 — Read-only**

May run automatically.

Examples:

- List files
- Read notes
- View calendar
- Read system information
- Search indexed content

**Level 1 — Reversible local change**

May require preview or approval depending on the tool.

Examples:

- Create a file
- Rename a file
- Move a file
- Write a note
- Create a draft

**Level 2 — External communication or meaningful system change**

Requires approval initially.

Examples:

- Send an email
- Send a text
- Create a calendar event
- Run a terminal command that changes state
- Install software

**Level 3 — Destructive, financial, private, or high-impact action**

Always requires explicit approval.

Examples:

- Delete files
- Make purchases
- Change account settings
- Publish content
- Execute privileged commands
- Speak to someone on the user’s behalf

#### Auditability

Every tool execution records:

- Timestamp
- Requesting user or task
- Model and provider
- Tool name
- Arguments
- Permission decision
- Result
- Error, if any
- API cost, if applicable

#### Background operation

Orion will eventually operate as a macOS background service.

The graphical app is a client and dashboard. Closing the app must not necessarily stop Orion’s scheduler, watches, or task queue.

#### State

SQLite will initially hold structured runtime information:

- Conversations
- Tasks
- Tool executions
- Approval requests
- Events
- Watches
- Provider usage
- Configuration

Long-form human-readable knowledge may later live in an Obsidian vault.

#### Communication

Orion must support multiple channels without tying its core to any one channel.

Possible channels:

- Terminal
- Desktop app
- Push notifications
- SMS
- iMessage
- Voice
- Phone calls

Each channel communicates with the same agent runtime.

### Completion milestone

Phase 0 is complete when these decisions are documented and the initial repository structure reflects them.

### Decision record — confirmed July 2026

The following decisions refine and confirm the Phase 0 architecture contract.

#### Runtime and interfaces

- Orion will run as a persistent local Python runtime.
- The desktop application is Orion's first and primary interface, but it is a client of the runtime rather than the runtime itself.
- Terminal, notifications, messaging, and voice are future interface adapters. They must use the same runtime, task system, memory, permissions, and audit history as the desktop app.
- Voice is an explicit future requirement. It will begin with push-to-talk, then may add wake-word activation, interruption handling, speech-to-text, and text-to-speech. Voice input must not bypass the normal permission or approval system.

#### Model routing

- Orion will define a thin, provider-independent model interface from the beginning.
- Ollama is the first implemented provider and is the default for local, private work.
- Claude is a later cloud escalation provider; Orion is not intended to replace specialized coding products such as Claude Code.
- Orion may automatically escalate to an approved lower-cost cloud model when task type, local confidence, repeated structured-output failures, or a required capability warrants it.
- Higher-cost or premium model tiers require explicit approval unless the user later creates a trusted policy for them.
- Every escalation records its reason, selected tier, and cost, and is subject to budget limits.
- Fresh information is obtained through permission-controlled data tools, rather than granting an underlying model unrestricted internet access.

#### Tools and permissions

- Orion should be capable of creating and editing files, using terminal tools, and operating approved services, but models never receive unrestricted authority.
- Every capability is a registered tool with a structured input and output, scope, timeout, permission policy, and audit record.
- Permissions are standing and scoped rather than repeatedly requested. Orion can act autonomously inside explicitly approved boundaries, such as a designated workspace or safe read-only services.
- Orion asks for confirmation when an action crosses a scope boundary, has meaningful risk, is ambiguous, or requires a higher-cost model tier.
- Destructive, financial, account-changing, publishing, privileged, or representative actions always require explicit approval.
- Local execution improves privacy but is not a substitute for security. Tool access must remain sandboxed and scoped, and instructions discovered in files, webpages, or other external content are untrusted.

#### State, reporting, and auditability

- SQLite is the initial local store for conversations, tasks, permissions, tool executions, schedules, configuration, and concise audit records.
- An Obsidian-compatible Markdown vault may later hold longer, human-readable knowledge such as project briefs, decisions, and notes.
- Default status reporting is short and conversational. Orion provides deeper task history, reasoning context, and execution detail only when the user asks for it or it is needed to explain a problem.
- Compact internal records retain actions, approvals, outcomes, and costs for safety, troubleshooting, and away-task follow-up.

---

## Phase 1 — Local conversational core

Create the smallest functional version of Orion that uses no cloud services.

### Build

- Install Ollama.
- Install one capable local tool-calling model.
- Create an `OllamaProvider`.
- Stream responses into the existing interface.
- Store basic conversation sessions.
- Register one harmless tool.
- Execute one complete model → tool → result → model loop.
- Record the tool call in the audit log.

The first tool should be deterministic and safe, such as:

- Get the current date
- Perform a calculation
- Return basic system information

### Completion milestone

Orion can hold a conversation through the interface, recognize when it needs a tool, call that tool, incorporate the result, and log the operation without using Claude.

---

## Phase 2 — Agent runtime

Build the machinery required for Orion to perform more than one simple model response.

### Build

- Agent loop
- Tool registry
- Structured tool calls
- Permission enforcement
- Approval requests
- Task state machine
- Timeouts
- Cancellation
- Retry policies
- Failure reporting
- Event log

Suggested task states:

- Created
- Planning
- Waiting for approval
- Running
- Waiting for external input
- Completed
- Failed
- Cancelled

### Completion milestone

Orion can receive a multi-step request, create a task, call allowed tools, pause for approval when necessary, recover from a manageable failure, and clearly report the result.

---

## Phase 3 — Memory layer

Give Orion durable knowledge beyond individual conversations.

### Build

- Structured personal and project memory
- Conversation summaries
- Source attribution
- Timestamps
- Confidence and relevance metadata
- Retrieval
- Memory-editing rules
- Obsidian vault integration
- Root navigation document such as `ORION.md`

Memory categories should include:

- Stable user information
- Preferences
- People
- Projects
- Decisions
- Current goals
- Temporary context
- Scheduled watches
- Past task outcomes

### Completion milestone

You can discuss a project, close Orion, return later, mention the project naturally, and Orion retrieves the correct relevant context without requiring a full explanation.

---

## Phase 4 — Local computer tools

Allow Orion to interact with the Mac under strict scope and permission controls.

### Build

- Scoped file listing
- File reading
- File creation
- File editing
- File moving and renaming
- Folder organization proposals
- Read-only terminal commands
- Approval-gated state-changing terminal commands
- Diffs and previews
- Rollback where possible

Begin with one sandboxed folder, such as a dedicated Orion test directory. Expand to Downloads or Desktop only after the safety model works.

### Completion milestone

Orion can propose a folder cleanup, show the planned changes, receive approval, execute them, and produce an audit record without accessing anything outside the permitted directory.

---

## Phase 5 — Cloud escalation

Connect Orion’s model router to the already-created Claude provider.

### Build

- Escalation policies
- Complexity and confidence signals
- Local failure detection
- Provider selection
- API cost estimation
- Per-request and monthly spending limits
- Prompt caching
- Usage logging
- Local fallback when cloud access fails

Anthropic prompt caching should be used for stable prefixes such as Orion’s system instructions and frequently reused context because it reduces repeated input processing, latency, and cost.

### Completion milestone

A simple task remains entirely local. A genuinely difficult task escalates to Claude, returns successfully, records why it escalated, and logs the exact API usage.

---

## Phase 6 — Persistent background service

Turn Orion from an app into an always-available system.

### Build

- Background daemon
- Local API between the interface and runtime
- Event bus
- Scheduler
- Job persistence
- Crash recovery
- Notifications
- Health status
- Startup and shutdown behavior
- macOS launch integration

### Completion milestone

A scheduled task executes even when the desktop interface is closed, and Orion reports the outcome when the interface is reopened.

---

## Phase 7 — Email and calendar

Add Orion’s first external personal-data connectors.

### Build order

1. Read-only access
2. Search and summarization
3. Draft creation
4. Approval-gated changes
5. Narrow, policy-based automation

Initial abilities:

- Read and summarize inbox activity
- Identify important messages
- Search old email
- View calendar
- Explain schedule conflicts
- Draft responses
- Propose calendar events

### Completion milestone

Orion can summarize relevant email and calendar information without opening either application, but cannot send or modify anything without the required approval.

---

## Phase 8 — Remote messaging

Allow communication with Orion while away from the Mac.

### Possible first channels

- Telegram
- Discord
- SMS
- iMessage

A channel gateway such as OpenClaw may be evaluated here as an adapter. It should not replace Orion’s core runtime.

### Completion milestone

You can message Orion remotely, receive an authenticated response from the same runtime used by the desktop app, and approve or reject a queued action.

---

## Phase 9 — Proactive watches and alerts

Allow Orion to monitor specifically defined situations.

### Build

- Watch definitions
- Data-source polling
- Trigger thresholds
- Deduplication
- Quiet hours
- Expiration
- Notification routing
- Cost limits

A casual mention must not create an indefinite watch. Watches require explicit scope, conditions, frequency, and expiration.

### Completion milestone

You define a trip and a weather threshold. Orion checks at an appropriate interval and alerts you only when the threshold becomes relevant.

---

## Phase 10 — Autonomous away-tasks

Allow Orion to continue bounded tasks while you leave.

### Build

- Persistent task queue
- Resource limits
- Progress checkpoints
- Maximum runtime
- Approval pauses
- Clear completion reports
- Clear blocked-task reports
- No silent failure

### Completion milestone

You assign a bounded task, leave, and return to either a completed result or an explicit explanation of the decision Orion needs from you.

---

## Phase 11 — Voice assistant

Add Alexa-like interaction without yet answering external phone calls.

### Build

- Push-to-talk first
- Speech-to-text
- Text-to-speech
- Interruption handling
- Short spoken responses
- Optional wake-word detection
- Device and room routing later

### Completion milestone

You can speak a request, Orion performs the same permission-controlled workflow as the desktop interface, and it responds aloud.

---

## Phase 12 — Phone calls, voicemail tier

Create a dedicated phone number and handle missed calls asynchronously.

### Build

- Incoming call handling
- Voicemail recording
- Transcription
- Caller identification where possible
- Summary
- Suggested response
- Text notification
- Approval before replying

### Completion milestone

A caller leaves a message and Orion sends you an accurate summary and suggested response without pretending to be you.

---

## Phase 13 — Phone calls, live tier

Add a live AI receptionist.

### Build

- Real-time duplex audio
- Voice activity detection
- Streaming speech recognition
- Streaming speech synthesis
- Contact-aware call policy
- Transfer rules
- Explicit disclosure that the caller is speaking with Orion
- Emergency and uncertainty handling
- Call summaries and logs

### Completion milestone

Orion can answer a permitted category of calls, clearly identify itself, either handle the bounded interaction or transfer the caller, and produce an accurate summary.

---

## Phase 14 — Additional connectors

Add integrations only when real use demonstrates a need.

Examples:

- Whoop and wearable data
- GitHub
- School systems
- Business tools
- Smart-home devices
- Financial read-only dashboards
- Media and entertainment services

Each connector follows the same progression:

1. Read-only
2. Search and summarize
3. Draft or propose
4. Approval-gated writes
5. Narrow trusted automation

### Completion milestone

There is no final milestone. This remains Orion’s ongoing expansion phase.
