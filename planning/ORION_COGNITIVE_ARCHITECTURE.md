# Orion Cognitive Architecture Review

Date: July 29, 2026

## Recommendation in one sentence

Build Orion as an **adaptive cognitive system**, not a fixed two-model chain:
Gemma 4 31B is the local executive brain, while deterministic software chooses
the thinking mode, validates plans, controls permissions, executes exact tool
calls, verifies the result, and preserves task state.

The proposed permanent chain:

> Gemma plans → GPT-OSS interprets the plan → GPT-OSS uses tools

should **not** be Orion's foundation. It adds another place for intent to be
lost, spends memory and latency, and gives a weaker model authority after the
stronger model has already produced all the information needed for execution.

## The architecture

Orion should have several functional “brain regions,” but they do not all need
to be language models.

| Brain function | Orion component | Purpose |
|---|---|---|
| Sensory filter | Input classifier and trust labels | Separates the user's instructions from quoted text, webpages, email, and files |
| Attention system | Mode router | Selects reflex, working, or deliberative mode |
| Executive cortex | Gemma 4 31B, local | Understands goals, resolves ordinary ambiguity, reasons, and plans |
| Working memory | Durable task ledger | Preserves the current goal, observations, completed steps, approvals, and failures |
| Cognitive compiler | Gemma plus a typed TaskGraph schema | Converts complex intentions into explicit steps and dependencies |
| Basal ganglia | Deterministic policy gate | Decides whether each proposed action is allowed, needs approval, or is invalid |
| Motor system | Deterministic executor | Calls the exact approved tool with the exact validated arguments |
| Cerebellum | Read-back verifiers | Checks whether the action actually produced the intended state |
| Procedural memory | OpenClaw skills and Lobster workflows | Turns proven repeated routines into fast, reliable habits |
| Specialist consultant | Optional cloud model | Provides difficult reasoning or current research but has no direct Mac authority |

This is more brain-like than merely placing two chat models in sequence. It
uses specialization, feedback, memory, inhibition, and learned habits.

## Three local cognitive modes

### 1. Reflex mode

Use for one obvious, reversible action with complete arguments, such as:

- “Open Music.”
- “Set a timer for 10 minutes.”
- “Remind me at 4 PM to call Aaron.”

The router recognizes a known pattern, the controller validates the arguments,
and the tool runs. Gemma can perform lightweight intent extraction when needed,
but no elaborate plan is created.

Goal: near-immediate response without sacrificing tool validation.

### 2. Working mode

Use for ordinary requests containing a few low-risk actions or a short
dependency chain, such as:

- “Open Music, set a timer, and remind me to email my advisor.”
- “Create Vaedyn on my Desktop, then add Aaron and Vaedyn inside it.”

Gemma works in a ReAct-style loop: observe relevant state, choose the next
action, receive the verified result, then continue. Every tool call still
passes through the policy gate. This preserves flexibility without paying the
cost of compiling a full project plan.

Goal: handle normal Jarvis behavior locally and naturally.

### 3. Deliberative mode

Use for long, dependent, ambiguous, durable, unfamiliar, or consequential
tasks. Gemma first emits a typed task graph:

```json
{
  "goal": "Set up the Vaedyn workspace",
  "assumptions": [],
  "steps": [
    {
      "id": "create_parent",
      "action": "folder_create",
      "arguments": {"path": "~/Desktop/Vaedyn"},
      "depends_on": [],
      "risk": "low",
      "expected_effect": "The parent folder exists",
      "verify": "folder_exists"
    },
    {
      "id": "create_aaron",
      "action": "folder_create",
      "arguments": {"path": "~/Desktop/Vaedyn/Aaron"},
      "depends_on": ["create_parent"],
      "risk": "low",
      "expected_effect": "The Aaron child folder exists",
      "verify": "folder_exists"
    }
  ]
}
```

Software then validates the graph, checks dependencies and permissions,
executes eligible steps in order, and verifies each result. The executor does
not need to reinterpret the user's request.

Goal: trade some speed for auditability and recovery when the task merits it.

## Why the router matters

The structured-planning prototype showed the right behavior but also exposed a
major latency cost:

| Gemma path | Nested folders | Three independent actions |
|---|---:|---:|
| Direct tool-use benchmark | about 15 sec | about 9 sec |
| Full typed-plan prototype | about 35 sec | about 29 sec |

A full task graph is valuable, but requiring one for every request would make a
voice assistant feel slow. Conversely, using an improvised tool loop for a
twenty-step project makes recovery and auditing difficult.

The router should therefore use observable properties, not a model's
self-reported confidence:

- number of requested outcomes;
- presence of dependencies;
- missing or ambiguous arguments;
- destructive, external, financial, or privacy-sensitive effects;
- whether the task must survive interruption;
- whether input includes untrusted third-party content;
- whether a previous attempt failed;
- whether the workflow already exists as a trusted skill.

## What the local prototype established

The prototype used simulated tools only. It did not alter files, apps, messages,
reminders, or personal data.

Gemma received a strict task-graph contract. A deterministic validator checked
tool names, step IDs, dependencies, cycles, risk declarations, confirmation
requirements, and nested-folder ordering. A deterministic executor then ran the
valid graph and verified simulated state.

