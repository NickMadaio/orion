# Canvas course facts in the Obsidian brain

Canvas remains the source for current course/assessment metadata. Obsidian holds
the inspectable study context: syllabus plans, confirmed timetable, preferences,
assessment links and source facts with retrieval times. API access does not itself
make a fact durable in the brain, and an old note is not a live API answer.

## Request-based commands

- `scripts/orion-brain canvas-courses`: complete active Canvas enrollment list,
  filtered using `canvas_excluded_course_ids` in the existing university note.
  The underlying `orion-connect canvas-courses` returns Canvas's source truth.
- `scripts/orion-connect canvas-course 7434`: complete, paginated GET snapshot
  for one actively enrolled course. Syllabus/course details, assignments, classic
  quiz metadata and assignment groups each carry source URLs and retrieval times.
- `scripts/orion-brain canvas-refresh 7434 ECON1115`: preview changes.
- `scripts/orion-brain canvas-refresh 7434 ECON1115 --apply`: on Nick's course
  import/refresh request, apply the source sections and properties to the existing
  course and linked assessment notes. CS2100 uses course 7419 and existing note
  `CS2100`; `AE1: Exam`/`AE2: Exam` reuse AE1/AE2 notes.

The existing Keychain reader in `orion-connect` retains token custody. Snapshots
use the shipped Canvas spec and configured host; pagination stays on the same
HTTPS origin and resource, refuses redirects and loops, and has a 20-page cap.
No submissions, questions, answers, quiz-attempt endpoints or Canvas mutations
are invoked. This feature schedules no polling, reminders or calendar events.

## Note format and preservation

Destination: indexed `~/Documents/orionBrain`, existing
`20 Areas/School/Courses`, plus its `60 Sources/Source Register.md`.
No repository brain mirror or parallel Classes hierarchy is written. The selected
parent must already be a course and match Canvas's name/code. Stable course and
assignment ids are bound after the first refresh; ambiguous mappings refuse.

Each note's `orion:canvas` HTML marker pair surrounds the replaceable source
facts. The latest block goes below the title so attribution and freshness survive
recall. API syllabus/description text is labelled and quoted after removing HTML,
scripts and styles; provider text cannot create graph links or marker boundaries.
Assessment briefs supplement their graded child rather than creating duplicate
assessments. Practice quizzes remain resources on the course parent.

Local timetable, study preferences, syllabus synthesis, weights and duration are
retained outside the block. Course/assignment bindings and API timing properties
refresh separately. Missing timing fields remove a stale current timing property
and retain its prior value under `prior_canvas_*`; `canvas_*_status` distinguishes
unavailable from explicitly not set. Both parent and children have real wikilinks.
Per-course source-register blocks refresh without duplicating previous attribution.

## Interpretation limits

- `due_at`, `unlock_at` and `lock_at` are separate fields, as effective for the
  requesting user. Raw offset-bearing API timestamps are preserved; local display
  uses the returned course timezone. Null, empty, zero, false, omitted fields and
  inaccessible endpoints remain distinct.
- A due listing never proves an in-person exam appointment, duration or room.
- Quiz settings are current configuration, not promises. Zero configured
  questions/points may conflict with a syllabus's planned question count.
  Quiz-specific attempts take precedence over generic assignment attempt metadata.
- Assignment-group weights are group percentages, not automatically individual
  assessment percentages. Existing syllabus weights are preserved.
- Classic quiz metadata may be inaccessible or omit a New Quiz. Such settings
  remain unavailable; no additional New Quizzes access is assumed.
- Assignment retrieval failure or incomplete pagination refuses the whole
  refresh. Optional endpoint denial is labelled rather than silently treated as
  an empty result. Only records visible to the current enrollment are known.
- The exclusion list is user-authored, never imported from Canvas content.
  CS2000/7349 remains excluded even while Canvas reports active enrollment.
- Direct files are verified after write. Apply requests one Basic Memory full-text
  reindex for the local `orion` project; its receipt distinguishes refreshed from
  pending/failed indexing. OpenClaw semantic-index freshness and a natural-language
  model turn remain separate proof gates.

## Conflicts, backups and rollback

Before writing, the entire plan is computed. A course-folder lock, unchanged-file
checks and unchanged-exclusion checks prevent lost local edits. Files are staged
then atomically renamed, and a failed apply restores its own already-written files
when they have not changed again. Crash atomicity across all files is not claimed.

Private backups and a manifest are under
`~/.openclaw/orion-controlled/canvas-backups/canvas-<course id>-<uuid>/`; the apply
receipt prints the exact path. To undo, inspect the manifest and restore the
previous files, preserving subsequent local edits. Notes marked `existed:false`
were newly created; remove them only after confirming they contain no later work.
Do not blindly restore the shared source register over newer unrelated entries.

Source rollback uses a normal revert commit. Installed wrapper rollback uses the
per-file backup in `.builds/canvas-brain/`; verify/re-record the installed integrity
manifest through its installer after a sanctioned rollback.

## API contracts checked

- [Courses](https://developerdocs.instructure.com/services/canvas/resources/courses):
  single-course GET, `include[]=syllabus_body`, course timezone.
- [Assignments](https://developerdocs.instructure.com/services/canvas/resources/assignments):
  descriptions, student-effective due/unlock/lock fields, all-course list.
- [Quizzes](https://developerdocs.instructure.com/services/canvas/resources/quizzes):
  classic quiz time limits, counts, attempts and access metadata.
- [Assignment groups](https://developerdocs.instructure.com/services/canvas/resources/assignment_groups):
  group weights and rules.
- [Pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination):
  opaque Link header continuation rather than guessing pages.

Focused checks: `node --test tests/connect.test.mjs tests/canvas-brain.test.mjs`;
also registered in `scripts/orion_v2_ci_check.sh`.
