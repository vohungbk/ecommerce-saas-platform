---
name: feature-development
description: Chạy quy trình phát triển tính năng đầy đủ (Planner -> Dev -> QA -> Reviewer)
---

# Feature Development Workflow

This workflow turns a feature request into reviewed, tested, committed code
by running four agents in sequence, each scoped to its own responsibility.
**Do not skip a step. Do not skip a checkpoint. Do not perform an agent's
job yourself instead of delegating to it.**

Inputs required to start: a feature description or ticket from the user. If
missing or ambiguous, ask before proceeding to Step 1.

---

## Step 1 — Planning

1. Invoke the `planner` agent (`.claude/agents/planner.md`) with the feature
   request. The planner is read-only — it must not write code.
2. Have the planner write its output to `plan.md` at the repo root:
   restated scope/non-goals, affected files/modules, ordered concrete
   steps, risks/edge cases, and testable acceptance criteria.
3. Print the contents of `plan.md` to the user.

### [HUMAN CHECKPOINT 1 — required]

**STOP.** Do not proceed to Step 2 under any circumstances until the user
explicitly approves `plan.md`.

- Ask the user to review `plan.md` and approve, request changes, or reject.
- If changes are requested, return to the `planner` agent with the feedback
  and regenerate `plan.md`, then re-present it for approval.
- Do not treat silence, an unrelated reply, or your own judgment as
  approval — approval must be explicit and about this plan.

---

## Step 2 — Implementation

1. Invoke the `dev` agent (`.claude/agents/dev.md`) with the approved
   `plan.md` as its instructions. The dev agent implements only what the
   plan specifies — no unplanned scope.
2. Apply the relevant rule file(s) based on what the plan touches:
   - Changes in `apps/api` → `@rules/backend.md`.
   - Changes in `apps/web` → `@rules/frontend.md`.
   - Changes touching both → apply both.
3. The dev agent writes code against each item in `plan.md`'s checklist,
   mirroring existing patterns and staying within the files/modules the
   plan identified.
4. If the dev agent finds the plan is wrong or incomplete, stop and return
   to Step 1 with the discrepancy — do not let the dev agent improvise a
   large deviation from an unapproved plan.

---

## Step 3 — Quality Assurance & Testing

1. Invoke the `qa` agent (`.claude/agents/qa.md`) and apply
   `@rules/testing.md` for what to test and minimum coverage.
2. The qa agent writes new test cases (unit and/or integration per
   `@rules/testing.md`) covering `plan.md`'s acceptance criteria, then runs
   the full test suite and linter for every package touched.
3. **Fix loop:** if any test or lint check fails, hand back to the `dev`
   agent (Step 2) with the qa agent's failure output to fix the specific
   issue — do not re-run the whole implementation step from scratch.
   Repeat qa → dev → qa until everything passes.
   - If the same failure persists after 3 fix attempts, stop and escalate
     to the user with the failure details instead of continuing to loop.
4. Do not proceed to Step 4 until the qa agent reports a pass verdict for
   every acceptance criterion in `plan.md`, `pnpm lint` passes, and
   `pnpm typecheck` passes for every touched package.

---

## Step 4 — Code Review & Final Human Approval

1. Invoke the `reviewer` agent (`.claude/agents/reviewer.md`) against the
   full diff produced in Steps 2–3. The reviewer is read-only and must not
   modify files, even to fix something trivial.
2. The reviewer evaluates correctness, architecture (per root `CLAUDE.md`),
   security/tenant isolation, performance (N+1s), maintainability, and test
   coverage — grouped into blocking issues, suggestions, and nitpicks.
3. If the reviewer reports blocking issues, hand back to the `dev` agent
   (Step 2) to fix them, then re-run Step 3 and Step 4 before proceeding.
4. Consolidate the reviewer's findings and a summary diff (files changed,
   lines added/removed, one-line description per file) for the user.

### [HUMAN CHECKPOINT 2 — required]

**STOP.** Do not proceed to Step 5 under any circumstances until the user
gives final explicit approval of the code.

- Present the consolidated review summary and the diff summary.
- Ask the user to approve, request changes, or reject.
- If changes are requested, return to Step 2 with the feedback, then repeat
  Step 3 and Step 4 before asking for approval again.

---

## Step 5 — Git Commit & Cleanup

1. Invoke the `dev` agent (`.claude/agents/dev.md`) and apply
   `@rules/git-commit.md` for the commit message format.
2. Stage only the files actually touched by this feature (never a broad
   `git add -A`) and create a Conventional Commit
   (`feat(<scope>): <summary>`, or `fix(...)`/`refactor(...)` if that better
   matches the change) — one logical commit, or several small ones if the
   change has distinct logical steps, per `@rules/git-commit.md`.
3. Delete the temporary `plan.md` file and confirm it is not included in
   the commit.
4. Print a final completion summary: feature implemented, files changed,
   tests added, commit hash(es) and message(s), and any follow-up items the
   reviewer flagged as non-blocking.

---

## Guardrails (apply throughout)

- Never let one agent silently do another agent's job (e.g. dev writing the
  plan, reviewer editing code). If a step's agent can't proceed within its
  own responsibility, stop and say so.
- Never skip a checkpoint or infer approval — both checkpoints require an
  explicit, on-topic "yes"/approval from the user.
- Never commit before Checkpoint 2 has passed.
- Never weaken a test assertion or skip a failing test to get through
  Step 3 — report the failure and keep iterating instead, per
  `@rules/testing.md` and root `CLAUDE.md`.