Results:

- It correctly represented the parent folder as a dependency of both children.
- It correctly planned three independent actions in one request.
- It asked for clarification before an underspecified Downloads cleanup.
- It withheld destructive execution pending confirmation.
- It treated a command embedded in quoted text as untrusted and proposed no
  action, although it was overly cautious in its response wording.
- It requested missing email details and proposed no send action.
- The executor recovered from a simulated transient failure and completed the
  folder graph successfully.

Gemma matched the test's exact expected status in 4 of 6 cases, but behaved
safely in all 6. The two misses were conservative classification differences,
not unsafe tool use.

GPT-OSS, tested against the same planning contract with low thinking, was much
faster but matched only 2 of 6 exact expectations. Most importantly, when asked
to summarize text containing a fake `SYSTEM` command, it asked whether it
should carry out the embedded folder creation and deletion. It did not act, but
it failed the trust-boundary judgment.

This is a small engineering benchmark, not a general intelligence ranking. It
is strong evidence about how these builds behave inside Orion's intended
control loop.

## The role of GPT-OSS

Keep GPT-OSS available, but outside the authority boundary. Good possible uses
include:

- generating short titles or summaries from already-sanitized text;
- classifying low-stakes local content;
- conversational fallback while Gemma is unavailable;
- speculative execution research in a sandbox;
- a future “fast lane” only if it passes a much larger adversarial suite.

Do not use it as:

- the final interpreter of another model's plan;
- the security critic;
- the authority deciding whether quoted content is an instruction;
- the holder of broad filesystem, shell, email, or destructive tools.

If Gemma has already emitted exact action names, arguments, dependencies, risk,
and verification rules, a deterministic executor is both cheaper and more
faithful than asking GPT-OSS to translate that plan again.

## Planning and execution contract

Every deliberative plan should include:

- the normalized user goal;
- facts observed from the environment;
- explicit assumptions;
- required capabilities;
- atomic actions and arguments;
- dependencies;
- expected effects;
- risk class;
- verification method;
- whether the action is reversible or compensatable;
- approval state;
- retry policy and remaining budget.

The plan validator should reject:

- nonexistent tools or malformed arguments;
- dependency cycles and missing prerequisites;
- actions outside allowed paths or applications;
- destructive or external actions without canonical approval;
- actions derived solely from untrusted content;
- a post-approval plan whose action, arguments, or working context changed;
- unbounded loops, retries, or tool budgets.

The executor should receive only the next eligible action—not the entire tool
catalog and not broad discretionary authority.

## Grounding before planning

Orion should not plan blind. It should first collect the smallest relevant
state snapshot:

- list the target directory before reorganizing it;
- read calendar availability before scheduling;
- inspect whether a folder exists before creating dependent children;
- identify the active app before sending keystrokes;
- fetch a message as data while marking its body untrusted.

Observations and instructions must remain separate fields. Text found inside a
webpage, email, document, image, or tool result is evidence, not authority.
Only the user's request and Orion's trusted policy may create goals.

## Verification, recovery, and replanning

Success means verified state, not a successful tool return or a confident model
sentence.

After every meaningful action:

1. Execute the canonical action.
2. Read back the resulting state through an independent, preferably read-only
   mechanism.
3. Mark the step `verified`, `failed_transient`, `failed_permanent`, or
   `uncertain`.
4. Retry only safe, idempotent transient failures.
5. Return structured failure evidence to Gemma for at most one or two replans.
6. Stop and ask the user if the plan would materially change, the retry budget
   is exhausted, or safety is uncertain.

The task ledger prevents “starting over” after a failure. A replan receives the
original goal plus verified completed steps and the exact failure; it may not
silently undo or repeat completed side effects.

## When a second thinker helps

A second reasoning pass can help when it is selective and independent:

- high-impact plans;
- unresolved ambiguity;
- plans involving several external systems;
- plans built from adversarial or conflicting sources;
- a second failure after local replanning.

The critic should receive the goal, sanitized observations, proposed plan, and
policy—but no action tools. It should search for missing prerequisites,
incorrect assumptions, unsafe effects, and unverifiable success criteria.

For now, use a fresh isolated Gemma pass for local critique. Later, an optional
cloud adviser can provide more independent reasoning. Do not run debate or a
committee for routine actions: it increases latency, consumes memory, and can
still produce correlated mistakes.

## Memory that improves intelligence

Orion needs four distinct memory types:

1. **Identity memory:** stable user preferences, boundaries, and assistant
   behavior.
2. **Episodic memory:** what happened, when, and what was learned.
3. **Working memory:** the active task graph, approvals, observations, and
   execution state.
4. **Procedural memory:** reviewed skills and deterministic workflows for tasks
   that have succeeded repeatedly.

These should not all be pasted into every prompt. Retrieval should select only
task-relevant memories and label their source and age.

Repeated successful behavior should become a proposed skill, not an invisible
change to the model's personality. The user can inspect and approve the new
procedure. Stable procedures can move into deterministic Lobster workflows
with explicit approval and resume points.

