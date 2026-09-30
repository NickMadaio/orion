# Task 5 — evidence packet for Astra

Write only `docs/planning/v2/PHASE_57_LOCAL_AGENT_REVIEW.md`. Read the final
installer and its tests; those whole files are the cumulative Tasks 1–4 change.
Do not read the enormous program manifest, phase-gate JSON or root handoff. You
have no git/diff/receipt access, so never invent commit ids, line numbers or
deployment evidence.

The packet must document the APIs actually implemented, transaction phase
vocabulary, exact durable paths, side-effect order, record/ledger binding,
rollback/reconciliation behavior, locks and unknown-outcome invariants. Where
implementation differs from earlier wording, describe the code honestly.

Map these prior-task outcomes to named tests or mark them explicitly unproven:

1. Exact pure disabled read-back of id/name/timeZone/cron/argv/cwd and strict
   disabled/exact/no-deliver booleans, including malformed and shell-like data.
2. Required injected roots/adapters; exclusive durable intent before scheduler
   effect; random installation identity; exact read-back; ledger then installed
   publication; concurrency and every failure seam.
3. Reconciliation never creates/enables/resets quotas/guesses dead locks;
   unknown create remains blocked; exact known job only; read/cleanup failures
   persist; crash/reopen and repeat behavior covered.
4. Real installer-to-runtime fixture: once-only due execution; replay refusal;
   authority/expiry/mode/focus/changed-record refusals before effects; effect
   failure and process death never blindly retry; all production routes injected.

Quote observed check summaries exactly from the current check output. Separate
those observations from behavior inferred by reading code. The local reviewer
does not see the underlying files, so make each claim traceable to a test name.

Call out what remains: the real scheduler adapter and exact read-back schema,
explicit human activation, remote operator controls for automations, production
root wiring, and a disposable live route. No real scheduler job has been created,
enabled or run by this batch. Do not mark Phase 57 complete, edit gates/manifests,
or claim installation/deployment.

The next bounded source task is to implement and test the real scheduler adapter
against captured CLI JSON while keeping creation disabled. Its live gate is:
create one disposable disabled job, read back exact identity/configuration,
remove it, prove absence, and only then separately ask for human activation.
Do not begin that work in this documentation task.
