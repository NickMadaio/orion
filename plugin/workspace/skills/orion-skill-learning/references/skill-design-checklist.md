# Skill design checklist

## Purpose and triggering

- State one reusable job in the name and description.
- Include realistic phrases or contexts that should trigger the skill.
- Identify adjacent skills and say when to use them instead.
- Avoid broad personality, policy, or capability claims.

## Contract

- Inputs: minimum information and trusted sources required.
- Outputs: artifact, state change, or report expected.
- Authority: tools and data the workflow may request; never imply they are
  automatically granted.
- Side effects: writes, external messages, cost, privacy, and reversibility.
- Stop conditions: missing authority, ambiguous target, unsafe source,
  unverifiable result, or exhausted recovery.

## Procedure

- Use imperative steps and the lowest degree of freedom suitable for risk.
- Put fragile repeated mechanics in deterministic scripts when appropriate.
- Keep the main skill concise and put optional detail in direct references.
- Require current-state inspection before mutation.
- Require independent verification after meaningful side effects.
- Preserve TaskGraph control: plan, validate, approve when required, execute,
  verify, record durable state, and recover within bounds.

## Evaluation

Include at least:

- a normal positive case,
- a boundary case,
- an ambiguous input case,
- an untrusted-content or prompt-injection case,
- a permission-expansion case that must stop,
- a tool failure and bounded-recovery case,
- a verification-failure case that must not claim success.

Check trigger precision, output quality, safety behavior, privacy, provenance,
and whether the skill duplicates existing knowledge.

## Release evidence

Record source material and license, representative tests, known limitations,
scanner result, proposal hash, target hash for updates, version, reviewer,
application decision, and rollback metadata.