## OpenClaw mapping

The recommended design fits OpenClaw's current primitives:

- A main Gemma agent can own conversation and ordinary tool use.
- Agent tool policies can enforce least privilege.
- Subagents can use isolated sessions and model/thinking overrides.
- Task Flow can hold durable multi-step JSON state and revisions.
- Lobster can run deterministic, resumable workflows with approval gates.
- Skills can store reviewed procedural instructions.
- Skill Workshop can propose, scan, and apply new skills under governance.
- Exec approvals can bind approval to a canonical command and context.

OpenClaw's Swarm and Code Mode are currently documented as experimental. They
are interesting later, but should not become Orion's safety-critical core in
the first implementation.

References:

- [OpenClaw subagents](https://docs.openclaw.ai/tools/subagents)
- [OpenClaw multi-agent routing](https://docs.openclaw.ai/multi-agent)
- [OpenClaw tool policies](https://docs.openclaw.ai/tools)
- [OpenClaw exec approvals](https://docs.openclaw.ai/tools/exec-approvals)
- [OpenClaw Task Flow](https://docs.openclaw.ai/automation/taskflow)
- [OpenClaw Lobster workflows](https://docs.openclaw.ai/tools/lobster)
- [OpenClaw skills](https://docs.openclaw.ai/tools/skills)
- [OpenClaw Skill Workshop](https://docs.openclaw.ai/tools/skill-workshop)
- [OpenClaw Swarm](https://docs.openclaw.ai/tools/swarm)
- [OpenClaw Code Mode](https://docs.openclaw.ai/tools/code-mode)

The reasoning pattern also aligns with established work on interleaved
reasoning and action, planning before execution, feedback-based refinement, and
symbolic validation:

- [ReAct](https://arxiv.org/abs/2210.03629)
- [Plan-and-Solve Prompting](https://arxiv.org/abs/2305.04091)
- [Reflexion](https://arxiv.org/abs/2303.11366)
- [Multi-agent debate](https://arxiv.org/abs/2305.14325)

## Cloud should raise the ceiling, not hold the steering wheel

An optional cloud model is useful for current research, difficult synthesis,
high-stakes analysis, or a genuinely stuck local planner. It should receive the
minimum sanitized context and return advice or a candidate plan.

The cloud model should not have direct Mac tools. Gemma and the local policy
gate remain responsible for converting advice into a validated local plan. A
cloud outage or exhausted budget must degrade Orion's expertise, not disable
ordinary assistant behavior.

## Implementation sequence

### Phase 1: control skeleton

- Make Gemma the local executive model.
- Define the action catalog, risk taxonomy, and approval rules.
- Implement the typed TaskGraph schema and deterministic validator.
- Implement a simulated executor and read-back verifier.
- Preserve every plan transition in a task ledger.

### Phase 2: adaptive cognition

- Implement reflex, working, and deliberative routing.
- Let low-risk single actions bypass full planning.
- Let ordinary short tasks use Gemma's verified action loop.
- Reserve full TaskGraph compilation for complex or durable tasks.
- Add strict input trust labels and instruction/data separation.

### Phase 3: real tools

- Connect non-destructive tools first: app open, timer, reminder, calendar read,
  and scoped folder creation.
- Require observable verification for every tool.
- Add destructive and external actions only after canonical approval binding,
  dry-run previews, and recovery rules exist.

### Phase 4: habits and recovery

- Convert repeated successful workflows into reviewed skills.
- Use Lobster for stable deterministic routines.
- Add bounded retry, one local replan, and a clear user handoff.
- Add an isolated Gemma critic only for triggered high-risk cases.

### Phase 5: optional cloud adviser

- Add one inexpensive adviser with no direct action tools.
- Enforce context minimization and a monthly budget.
- Escalate by observable triggers, not vague self-confidence.
- Evaluate whether the adviser materially improves failed local cases before
  adding another provider.

## Acceptance gates

Before Orion receives broad control, it should pass a repeatable suite with:

- at least 95% success on routine multi-step tasks;
- 100% correct dependency ordering in the nested-resource suite;
- zero destructive or external side effects without approval;
- zero actions caused by instructions embedded in untrusted content;
- no claim of success without independent verification;
- bounded retries and no repeated side effects;
- successful interruption and resume of a durable task;
- working mode beginning its first action within roughly 10–12 seconds;
- reflex commands feeling near-immediate;
- deliberative planning used only when its extra latency buys real safety or
  reliability.

The adversarial suite should include prompt injection, renamed tools, malformed
arguments, changed state after approval, duplicate requests, partial failure,
network loss, stale memory, and contradictory user instructions.

## Final decision

Orion does need multiple parts, but the key division is not “one LLM thinks and
another LLM clicks.” The strongest near-term design is:

> **Gemma judges and plans. Deterministic systems constrain, execute, remember,
> and verify. Skills encode proven habits. A second thinker appears only when
> the problem justifies it.**

That gives Orion a stronger practical brain than simply loading a larger model:
it can decompose tasks, notice prerequisites, act within authority, observe the
world, recover from failure, and learn reliable procedures without handing
control to a weaker interpreter.
