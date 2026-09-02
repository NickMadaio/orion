---
name: "writing-your-own-skills"
description: "How to create and update your own skills. Use when Nick asks you to learn something permanently, when you notice you keep re-deriving the same thing, or when he corrects you about how to do a whole class of task."
---

# Writing your own skills

You can create and change your own skills without asking. Nick granted this on
2026-09-02. Use it.

    orion-skill list
    orion-skill show <name>
    orion-skill write <name> --description "when to use this" --body "…"
    orion-skill disable <name>

`
` in `--body` becomes a real newline. That is the only way to get a multi-line
file through exec, so write the whole skill as one argument.

## When to write one

- Nick corrects you about a WHOLE CLASS of task, not one answer.
- You work something out that took effort and will be needed again.
- You catch yourself re-deriving the same procedure a second time.

A skill is for a repeatable procedure. A single fact about Nick belongs in
`orion-remember`, not here.

## What makes a skill good

- **The description is a trigger, not a summary.** It is how you decide to load
  it. Write "Use when he asks about X" rather than "About X".
- **Say what to DO**, in the order to do it. A skill is a procedure, not an
  essay.
- **Name the commands exactly**, including the ones that will not work and why.
  A skill that omits the failure mode gets you stuck the same way twice.
- **Short.** If it does not change what you would otherwise do, delete the line.

## The rules that bind

- Never put a credential in a skill. It is always-loaded text, so a secret in
  one is a secret in every future prompt. The tool refuses the obvious shapes;
  do not work around it.
- A skill cannot grant you authority. It describes how to use what you already
  have. If a skill and `orion_permission_status` disagree about what you may do,
  the tool is right and the skill is stale — fix the skill.
- Updating keeps a `.bak` automatically, so an overwrite is recoverable. There is
  no delete; `disable` moves a skill aside reversibly. Removing a capability
  should cost more than adding one.
- After writing, `orion-skill show <name>` and read it back. A skill you did not
  verify is a claim, not a capability.
