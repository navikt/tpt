---
name: sync-memory
description: Catch up this repo's shared memory (CONTEXT.md + docs/adr/) with what has actually landed in the sibling TPT repos since the last sync. Sweeps merged PRs and direct commits across the stack, finds memory-worthy changes (new or renamed domain terms, changed contracts, new Kafka topics, architectural decisions), and produces proposed memory edits plus draft tickets — all for your approval. Use when the user says "catch up the memory", "what changed across the repos", "sync the stack memory", "reconcile CONTEXT.md", or starts a cross-repo research session and wants to know what has drifted.
---

# Sync Memory

Keep this repo's **shared memory** — `CONTEXT.md` and `docs/adr/` — in sync with what has actually
landed in the sibling TPT repos, even when that work was done by people not using agents, or agents
not using `wayfinder`.

The memory is only useful if it reflects reality. Code lands in `tpt-backend`, `tpt-frontend`,
`tpt-data-collector`, and `tpt-graph` without ever touching this repo. This skill closes that gap
by **pulling**: it sweeps each sibling repo's history since a recorded watermark, reconciles what it
finds against the memory, and proposes updates.

This skill never writes memory or files tickets without your approval. It ends by handing ticket
drafts to `to-tickets` and advancing the watermark.

## Process

### 1. Load the watermark

Read `docs/agents/sync-state.json`. It records, per repo, the last commit SHA that was reconciled
and the date it was synced:

```json
{
  "repos": {
    "navikt/tpt-backend": { "lastSyncedSha": "abc1234", "lastSyncedAt": "2026-08-01T00:00:00Z" },
    "navikt/tpt-frontend": { "lastSyncedSha": "def5678", "lastSyncedAt": "2026-08-01T00:00:00Z" }
  }
}
```

- **File exists** → for each repo, the window is `lastSyncedSha..HEAD` (or `--since lastSyncedAt` when
  the SHA is unreachable, e.g. after a force-push).
- **File missing or a repo absent from it** → this is a first sync for that repo. Ask the user for a
  start point (a date, a tag, or "last N weeks"). Do not silently sweep the entire history.

### 2. Determine the repo list

Read the **repository map** table in `CONTEXT.md` (repo root). The sibling repos are every row whose
slug is not `tpt` (this repo). Keep the list derived from `CONTEXT.md` so it stays correct as the
stack evolves — do not hardcode it here.

Map each slug to `navikt/<slug>`.

### 3. Fetch changes per repo

Prefer a **local clone** when one exists at `~/IdeaProjects/<slug>` — it is faster and avoids API
rate limits. Otherwise use `gh`.

**Local clone** (fetch first so the range is current):

```bash
git -C ~/IdeaProjects/<slug> fetch --quiet origin
# Commits in the window, oldest first, with subject + body
git -C ~/IdeaProjects/<slug> log --no-merges --reverse \
  --pretty=format:'%H%x09%an%x09%ad%x09%s' --date=short \
  <lastSyncedSha>..origin/HEAD
# Current HEAD to become the new watermark
git -C ~/IdeaProjects/<slug> rev-parse origin/HEAD
```

**Via `gh`** (merged PRs give the best signal since they carry titles, bodies, and labels):

```bash
gh pr list --repo navikt/<slug> --state merged \
  --search "merged:>=<lastSyncedAt>" \
  --json number,title,body,mergedAt,url,author,labels,mergeCommit --limit 100
```

For deeper inspection of a specific change, read the PR body or the commit diff — but only for
changes that look memory-worthy in the next step. Do not diff everything.

If a repo has no changes in the window, note it as "no activity" and still advance its watermark.

### 4. Reconcile against the memory

This is the core of the skill. For each change, decide: **does the memory need to know about this?**

First read the memory so you can judge against it:

- `CONTEXT.md` — the ubiquitous language table, retired synonyms, repository map, architectural intent.
- `docs/adr/` — existing decisions in the areas the changes touch.

Then classify each change:

**Memory-worthy** (surface it):

- A **new or renamed domain concept** — a term that belongs in the glossary, or a rename that makes a
  glossary term or a "retired synonym" stale.
- A **changed contract between services** — Kafka topic added/renamed/reshaped, schema change, a new
  or removed API surface that another repo depends on. The backend↔collector Kafka seam and any
  graph-access boundary are especially load-bearing.
- An **architectural decision** — something that should have been (or now warrants) an ADR: a new
  datasource, a new external dependency, a change to auth/sidecar handling, a shift in who owns what.
- A change that **contradicts an existing ADR or the glossary** — flag it explicitly rather than
  silently reconciling. Follow the `docs/agents/domain.md` rule for ADR conflicts.

**Routine** (exclude, but keep the watermark moving): dependency bumps, formatting, test-only changes,
copy tweaks, CI config, refactors with no interface impact.

When unsure, lean toward surfacing — a false positive costs one line in a report; a false negative
means the memory silently rots.

### 5. Produce drafts — do not write yet

Present, grouped by repo and then by category:

1. **Memory-worthy changes** — each with a one-line "why it matters" and a link to the PR/commit.
2. **Proposed memory edits** — concrete, reviewable diffs:
   - Glossary additions/edits to `CONTEXT.md`, using the project's own vocabulary.
   - Repository-map or architectural-intent updates.
   - New ADR stubs in `docs/adr/` for decisions that landed without one (title, status, context,
     decision, consequences — filled from what you found, marked for the user to confirm).
   - ADR-conflict flags, phrased as in `docs/agents/domain.md`.
3. **Candidate tickets** — cross-cutting follow-ups the changes imply (e.g. "the collector added
   topic X; the backend consumer needs to handle field Y"). These are drafts for `to-tickets`, not
   yet filed.

Let the user edit, drop, or add before anything is written.

### 6. On approval — write, file, advance

Once the user approves:

1. **Apply the memory edits** to `CONTEXT.md` and `docs/adr/`.
2. **File the tickets** by handing the approved candidate tickets to the `to-tickets` skill, which
   publishes them to the configured issue tracker (see `docs/agents/issue-tracker.md`) in the
   correct sibling repos. Do not reimplement ticket creation here.
3. **Advance the watermark** — update each repo's `lastSyncedSha` to the HEAD you fetched in step 3
   and `lastSyncedAt` to now, in `docs/agents/sync-state.json`. This is what makes the next run
   incremental. Advance it for every repo you swept, including no-activity ones.

Report what was written, what was filed (with links), and the new watermark.

## Notes

- **The watermark is per-repo and only advances on a completed, approved run.** If the user aborts,
  leave it untouched so the next run re-covers the same window.
- **This is a pull mechanism by design.** It catches changes regardless of how they were authored,
  which is the whole point — the team is a mix of agent and non-agent, wayfinder and non-wayfinder.
- **Memory edits and tickets both go through human approval.** The skill proposes; the user disposes.
