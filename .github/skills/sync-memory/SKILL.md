---
name: sync-memory
description: Reconcile this repo's shared memory (CONTEXT.md and ADRs) with changes landed in the sibling TPT repos since the last approved sync. Use for "catch up the memory", "sync the stack memory", or checking cross-repo documentation drift; not for a routine weekly activity summary.
---

# Sync Memory

Sweep the sibling repos' default-branch history and propose evidence-backed memory
edits and follow-up tickets. Read `CONTEXT.md`, relevant `docs/adr/` records, and
`docs/agents/domain.md` before reconciling changes.

Work in two phases: **draft first**, then **apply only on approval**. Starting a
sync does not authorize memory edits, issue creation, or watermark advancement.
Never modify sibling application code, commit, or push.

## 1. Establish the window

Derive the sibling repo list from the repository map in `CONTEXT.md`, excluding
this repo. Map each slug to `navikt/<slug>`.

Read `docs/agents/sync-state.json` for each repo's `lastSyncedSha` and
`lastSyncedAt`. If a repo has no watermark, ask for a date, tag, or number of
weeks; do not silently sweep its entire history.

Pin each remote default-branch tip once at the start of the sweep and record its
SHA. Use that exact tip throughout the run, including any eventual watermark
update, so commits landing during review remain in the next window.

## 2. Collect landed changes

Prefer an existing sibling clone beside this repo when available. Fetch its
remote default branch without checking out or changing working files, and inspect
`lastSyncedSha..pinnedTip` with `git log --reverse`. Include merge commits so a
merge's conflict resolution or squash is not missed. Capture subjects, bodies,
and file summaries; inspect diffs only for plausible memory-worthy changes.

If no usable local clone exists, use `gh api`. Resolve the default branch
with `repos/<owner>/<repo>`, pin its tip with the commits endpoint, then compare:

```bash
gh api --paginate \
  'repos/<owner>/<repo>/compare/<lastSyncedSha>...<pinnedTip>?per_page=100' \
  --jq '.commits[] | {sha, message: .commit.message, html_url}'
```

Check comparison status and completeness. GitHub comparisons use merge-base
semantics; a diverged or unreachable watermark is not an ordinary incremental
window. Flag it and use the recorded date as an explicit fallback, enumerating
commits reachable from the pinned tip. Note date fallback limitations.

Merged PR titles and bodies provide context, but **PR lists alone are not a
complete history**: direct commits must also be covered. Paginate every history
or PR query; do not silently truncate at a fixed result limit. Mark inaccessible
repos or incomplete windows as blocked, not "no activity".
If access is denied by permissions or repository scope, report the denial and
ask the user to grant the required access. Do not bypass the restriction with
another tool or weaker guard configuration.

## 3. Reconcile against current memory

Surface changes that affect:

- Domain concepts, names, glossary entries, or retired synonyms.
- Cross-service HTTP triggers, callbacks, payloads, auth, or SSE signals.
- Capability ownership, data sources, storage, graph access, or deployment
  boundaries that warrant an architectural decision.
- Existing ADRs or glossary claims that the code contradicts.

The current transport decision is ADR-0005: HTTP callbacks and Postgres-backed
SSE, not Kafka. Verify both sides of changed contracts at their pinned tips.
Distinguish implemented behavior from proposals, scaffolding, and research.
Use code as evidence; do not infer architecture from commit titles alone.

Exclude routine dependency bumps, formatting, copy, tests, and refactors without
interface or architectural impact. Surface uncertainty rather than inventing a
decision. Follow `docs/agents/domain.md` when flagging ADR conflicts; never
silently rewrite an accepted decision to match code.

## 4. Present drafts

Report the pinned ranges and coverage, then group findings by repo and category:

1. **Memory-worthy changes** with a short explanation and PR or commit links.
   Identify changes already reflected in the memory instead of proposing them again.
2. **Concrete proposed diffs** to `CONTEXT.md` and, where justified, new ADR
   drafts using the repository format. Mark unconfirmed decisions for review.
3. **Candidate tickets** with target repos, evidence, and acceptance criteria.
   Check existing issues before proposing duplicates.

Keep volatile endpoint inventories in code rather than copying them into the
glossary. If there are no necessary edits or tickets, say so. Stop for approval;
leave memory files and watermarks untouched.

## 5. Apply the approved outcome

Apply only approved memory edits. For approved tickets, resolve `to-issues` from
the active skill catalog and follow it with `docs/agents/issue-tracker.md`.
If unavailable, leave ticket drafts and report the blocked handoff; do not
silently substitute another publishing workflow.

Advance `lastSyncedSha` to each fully reconciled repo's **pinned tip**, and set
`lastSyncedAt` to the sweep's recorded time, only after approval and completion
of its approved actions. Include fully reviewed no-activity repos. Never advance
blocked or partially reviewed windows. Report any partial outcome explicitly.

Stage only task-owned changes and leave them uncommitted. Report applied edits,
filed issue links, and advanced watermarks.
